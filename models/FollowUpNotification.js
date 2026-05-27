const mongoose = require("mongoose");

const followUpNotificationSchema = new mongoose.Schema(
  {
    followUp: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FollowUp",
      required: true,
      index: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["reminder", "overdue", "completed", "rescheduled", "missed", "system"],
      default: "reminder",
    },
    readAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

followUpNotificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });

module.exports = mongoose.model("FollowUpNotification", followUpNotificationSchema);
