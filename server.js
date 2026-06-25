require("dotenv").config();
const express  = require("express");
const mongoose = require("mongoose");
const cors     = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ── DATABASE ──────────────────────────────────────
let dbMode = "local";
const MONGO_URI = (process.env.MONGO_URI || "").replace(/"/g, "").trim();

if (MONGO_URI) {
  mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => { dbMode = "mongo"; console.log("✅ MongoDB Connected"); })
    .catch(err => {
      dbMode = "local";
      console.warn("⚠️  MongoDB unavailable — using LOCAL file database");
    });
} else {
  console.log("📁 No MONGO_URI — using LOCAL file database");
}

app.use((req, res, next) => { req.dbMode = dbMode; next(); });

// ── ROUTES ────────────────────────────────────────
app.use("/api/auth",        require("./routes/auth"));
app.use("/api/habits",      require("./routes/habits"));
app.use("/api/assistant",   require("./routes/assistant"));
app.use("/api/report",      require("./routes/report"));
app.use("/api/leaderboard", require("./routes/leaderboard"));
app.use("/api/ai",          require("./routes/ai"));
app.use("/api/boss",        require("./routes/boss"));
app.use("/api/partner",     require("./routes/partner"));

app.get("/", (req, res) => res.json({ status: "ok", message: "HabitFlow+ API running 🚀" }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

// ── START — kill old process if port busy ─────────
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Open: http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} is already in use.`);
    console.error(`   Run this command to free it, then restart:`);
    console.error(`   Windows:  netstat -ano | findstr :${PORT}  then  taskkill /PID <PID> /F`);
    console.error(`   Mac/Linux: kill $(lsof -ti:${PORT})`);
    process.exit(1);
  } else {
    throw err;
  }
});

module.exports = app;