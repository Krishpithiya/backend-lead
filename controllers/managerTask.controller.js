const mongoose = require("mongoose");
const Task = require("../models/Task");
const User = require("../models/user");
const Lead = require("../models/lead.model");
const Notification = require("../models/Notification");
const { notifyAdminsOfUpdate, formatActor } = require("../utils/adminNotifications");
const { dateError } = require("../utils/dateValidation");

const toObjectId = (id) => (id && mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null);
const computedStatus = (task) => task.status !== "completed" && task.status !== "cancelled" && new Date(task.dueDate) < new Date() ? "overdue" : task.status;
const emitTaskEvent = (req, event, payload) => {
  const io = req.app.get("io");
  if (io) io.emit(event, payload);
};

const getScope = async (req) => {
  const managerId = toObjectId(req.user.id);
  const agents = await User.find(req.user.role === "admin" ? { role: "agent" } : { role: "agent", managerId })
    .select("_id name email status")
    .lean();
  const agentIds = agents.map((agent) => agent._id);
  return {
    agents,
    agentIds,
    query: req.user.role === "admin" ? {} : { $or: [{ assignedBy: managerId }, { assignedTo: managerId }, { assignedUsers: managerId }, { assignedTo: { $in: agentIds } }] },
  };
};

const buildQuery = async (req) => {
  const { query, agentIds } = await getScope(req);
  const filter = { isDeleted: { $ne: true }, ...query };
  const { search, status, priority, agent, dueDate, createdDate } = req.query;
  if (search) {
    const pattern = new RegExp(search, "i");
    filter.$and = [...(filter.$and || []), { $or: [{ title: pattern }, { description: pattern }, { category: pattern }] }];
  }
  if (status && status !== "all") filter.status = status;
  if (priority && priority !== "all") filter.priority = priority;
  if (agent && agent !== "all") {
    const agentId = toObjectId(agent);
    if (agentId && (req.user.role === "admin" || agentIds.some((id) => String(id) === String(agentId)))) filter.assignedTo = agentId;
  }
  const dateFilter = (field, value) => {
    if (!value) return;
    const start = new Date(value);
    start.setHours(0, 0, 0, 0);
    const end = new Date(value);
    end.setHours(23, 59, 59, 999);
    filter[field] = { $gte: start, $lte: end };
  };
  dateFilter("dueDate", dueDate);
  dateFilter("createdAt", createdDate);
  return filter;
};

const analytics = async (baseQuery) => {
  const tasks = await Task.find({ ...baseQuery, isDeleted: { $ne: true } }).populate("assignedTo", "name").lean();
  const now = new Date();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setHours(23, 59, 59, 999);
  const count = (fn) => tasks.filter(fn).length;
  const total = tasks.length || 1;
  const summary = {
    totalTasks: tasks.length,
    pendingTasks: count((t) => t.status === "pending"),
    inProgressTasks: count((t) => t.status === "in_progress"),
    completedTasks: count((t) => t.status === "completed"),
    overdueTasks: count((t) => computedStatus(t) === "overdue"),
    todayTasks: count((t) => new Date(t.dueDate) >= todayStart && new Date(t.dueDate) <= todayEnd),
    highPriorityTasks: count((t) => ["high", "urgent"].includes(t.priority)),
  };
  const group = (keyFn) => Object.entries(tasks.reduce((acc, task) => {
    const key = keyFn(task);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).map(([name, value]) => ({ name, value }));
  const byAgent = Object.values(tasks.reduce((acc, task) => {
    const key = task.assignedTo?._id || "unassigned";
    acc[key] = acc[key] || { agent: task.assignedTo?.name || "Unassigned", assigned: 0, completed: 0, overdue: 0, score: 0 };
    acc[key].assigned += 1;
    if (task.status === "completed") acc[key].completed += 1;
    if (computedStatus(task) === "overdue") acc[key].overdue += 1;
    acc[key].score = Math.round((acc[key].completed / acc[key].assigned) * 100);
    return acc;
  }, {}));
  return {
    summary,
    percentages: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, Math.round((v / total) * 100)])),
    charts: { byStatus: group(computedStatus), byPriority: group((t) => t.priority), byAgent },
  };
};

exports.getTaskCenter = async (req, res, next) => {
  try {
    const { agents, query: scopeQuery } = await getScope(req);
    const filter = await buildQuery(req);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const sortBy = req.query.sortBy || "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const leadQuery = req.user.role === "admin" ? {} : { $or: [{ assignedManager: req.user.id }, { createdBy: req.user.id }, { assignedBy: req.user.id }] };
    const [tasks, total, stats, leads] = await Promise.all([
      Task.find(filter).populate("assignedTo", "name email status").populate("assignedBy", "name email role").populate("relatedLead", "name company email phone").sort({ [sortBy]: sortOrder }).skip((page - 1) * limit).limit(limit).lean(),
      Task.countDocuments(filter),
      analytics(scopeQuery),
      Lead.find(leadQuery).select("_id name company email phone").limit(200).lean(),
    ]);
    res.json({ success: true, data: { tasks: tasks.map((t) => ({ ...t, computedStatus: computedStatus(t) })), agents, leads, ...stats, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } } });
  } catch (error) { next(error); }
};

exports.createTask = async (req, res, next) => {
  try {
    const { title, assignedTo, dueDate } = req.body;
    if (!title || !assignedTo || !dueDate) {
      return res.status(400).json({
        success: false,
        message: "Task title, assigned agent, and due date are required",
      });
    }
    const invalidDueDate = dateError(dueDate, "Due date");
    if (invalidDueDate) return res.status(400).json({ success: false, message: invalidDueDate });
    const invalidReminderDate = dateError(req.body.reminderDate, "Reminder date");
    if (invalidReminderDate) return res.status(400).json({ success: false, message: invalidReminderDate });
    const task = await Task.create({
      title,
      description: req.body.description || "",
      assignedTo,
      assignedBy: req.user.id,
      relatedLead: req.body.relatedLead || null,
      priority: req.body.priority || "medium",
      status: req.body.saveAsDraft ? "draft" : req.body.status || "pending",
      dueDate,
      reminderDate: req.body.reminderDate || null,
      category: req.body.category || "General",
      notes: req.body.notes || "",
      recurringType: req.body.recurringType || "none",
      activity: [{ type: "created", message: req.body.saveAsDraft ? "Task saved as draft" : "Task created", addedBy: req.user.id }],
    });
    const data = await Task.findById(task._id).populate("assignedTo", "name email").populate("relatedLead", "name company").lean();
    if (!req.body.saveAsDraft) {
      const notification = await Notification.create({
        recipient: assignedTo,
        type: "task_assigned",
        title: "New task assigned",
        message: `Task assigned: ${title}`,
        relatedId: task._id,
        actionUrl: "/agent/tasks",
        metadata: { taskId: task._id, priority: task.priority, dueDate: task.dueDate },
      });
      const io = req.app.get("io");
      if (io) io.emit("notification:new", notification);
    }
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "task_assigned",
      title: "Manager created task",
      message: `${formatActor(req.user)} created task "${title}".`,
      lead: data.relatedLead?._id || data.relatedLead,
      relatedId: task._id,
      actionUrl: "/manager/tasks",
      metadata: {
        entity: "task",
        taskTitle: title,
        assignedTo,
        dueDate,
        priority: task.priority,
        status: task.status,
        relatedLead: data.relatedLead,
      },
    });
    emitTaskEvent(req, "task:created", data);
    res.status(201).json({ success: true, message: "Task created successfully", data });
  } catch (error) { next(error); }
};

exports.getTaskDetails = async (req, res, next) => {
  try {
    const task = await Task.findOne({ _id: req.params.taskId, isDeleted: { $ne: true } }).populate("assignedTo", "name email phone status").populate("assignedBy", "name email role").populate("relatedLead", "name company email phone status").populate("comments.addedBy", "name role").populate("activity.addedBy", "name role").lean();
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    res.json({ success: true, data: { ...task, computedStatus: computedStatus(task) } });
  } catch (error) { next(error); }
};

exports.updateTask = async (req, res, next) => {
  try {
    const update = { ...req.body };
    const invalidDueDate = dateError(update.dueDate, "Due date");
    if (invalidDueDate) return res.status(400).json({ success: false, message: invalidDueDate });
    const invalidReminderDate = dateError(update.reminderDate, "Reminder date");
    if (invalidReminderDate) return res.status(400).json({ success: false, message: invalidReminderDate });
    if (update.status === "completed") update.completedAt = new Date();
    const task = await Task.findByIdAndUpdate(req.params.taskId, { ...update, $push: { activity: { type: "updated", message: "Task updated", meta: update, addedBy: req.user.id } } }, { new: true, runValidators: true }).populate("assignedTo", "name email").populate("relatedLead", "name company").lean();
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "task_updated",
      title: "Manager updated task",
      message: `${formatActor(req.user)} updated task "${task?.title || "Task"}".`,
      lead: task?.relatedLead?._id || task?.relatedLead,
      relatedId: task?._id || req.params.taskId,
      actionUrl: "/manager/tasks",
      metadata: { entity: "task", taskTitle: task?.title, changes: update, relatedLead: task?.relatedLead },
    });
    emitTaskEvent(req, "task:updated", task);
    res.json({ success: true, message: "Task updated", data: task });
  } catch (error) { next(error); }
};

exports.deleteTask = async (req, res, next) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.taskId, { isDeleted: true }, { new: true }).lean();
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "task_updated",
      title: "Manager deleted task",
      message: `${formatActor(req.user)} deleted task "${task?.title || "Task"}".`,
      relatedId: req.params.taskId,
      actionUrl: "/manager/tasks",
      metadata: { entity: "task", taskId: req.params.taskId, taskTitle: task?.title },
    });
    emitTaskEvent(req, "task:deleted", { taskId: req.params.taskId });
    res.json({ success: true, message: "Task deleted" });
  } catch (error) { next(error); }
};

exports.addComment = async (req, res, next) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.taskId, { $push: { comments: { text: req.body.text, isInternal: req.body.isInternal !== false, addedBy: req.user.id }, activity: { type: "comment_added", message: "Comment added", addedBy: req.user.id } } }, { new: true }).populate("comments.addedBy", "name role").lean();
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "task_updated",
      title: "Manager added task comment",
      message: `${formatActor(req.user)} added a comment on task "${task?.title || "Task"}".`,
      relatedId: task?._id || req.params.taskId,
      actionUrl: "/manager/tasks",
      metadata: { entity: "task", taskTitle: task?.title, comment: req.body.text },
    });
    emitTaskEvent(req, "task:comment", task);
    res.json({ success: true, message: "Comment added", data: task });
  } catch (error) { next(error); }
};

exports.bulkAction = async (req, res, next) => {
  try {
    const ids = (req.body.taskIds || []).map(toObjectId).filter(Boolean);
    if (!ids.length) return res.status(400).json({ success: false, message: "Select at least one task" });
    if (req.body.action === "delete") await Task.updateMany({ _id: { $in: ids } }, { isDeleted: true });
    if (req.body.action === "status") await Task.updateMany({ _id: { $in: ids } }, { status: req.body.payload?.status });
    if (req.body.action === "assign") await Task.updateMany({ _id: { $in: ids } }, { assignedTo: req.body.payload?.assignedTo });
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "task_updated",
      title: "Manager performed bulk task update",
      message: `${formatActor(req.user)} performed "${req.body.action}" on ${ids.length} tasks.`,
      actionUrl: "/manager/tasks",
      metadata: { entity: "task", action: req.body.action, taskIds: ids, payload: req.body.payload },
    });
    emitTaskEvent(req, "task:bulk", req.body);
    res.json({ success: true, message: "Bulk action completed" });
  } catch (error) { next(error); }
};

exports.exportTasks = async (req, res, next) => {
  try {
    const rows = await Task.find(await buildQuery(req)).populate("assignedTo", "name").populate("relatedLead", "name company").lean();
    const headers = ["Task Title", "Description", "Assigned Agent", "Related Lead", "Priority", "Status", "Due Date", "Reminder", "Created Date"];
    const csvRows = rows.map((t) => [t.title, t.description, t.assignedTo?.name || "", t.relatedLead?.name || "", t.priority, computedStatus(t), t.dueDate, t.reminderDate || "", t.createdAt]);
    const csv = [headers, ...csvRows].map((row) => row.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="tasks-${Date.now()}.csv"`);
    res.send(csv);
  } catch (error) { next(error); }
};
