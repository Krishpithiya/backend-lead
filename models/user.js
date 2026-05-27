const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
    },

    password: {
      type: String,
      required: true,
    },

    phone: {
      type: String,
      required: true,
    },

    username: {
      type: String,
      trim: true,
      default: "",
    },

    designation: {
      type: String,
      trim: true,
      default: "",
    },

    bio: {
      type: String,
      trim: true,
      default: "",
    },

    profilePhoto: {
      type: String,
      default: "",
    },

    emailVerified: {
      type: Boolean,
      default: false,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    lastLoginIp: {
      type: String,
      default: "",
    },

    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },

    sessionTimeoutMinutes: {
      type: Number,
      default: 30,
    },

    notificationPreferences: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      browser: { type: Boolean, default: true },
      followUpReminders: { type: Boolean, default: true },
      leadAssignments: { type: Boolean, default: true },
      taskDeadlines: { type: Boolean, default: true },
    },

    appearancePreferences: {
      mode: { type: String, enum: ["light", "dark", "system"], default: "system" },
      themeColor: { type: String, default: "blue" },
      dashboardLayout: { type: String, enum: ["comfortable", "compact"], default: "comfortable" },
      sidebarCollapsed: { type: Boolean, default: false },
    },

    activeDevices: [
      {
        device: String,
        browser: String,
        ipAddress: String,
        lastActiveAt: { type: Date, default: Date.now },
      },
    ],

    role: {
      type: String,
      enum: ["admin", "manager", "agent"],
      required: true,
    },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },

    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    refreshToken: {
      type: String,
      default: null,
    },

    resetPasswordToken: {
      type: String,
      default: null,
    },

    resetPasswordExpires: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
