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

// GET /api/partner/search?email=xxx
router.get("/search", auth, async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ message: "Email required" });

    const { Habit, User, mode } = getDB();

    const found = mode === "mongo"
      ? await User.findOne({ email: email.toLowerCase() }).select("_id name email xp")
      : User.findOne({ email: email.toLowerCase() });

    if (!found) return res.status(404).json({ message: "User not found" });
    if (found._id.toString() === req.userId) return res.status(400).json({ message: "That is you!" });

    const habits = mode === "mongo"
      ? await Habit.find({ user: found._id })
      : Habit.find({ user: found._id.toString() });

    const streak = habits.reduce((m, h) => Math.max(m, h.streak || 0), 0);
    const total  = habits.reduce((s, h) => s + (h.completedDates?.length || 0), 0);

    res.json({
      _id: found._id,
      name: found.name,
      email: found.email,
      level: Math.floor((found.xp || 0) / 100) + 1,
      xp: found.xp || 0,
      bestStreak: streak,
      totalCompletions: total,
      habitCount: habits.length
    });
  } catch(e) {
    console.error("Partner search error:", e);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/partner/stats/:partnerId
router.get("/stats/:partnerId", auth, async (req, res) => {
  try {
    const { Habit, User, mode } = getDB();

    const partner = mode === "mongo"
      ? await User.findById(req.params.partnerId).select("_id name email xp")
      : User.findById(req.params.partnerId);

    if (!partner) return res.status(404).json({ message: "Partner not found" });

    const habits = mode === "mongo"
      ? await Habit.find({ user: partner._id })
      : Habit.find({ user: partner._id.toString() });

    const today      = new Date().toISOString().split("T")[0];
    const doneToday  = habits.filter(h => (h.completedDates || []).includes(today)).length;
    const bestStreak = habits.reduce((m, h) => Math.max(m, h.streak || 0), 0);
    const total      = habits.reduce((s, h) => s + (h.completedDates?.length || 0), 0);

    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().split("T")[0];
      last7.push({ date: ds, count: habits.filter(h => (h.completedDates || []).includes(ds)).length });
    }

    res.json({
      name: partner.name,
      level: Math.floor((partner.xp || 0) / 100) + 1,
      xp: partner.xp || 0,
      habitCount: habits.length,
      doneToday,
      totalToday: habits.length,
      bestStreak,
      totalCompletions: total,
      last7
    });
  } catch(e) {
    console.error("Partner stats error:", e);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;