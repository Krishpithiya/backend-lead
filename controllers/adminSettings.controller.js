const bcrypt = require("bcryptjs");
const User = require("../models/user");
const AdminRole = require("../models/AdminRole");
const AdminSetting = require("../models/AdminSetting");
const AdminActivityLog = require("../models/AdminActivityLog");
const PipelineStage = require("../models/PipelineStage");
const IntegrationConnection = require("../models/IntegrationConnection");
const BackupJob = require("../models/BackupJob");
const Lead = require("../models/lead.model");

const DEFAULT_PIPELINE = [
  ["New Lead", "#3b82f6", 1, 10],
  ["Contacted", "#06b6d4", 2, 25],
  ["Qualified", "#8b5cf6", 3, 45],
  ["Proposal Sent", "#f59e0b", 4, 65],
  ["Negotiation", "#f97316", 5, 80],
  ["Converted", "#22c55e", 6, 100],
  ["Lost", "#ef4444", 7, 0],
];

const DEFAULT_SETTINGS = {
  company: {
    companyName: "HYGO Technologies",
    address: "",
    gstNumber: "",
    website: "",
    supportEmail: "",
    timezone: "Asia/Kolkata",
    currency: "INR",
    businessHours: "10:00 - 19:00",
    themeColor: "#3db0a6",
    logoUrl: "",
  },
  notifications: {
    email: true,
    browser: true,
    sms: false,
    whatsapp: false,
    sound: true,
    triggers: ["new_lead_assigned", "followup_reminder", "task_overdue", "lead_converted"],
  },
  communication: {
    smtpHost: "",
    smtpPort: "587",
    smtpUser: "",
    smsGateway: "",
    whatsappApiUrl: "",
    otpExpiryMinutes: 10,
    templates: [{ name: "Welcome", subject: "Welcome to HYGO LMS", body: "Hello {{name}}" }],
  },
  security: {
    sessionTimeoutMinutes: 30,
    minPasswordLength: 8,
    requireUppercase: true,
    requireNumber: true,
    ipWhitelist: "",
    loginAttemptLimit: 5,
    twoFactorRequired: false,
  },
  automation: {
    rules: [
      { id: "facebook-sales-a", if: "Lead source = Facebook", then: "Assign to Sales Team A", active: true },
    ],
  },
  data: {
    duplicatePrevention: true,
    cleanupAfterDays: 365,
    importHistory: [],
  },
  appearance: {
    mode: "system",
    sidebarColor: "#17145b",
    theme: "enterprise",
    compactMode: false,
    tableDensity: "comfortable",
  },
  system: {
    defaultDashboard: "admin",
    defaultLeadOwner: "",
    dateFormat: "DD MMM YYYY",
    timeFormat: "12h",
    autoLogoutMinutes: 30,
    language: "en",
  },
};

const logActivity = async (req, action, message, metadata = {}) => {
  await AdminActivityLog.create({
    actor: req.user?.id,
    action,
    message,
    metadata,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] || "",
  });
};

const getSetting = async (key) => {
  const record = await AdminSetting.findOne({ key }).lean();
  return record?.data ?? DEFAULT_SETTINGS[key] ?? {};
};

const upsertSetting = async (req, key, data) => {
  const updated = await AdminSetting.findOneAndUpdate(
    { key },
    { key, data, updatedBy: req.user.id },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  await logActivity(req, "settings.updated", `Updated ${key} settings`, { key });
  return updated.data;
};

const seedPipeline = async (req) => {
  const count = await PipelineStage.countDocuments();
  if (count > 0) return;
  await PipelineStage.insertMany(
    DEFAULT_PIPELINE.map(([name, color, order, probability]) => ({
      name,
      color,
      order,
      probability,
      isClosed: ["Converted", "Lost"].includes(name),
      createdBy: req.user.id,
    }))
  );
};

const normalizePipelineName = (name = "") =>
  String(name)
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const PIPELINE_STATUS_MAP = {
  new_lead: ["new"],
  contacted: ["contacted"],
  qualified: ["qualified"],
  proposal_sent: ["proposal_sent"],
  negotiation: ["negotiation"],
  converted: ["converted", "won"],
  lost: ["lost"],
};

exports.getOverview = async (req, res) => {
  try {
    await seedPipeline(req);
    const [settings, roles, pipelines, integrations, logs, backups, users, leadStatusCounts] = await Promise.all([
      AdminSetting.find().lean(),
      AdminRole.find().sort({ hierarchyLevel: 1 }).lean(),
      PipelineStage.find().sort({ order: 1 }).lean(),
      IntegrationConnection.find().sort({ provider: 1 }).lean(),
      AdminActivityLog.find().populate("actor", "name email role").sort({ createdAt: -1 }).limit(50).lean(),
      BackupJob.find().sort({ createdAt: -1 }).limit(20).lean(),
      User.find().select("-password -refreshToken -resetPasswordToken -resetPasswordExpires").sort({ createdAt: -1 }).lean(),
      Lead.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);

    const settingsMap = Object.keys(DEFAULT_SETTINGS).reduce((acc, key) => ({ ...acc, [key]: DEFAULT_SETTINGS[key] }), {});
    settings.forEach((item) => { settingsMap[item.key] = { ...settingsMap[item.key], ...item.data }; });
    const statusCountMap = leadStatusCounts.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});
    const totalPipelineLeads = Object.values(statusCountMap).reduce((sum, count) => sum + count, 0);
    const pipelinesWithLeadStats = pipelines.map((stage) => {
      const statuses = PIPELINE_STATUS_MAP[normalizePipelineName(stage.name)] || [normalizePipelineName(stage.name)];
      const leadCount = statuses.reduce((sum, status) => sum + (statusCountMap[status] || 0), 0);
      const actualPercentage = totalPipelineLeads ? Math.round((leadCount / totalPipelineLeads) * 100) : 0;
      return { ...stage, statuses, leadCount, actualPercentage };
    });

    res.json({
      success: true,
      data: {
        profile: users.find((u) => String(u._id) === String(req.user.id)) || null,
        settings: settingsMap,
        roles,
        pipelines: pipelinesWithLeadStats,
        integrations,
        logs,
        backups,
        users,
        health: { api: "operational", database: "connected", queue: "idle", socket: "ready" },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const allowed = ["name", "email", "phone", "designation", "twoFactorEnabled"];
    const update = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    });
    const user = await User.findByIdAndUpdate(req.user.id, update, { new: true }).select("-password -refreshToken");
    await logActivity(req, "profile.updated", "Updated admin profile", update);
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ success: false, message: "Current password and a strong new password are required" });
    }
    const user = await User.findById(req.user.id);
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(400).json({ success: false, message: "Current password is incorrect" });
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    await logActivity(req, "security.password_changed", "Changed admin password");
    res.json({ success: true, message: "Password updated" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.uploadAsset = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "File is required" });
    const fileUrl = `/uploads/settings/${req.file.filename}`;
    await logActivity(req, "asset.uploaded", "Uploaded settings asset", { fileUrl });
    res.json({ success: true, data: { fileUrl } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateSection = async (req, res) => {
  try {
    const data = await upsertSetting(req, req.params.section, req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createRole = async (req, res) => {
  try {
    const role = await AdminRole.create({ ...req.body, createdBy: req.user.id });
    await logActivity(req, "role.created", `Created role ${role.name}`, { roleId: role._id });
    res.status(201).json({ success: true, data: role });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateRole = async (req, res) => {
  try {
    const role = await AdminRole.findByIdAndUpdate(req.params.id, req.body, { new: true });
    await logActivity(req, "role.updated", `Updated role ${role?.name || req.params.id}`);
    res.json({ success: true, data: role });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.deleteRole = async (req, res) => {
  try {
    await AdminRole.findByIdAndDelete(req.params.id);
    await logActivity(req, "role.deleted", "Deleted role", { roleId: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateUserStatus = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true }).select("-password");
    await logActivity(req, "user.status_updated", `Updated user status to ${req.body.status}`, { userId: req.params.id });
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.resetUserPassword = async (req, res) => {
  try {
    const password = req.body.password || "Welcome@123";
    const hash = await bcrypt.hash(password, 10);
    await User.findByIdAndUpdate(req.params.id, { password: hash });
    await logActivity(req, "user.password_reset", "Reset user password", { userId: req.params.id });
    res.json({ success: true, message: "Password reset", temporaryPassword: password });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.createPipelineStage = async (req, res) => {
  try {
    const stage = await PipelineStage.create({ ...req.body, createdBy: req.user.id });
    await logActivity(req, "pipeline.created", `Created pipeline stage ${stage.name}`);
    res.status(201).json({ success: true, data: stage });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updatePipelineStage = async (req, res) => {
  try {
    const stage = await PipelineStage.findByIdAndUpdate(req.params.id, req.body, { new: true });
    await logActivity(req, "pipeline.updated", `Updated pipeline stage ${stage?.name || req.params.id}`);
    res.json({ success: true, data: stage });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.deletePipelineStage = async (req, res) => {
  try {
    await PipelineStage.findByIdAndDelete(req.params.id);
    await logActivity(req, "pipeline.deleted", "Deleted pipeline stage", { stageId: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.upsertIntegration = async (req, res) => {
  try {
    const integration = await IntegrationConnection.findOneAndUpdate(
      { provider: req.params.provider },
      { ...req.body, provider: req.params.provider, updatedBy: req.user.id },
      { new: true, upsert: true }
    );
    await logActivity(req, "integration.updated", `Updated ${req.params.provider} integration`);
    res.json({ success: true, data: integration });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.testEmail = async (req, res) => {
  await logActivity(req, "email.test", "Sent test email", { to: req.body.to });
  res.json({ success: true, message: "Test email queued. Connect SMTP credentials to send live mail." });
};

exports.importCsv = async (req, res) => {
  const data = await getSetting("data");
  const entry = { fileName: req.file?.originalname || "leads.csv", rows: 0, status: "queued", date: new Date() };
  data.importHistory = [entry, ...(data.importHistory || [])].slice(0, 20);
  await upsertSetting(req, "data", data);
  res.json({ success: true, data: entry });
};

exports.exportData = async (req, res) => {
  await logActivity(req, "data.exported", "Exported admin settings data");
  res.json({ success: true, data: { downloadUrl: "", message: "Export prepared" } });
};

exports.createBackup = async (req, res) => {
  try {
    const backup = await BackupJob.create({
      name: req.body.name || `Manual backup ${new Date().toISOString()}`,
      type: req.body.type || "manual",
      size: "Pending",
      createdBy: req.user.id,
    });
    await logActivity(req, "backup.created", "Created backup", { backupId: backup._id });
    res.status(201).json({ success: true, data: backup });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getLogs = async (req, res) => {
  const { search = "", action = "", page = 1, limit = 20 } = req.query;
  const query = {};
  if (action) query.action = action;
  if (search) query.$or = [{ action: new RegExp(search, "i") }, { message: new RegExp(search, "i") }];
  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    AdminActivityLog.find(query).populate("actor", "name email role").sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    AdminActivityLog.countDocuments(query),
  ]);
  res.json({ success: true, data: { items, total, page: Number(page), pages: Math.ceil(total / Number(limit)) } });
};
