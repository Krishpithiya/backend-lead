const mongoose = require("mongoose");

const followUpReminderSchema = new mongoose.Schema(
  {
    followUp: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FollowUp",
      required: true,
      index: true,
    },
    reminderAt: {
      type: Date,
      required: true,
      index: true,
    },
    channels: {
      type: [String],
      enum: ["in_app", "browser", "email", "whatsapp", "sms"],
      default: ["in_app"],
    },
    status: {
      type: String,
      enum: ["scheduled", "sent", "snoozed", "cancelled", "failed"],
      default: "scheduled",
      index: true,
    },
    snoozedUntil: Date,
    sentAt: Date,
    repeatEveryMinutes: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

followUpReminderSchema.index({ status: 1, reminderAt: 1 });

module.exports = mongoose.model("FollowUpReminder", followUpReminderSchema);
