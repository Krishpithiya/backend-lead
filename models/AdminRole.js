const mongoose = require("mongoose");

const permissionSchema = new mongoose.Schema(
  {
    module: { type: String, required: true },
    view: { type: Boolean, default: true },
    create: { type: Boolean, default: false },
    edit: { type: Boolean, default: false },
    delete: { type: Boolean, default: false },
    export: { type: Boolean, default: false },
  },
  { _id: false }
);

const adminRoleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    hierarchyLevel: { type: Number, default: 1 },
    permissions: [permissionSchema],
    isSystem: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

adminRoleSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model("AdminRole", adminRoleSchema);
