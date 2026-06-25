const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },

    // 🎮 XP System
    xp: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// 🔥 VERY IMPORTANT: Prevent OverwriteModelError
module.exports =
  mongoose.models.user || mongoose.model("user", userSchema);