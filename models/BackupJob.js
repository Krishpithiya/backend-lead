const mongoose = require("mongoose");

const backupJobSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ["manual", "scheduled", "restore"], default: "manual" },
    status: { type: String, enum: ["queued", "running", "completed", "failed"], default: "completed" },
    size: { type: String, default: "0 MB" },
    fileUrl: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

backupJobSchema.index({ createdAt: -1 });

module.exports = mongoose.model("BackupJob", backupJobSchema);
