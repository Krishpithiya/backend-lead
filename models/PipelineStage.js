const mongoose = require("mongoose");

const pipelineStageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    color: { type: String, default: "#3db0a6" },
    order: { type: Number, default: 0 },
    probability: { type: Number, default: 0 },
    autoAssignTeam: { type: String, default: "" },
    scoringRule: { type: String, default: "" },
    isClosed: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

pipelineStageSchema.index({ order: 1 });

module.exports = mongoose.model("PipelineStage", pipelineStageSchema);
