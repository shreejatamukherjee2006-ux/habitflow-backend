const express = require("express");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const router  = express.Router();

// Works with both MongoDB models and local DB
function getDB() {
  try {
    const mongoose = require("mongoose");
    if (mongoose.connection.readyState === 1) {
      return {
        User: require("../models/user"),
        mode: "mongo"
      };
    }
  } catch(e) {}
  return {
    User: require("../localdb").Users,
    mode: "local"
  };
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ message: "No token provided" });
  try {
    req.userId = jwt.verify(h.split(" ")[1], process.env.JWT_SECRET || "habitflow_secret").id;
    next();
  } catch(e) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

// ── REGISTER ──────────────────────────────────────
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: "All fields are required" });
    if (password.length < 6)
      return res.status(400).json({ message: "Password must be at least 6 characters" });

    const { User, mode } = getDB();

    const existing = mode === "mongo"
      ? await User.findOne({ email: email.toLowerCase() })
      : User.findOne({ email: email.toLowerCase() });

    if (existing)
      return res.status(400).json({ message: "An account with this email already exists" });

    const hashed = await bcrypt.hash(password, 10);

    if (mode === "mongo") {
      await new User({ name: name.trim(), email: email.toLowerCase().trim(), password: hashed }).save();
    } else {
      User.create({ name: name.trim(), email: email.toLowerCase().trim(), password: hashed });
    }

    return res.status(201).json({ message: "Account created successfully!" });
  } catch(e) {
    console.error("Register error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

// ── LOGIN ─────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Email and password required" });

    const { User, mode } = getDB();

    const user = mode === "mongo"
      ? await User.findOne({ email: email.toLowerCase() })
      : User.findOne({ email: email.toLowerCase() });

    if (!user)
      return res.status(400).json({ message: "No account found with this email" });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(400).json({ message: "Incorrect password" });

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET || "habitflow_secret",
      { expiresIn: "30d" }
    );

    return res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, xp: user.xp || 0 }
    });
  } catch(e) {
    console.error("Login error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

// ── GET PROFILE ───────────────────────────────────
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const { User, mode } = getDB();
    const user = mode === "mongo"
      ? await User.findById(req.userId).select("-password")
      : User.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const { password, ...safe } = user;
    return res.json(safe);
  } catch(e) {
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;