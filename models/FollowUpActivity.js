const mongoose = require("mongoose");

const followUpActivitySchema = new mongoose.Schema(
  {
    followUp: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FollowUp",
      required: true,
    },
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
    },
    activityType: {
      type: String,
      enum: [
        "created",
        "completed",
        "rescheduled",
        "reminder_sent",
        "note_added",
        "status_changed",
        "meeting_scheduled",
        "deleted",
      ],
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

followUpActivitySchema.index({ followUp: 1, createdAt: -1 });
followUpActivitySchema.index({ performedBy: 1, createdAt: -1 });
followUpActivitySchema.index({ activityType: 1 });

module.exports = mongoose.model("FollowUpActivity", followUpActivitySchema);
