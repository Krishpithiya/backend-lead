const mongoose = require("mongoose");

const followUpNoteSchema = new mongoose.Schema(
  {
    followUp: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FollowUp",
      required: true,
      index: true,
    },
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      index: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    richText: {
      type: String,
      default: "",
    },
    isInternal: {
      type: Boolean,
      default: true,
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

followUpNoteSchema.index({ followUp: 1, createdAt: -1 });

module.exports = mongoose.model("FollowUpNote", followUpNoteSchema);
