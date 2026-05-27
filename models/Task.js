const mongoose = require("mongoose");

const taskActivitySchema = new mongoose.Schema(
  {
    type: String,
    message: String,
    meta: mongoose.Schema.Types.Mixed,
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const checklistItemSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    completed: { type: Boolean, default: false },
    completedAt: Date,
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    assignedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    relatedLead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
    status: { type: String, enum: ["pending", "in_progress", "review", "completed", "on_hold", "cancelled", "overdue", "draft"], default: "pending" },
    dueDate: { type: Date, required: true },
    reminderDate: Date,
    reminderSent: { type: Boolean, default: false },
    category: { type: String, default: "General", trim: true },
    department: { type: String, default: "Sales", trim: true },
    tags: [{ type: String, trim: true }],
    labels: [{ type: String, trim: true }],
    notes: { type: String, default: "", trim: true },
    recurringType: { type: String, enum: ["none", "daily", "weekly", "monthly", "custom"], default: "none" },
    recurringInterval: { type: Number, default: 1 },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    aiPrioritySuggestion: {
      suggestedPriority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
      confidence: { type: Number, default: 0 },
      reasons: [{ type: String }],
      reviewed: { type: Boolean, default: false },
    },
    checklist: [checklistItemSchema],
    attachments: [
      {
        fileName: String,
        fileUrl: String,
        fileType: String,
        publicId: String,
        source: { type: String, enum: ["local", "cloudinary"], default: "local" },
        voiceNote: { type: Boolean, default: false },
        uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    comments: [
      {
        text: { type: String, required: true },
        isInternal: { type: Boolean, default: true },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    activity: [taskActivitySchema],
    completedAt: Date,
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

taskSchema.index({ assignedTo: 1, dueDate: 1 });
taskSchema.index({ assignedUsers: 1, dueDate: 1 });
taskSchema.index({ assignedBy: 1, createdAt: -1 });
taskSchema.index({ status: 1, priority: 1 });
taskSchema.index({ title: "text", description: "text", category: "text", department: "text", tags: "text" });

taskSchema.pre("save", function syncProgress() {
  if (this.checklist?.length) {
    const completed = this.checklist.filter((item) => item.completed).length;
    this.progress = Math.round((completed / this.checklist.length) * 100);
  }
  if (!this.assignedUsers?.length && this.assignedTo) {
    this.assignedUsers = [this.assignedTo];
  }
});

module.exports = mongoose.model("Task", taskSchema);
