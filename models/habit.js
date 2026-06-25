const mongoose = require("mongoose");

const habitSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },

    // Habit category
    category: {
      type: String,
      enum: ["Health", "Study", "Fitness", "Productivity", "General"],
      default: "General"
    },

    // Optional reminder time (HH:MM format)
    reminderTime: {
      type: String,
      default: null,
      validate: {
        validator: function (value) {
          if (!value) return true;
          return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
        },
        message: "Reminder time must be in HH:MM format"
      }
    },

    // ✅ NEW: Completion History for ML
    completionHistory: [
      {
        date: {
          type: Date,
          required: true
        },
        completed: {
          type: Boolean,
          required: true
        }
      }
    ],

    // Keep old field (optional for backward compatibility)
    completedDates: {
      type: [String],
      default: []
    },

    streak: {
      type: Number,
      default: 0
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Habit", habitSchema);