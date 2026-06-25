const express = require("express");
const jwt     = require("jsonwebtoken");
const router  = express.Router();

function getDB() {
  try {
    const mongoose = require("mongoose");
    if (mongoose.connection.readyState === 1) {
      return { User: require("../models/user"), Habit: require("../models/habit"), mode: "mongo" };
    }
  } catch(e) {}
  const local = require("../localdb");
  return { User: local.Users, Habit: local.Habits, mode: "local" };
}

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ message: "No token" });
  try { req.userId = jwt.verify(h.split(" ")[1], process.env.JWT_SECRET || "habitflow_secret").id; next(); }
  catch(e) { res.status(401).json({ message: "Invalid token" }); }
}

router.get("/", auth, async (req, res) => {
  try {
    const { User, Habit, mode } = getDB();
    const users  = mode === "mongo" ? await User.find().select("-password") : User.find();
    const habits = mode === "mongo" ? await Habit.find() : Habit.find({});

    const board = users.map(u => {
      const uid = u._id.toString();
      const uHabits = habits.filter(h => h.user && h.user.toString() === uid);
      const streak  = uHabits.reduce((m, h) => Math.max(m, h.streak || 0), 0);
      const totalC  = uHabits.reduce((s, h) => s + (h.completedDates || []).length, 0);
      return { _id: uid, name: u.name, xp: u.xp || 0, longestStreak: streak, habitCount: uHabits.length, totalCompletions: totalC, level: Math.floor((u.xp || 0) / 100) + 1 };
    }).sort((a, b) => b.xp - a.xp);

    res.json(board);
  } catch(e) {
    console.error("Leaderboard error:", e);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;