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

const BOSSES = [
  { id:"b1", name:"Weekend Slacker",    emoji:"😴", hp:100, description:"Drains your energy on weekends",       weakness:"Fitness & Health habits",      reward:150, xpBonus:50  },
  { id:"b2", name:"Procrastination Rex", emoji:"🦖", hp:150, description:"Makes you delay everything",           weakness:"Productivity habits",           reward:200, xpBonus:75  },
  { id:"b3", name:"Junk Food Goblin",   emoji:"🍔", hp:120, description:"Tempts you with unhealthy choices",    weakness:"Health habits",                 reward:175, xpBonus:60  },
  { id:"b4", name:"Distraction Demon",  emoji:"📱", hp:180, description:"Steals your focus with scrolling",     weakness:"Study habits",                  reward:250, xpBonus:100 },
  { id:"b5", name:"The Burnout Beast",  emoji:"🔥", hp:200, description:"Overwhelms you until you give up",     weakness:"Any 3+ habits completed daily", reward:300, xpBonus:125 },
  { id:"b6", name:"Sleep Vampire",      emoji:"🧛", hp:130, description:"Keeps you up late every night",        weakness:"Health & General habits",       reward:180, xpBonus:65  },
];

// GET /api/boss/current
router.get("/current", auth, async (req, res) => {
  try {
    const { Habit, User, mode } = getDB();

    const habits = mode === "mongo"
      ? await Habit.find({ user: req.userId })
      : Habit.find({ user: req.userId });
    const user = mode === "mongo"
      ? await User.findById(req.userId)
      : User.findById(req.userId);

    const weekNum  = Math.floor(Date.now() / (1000 * 60 * 60 * 24 * 7));
    const boss     = BOSSES[weekNum % BOSSES.length];

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekStartStr = weekStart.toISOString().split("T")[0];

    let damageDealt = 0, completionsThisWeek = 0;
    habits.forEach(h => {
      (h.completedDates || []).forEach(d => {
        if (d >= weekStartStr) { damageDealt += 10; completionsThisWeek++; }
      });
    });

    damageDealt = Math.min(damageDealt, boss.hp);
    const bossHpRemaining = Math.max(0, boss.hp - damageDealt);

    res.json({
      boss,
      damageDealt,
      bossHpRemaining,
      bossHpMax: boss.hp,
      defeated: bossHpRemaining === 0,
      completionsThisWeek,
      daysLeft: 6 - new Date().getDay(),
      userLevel: Math.floor((user?.xp || 0) / 100) + 1,
      userXP: user?.xp || 0,
      weekStartStr
    });
  } catch(e) {
    console.error("Boss error:", e);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/boss/all
router.get("/all", auth, (req, res) => {
  res.json({ bosses: BOSSES });
});

module.exports = router;