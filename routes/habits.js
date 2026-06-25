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
  if (!h) return res.status(401).json({ message: "No token" });
  try {
    req.userId = jwt.verify(h.split(" ")[1], process.env.JWT_SECRET || "habitflow_secret").id;
    next();
  } catch(e) { res.status(401).json({ message: "Invalid token" }); }
}

// GET ALL HABITS
router.get("/", auth, async (req, res) => {
  try {
    const { Habit, mode } = getDB();
    const habits = mode === "mongo"
      ? await Habit.find({ user: req.userId }).sort({ createdAt: -1 })
      : Habit.find({ user: req.userId });
    const today = new Date().toISOString().split("T")[0];
    const result = habits.map(h => {
      const obj = mode === "mongo" ? h.toObject() : { ...h };
      obj.completedToday = (obj.completedDates || []).includes(today);
      return obj;
    });
    res.json(result);
  } catch(e) {
    console.error("GET habits error:", e);
    res.status(500).json({ message: "Server error" });
  }
});

// CREATE HABIT
router.post("/", auth, async (req, res) => {
  try {
    const { title, category, reminderTime } = req.body;
    if (!title) return res.status(400).json({ message: "Title is required" });
    const { Habit, mode } = getDB();
    let habit;
    if (mode === "mongo") {
      habit = await new Habit({
        title: title.trim(), category: category || "General",
        reminderTime: reminderTime || "", user: req.userId,
        streak: 0, completedDates: []
      }).save();
    } else {
      habit = Habit.create({
        title: title.trim(), category: category || "General",
        reminderTime: reminderTime || "", user: req.userId
      });
    }
    res.status(201).json(habit);
  } catch(e) {
    console.error("POST habit error:", e);
    res.status(500).json({ message: "Server error" });
  }
});

// MARK DONE / UNDO — both PATCH and POST
async function completeHandler(req, res) {
  try {
    const { Habit, User, mode } = getDB();
    const today = new Date().toISOString().split("T")[0];
    if (mode === "mongo") {
      const habit = await Habit.findOne({ _id: req.params.id, user: req.userId });
      if (!habit) return res.status(404).json({ message: "Habit not found" });
      const alreadyDone = habit.completedDates.includes(today);
      if (alreadyDone) {
        habit.completedDates = habit.completedDates.filter(d => d !== today);
        habit.streak = Math.max(0, habit.streak - 1);
        habit.completedToday = false;
      } else {
        habit.completedDates.push(today);
        habit.streak = (habit.streak || 0) + 1;
        habit.completedToday = true;
        await User.findByIdAndUpdate(req.userId, { $inc: { xp: 10 } });
      }
      await habit.save();
      res.json(habit);
    } else {
      const habit = Habit.findOne({ _id: req.params.id, user: req.userId });
      if (!habit) return res.status(404).json({ message: "Habit not found" });
      const alreadyDone = (habit.completedDates || []).includes(today);
      if (alreadyDone) {
        Habit.updateById(req.params.id, {
          $pull: { completedDates: today },
          $set: { streak: Math.max(0, (habit.streak || 0) - 1), completedToday: false }
        });
      } else {
        Habit.updateById(req.params.id, {
          $push: { completedDates: today },
          $set: { streak: (habit.streak || 0) + 1, completedToday: true }
        });
        User.updateById(req.userId, { $inc: { xp: 10 } });
      }
      res.json(Habit.findById(req.params.id));
    }
  } catch(e) {
    console.error("complete error:", e);
    res.status(500).json({ message: "Server error" });
  }
}

router.post("/:id/complete", auth, completeHandler);
router.patch("/:id/complete", auth, completeHandler);

// DELETE HABIT
router.delete("/:id", auth, async (req, res) => {
  try {
    const { Habit, mode } = getDB();
    if (mode === "mongo") {
      await Habit.findOneAndDelete({ _id: req.params.id, user: req.userId });
    } else {
      Habit.deleteById(req.params.id);
    }
    res.json({ message: "Habit deleted" });
  } catch(e) {
    res.status(500).json({ message: "Server error" });
  }
});

// ANALYTICS
router.get("/analytics", auth, async (req, res) => {
  try {
    const { Habit, User, mode } = getDB();
    const habits = mode === "mongo"
      ? await Habit.find({ user: req.userId })
      : Habit.find({ user: req.userId });
    const user = mode === "mongo"
      ? await User.findById(req.userId)
      : User.findById(req.userId);

    const totalXP = (user && user.xp) || 0;
    const level   = Math.floor(totalXP / 100) + 1;
    const xpForNextLevel = 100 - (totalXP % 100);
    const today = new Date();
    const weeklyData = [0,0,0,0,0,0,0];
    const categoryData = { Health:0, Study:0, Fitness:0, Productivity:0, General:0 };
    let totalCompletions = 0;
    let longestStreak = 0;

    habits.forEach(h => {
      const dates = h.completedDates || [];
      totalCompletions += dates.length;
      if ((h.streak || 0) > longestStreak) longestStreak = h.streak || 0;
      const cat = h.category || "General";
      categoryData[cat] = (categoryData[cat] || 0) + dates.length;
      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - (6 - i));
        if (dates.includes(d.toISOString().split("T")[0])) weeklyData[i]++;
      }
    });

    const heatmap = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().split("T")[0];
      let count = 0;
      habits.forEach(h => { if ((h.completedDates||[]).includes(ds)) count++; });
      heatmap.push(count);
    }

    const completionRate = habits.length > 0
      ? Math.min(100, Math.round((totalCompletions / (habits.length * 30)) * 100))
      : 0;

    const badges = [];
    if (totalCompletions >= 1)  badges.push("🌟 First Habit");
    if (longestStreak >= 3)     badges.push("🔥 3-Day Streak");
    if (totalCompletions >= 10) badges.push("💪 10 Completions");
    if (longestStreak >= 7)     badges.push("🗓 Week Warrior");
    if (totalCompletions >= 50) badges.push("🏆 50 Completions");
    if (level >= 5)             badges.push("⭐ Level 5 Reached");
    if (level >= 10)            badges.push("💎 Level 10 Legend");

    res.json({ totalHabits: habits.length, totalCompletions, longestStreak,
      completionRate, totalXP, level, xpForNextLevel,
      weeklyData, categoryData, heatmap, badges });
  } catch(e) {
    console.error("Analytics error:", e);
    res.status(500).json({ message: "Analytics error" });
  }
});

// PREDICT
router.get("/predict/:id", auth, async (req, res) => {
  try {
    const { Habit, mode } = getDB();
    const habit = mode === "mongo"
      ? await Habit.findOne({ _id: req.params.id, user: req.userId })
      : Habit.findOne({ _id: req.params.id, user: req.userId });
    if (!habit) return res.status(404).json({ message: "Habit not found" });
    const streak = habit.streak || 0;
    const completions = (habit.completedDates || []).length;
    const isWeekend = [0, 6].includes(new Date().getDay());
    let score = 50;
    if (streak >= 7) score += 25; else if (streak >= 3) score += 15; else if (streak >= 1) score += 8;
    if (completions >= 30) score += 15; else if (completions >= 10) score += 8;
    if (isWeekend) score -= 10;
    score = Math.min(99, Math.max(10, score));
    const prediction = score >= 60 ? 1 : 0;
    res.json({ prediction, confidence: score,
      message: prediction === 1
        ? "You are likely to complete this today! 💪 (" + score + "% confidence)"
        : "You might struggle today. Set a reminder! ⏰ (" + score + "% confidence)" });
  } catch(e) {
    res.status(500).json({ message: "Prediction unavailable" });
  }
});

module.exports = router;