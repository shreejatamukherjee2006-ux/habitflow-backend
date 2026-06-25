/**
 * localdb.js — File-based database fallback
 * Works completely offline, no MongoDB needed.
 * Data stored in db.json next to this file.
 */

const fs   = require("fs");
const path = require("path");
const DB_FILE = path.join(__dirname, "db.json");

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    }
  } catch(e) {}
  return { users: [], habits: [] };
}

function save(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Users ──────────────────────────────────────────
const Users = {
  findOne: (query) => {
    const db = load();
    if (query.email) return db.users.find(u => u.email === query.email) || null;
    if (query._id)   return db.users.find(u => u._id === query._id) || null;
    return null;
  },
  findById: (id) => {
    const db = load();
    return db.users.find(u => u._id === id) || null;
  },
  find: () => {
    return load().users;
  },
  create: (data) => {
    const db = load();
    const user = { _id: genId(), xp: 0, createdAt: new Date().toISOString(), ...data };
    db.users.push(user);
    save(db);
    return user;
  },
  updateById: (id, update) => {
    const db = load();
    const idx = db.users.findIndex(u => u._id === id);
    if (idx === -1) return null;
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        db.users[idx][k] = (db.users[idx][k] || 0) + v;
      }
    }
    if (update.$set) {
      Object.assign(db.users[idx], update.$set);
    }
    save(db);
    return db.users[idx];
  }
};

// ── Habits ─────────────────────────────────────────
const Habits = {
  find: (query) => {
    const db = load();
    let habits = db.habits;
    if (query && query.user) habits = habits.filter(h => h.user === query.user);
    return habits;
  },
  findOne: (query) => {
    const db = load();
    let habits = db.habits;
    if (query._id)  habits = habits.filter(h => h._id === query._id);
    if (query.user) habits = habits.filter(h => h.user === query.user);
    return habits[0] || null;
  },
  findById: (id) => {
    return load().habits.find(h => h._id === id) || null;
  },
  create: (data) => {
    const db = load();
    const habit = {
      _id: genId(),
      streak: 0,
      completedDates: [],
      completedToday: false,
      createdAt: new Date().toISOString(),
      ...data
    };
    db.habits.push(habit);
    save(db);
    return habit;
  },
  updateById: (id, update) => {
    const db = load();
    const idx = db.habits.findIndex(h => h._id === id);
    if (idx === -1) return null;
    if (update.$set)  Object.assign(db.habits[idx], update.$set);
    if (update.$push && update.$push.completedDates) {
      db.habits[idx].completedDates = db.habits[idx].completedDates || [];
      db.habits[idx].completedDates.push(update.$push.completedDates);
    }
    if (update.$pull && update.$pull.completedDates) {
      const val = update.$pull.completedDates;
      db.habits[idx].completedDates = (db.habits[idx].completedDates || []).filter(d => d !== val);
    }
    save(db);
    return db.habits[idx];
  },
  deleteById: (id) => {
    const db = load();
    db.habits = db.habits.filter(h => h._id !== id);
    save(db);
  }
};

module.exports = { Users, Habits, isLocal: true };