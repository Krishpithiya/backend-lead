const mongoose = require("mongoose");

const scheduledReportSchema = new mongoose.Schema(
  {
    manager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reportType: {
      type: String,
      required: true,
      enum: [
        "lead",
        "agent",
        "followup",
        "revenue",
        "source",
        "time",
        "activity",
      ],
    },
    dateRange: {
      type: String,
      default: "last30",
    },
    exportFormat: {
      type: String,
      enum: ["pdf", "excel", "csv"],
      default: "pdf",
    },
    recipients: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
    frequency: {
      type: String,
      enum: ["daily", "weekly", "monthly"],
      default: "weekly",
    },
    nextRunAt: Date,
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ScheduledReport", scheduledReportSchema);
