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

router.get("/weekly", auth, async (req, res) => {
  try {
    const { Habit, User, mode } = getDB();

    const user = mode === "mongo"
      ? await User.findById(req.userId)
      : User.findById(req.userId);

    const habits = mode === "mongo"
      ? await Habit.find({ user: req.userId })
      : Habit.find({ user: req.userId });

    const today = new Date();
    const week  = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      week.push(d.toISOString().split("T")[0]);
    }

    const weeklyStats = week.map(date => ({
      date,
      completed: habits.filter(h => (h.completedDates || []).includes(date)).length,
      total: habits.length
    }));

    const totalDone   = weeklyStats.reduce((s, d) => s + d.completed, 0);
    const perfectDays = weeklyStats.filter(d => d.completed === habits.length && habits.length > 0).length;
    const rate        = habits.length > 0 ? Math.round((totalDone / (habits.length * 7)) * 100) : 0;
    const bestStreak  = habits.reduce((m, h) => Math.max(m, h.streak || 0), 0);

    const dayCounts = [0,0,0,0,0,0,0];
    habits.forEach(h => {
      (h.completedDates || []).forEach(d => {
        dayCounts[new Date(d).getDay()]++;
      });
    });
    const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const worstDayIdx = dayCounts.indexOf(Math.min(...dayCounts));

    res.json({
      userName: user?.name || "there",
      weekRange: week[0] + " to " + week[6],
      totalHabits: habits.length,
      totalCompletions: totalDone,
      perfectDays,
      completionRate: rate,
      bestStreak,
      worstDay: DAYS[worstDayIdx],
      weeklyStats,
      level: Math.floor((user?.xp || 0) / 100) + 1,
      totalXP: user?.xp || 0,
      topHabit: habits.sort((a, b) => (b.streak || 0) - (a.streak || 0))[0]?.title || "None yet",
      dbMode: mode
    });
  } catch(e) {
    console.error("Report error:", e);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;