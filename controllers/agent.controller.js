const mongoose = require("mongoose");
const Lead = require("../models/lead.model");
const FollowUp = require("../models/FollowUp");
const Task = require("../models/Task");
const Notification = require("../models/Notification");
const { notifyAdminsOfUpdate, formatActor } = require("../utils/adminNotifications");
const { ensureTenMinuteSmsReminder } = require("../utils/followUpReminderUtils");
const { dateError } = require("../utils/dateValidation");

const oid = (id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null);

const dayRange = (date = new Date()) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const monthStart = () => {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
};

const title = (value = "") => value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const computedTaskStatus = (task) =>
  task.status !== "completed" && task.status !== "cancelled" && new Date(task.dueDate) < new Date()
    ? "overdue"
    : task.status;

const agentLeadQuery = (agentId) => ({
  isDeleted: { $ne: true },
  assignedAgent: agentId,
});

const ensureAgentNotifications = async (agentId) => {
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const [leads, followups, tasks] = await Promise.all([
    Lead.find(agentLeadQuery(agentId)).select("_id name company status assignedDate createdAt").lean(),
    FollowUp.find({ assignedTo: agentId, scheduledDate: { $gte: now, $lte: soon }, status: { $in: ["pending", "in_progress", "rescheduled"] } }).populate("lead", "name company").lean(),
    Task.find({ $or: [{ assignedTo: agentId }, { assignedUsers: agentId }], isDeleted: { $ne: true } }).select("_id title priority dueDate status createdAt").lean(),
  ]);

  const ops = [];
  leads.forEach((lead) => ops.push({
    updateOne: {
      filter: { recipient: agentId, type: "lead_assigned", relatedId: lead._id },
      update: { $setOnInsert: { recipient: agentId, type: "lead_assigned", title: "New lead assigned", message: `${lead.name}${lead.company ? ` from ${lead.company}` : ""} is assigned to you.`, lead: lead._id, relatedId: lead._id, actionUrl: "/agent/leads", metadata: { status: lead.status }, createdAt: lead.assignedDate || lead.createdAt || new Date() } },
      upsert: true,
    },
  }));
  followups.forEach((followup) => ops.push({
    updateOne: {
      filter: { recipient: agentId, type: followup.followUpType === "meeting" ? "meeting_reminder" : "follow_up_due", relatedId: followup._id },
      update: { $setOnInsert: { recipient: agentId, type: followup.followUpType === "meeting" ? "meeting_reminder" : "follow_up_due", title: followup.followUpType === "meeting" ? "Meeting reminder" : "Followup reminder", message: `${title(followup.followUpType)} due for ${followup.lead?.name || "lead"}.`, lead: followup.lead?._id || followup.lead, relatedId: followup._id, actionUrl: "/agent/followups", metadata: { scheduledDate: followup.scheduledDate, status: followup.status }, createdAt: new Date() } },
      upsert: true,
    },
  }));
  tasks.forEach((task) => ops.push({
    updateOne: {
      filter: { recipient: agentId, type: "task_assigned", relatedId: task._id },
      update: { $setOnInsert: { recipient: agentId, type: "task_assigned", title: "Task assigned", message: `Task assigned: ${task.title}`, relatedId: task._id, actionUrl: "/agent/tasks", metadata: { priority: task.priority, dueDate: task.dueDate, status: task.status }, createdAt: task.createdAt || new Date() } },
      upsert: true,
    },
  }));
  if (ops.length) await Notification.bulkWrite(ops, { ordered: false });
};

exports.getDashboard = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    const today = dayRange();
    const thisMonth = monthStart();
    const leadQuery = agentLeadQuery(agentId);

    const [leads, followups, tasks, notifications] = await Promise.all([
      Lead.find(leadQuery).sort({ assignedDate: -1, createdAt: -1 }).limit(500).lean(),
      FollowUp.find({ assignedTo: agentId }).populate("lead", "name company phone email status").sort({ scheduledDate: 1 }).limit(200).lean(),
      Task.find({ $or: [{ assignedTo: agentId }, { assignedUsers: agentId }], isDeleted: { $ne: true } }).populate("relatedLead", "name company status").sort({ dueDate: 1 }).limit(200).lean(),
      Notification.find({ recipient: agentId }).populate("lead", "name company").sort({ createdAt: -1 }).limit(20).lean(),
    ]);

    const countStatus = (status) => leads.filter((lead) => lead.status === status).length;
    const todayFollowups = followups.filter((f) => new Date(f.scheduledDate) >= today.start && new Date(f.scheduledDate) <= today.end);
    const pendingFollowups = followups.filter((f) => ["pending", "in_progress", "rescheduled"].includes(f.status));
    const monthlyLeads = leads.filter((lead) => new Date(lead.createdAt) >= thisMonth || new Date(lead.assignedDate || 0) >= thisMonth);
    const monthlyConverted = monthlyLeads.filter((lead) => ["converted", "won"].includes(lead.status)).length;
    const monthlyRate = monthlyLeads.length ? Math.round((monthlyConverted / monthlyLeads.length) * 100) : 0;

    const statusMap = leads.reduce((acc, lead) => {
      const key = title(lead.status || "new");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const monthly = Array.from({ length: 6 }).map((_, index) => {
      const date = new Date();
      date.setMonth(date.getMonth() - (5 - index));
      const y = date.getFullYear();
      const m = date.getMonth();
      const monthLeads = leads.filter((lead) => {
        const d = new Date(lead.createdAt);
        return d.getFullYear() === y && d.getMonth() === m;
      });
      return {
        month: date.toLocaleDateString("en-US", { month: "short" }),
        assigned: monthLeads.length,
        converted: monthLeads.filter((lead) => ["converted", "won"].includes(lead.status)).length,
      };
    });

    const stats = {
      totalAssignedLeads: leads.length,
      newLeads: countStatus("new"),
      interestedLeads: countStatus("interested"),
      followupPending: pendingFollowups.length,
      convertedLeads: countStatus("converted") + countStatus("won"),
      lostLeads: countStatus("lost") + countStatus("not_interested"),
      todayFollowups: todayFollowups.length,
      monthlyPerformance: monthlyRate,
    };

    const activityTimeline = [
      ...leads.slice(0, 8).map((lead) => ({
        id: `lead-${lead._id}`,
        type: "lead",
        title: `${lead.name} assigned`,
        description: `${title(lead.status)} lead${lead.company ? ` from ${lead.company}` : ""}`,
        createdAt: lead.assignedDate || lead.createdAt,
      })),
      ...tasks.slice(0, 8).map((task) => ({
        id: `task-${task._id}`,
        type: "task",
        title: task.title,
        description: `${title(computedTaskStatus(task))} task due ${new Date(task.dueDate).toLocaleDateString("en-IN")}`,
        createdAt: task.createdAt,
      })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10);

    res.json({
      success: true,
      data: {
        stats,
        charts: {
          leadStatus: Object.entries(statusMap).map(([name, value]) => ({ name, value })),
          monthlyConversion: monthly,
        },
        recentLeads: leads.slice(0, 8),
        upcomingFollowups: pendingFollowups.slice(0, 8),
        dailyTasks: tasks.filter((task) => new Date(task.dueDate) <= today.end).slice(0, 8).map((task) => ({ ...task, computedStatus: computedTaskStatus(task) })),
        notifications,
        activityTimeline,
        performance: {
          conversionRate: leads.length ? Math.round(((countStatus("converted") + countStatus("won")) / leads.length) * 100) : 0,
          activeLeads: leads.filter((lead) => !["converted", "won", "lost", "not_interested"].includes(lead.status)).length,
          completedTasks: tasks.filter((task) => task.status === "completed").length,
          overdueTasks: tasks.filter((task) => computedTaskStatus(task) === "overdue").length,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.getLeads = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const filter = agentLeadQuery(agentId);
    if (req.query.status && req.query.status !== "all") filter.status = req.query.status;
    if (req.query.priority && req.query.priority !== "all") filter.priority = req.query.priority;
    if (req.query.source && req.query.source !== "all") filter.source = req.query.source;
    if (req.query.date) {
      const range = dayRange(new Date(req.query.date));
      filter.createdAt = { $gte: range.start, $lte: range.end };
    }
    if (req.query.search) {
      const pattern = new RegExp(req.query.search, "i");
      filter.$or = [{ name: pattern }, { email: pattern }, { phone: pattern }, { company: pattern }];
    }
    const allowedSort = ["createdAt", "assignedDate", "name", "company", "status", "priority", "nextFollowUpDate"];
    const sortBy = allowedSort.includes(req.query.sortBy) ? req.query.sortBy : "assignedDate";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const [leads, total] = await Promise.all([
      Lead.find(filter).sort({ [sortBy]: sortOrder, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Lead.countDocuments(filter),
    ]);
    res.json({ success: true, data: { leads, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } } });
  } catch (error) {
    next(error);
  }
};

exports.exportLeads = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    const filter = agentLeadQuery(agentId);
    if (req.query.status && req.query.status !== "all") {
      if (req.query.status === "missed") {
        filter.$or = [
          { status: "missed" },
          { status: "pending", scheduledDate: { $lt: new Date() } },
        ];
      } else {
        filter.status = req.query.status;
      }
    }
    if (req.query.priority && req.query.priority !== "all") filter.priority = req.query.priority;
    if (req.query.source && req.query.source !== "all") filter.source = req.query.source;
    if (req.query.date) {
      const range = dayRange(new Date(req.query.date));
      filter.createdAt = { $gte: range.start, $lte: range.end };
    }
    if (req.query.search) {
      const pattern = new RegExp(req.query.search, "i");
      filter.$or = [{ name: pattern }, { email: pattern }, { phone: pattern }, { company: pattern }];
    }
    const allowedSort = ["createdAt", "assignedDate", "name", "company", "status", "priority", "nextFollowUpDate"];
    const sortBy = allowedSort.includes(req.query.sortBy) ? req.query.sortBy : "assignedDate";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const leads = await Lead.find(filter).sort({ [sortBy]: sortOrder, createdAt: -1 }).lean();
    res.json({ success: true, data: { leads, total: leads.length } });
  } catch (error) {
    next(error);
  }
};

exports.getLeadDetails = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    const lead = await Lead.findOne({ _id: req.params.leadId, ...agentLeadQuery(agentId) })
      .populate("assignedBy", "name email role")
      .populate("createdBy", "name email role")
      .populate("notes.addedBy", "name role")
      .populate("timeline.addedBy", "name role")
      .lean();
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    const followups = await FollowUp.find({ lead: lead._id, assignedTo: agentId }).sort({ scheduledDate: -1 }).lean();
    res.json({ success: true, data: { ...lead, followupHistory: followups } });
  } catch (error) {
    next(error);
  }
};

exports.updateLeadStatus = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    const allowed = ["new", "contacted", "no_response", "interested", "not_interested", "qualified", "proposal_sent", "negotiation", "won", "converted", "lost", "follow_up", "demo_request", "meeting_schedule", "low_priority"];
    if (!allowed.includes(req.body.status)) return res.status(400).json({ success: false, message: "Invalid lead status" });
    const lead = await Lead.findOne({ _id: req.params.leadId, ...agentLeadQuery(agentId) });
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    const oldStatus = lead.status;
    lead.status = req.body.status;
    lead.updatedBy = agentId;
    lead.timeline.unshift({
      type: "status_changed",
      message: `Status changed from ${title(oldStatus)} to ${title(req.body.status)}`,
      meta: { oldStatus, newStatus: req.body.status },
      addedBy: agentId,
    });
    await lead.save();
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "lead_status_updated",
      title: "Agent updated lead status",
      message: `${formatActor(req.user)} changed lead "${lead.name}" from ${title(oldStatus)} to ${title(req.body.status)}.`,
      lead: lead._id,
      relatedId: lead._id,
      actionUrl: `/manager/leads/${lead._id}`,
      metadata: { entity: "lead", leadName: lead.name, oldStatus, newStatus: req.body.status },
    });
    res.json({ success: true, message: "Lead status updated", data: lead });
  } catch (error) {
    next(error);
  }
};

exports.addLeadNote = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    if (!req.body.text?.trim()) return res.status(400).json({ success: false, message: "Note is required" });
    const lead = await Lead.findOneAndUpdate(
      { _id: req.params.leadId, ...agentLeadQuery(agentId) },
      {
        $push: {
          notes: { $each: [{ text: req.body.text.trim(), addedBy: agentId }], $position: 0 },
          timeline: { $each: [{ type: "note_added", message: "Note added", addedBy: agentId }], $position: 0 },
        },
      },
      { new: true }
    ).lean();
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "note_added",
      title: "Agent added lead note",
      message: `${formatActor(req.user)} added a note on lead "${lead.name}".`,
      lead: lead._id,
      relatedId: lead._id,
      actionUrl: `/manager/leads/${lead._id}`,
      metadata: { entity: "lead", leadName: lead.name, note: req.body.text.trim() },
    });
    res.json({ success: true, message: "Note added", data: lead });
  } catch (error) {
    next(error);
  }
};

exports.scheduleLeadFollowup = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    const lead = await Lead.findOne({ _id: req.params.leadId, ...agentLeadQuery(agentId) });
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    if (!req.body.scheduledDate) return res.status(400).json({ success: false, message: "Followup date is required" });
    const invalidScheduledDate = dateError(req.body.scheduledDate, "Followup date");
    if (invalidScheduledDate) return res.status(400).json({ success: false, message: invalidScheduledDate });
    const followup = await FollowUp.create({
      lead: lead._id,
      assignedTo: agentId,
      scheduledDate: req.body.scheduledDate,
      scheduledTime: req.body.scheduledTime || "",
      followUpType: req.body.followUpType || "call",
      priority: req.body.priority || "medium",
      notes: req.body.notes || "",
      nextAction: req.body.nextAction || "",
      createdBy: agentId,
      activity: [{ type: "created", message: "Followup scheduled", addedBy: agentId }],
    });
    await ensureTenMinuteSmsReminder(followup);
    await Lead.updateOne(
      { _id: lead._id },
      {
        $set: {
          nextFollowUpDate: req.body.scheduledDate,
          ...(req.body.notes ? { followUpNotes: req.body.notes } : {}),
        },
        $push: {
          followUps: { date: req.body.scheduledDate, note: req.body.notes || "", status: "pending", createdBy: agentId },
          timeline: { $each: [{ type: "follow_up_added", message: "Followup scheduled", meta: { followUpDate: req.body.scheduledDate }, addedBy: agentId }], $position: 0 },
        },
      }
    );
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "follow_up_updated",
      title: "Agent scheduled lead follow-up",
      message: `${formatActor(req.user)} scheduled a follow-up for lead "${lead.name}".`,
      lead: lead._id,
      relatedId: followup._id,
      actionUrl: `/manager/leads/${lead._id}`,
      metadata: {
        entity: "followup",
        leadName: lead.name,
        scheduledDate: req.body.scheduledDate,
        scheduledTime: req.body.scheduledTime || "",
        priority: req.body.priority || "medium",
        notes: req.body.notes || "",
      },
    });
    res.status(201).json({ success: true, message: "Followup scheduled", data: followup });
  } catch (error) {
    next(error);
  }
};

exports.addCallSummary = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    const lead = await Lead.findOne({ _id: req.params.leadId, ...agentLeadQuery(agentId) });
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    lead.callLogs.unshift({
      callType: req.body.callType || "outgoing",
      duration: Number(req.body.duration) || 0,
      note: req.body.note || "",
      status: req.body.status || "connected",
      calledAt: req.body.calledAt || new Date(),
      addedBy: agentId,
    });
    lead.timeline.unshift({ type: "call_logged", message: "Call summary added", meta: { callDuration: Number(req.body.duration) || 0 }, addedBy: agentId });
    await lead.save();
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "admin_activity",
      title: "Agent added call summary",
      message: `${formatActor(req.user)} added a call summary for lead "${lead.name}".`,
      lead: lead._id,
      relatedId: lead._id,
      actionUrl: `/manager/leads/${lead._id}`,
      metadata: {
        entity: "lead",
        leadName: lead.name,
        callType: req.body.callType || "outgoing",
        duration: Number(req.body.duration) || 0,
        status: req.body.status || "connected",
        note: req.body.note || "",
      },
    });
    res.json({ success: true, message: "Call summary added", data: lead });
  } catch (error) {
    next(error);
  }
};

exports.addLeadDocument = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    if (!req.file) return res.status(400).json({ success: false, message: "Document file is required" });
    const fileUrl = `/uploads/lead-documents/${req.file.filename}`;
    const lead = await Lead.findOneAndUpdate(
      { _id: req.params.leadId, ...agentLeadQuery(agentId) },
      {
        $push: {
          attachments: {
            $each: [{
              fileName: req.body.fileName || req.file.originalname || "Document",
              fileUrl,
              fileType: req.file.mimetype || "document",
              uploadedBy: agentId,
            }],
            $position: 0,
          },
          timeline: {
            $each: [{
              type: "file_uploaded",
              message: "Document uploaded",
              meta: { fileUrl },
              addedBy: agentId,
            }],
            $position: 0,
          },
        },
      },
      { new: true }
    ).lean();
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "attachment_uploaded",
      title: "Agent uploaded lead document",
      message: `${formatActor(req.user)} uploaded a document for lead "${lead.name}".`,
      lead: lead._id,
      relatedId: lead._id,
      actionUrl: `/manager/leads/${lead._id}`,
      metadata: { entity: "lead", leadName: lead.name, fileName: req.body.fileName || req.file.originalname || "Document", fileUrl },
    });
    res.json({ success: true, message: "Document uploaded", data: lead });
  } catch (error) {
    next(error);
  }
};

exports.getFollowups = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    const filter = { assignedTo: agentId };
    if (req.query.status && req.query.status !== "all") {
      if (req.query.status === "missed") {
        filter.$or = [
          { status: "missed" },
          { status: "pending", scheduledDate: { $lt: new Date() } },
        ];
      } else {
        filter.status = req.query.status;
      }
    }
    const followups = await FollowUp.find(filter).populate("lead", "name company phone email status").sort({ scheduledDate: 1 }).lean();
    const today = dayRange();
    const stats = {
      today: followups.filter((f) => new Date(f.scheduledDate) >= today.start && new Date(f.scheduledDate) <= today.end && f.status !== "completed").length,
      upcoming: followups.filter((f) => new Date(f.scheduledDate) > today.end && f.status !== "completed").length,
      missed: followups.filter((f) => (f.status === "missed" || (new Date(f.scheduledDate) < today.start && f.status !== "completed"))).length,
      completed: followups.filter((f) => f.status === "completed").length,
    };
    res.json({ success: true, data: followups, stats });
  } catch (error) {
    next(error);
  }
};

exports.createFollowup = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    const lead = await Lead.findOne({ _id: req.body.lead, ...agentLeadQuery(agentId) });
    if (!lead) return res.status(404).json({ success: false, message: "Assigned lead not found" });
    if (!req.body.scheduledDate) return res.status(400).json({ success: false, message: "Date is required" });
    const invalidScheduledDate = dateError(req.body.scheduledDate, "Followup date");
    if (invalidScheduledDate) return res.status(400).json({ success: false, message: invalidScheduledDate });
    const invalidReminderDate = dateError(req.body.reminderTime, "Reminder date");
    if (invalidReminderDate) return res.status(400).json({ success: false, message: invalidReminderDate });
    const followup = await FollowUp.create({
      lead: lead._id,
      assignedTo: agentId,
      scheduledDate: req.body.scheduledDate,
      scheduledTime: req.body.scheduledTime || "",
      followUpType: req.body.followUpType || "call",
      notes: req.body.notes || "",
      reminderTime: req.body.reminderTime || null,
      priority: req.body.priority || "medium",
      createdBy: agentId,
      activity: [{ type: "created", message: "Followup created", addedBy: agentId }],
    });
    await ensureTenMinuteSmsReminder(followup);
    await Lead.updateOne(
      { _id: lead._id },
      {
        $set: { nextFollowUpDate: req.body.scheduledDate },
        $push: {
          followUps: { date: req.body.scheduledDate, note: req.body.notes || "", status: "pending", createdBy: agentId },
          timeline: { $each: [{ type: "follow_up_added", message: "Followup created", meta: { followUpDate: req.body.scheduledDate }, addedBy: agentId }], $position: 0 },
        },
      }
    );
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "follow_up_updated",
      title: "Agent created follow-up",
      message: `${formatActor(req.user)} created a follow-up for lead "${lead.name}".`,
      lead: lead._id,
      relatedId: followup._id,
      actionUrl: `/manager/leads/${lead._id}`,
      metadata: {
        entity: "followup",
        leadName: lead.name,
        scheduledDate: req.body.scheduledDate,
        scheduledTime: req.body.scheduledTime || "",
        priority: req.body.priority || "medium",
        notes: req.body.notes || "",
      },
    });
    res.status(201).json({ success: true, message: "Followup created", data: followup });
  } catch (error) { next(error); }
};

exports.updateFollowup = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    const update = { ...req.body };
    const invalidScheduledDate = dateError(update.scheduledDate, "Followup date");
    if (invalidScheduledDate) return res.status(400).json({ success: false, message: invalidScheduledDate });
    const invalidReminderDate = dateError(update.reminderTime, "Reminder date");
    if (invalidReminderDate) return res.status(400).json({ success: false, message: invalidReminderDate });
    if (update.status === "completed") {
      update.completedAt = new Date();
      update.completedBy = agentId;
    }
    if (update.scheduledDate) update.status = update.status || "rescheduled";
    const activityType = update.status === "completed" ? "completed" : update.scheduledDate ? "rescheduled" : "status_changed";
    const followup = await FollowUp.findOneAndUpdate(
      { _id: req.params.followupId, assignedTo: agentId },
      { ...update, $push: { activity: { type: activityType, message: "Followup updated", meta: update, addedBy: agentId } } },
      { new: true, runValidators: true }
    ).populate("lead", "name company phone email status").lean();
    if (!followup) return res.status(404).json({ success: false, message: "Followup not found" });
    await ensureTenMinuteSmsReminder(followup);
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "follow_up_updated",
      title: "Agent updated follow-up",
      message: `${formatActor(req.user)} updated a follow-up for ${followup.lead?.name || "a lead"}.`,
      lead: followup.lead?._id || followup.lead,
      relatedId: followup._id,
      actionUrl: followup.lead?._id ? `/manager/leads/${followup.lead._id}` : "/manager/followups",
      metadata: { entity: "followup", leadName: followup.lead?.name, changes: update },
    });
    res.json({ success: true, message: "Followup updated", data: followup });
  } catch (error) { next(error); }
};

exports.deleteFollowup = async (req, res, next) => {
  try {
    const deleted = await FollowUp.findOneAndDelete({ _id: req.params.followupId, assignedTo: oid(req.user.id) });
    if (!deleted) return res.status(404).json({ success: false, message: "Followup not found" });
    res.json({ success: true, message: "Followup deleted" });
  } catch (error) { next(error); }
};

exports.getTasks = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    const tasks = await Task.find({ $or: [{ assignedTo: agentId }, { assignedUsers: agentId }], isDeleted: { $ne: true } }).populate("relatedLead", "name company status").populate("assignedBy", "name email role").sort({ dueDate: 1 }).lean();
    res.json({ success: true, data: tasks.map((task) => ({ ...task, computedStatus: computedTaskStatus(task) })) });
  } catch (error) {
    next(error);
  }
};

exports.updateTaskStatus = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    const statusUpdate = { status: req.body.status };
    if (req.body.status === "completed") {
      statusUpdate.completedAt = new Date();
    } else {
      statusUpdate.completedAt = null;
    }
    const task = await Task.findOneAndUpdate(
      { _id: req.params.taskId, $or: [{ assignedTo: agentId }, { assignedUsers: agentId }], isDeleted: { $ne: true } },
      {
        ...statusUpdate,
        $push: { activity: { type: "status_changed", message: `Agent updated task status to ${title(req.body.status)}`, addedBy: agentId } },
      },
      { new: true, runValidators: true }
    ).populate("relatedLead", "name company status").lean();
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "task_updated",
      title: "Agent updated task status",
      message: `${formatActor(req.user)} changed task "${task.title}" status to ${title(req.body.status)}.`,
      lead: task.relatedLead?._id || task.relatedLead,
      relatedId: task._id,
      actionUrl: "/manager/tasks",
      metadata: { entity: "task", taskTitle: task.title, status: req.body.status, relatedLead: task.relatedLead },
    });
    res.json({ success: true, data: { ...task, computedStatus: computedTaskStatus(task) } });
  } catch (error) {
    next(error);
  }
};

exports.addTaskNote = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    if (!req.body.text?.trim()) return res.status(400).json({ success: false, message: "Note is required" });
    const task = await Task.findOneAndUpdate(
      { _id: req.params.taskId, $or: [{ assignedTo: agentId }, { assignedUsers: agentId }], isDeleted: { $ne: true } },
      {
        $push: {
          comments: { text: req.body.text.trim(), addedBy: agentId, isInternal: true },
          activity: { type: "note_added", message: "Task note added", addedBy: agentId },
        },
      },
      { new: true }
    ).populate("relatedLead", "name company status").lean();
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "task_updated",
      title: "Agent added task note",
      message: `${formatActor(req.user)} added a note on task "${task.title}".`,
      lead: task.relatedLead?._id || task.relatedLead,
      relatedId: task._id,
      actionUrl: "/manager/tasks",
      metadata: { entity: "task", taskTitle: task.title, note: req.body.text.trim(), relatedLead: task.relatedLead },
    });
    res.json({ success: true, message: "Task note added", data: { ...task, computedStatus: computedTaskStatus(task) } });
  } catch (error) { next(error); }
};

exports.addTaskFile = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    const task = await Task.findOneAndUpdate(
      { _id: req.params.taskId, $or: [{ assignedTo: agentId }, { assignedUsers: agentId }], isDeleted: { $ne: true } },
      {
        $push: {
          attachments: {
            fileName: req.body.fileName || "Task file",
            fileUrl: req.body.fileUrl || "",
            fileType: req.body.fileType || "document",
            uploadedBy: agentId,
          },
          activity: { type: "file_uploaded", message: "Task file uploaded", addedBy: agentId },
        },
      },
      { new: true }
    ).populate("relatedLead", "name company status").lean();
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    res.json({ success: true, message: "Task file uploaded", data: { ...task, computedStatus: computedTaskStatus(task) } });
  } catch (error) { next(error); }
};

exports.getReports = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    const [leads, followups, tasks] = await Promise.all([
      Lead.find(agentLeadQuery(agentId)).lean(),
      FollowUp.find({ assignedTo: agentId }).populate("lead", "name company source status").lean(),
      Task.find({ $or: [{ assignedTo: agentId }, { assignedUsers: agentId }], isDeleted: { $ne: true } }).lean(),
    ]);
    const converted = leads.filter((l) => ["converted", "won"].includes(l.status)).length;
    const meetings = followups.filter((f) => ["meeting", "video_call", "demo"].includes(f.followUpType) && f.status === "completed").length;
    const calls = followups.filter((f) => f.followUpType === "call").length + leads.reduce((sum, lead) => sum + (lead.callLogs?.length || 0), 0);
    const completedTasks = tasks.filter((t) => t.status === "completed").length;
    const conversionPercentage = leads.length ? Math.round((converted / leads.length) * 100) : 0;
    const productivityScore = Math.min(100, Math.round((conversionPercentage * 0.4) + ((completedTasks / Math.max(tasks.length, 1)) * 100 * 0.35) + ((followups.filter((f) => f.status === "completed").length / Math.max(followups.length, 1)) * 100 * 0.25)));
    const group = (items, keyFn) => Object.entries(items.reduce((acc, item) => {
      const key = keyFn(item) || "other";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})).map(([name, value]) => ({ name: title(name), value }));
    const monthly = Array.from({ length: 6 }).map((_, index) => {
      const date = new Date();
      date.setMonth(date.getMonth() - (5 - index));
      const y = date.getFullYear();
      const m = date.getMonth();
      const monthLeads = leads.filter((lead) => {
        const d = new Date(lead.createdAt);
        return d.getFullYear() === y && d.getMonth() === m;
      });
      return {
        month: date.toLocaleDateString("en-US", { month: "short" }),
        leads: monthLeads.length,
        converted: monthLeads.filter((l) => ["converted", "won"].includes(l.status)).length,
        followups: followups.filter((f) => {
          const d = new Date(f.scheduledDate);
          return d.getFullYear() === y && d.getMonth() === m;
        }).length,
        tasks: tasks.filter((t) => {
          const d = new Date(t.createdAt);
          return d.getFullYear() === y && d.getMonth() === m;
        }).length,
      };
    });
    const previous = monthly[monthly.length - 2]?.converted || 0;
    const current = monthly[monthly.length - 1]?.converted || 0;
    const monthlyGrowth = previous ? Math.round(((current - previous) / previous) * 100) : current ? 100 : 0;
    res.json({
      success: true,
      data: {
        analytics: { totalCalls: calls, meetingsDone: meetings, conversionPercentage, monthlyGrowth, productivityScore },
        reports: {
          leadConversion: group(leads, (l) => l.status),
          monthlyPerformance: monthly,
          followupPerformance: group(followups, (f) => f.status),
          taskCompletion: group(tasks, (t) => computedTaskStatus(t)),
          leadSource: group(leads, (l) => l.source),
        },
        exportRows: leads.map((lead) => ({
          name: lead.name,
          company: lead.company,
          source: lead.source,
          status: lead.status,
          priority: lead.priority,
          assignedDate: lead.assignedDate || lead.createdAt,
          nextFollowUpDate: lead.nextFollowUpDate,
        })),
      },
    });
  } catch (error) { next(error); }
};

exports.getNotifications = async (req, res, next) => {
  try {
    const agentId = oid(req.user.id);
    await ensureAgentNotifications(agentId);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const query = { recipient: agentId };
    if (req.query.unreadOnly === "true") query.isRead = false;
    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query).populate("lead", "name company email phone status").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({ recipient: agentId, isRead: false }),
    ]);
    res.json({ success: true, data: { notifications, unreadCount, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } } });
  } catch (error) { next(error); }
};

exports.getNotificationUnreadCount = async (req, res, next) => {
  try {
    const unreadCount = await Notification.countDocuments({ recipient: oid(req.user.id), isRead: false });
    res.json({ success: true, data: { unreadCount } });
  } catch (error) { next(error); }
};

exports.markNotificationRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.notificationId, recipient: oid(req.user.id) },
      { isRead: true, readAt: new Date() },
      { new: true }
    ).lean();
    if (!notification) return res.status(404).json({ success: false, message: "Notification not found" });
    res.json({ success: true, data: notification, message: "Notification marked as read" });
  } catch (error) { next(error); }
};

exports.markAllNotificationsRead = async (req, res, next) => {
  try {
    await Notification.updateMany({ recipient: oid(req.user.id), isRead: false }, { isRead: true, readAt: new Date() });
    res.json({ success: true, message: "All notifications marked as read" });
  } catch (error) { next(error); }
};

exports.deleteNotification = async (req, res, next) => {
  try {
    const deleted = await Notification.findOneAndDelete({ _id: req.params.notificationId, recipient: oid(req.user.id) });
    if (!deleted) return res.status(404).json({ success: false, message: "Notification not found" });
    res.json({ success: true, message: "Notification deleted" });
  } catch (error) { next(error); }
};
