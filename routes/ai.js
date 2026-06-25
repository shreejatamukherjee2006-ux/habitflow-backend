const express = require("express");
const jwt     = require("jsonwebtoken");
const https   = require("https");
const router  = express.Router();

function getDB() {
  try {
    const mongoose = require("mongoose");
    if (mongoose.connection.readyState === 1) {
      return { Habit: require("../models/habit"), User: require("../models/user"), mode: "mongo" };
    }
  } catch(e) {}
  const local = require("../localdb");
  return { Habit: local.Habits, User: local.Users, mode: "local" };
}

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ message: "No token" });
  try {
    req.userId = jwt.verify(h.split(" ")[1], process.env.JWT_SECRET || "habitflow_secret").id;
    next();
  } catch(e) { res.status(401).json({ message: "Invalid token" }); }
}

function callClaude(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const key = (process.env.ANTHROPIC_API_KEY || "").trim();
    if (!key) return reject(new Error("NO_API_KEY"));

    const body = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }]
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || "API error"));
          const text = parsed.content?.[0]?.text;
          if (!text) return reject(new Error("Empty response"));
          resolve(text);
        } catch(e) { reject(new Error("Parse error")); }
      });
    });

    req.on("error", e => reject(new Error("Network: " + e.message)));
    req.setTimeout(60000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });
}

// Repair truncated JSON by closing open structures
function repairJSON(str) {
  let s = str.trim();
  // Remove trailing incomplete key-value or comma
  s = s.replace(/,\s*$/, "");
  s = s.replace(/,\s*"[^"]*"\s*:\s*"[^"]*$/, "");
  s = s.replace(/,\s*"[^"]*"\s*:\s*$/, "");
  s = s.replace(/"[^"]*$/, '"...')  ; // close unterminated string

  // Count open braces/brackets and close them
  let opens = 0, aopens = 0;
  for (let c of s) {
    if (c === "{") opens++;
    else if (c === "}") opens--;
    else if (c === "[") aopens++;
    else if (c === "]") aopens--;
  }
  // Close any open arrays first, then objects
  for (let i = 0; i < aopens; i++) s += "]";
  for (let i = 0; i < opens; i++) s += "}";

  try {
    return JSON.parse(s);
  } catch(e) {
    // Last resort — extract whatever we can
    console.log("⚠️ Repair failed, using partial data");
    const partial = {};
    const titleMatch = s.match(/"planTitle"\s*:\s*"([^"]+)"/);
    const summaryMatch = s.match(/"summary"\s*:\s*"([^"]+)"/);
    if (titleMatch) partial.planTitle = titleMatch[1];
    if (summaryMatch) partial.summary = summaryMatch[1];
    partial._repaired = true;
    return partial;
  }
}

// ── POST /api/ai/coach ──────────────────────────────
router.post("/coach", auth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ message: "Message required" });

    const { Habit, User, mode } = getDB();
    const habits = mode === "mongo" ? await Habit.find({ user: req.userId }) : Habit.find({ user: req.userId });
    const user   = mode === "mongo" ? await User.findById(req.userId) : User.findById(req.userId);

    const today      = new Date().toISOString().split("T")[0];
    const totalComp  = habits.reduce((s, h) => s + (h.completedDates?.length || 0), 0);
    const bestStreak = habits.reduce((m, h) => Math.max(m, h.streak || 0), 0);
    const doneToday  = habits.filter(h => (h.completedDates || []).includes(today)).length;
    const rate       = habits.length > 0 ? Math.round((totalComp / (habits.length * 30)) * 100) : 0;
    const habitList  = habits.map(h =>
      `- ${h.title} (${h.category}): ${h.streak || 0} day streak, ${(h.completedDates||[]).length} completions`
    ).join("\n");

    const system = `You are Coach Aria, a warm motivating AI habit coach inside HabitFlow+.
Always reference the user's specific habits, streaks and numbers. Be conversational and give concrete advice. Keep replies to 3-5 sentences.

USER: ${user?.name || "User"} | Level ${Math.floor((user?.xp||0)/100)+1} | ${user?.xp||0} XP
HABITS (${habits.length} total, ${rate}% completion, ${bestStreak} day best streak):
${habitList || "No habits yet"}
Done today: ${doneToday}/${habits.length}`;

    try {
      const reply = await callClaude(system, message);
      return res.json({ reply, source: "ai" });
    } catch(aiErr) {
      console.error("Coach AI error:", aiErr.message);
      return res.json({ reply: `I'm having trouble connecting to my AI brain right now (${aiErr.message}).`, source: "error" });
    }
  } catch(e) {
    console.error("Coach route error:", e);
    res.status(500).json({ message: "Coach unavailable." });
  }
});

// ── POST /api/ai/plan ── DEEP LIFE PLAN ────────────
router.post("/plan", auth, async (req, res) => {
  try {
    const { goal, timeAvailable, level, duration, timePreference, wakeTime, sleepTime } = req.body;
    if (!goal) return res.status(400).json({ message: "Goal required" });

    const { Habit, mode } = getDB();
    const habits   = mode === "mongo" ? await Habit.find({ user: req.userId }) : Habit.find({ user: req.userId });
    const existing = habits.map(h => h.title).join(", ");

    const g = goal.toLowerCase();
    const isFitness = g.includes("weight") || g.includes("fit") || g.includes("gym") || g.includes("muscle") || g.includes("cardio") || g.includes("run");
    const isStudy   = g.includes("study") || g.includes("exam") || g.includes("learn") || g.includes("grade") || g.includes("school") || g.includes("college");
    const isSleep   = g.includes("sleep");
    const isStress  = g.includes("stress") || g.includes("mental") || g.includes("anxiety") || g.includes("calm");
    const isProductivity = g.includes("productiv") || g.includes("procrastin") || g.includes("focus") || g.includes("work");

    const goalContext = isFitness
      ? `This is a FITNESS/WEIGHT LOSS goal. You MUST:
- Design a specific workout split (e.g. Mon/Wed/Fri strength + Tue/Thu cardio + weekend active rest)
- Give exact exercises with sets, reps, rest periods (e.g. "3 sets x 12 squats, 60s rest")
- Specify cardio type, duration and intensity (e.g. "20 min HIIT: 40s work / 20s rest x 10 rounds")
- Create a COMPLETE nutrition plan: exact foods, portion sizes, macros guidance, meal timing
- Include what to eat PRE and POST workout
- Specify foods to strictly avoid and why
- Include a calorie deficit strategy (NOT starvation — healthy 300-500 cal deficit)
- Address hydration, sleep, and recovery as part of the fitness plan
- Weekly workout structure must vary intensity (heavy, moderate, light, rest)`
      : isStudy
      ? `This is a STUDY/ACADEMIC goal. You MUST:
- Design specific study blocks using proven techniques (Pomodoro, active recall, spaced repetition, Feynman technique)
- Give exact session structure (e.g. "25 min active recall → 5 min break → repeat x 3")
- Specify subject rotation strategy so no subject is neglected
- Include brain food nutrition recommendations for focus and memory
- Design morning, afternoon and evening study blocks based on time available
- Include how to handle distractions, phone, social media
- Include weekly review and practice test strategy
- Address sleep as critical for memory consolidation`
      : isStress
      ? `This is a MENTAL WELLNESS/STRESS goal. You MUST:
- Include specific breathwork techniques with exact counts (e.g. box breathing: 4-4-4-4)
- Design a morning and evening mindfulness routine with exact steps
- Include physical movement (even light yoga or walks) as stress relief
- Recommend specific journaling prompts
- Include digital detox windows in the daily schedule
- Address sleep hygiene in detail
- Include social connection time
- Recommend nutrition changes that reduce cortisol (e.g. reduce caffeine, increase magnesium foods)`
      : isProductivity
      ? `This is a PRODUCTIVITY goal. You MUST:
- Design time-blocked deep work sessions with exact durations
- Include specific task prioritization method (e.g. MIT — Most Important Task first)
- Design an evening planning ritual to prep for next day
- Include specific strategies for beating procrastination (2-minute rule, implementation intentions)
- Include digital environment setup (which apps to block, notification settings)
- Balance deep work with recovery to avoid burnout`
      : `This is a general self-improvement goal. Make it highly specific and actionable for this exact goal.`;

    const system = `You are a life coach, personal trainer and nutritionist. Create specific, actionable transformation plans. RESPOND ONLY WITH VALID JSON — no markdown, no text outside the JSON.`;

    const userMsg = `Goal: "${goal}". Wake: ${wakeTime||"6:30 AM"}. Sleep: ${sleepTime||"10:30 PM"}. Free time: ${timeAvailable||"30 min"}. Level: ${level||"Beginner"}.

Reply with ONLY this JSON (no markdown):
{"planTitle":"string","summary":"string","weeklyGoal":"string","dailySchedule":[{"timeSlot":"string","activity":"string","category":"Morning Routine|Workout|Nutrition|Study|Self-Care|Evening Routine","description":"string","whyItMatters":"string","duration":"string","tips":["string","string"]}],"nutritionPlan":{"principles":["string","string","string"],"meals":[{"meal":"string","time":"string","foods":["string","string","string"],"avoid":["string","string"],"why":"string"}],"hydration":"string"},"weeklyStructure":{"Monday":{"focus":"string","keyActivities":["string","string"]},"Tuesday":{"focus":"string","keyActivities":["string"]},"Wednesday":{"focus":"string","keyActivities":["string"]},"Thursday":{"focus":"string","keyActivities":["string"]},"Friday":{"focus":"string","keyActivities":["string"]},"Saturday":{"focus":"string","keyActivities":["string"]},"Sunday":{"focus":"string","keyActivities":["string"]}},"habits":[{"title":"string","category":"Health|Fitness|Study|Productivity|General","why":"string","difficulty":"Easy|Medium|Hard","timeMinutes":20,"reminderTime":"07:00","howTo":"string"}],"milestones":[{"week":1,"goal":"string","reward":"string"},{"week":4,"goal":"string","reward":"string"}],"doNotList":["string","string","string"],"mindsetTips":["string","string"],"tips":["string","string"]}

Rules: 4 dailySchedule items, 3 meals, 4 habits. Specific to the goal. Indian food options for nutrition.`;


    try {
      const raw   = await callClaude(system, userMsg);
      console.log("🔍 RAW AI RESPONSE (first 500 chars):", raw.substring(0, 500));
      console.log("🔍 RAW AI RESPONSE (last 500 chars):", raw.substring(raw.length - 500));
      const clean = raw.replace(/```json|```/g, "").trim();
      let plan;
      try {
        plan = JSON.parse(clean);
      } catch(parseErr) {
        // Try to repair truncated JSON
        console.log("⚠️ JSON truncated, attempting repair...");
        plan = repairJSON(clean);
      }
      console.log("✅ Deep plan generated for:", goal);
      console.log("📋 Plan keys:", Object.keys(plan));
      console.log("🥗 Has nutritionPlan:", !!plan.nutritionPlan);
      return res.json({ ...plan, source: "ai" });
    } catch(aiErr) {
      console.error("Plan AI error:", aiErr.message);
      // Detailed local fallback
      return res.json(buildLocalPlan(goal, timeAvailable, level, existing));
    }
  } catch(e) {
    console.error("Plan route error:", e);
    res.status(500).json({ message: "Could not generate plan." });
  }
});

function buildLocalPlan(goal, timeAvailable, level, existing) {
  const g = goal.toLowerCase();
  const isFitness = g.includes("weight") || g.includes("fit") || g.includes("gym") || g.includes("exercise");
  const isStudy   = g.includes("study") || g.includes("exam") || g.includes("learn");
  const isSleep   = g.includes("sleep");
  const isStress  = g.includes("stress") || g.includes("mental") || g.includes("anxiety");

  const schedule = isFitness ? [
    { timeSlot:"6:00 AM – 6:10 AM", activity:"Wake Up Routine", category:"Morning Routine", description:"Drink 500ml water immediately. Open curtains for natural light. Do 10 deep breaths.", whyItMatters:"Rehydrates after sleep and raises cortisol naturally for energy.", duration:"10 minutes", tips:["Keep water bottle on nightstand","No phone for first 10 min"] },
    { timeSlot:"6:10 AM – 6:40 AM", activity:"Morning Workout", category:"Workout", description:"Day 1/3/5: HIIT — 30s jumping jacks → 30s rest × 10 rounds. Day 2/4: Strength — 3×12 push-ups, 3×15 squats, 3×10 lunges each leg.", whyItMatters:"Morning exercise boosts metabolism by 15% for the rest of the day.", duration:"30 minutes", tips:["Start with just 15 min if needed","Track reps in a notebook"] },
    { timeSlot:"7:00 AM – 7:20 AM", activity:"High-Protein Breakfast", category:"Nutrition", description:"2 boiled eggs + 1 bowl oats with banana OR Greek yogurt with nuts and berries. Avoid sugary cereals and white bread.", whyItMatters:"Protein at breakfast reduces hunger hormones for up to 4 hours.", duration:"20 minutes", tips:["Prep overnight oats the night before","Add cinnamon to reduce blood sugar spikes"] },
    { timeSlot:"1:00 PM – 1:30 PM", activity:"Balanced Lunch", category:"Nutrition", description:"Half plate vegetables, quarter plate lean protein (chicken/lentils/tofu), quarter plate whole grains (brown rice/quinoa). Eat slowly.", whyItMatters:"Balanced macros prevent afternoon energy crash and cravings.", duration:"30 minutes", tips:["Chew each bite 20 times","No screens while eating"] },
    { timeSlot:"6:00 PM – 6:30 PM", activity:"Evening Walk", category:"Workout", description:"30-minute brisk walk at 5-6 km/h pace. Keep phone away. Focus on breathing. Can listen to a podcast.", whyItMatters:"Post-dinner walks reduce blood sugar by 22% and improve fat burning overnight.", duration:"30 minutes", tips:["Walk within 30 min of dinner","Bring a friend for accountability"] },
    { timeSlot:"9:30 PM – 10:00 PM", activity:"Wind Down", category:"Evening Routine", description:"No food after 8 PM. Stretch for 10 min (hamstrings, hip flexors, shoulders). Write 3 wins from today in a journal.", whyItMatters:"Stretching improves recovery. Journaling reduces cortisol before bed.", duration:"30 minutes", tips:["Dim lights after 9 PM","No social media last 30 min"] }
  ] : isStudy ? [
    { timeSlot:"6:30 AM – 7:00 AM", activity:"Morning Brain Warm-Up", category:"Morning Routine", description:"Review yesterday's notes for 10 min. Solve 2-3 easy problems from the day before. Drink water and eat breakfast.", whyItMatters:"Spaced repetition during morning consolidates memory formed during sleep.", duration:"30 minutes", tips:["Keep notes on your desk overnight","No social media before studying"] },
    { timeSlot:"9:00 AM – 10:30 AM", activity:"Deep Study Block 1", category:"Study", description:"Pomodoro: 25 min focused study → 5 min break × 3 rounds. Cover hardest subject first. Use active recall — close book and write what you remember.", whyItMatters:"Active recall is 3x more effective than re-reading.", duration:"90 minutes", tips:["Put phone in another room","Use forest app or timer"] },
    { timeSlot:"3:00 PM – 4:30 PM", activity:"Deep Study Block 2", category:"Study", description:"Practice problems and past papers. Focus on weak areas identified in Block 1. Write summary notes by hand.", whyItMatters:"Handwriting notes improves retention by 40% vs typing.", duration:"90 minutes", tips:["Test yourself with flashcards","Teach concepts out loud"] },
    { timeSlot:"7:00 PM – 7:30 PM", activity:"Light Review", category:"Study", description:"30 min review of the day's material. Create mind maps or summaries. Don't start new topics.", whyItMatters:"Reviewing within 24 hours improves retention from 40% to 80%.", duration:"30 minutes", tips:["Use color coding in notes","Keep a 'confused list' for next day"] },
    { timeSlot:"10:00 PM – 10:30 PM", activity:"Sleep Prep", category:"Evening Routine", description:"Stop all screens. Read 10 pages of a light book. Write tomorrow's study plan. Sleep by 10:30 PM.", whyItMatters:"8 hours of sleep consolidates memory and improves recall by 20%.", duration:"30 minutes", tips:["Consistent sleep time is crucial","Cold room (18-20°C) improves sleep quality"] }
  ] : [
    { timeSlot:"7:00 AM – 7:15 AM", activity:"Morning Intention", category:"Morning Routine", description:"Write 3 intentions for the day. 5 min meditation — breathe in 4 counts, hold 4, out 6. Drink water.", whyItMatters:"Setting intentions increases goal completion by 30%.", duration:"15 minutes", tips:["Keep a journal on your desk","No phone for first 20 min"] },
    { timeSlot:"9:00 AM – 11:00 AM", activity:"Deep Work Block", category:"Work", description:"Work on your most important task first. No meetings, no notifications. Use Pomodoro (25/5).", whyItMatters:"Cognitive performance peaks 2-4 hours after waking.", duration:"2 hours", tips:["Batch all emails to 11 AM","Close all tabs except what you need"] },
    { timeSlot:"1:00 PM – 1:30 PM", activity:"Mindful Lunch + Walk", category:"Self-Care", description:"Eat a balanced lunch away from your desk. Take a 10-min walk outside afterward.", whyItMatters:"Midday walks reduce afternoon fatigue by 30%.", duration:"30 minutes", tips:["Prep lunch the night before","Walk in sunlight for vitamin D"] },
    { timeSlot:"9:00 PM – 9:30 PM", activity:"Evening Reset", category:"Evening Routine", description:"Review what you accomplished. Write tomorrow's top 3 tasks. 10 min stretch. No screens after 9:30 PM.", whyItMatters:"Planning the night before reduces morning decision fatigue.", duration:"30 minutes", tips:["Keep a consistent sleep schedule","Gratitude journaling reduces anxiety"] }
  ];

  const habits = isFitness ? [
    { title:"Morning Workout (30 min)", category:"Fitness", why:"Burns calories and boosts metabolism all day", difficulty:"Medium", timeMinutes:30, reminderTime:"06:10", howTo:"Alternate HIIT and strength days. Start with 15 min if needed and build up." },
    { title:"Drink 8 Glasses of Water", category:"Health", why:"Proper hydration reduces false hunger signals", difficulty:"Easy", timeMinutes:5, reminderTime:"08:00", howTo:"Drink 1 glass on wake, 1 with each meal, 1 mid-morning, 1 mid-afternoon, 1 evening." },
    { title:"Evening Walk (30 min)", category:"Fitness", why:"Post-dinner walks reduce blood sugar and burn fat", difficulty:"Easy", timeMinutes:30, reminderTime:"18:00", howTo:"Walk at a pace where you can talk but feel slightly breathless." },
    { title:"No Sugar After 7 PM", category:"Health", why:"Reduces caloric intake and improves sleep quality", difficulty:"Medium", timeMinutes:1, reminderTime:"19:00", howTo:"Replace evening snacks with herbal tea or a small handful of nuts." },
    { title:"Protein-First Meals", category:"Health", why:"Protein triggers satiety hormones reducing overeating", difficulty:"Easy", timeMinutes:5, reminderTime:"07:00", howTo:"Ensure every meal has a protein source — eggs, chicken, lentils, Greek yogurt, tofu." }
  ] : isStudy ? [
    { title:"Morning Review (10 min)", category:"Study", why:"Spaced repetition during morning consolidates memory", difficulty:"Easy", timeMinutes:10, reminderTime:"06:30", howTo:"Flip through yesterday's notes without re-reading fully. Just trigger recall." },
    { title:"Deep Study Block (90 min)", category:"Study", why:"Active recall triples retention vs passive reading", difficulty:"Hard", timeMinutes:90, reminderTime:"09:00", howTo:"25 min study, 5 min break. After each session, write everything you remember." },
    { title:"Practice Problems Daily", category:"Study", why:"Application cements understanding better than reading", difficulty:"Medium", timeMinutes:45, reminderTime:"15:00", howTo:"Do 10 practice questions per subject. Review every wrong answer carefully." },
    { title:"Sleep by 10:30 PM", category:"Health", why:"Sleep consolidates memory — critical before exams", difficulty:"Medium", timeMinutes:5, reminderTime:"22:00", howTo:"Set a 10 PM alarm as a wind-down signal. Stop studying at 10 PM." }
  ] : [
    { title:"Morning Meditation (10 min)", category:"General", why:"Reduces cortisol and sets a calm tone for the day", difficulty:"Easy", timeMinutes:10, reminderTime:"07:00", howTo:"Sit comfortably. Breathe in 4 counts, hold 4, out 6. Repeat 10 times." },
    { title:"Daily Planning (10 min)", category:"Productivity", why:"Planning reduces decision fatigue and increases output", difficulty:"Easy", timeMinutes:10, reminderTime:"08:00", howTo:"Write top 3 tasks for the day. Time-block them in your calendar." },
    { title:"Evening Journal (10 min)", category:"General", why:"Reflection reduces anxiety and improves self-awareness", difficulty:"Easy", timeMinutes:10, reminderTime:"21:00", howTo:"Write 3 wins, 1 thing to improve, and tomorrow's intention." }
  ];

  return {
    planTitle: "Your " + goal + " Transformation Plan",
    summary: "A comprehensive day-by-day plan tailored to your goal. Follow the daily schedule consistently for real results.",
    weeklyGoal: "Complete 80% of your daily schedule every day this week.",
    dailySchedule: schedule,
    nutritionPlan: isFitness ? {
      principles: ["Eat in a 200-300 calorie deficit — not starvation", "Protein at every meal to preserve muscle", "Eat whole foods 80% of the time, allow 20% flexibility"],
      meals: [
        { meal:"Breakfast", time:"7:00 AM", foods:["2 boiled eggs", "Oats with banana", "Green tea"], avoid:["Sugary cereals", "White bread", "Fruit juices"], why:"High protein + complex carbs fuel your morning workout recovery." },
        { meal:"Lunch", time:"1:00 PM", foods:["Grilled chicken or dal", "Brown rice or roti", "Large salad"], avoid:["Fried foods", "White rice in large portions", "Sodas"], why:"Balanced macros prevent afternoon energy crash." },
        { meal:"Dinner", time:"7:00 PM", foods:["Steamed vegetables", "Lean protein", "Soup"], avoid:["Heavy carbs after 7 PM", "Desserts", "Large portions"], why:"Light dinner improves sleep and allows overnight fat burning." },
        { meal:"Snack", time:"4:00 PM", foods:["Handful of nuts", "Greek yogurt", "Apple with peanut butter"], avoid:["Chips", "Biscuits", "Chocolates"], why:"Healthy snack prevents overeating at dinner." }
      ],
      hydration: "Drink minimum 2.5-3 litres of water daily. Start with 500ml on waking. No sugary drinks."
    } : null,
    weeklyStructure: {
      Monday:    { focus:"Start strong", keyActivities: habits.slice(0,2).map(h=>h.title) },
      Tuesday:   { focus:"Build momentum", keyActivities: habits.slice(0,3).map(h=>h.title) },
      Wednesday: { focus:"Midweek push", keyActivities: habits.map(h=>h.title) },
      Thursday:  { focus:"Stay consistent", keyActivities: habits.slice(0,3).map(h=>h.title) },
      Friday:    { focus:"Finish strong", keyActivities: habits.map(h=>h.title) },
      Saturday:  { focus:"Active recovery", keyActivities: ["Light stretching","Review week progress","Meal prep for next week"] },
      Sunday:    { focus:"Rest & plan", keyActivities: ["Full rest","Plan next week","Celebrate wins"] }
    },
    habits,
    milestones: [
      { week:1, goal:"Complete 5 out of 7 days of your schedule", reward:"Buy yourself a new water bottle or gym accessory" },
      { week:2, goal:"Notice first physical/mental changes", reward:"Share progress with a friend or take a progress photo" },
      { week:4, goal:"Full 30-day transformation", reward:"Treat yourself to something meaningful — you earned it" }
    ],
    doNotList: isFitness
      ? ["Skip breakfast — it sets you up to overeat later", "Do intense exercise every day without rest — leads to burnout", "Weigh yourself daily — once a week is enough", "Cut out all carbs — your brain needs glucose"]
      : ["Check your phone first thing in the morning", "Multitask during deep work blocks", "Skip sleep to study or work more", "Compare your progress to others"],
    mindsetTips: [
      "Progress over perfection — a bad day doesn't erase a good week",
      "Track your wins, not just your failures",
      "Tell one person about your goal — accountability doubles success rates"
    ],
    tips: ["Start with 2-3 habits, not all at once", "The first 3 days are hardest — push through them", "Your environment shapes behavior — set up your space for success"],
    source: "local"
  };
}

module.exports = router;