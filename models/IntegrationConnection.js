const mongoose = require("mongoose");

const integrationConnectionSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    status: { type: String, enum: ["connected", "disconnected", "error"], default: "disconnected" },
    apiKeyLabel: { type: String, default: "" },
    webhookUrl: { type: String, default: "" },
    lastSyncAt: { type: Date, default: null },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

integrationConnectionSchema.index({ provider: 1 }, { unique: true });

module.exports = mongoose.model("IntegrationConnection", integrationConnectionSchema);
