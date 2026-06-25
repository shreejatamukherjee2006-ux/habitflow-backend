const express = require("express");
const jwt     = require("jsonwebtoken");
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
  if (!h) return res.status(401).json({ message: "No token provided" });
  try {
    req.userId = jwt.verify(h.split(" ")[1], process.env.JWT_SECRET || "habitflow_secret").id;
    next();
  } catch(e) { res.status(401).json({ message: "Invalid token" }); }
}

router.post("/chat", auth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ message: "Message is required" });

    const { Habit, User, mode } = getDB();

    const habits = mode === "mongo"
      ? await Habit.find({ user: req.userId })
      : Habit.find({ user: req.userId });

    const user = mode === "mongo"
      ? await User.findById(req.userId)
      : User.findById(req.userId);

    let totalCompletions = 0, longestStreak = 0;
    habits.forEach(h => {
      totalCompletions += (h.completedDates || []).length;
      if ((h.streak || 0) > longestStreak) longestStreak = h.streak;
    });

    const completionRate = habits.length === 0
      ? 0 : Math.min(((totalCompletions / (habits.length * 30)) * 100), 100);
    const totalXP = user?.xp || 0;
    const level   = Math.floor(totalXP / 100) + 1;
    const lowerMsg = message.toLowerCase();
    let reply = "";

    if (lowerMsg.includes("improve") || lowerMsg.includes("better")) {
      if (completionRate < 30)
        reply = `Your completion rate is ${completionRate.toFixed(0)}% — quite low. Try focusing on just 1–2 core habits and build from there. Small wins compound! 💪`;
      else if (completionRate < 60)
        reply = `You're at ${completionRate.toFixed(0)}% completion — decent progress! Try habit stacking: attach new habits to ones you already do daily.`;
      else
        reply = `Great work! You're completing ${completionRate.toFixed(0)}% of your habits. Focus on maintaining streaks and gradually adding harder challenges.`;
    } else if (lowerMsg.includes("streak")) {
      if (longestStreak === 0)
        reply = "You haven't started a streak yet! Complete a habit today to begin. The first day is always the hardest. 🔥";
      else if (longestStreak < 7)
        reply = `Your longest streak is ${longestStreak} days — keep going! Reaching 7 days unlocks the Consistency Builder badge. 🥈`;
      else
        reply = `Impressive! Your longest streak is ${longestStreak} days. Don't break the chain! 🔥`;
    } else if (lowerMsg.includes("level") || lowerMsg.includes("xp")) {
      const xpToNext = 100 - (totalXP % 100);
      reply = `You're Level ${level} with ${totalXP} XP. Only ${xpToNext} XP until Level ${level + 1}! 🚀`;
    } else if (lowerMsg.includes("motivat") || lowerMsg.includes("inspire")) {
      const quotes = [
        "Small daily actions compound into extraordinary results. You're building something great!",
        "Every time you complete a habit, you cast a vote for the person you want to become.",
        "Progress, not perfection. One habit at a time.",
        "The secret to success is consistency. Show up today, even if it's small.",
      ];
      reply = quotes[Math.floor(Math.random() * quotes.length)] + " 💡";
    } else if (lowerMsg.includes("today")) {
      const today = new Date().toISOString().split("T")[0];
      const doneToday = habits.filter(h => (h.completedDates || []).includes(today)).length;
      reply = `Today you've completed ${doneToday} out of ${habits.length} habit${habits.length !== 1 ? "s" : ""}. ${doneToday === habits.length ? "Perfect day! 🎉" : "Keep going! 💪"}`;
    } else {
      reply = `You have ${habits.length} habits tracked with a ${completionRate.toFixed(0)}% completion rate. Ask me about streaks, XP, how to improve, motivation, or what you've done today!`;
    }

    res.json({ reply });
  } catch(e) {
    console.error("Chat error:", e);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;