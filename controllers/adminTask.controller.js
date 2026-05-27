const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Task = require("../models/Task");
const User = require("../models/user");
const Notification = require("../models/Notification");
const { dateError } = require("../utils/dateValidation");

const oid = (id) => (id && mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null);
const title = (value = "") => value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const taskStatus = (task) => task.status !== "completed" && task.status !== "cancelled" && new Date(task.dueDate) < new Date() ? "overdue" : task.status;
const emit = (req, event, payload) => req.app.get("io")?.emit(event, payload);
const uploadToCloudinary = async (file) => {
  if (!file || !process.env.CLOUDINARY_CLOUD_NAME) return null;
  try {
    const cloudinary = require("cloudinary").v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    return await cloudinary.uploader.upload(file.path, {
      folder: "lead-management/task-attachments",
      resource_type: "auto",
    });
  } catch {
    return null;
  }
};

const buildQuery = (req) => {
  const filter = { isDeleted: { $ne: true } };
  const { search, status, priority, assignedUser, dueDate, department } = req.query;
  if (search) {
    const pattern = new RegExp(search, "i");
    filter.$or = [{ title: pattern }, { description: pattern }, { tags: pattern }, { department: pattern }];
  }
  if (status && status !== "all") filter.status = status;
  if (priority && priority !== "all") filter.priority = priority;
  if (department && department !== "all") filter.department = department;
  if (assignedUser && assignedUser !== "all") filter.$or = [{ assignedTo: oid(assignedUser) }, { assignedUsers: oid(assignedUser) }];
  if (dueDate) {
    const start = new Date(dueDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(dueDate);
    end.setHours(23, 59, 59, 999);
    filter.dueDate = { $gte: start, $lte: end };
  }
  return filter;
};

const analytics = (tasks) => {
  const total = Math.max(tasks.length, 1);
  const count = (fn) => tasks.filter(fn).length;
  const weekly = Array.from({ length: 7 }).map((_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return {
      day: date.toLocaleDateString("en-US", { weekday: "short" }),
      completed: tasks.filter((task) => task.completedAt && new Date(task.completedAt).toDateString() === date.toDateString()).length,
      created: tasks.filter((task) => new Date(task.createdAt).toDateString() === date.toDateString()).length,
    };
  });
  const group = (fn) => Object.entries(tasks.reduce((acc, task) => {
    const key = fn(task);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).map(([name, value]) => ({ name: title(name), value }));
  const team = Object.values(tasks.reduce((acc, task) => {
    const users = task.assignedUsers?.length ? task.assignedUsers : [task.assignedTo].filter(Boolean);
    users.forEach((user) => {
      const key = String(user?._id || user);
      acc[key] = acc[key] || { name: user?.name || "Unassigned", assigned: 0, completed: 0, overdue: 0, avgHours: 0 };
      acc[key].assigned += 1;
      if (task.status === "completed") acc[key].completed += 1;
      if (taskStatus(task) === "overdue") acc[key].overdue += 1;
      if (task.completedAt) {
        acc[key].avgHours += Math.max(1, Math.round((new Date(task.completedAt) - new Date(task.createdAt)) / 36e5));
      }
    });
    return acc;
  }, {})).map((row) => ({ ...row, productivity: Math.round((row.completed / Math.max(row.assigned, 1)) * 100), avgHours: row.completed ? Math.round(row.avgHours / row.completed) : 0 }));
  return {
    summary: {
      totalTasks: tasks.length,
      pendingTasks: count((t) => t.status === "pending"),
      completedTasks: count((t) => t.status === "completed"),
      overdueTasks: count((t) => taskStatus(t) === "overdue"),
      highPriorityTasks: count((t) => ["high", "urgent"].includes(t.priority)),
      teamProductivity: Math.round((count((t) => t.status === "completed") / total) * 100),
    },
    charts: {
      weekly,
      byPriority: group((t) => t.priority),
      byStatus: group((t) => taskStatus(t)),
      team,
    },
  };
};

exports.getTasks = async (req, res, next) => {
  try {
    const filter = buildQuery(req);
    const [tasks, users] = await Promise.all([
      Task.find(filter)
        .populate("assignedTo", "name email role")
        .populate("assignedUsers", "name email role")
        .populate("assignedBy", "name email role")
        .sort({ createdAt: -1 })
        .limit(500)
        .lean(),
      User.find({ role: { $in: ["manager", "agent"] }, status: { $ne: "inactive" } }).select("name email role managerId status").sort({ role: -1, name: 1 }).lean(),
    ]);
    res.json({ success: true, data: { tasks: tasks.map((task) => ({ ...task, computedStatus: taskStatus(task) })), users, ...analytics(tasks) } });
  } catch (error) {
    next(error);
  }
};

exports.createTask = async (req, res, next) => {
  try {
    const assignedUsers = Array.isArray(req.body.assignedUsers) ? req.body.assignedUsers.filter(Boolean) : [req.body.assignedTo].filter(Boolean);
    if (!req.body.title || !assignedUsers.length || !req.body.dueDate) return res.status(400).json({ success: false, message: "Title, assigned user, and deadline are required" });
    const invalidDueDate = dateError(req.body.dueDate, "Due date");
    if (invalidDueDate) return res.status(400).json({ success: false, message: invalidDueDate });
    const invalidReminderDate = dateError(req.body.reminderDate, "Reminder date");
    if (invalidReminderDate) return res.status(400).json({ success: false, message: invalidReminderDate });
    const task = await Task.create({
      title: req.body.title,
      description: req.body.description || "",
      assignedTo: assignedUsers[0],
      assignedUsers,
      assignedBy: req.user.id,
      priority: req.body.priority || "medium",
      status: req.body.status || "pending",
      dueDate: req.body.dueDate,
      reminderDate: req.body.reminderDate || null,
      recurringType: req.body.recurringType || "none",
      recurringInterval: Number(req.body.recurringInterval) || 1,
      department: req.body.department || "Sales",
      tags: req.body.tags || [],
      labels: req.body.labels || [],
      checklist: req.body.checklist || [],
      activity: [{ type: "created", message: "Task created by admin", addedBy: req.user.id }],
    });
    await Notification.insertMany(assignedUsers.map((recipient) => ({
      recipient,
      type: "task_assigned",
      title: "New task assigned",
      message: `Task assigned: ${task.title}`,
      relatedId: task._id,
      actionUrl: "/agent/tasks",
      metadata: { taskId: task._id, priority: task.priority, dueDate: task.dueDate },
    })));
    const data = await Task.findById(task._id).populate("assignedUsers", "name email role").populate("assignedTo", "name email role").lean();
    emit(req, "task:created", data);
    res.status(201).json({ success: true, message: "Task created", data });
  } catch (error) {
    next(error);
  }
};

exports.updateTask = async (req, res, next) => {
  try {
    const update = { ...req.body };
    const invalidDueDate = dateError(update.dueDate, "Due date");
    if (invalidDueDate) return res.status(400).json({ success: false, message: invalidDueDate });
    const invalidReminderDate = dateError(update.reminderDate, "Reminder date");
    if (invalidReminderDate) return res.status(400).json({ success: false, message: invalidReminderDate });
    if (Array.isArray(update.assignedUsers) && update.assignedUsers.length) update.assignedTo = update.assignedUsers[0];
    if (update.status === "completed") update.completedAt = new Date();
    if (update.checklist?.length) {
      const done = update.checklist.filter((item) => item.completed).length;
      update.progress = Math.round((done / update.checklist.length) * 100);
    }
    const task = await Task.findByIdAndUpdate(req.params.taskId, { ...update, $push: { activity: { type: "updated", message: "Task updated by admin", meta: update, addedBy: req.user.id } } }, { new: true, runValidators: true })
      .populate("assignedTo", "name email role")
      .populate("assignedUsers", "name email role")
      .populate("comments.addedBy", "name role")
      .lean();
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    emit(req, "task:updated", task);
    res.json({ success: true, message: "Task updated", data: { ...task, computedStatus: taskStatus(task) } });
  } catch (error) {
    next(error);
  }
};

exports.deleteTask = async (req, res, next) => {
  try {
    await Task.findByIdAndUpdate(req.params.taskId, { isDeleted: true, $push: { activity: { type: "deleted", message: "Task deleted by admin", addedBy: req.user.id } } });
    emit(req, "task:deleted", { taskId: req.params.taskId });
    res.json({ success: true, message: "Task deleted" });
  } catch (error) {
    next(error);
  }
};

exports.addComment = async (req, res, next) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.taskId, {
      $push: {
        comments: { text: req.body.text, addedBy: req.user.id, isInternal: true },
        activity: { type: "comment_added", message: "Comment added", addedBy: req.user.id },
      },
    }, { new: true }).populate("comments.addedBy", "name role").lean();
    emit(req, "task:comment", task);
    res.json({ success: true, message: "Comment added", data: task });
  } catch (error) {
    next(error);
  }
};

exports.addAttachment = async (req, res, next) => {
  try {
    const cloudFile = await uploadToCloudinary(req.file);
    const fileUrl = cloudFile?.secure_url || (req.file ? `/uploads/task-attachments/${req.file.filename}` : req.body.fileUrl);
    const task = await Task.findByIdAndUpdate(req.params.taskId, {
      $push: {
        attachments: {
          fileName: req.body.fileName || req.file?.originalname || "Attachment",
          fileUrl,
          fileType: req.file?.mimetype || req.body.fileType || "document",
          publicId: cloudFile?.public_id || "",
          source: cloudFile ? "cloudinary" : "local",
          voiceNote: req.body.voiceNote === "true",
          uploadedBy: req.user.id,
        },
        activity: { type: "attachment_uploaded", message: "Attachment uploaded", meta: { fileUrl }, addedBy: req.user.id },
      },
    }, { new: true }).lean();
    emit(req, "task:attachment", task);
    res.json({ success: true, message: "Attachment uploaded", data: task });
  } catch (error) {
    next(error);
  }
};

exports.exportTasks = async (req, res, next) => {
  try {
    const rows = await Task.find(buildQuery(req)).populate("assignedUsers", "name role").lean();
    const csv = [["Title", "Assigned Users", "Priority", "Status", "Department", "Due Date", "Progress"], ...rows.map((task) => [
      task.title,
      (task.assignedUsers || []).map((u) => u.name).join("; "),
      task.priority,
      taskStatus(task),
      task.department,
      task.dueDate,
      task.progress || 0,
    ])].map((row) => row.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="admin-task-report-${Date.now()}.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
};

exports.ensureUploadDir = () => fs.mkdirSync(path.join(__dirname, "../uploads/task-attachments"), { recursive: true });
