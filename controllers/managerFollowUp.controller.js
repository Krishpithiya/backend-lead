const mongoose = require("mongoose");
const FollowUp = require("../models/FollowUp");
const FollowUpActivity = require("../models/FollowUpActivity");
const FollowUpNote = require("../models/FollowUpNote");
const FollowUpNotification = require("../models/FollowUpNotification");
const FollowUpReminder = require("../models/FollowUpReminder");
const Lead = require("../models/lead.model");
const User = require("../models/user");
const { notifyAdminsOfUpdate, formatActor } = require("../utils/adminNotifications");
const { ensureTenMinuteSmsReminder } = require("../utils/followUpReminderUtils");
const { dateError } = require("../utils/dateValidation");

const toObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;

const dateKey = (value) => {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
};

const dateTimeKey = (value) => {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 16);
  if (typeof value === "string") return value.slice(0, 16);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 16);
};

const getManagerScope = async (managerId) => {
  const managerObjectId = toObjectId(managerId);
  const agents = await User.find({ managerId: managerObjectId, role: "agent" })
    .select("_id name email phone status")
    .lean();
  const agentIds = agents.map((agent) => agent._id);

  return {
    managerObjectId,
    agents,
    agentIds,
    scopeQuery: {
      $or: [
        { assignedTo: managerObjectId },
        { assignedTo: { $in: agentIds } },
        { createdBy: managerObjectId },
      ],
    },
  };
};

const getDateRange = (filter, startDate, endDate) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(today);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  if (filter === "today") {
    return { $gte: today, $lt: tomorrowStart };
  }

  if (filter === "tomorrow") {
    const dayAfter = new Date(tomorrowStart);
    dayAfter.setDate(dayAfter.getDate() + 1);
    return { $gte: tomorrowStart, $lt: dayAfter };
  }

  if (filter === "week") {
    const end = new Date(today);
    end.setDate(end.getDate() + 7);
    return { $gte: today, $lt: end };
  }

  if (filter === "month") {
    const end = new Date(today);
    end.setMonth(end.getMonth() + 1);
    return { $gte: today, $lt: end };
  }

  if (filter === "custom" && startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    return { $gte: start, $lte: end };
  }

  return null;
};

const buildQuery = async (req) => {
  const { scopeQuery, agentIds } = await getManagerScope(req.user.id);
  const {
    search,
    status,
    type,
    priority,
    agent,
    dateFilter,
    startDate,
    endDate,
  } = req.query;

  const query = { ...scopeQuery };

  if (status && status !== "all") query.status = status;
  if (type && type !== "all") query.followUpType = type;
  if (priority && priority !== "all") query.priority = priority;

  if (agent && agent !== "all") {
    const agentId = toObjectId(agent);
    if (agentId && agentIds.some((id) => id.toString() === agentId.toString())) {
      query.assignedTo = agentId;
    }
  }

  const scheduledDate = getDateRange(dateFilter, startDate, endDate);
  if (scheduledDate) query.scheduledDate = scheduledDate;

  if (search) {
    const matchingUsers = await User.find({
      name: { $regex: search, $options: "i" },
      _id: { $in: agentIds },
    })
      .select("_id")
      .lean();
    const matchingLeads = await Lead.find({
      $or: [
        { name: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ],
    })
      .select("_id")
      .lean();

    query.$and = [
      ...(query.$and || []),
      {
        $or: [
          ...(mongoose.Types.ObjectId.isValid(search)
            ? [{ _id: toObjectId(search) }]
            : []),
          { assignedTo: { $in: matchingUsers.map((user) => user._id) } },
          { lead: { $in: matchingLeads.map((lead) => lead._id) } },
          { notes: { $regex: search, $options: "i" } },
        ],
      },
    ];
  }

  return query;
};

const populateFollowUp = (query) =>
  query
    .populate("lead", "name phone email company status source")
    .populate("assignedTo", "name email phone status")
    .populate("createdBy", "name email role")
    .populate("completedBy", "name email role")
    .populate("notesThread.addedBy", "name email role")
    .populate("activity.addedBy", "name email role");

const syncLeadFollowUpsToCollection = async (managerId) => {
  const { managerObjectId, agentIds, scopeQuery } = await getManagerScope(managerId);
  const leadScopeQuery = {
    $or: [
      { assignedManager: managerObjectId },
      { assignedAgent: { $in: agentIds } },
      { createdBy: managerObjectId },
    ],
  };

  const leads = await Lead.find({
    ...leadScopeQuery,
    followUps: { $exists: true, $ne: [] },
  })
    .select("_id name assignedManager assignedAgent createdBy priority followUps")
    .lean();

  const writes = [];
  leads.forEach((lead) => {
    (lead.followUps || []).forEach((item) => {
      if (!item.date || !item._id) return;
      const assignedTo = lead.assignedAgent || lead.assignedManager || managerObjectId;
      writes.push({
        updateOne: {
          filter: { lead: lead._id, legacyLeadFollowUpId: item._id },
          update: {
            $setOnInsert: {
              lead: lead._id,
              legacyLeadFollowUpId: item._id,
              followUpType: "call",
              priority: lead.priority || "medium",
              nextAction: item.note || "",
              createdBy: item.createdBy || lead.createdBy || managerObjectId,
              activity: [
                {
                  type: "created",
                  message: "Follow-up imported from lead history",
                  addedBy: item.createdBy || lead.createdBy || managerObjectId,
                  createdAt: item.createdAt || new Date(),
                },
              ],
              createdAt: item.createdAt || new Date(),
            },
            $set: {
              assignedTo,
              scheduledDate: item.date,
              scheduledTime: new Date(item.date).toISOString().slice(11, 16),
              status: item.status || "pending",
              notes: item.note || "",
            },
          },
          upsert: true,
        },
      });
    });
  });

  if (writes.length) {
    await FollowUp.bulkWrite(writes, { ordered: false });
  }

  return scopeQuery;
};

const logActivity = async (followUp, type, message, userId, meta = {}) => {
  followUp.activity.push({ type, message, addedBy: userId, meta });
  await FollowUpActivity.create({
    followUp: followUp._id,
    lead: followUp.lead,
    activityType: type,
    description: message,
    performedBy: userId,
    metadata: meta,
  });
};

const getSummary = async (scopeQuery) => {
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const [
    total,
    todayCount,
    pending,
    completed,
    missed,
    upcoming,
    overdue,
  ] = await Promise.all([
    FollowUp.countDocuments(scopeQuery),
    FollowUp.countDocuments({
      ...scopeQuery,
      scheduledDate: { $gte: today, $lt: tomorrow },
    }),
    FollowUp.countDocuments({ ...scopeQuery, status: "pending" }),
    FollowUp.countDocuments({ ...scopeQuery, status: "completed" }),
    FollowUp.countDocuments({ ...scopeQuery, status: "missed" }),
    FollowUp.countDocuments({
      ...scopeQuery,
      scheduledDate: { $gte: now, $lt: nextWeek },
      status: { $in: ["pending", "in_progress", "rescheduled"] },
    }),
    FollowUp.countDocuments({
      ...scopeQuery,
      scheduledDate: { $lt: now },
      status: { $in: ["pending", "in_progress", "rescheduled"] },
    }),
  ]);

  const successRate = total ? Math.round((completed / total) * 100) : 0;

  return [
    { key: "total", label: "Total Follow-Ups", value: total, growth: 0 },
    { key: "today", label: "Today's Follow-Ups", value: todayCount, growth: 0 },
    { key: "pending", label: "Pending Follow-Ups", value: pending, growth: 0 },
    { key: "completed", label: "Completed Follow-Ups", value: completed, growth: 0 },
    { key: "missed", label: "Missed Follow-Ups", value: missed, growth: 0 },
    { key: "upcoming", label: "Upcoming Follow-Ups", value: upcoming, growth: 0 },
    { key: "overdue", label: "Overdue Follow-Ups", value: overdue, growth: 0 },
    { key: "success", label: "Follow-Up Success Rate", value: `${successRate}%`, growth: 0 },
  ];
};

const getAnalytics = async (scopeQuery) => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const [statusBreakdown, agentPerformance, dailyTrend, monthlyTrend] =
    await Promise.all([
      FollowUp.aggregate([
        { $match: scopeQuery },
        { $group: { _id: "$status", value: { $sum: 1 } } },
      ]),
      FollowUp.aggregate([
        { $match: scopeQuery },
        {
          $group: {
            _id: "$assignedTo",
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
            missed: {
              $sum: { $cond: [{ $eq: ["$status", "missed"] }, 1, 0] },
            },
          },
        },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "agent" } },
        { $unwind: { path: "$agent", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            name: { $ifNull: ["$agent.name", "Unassigned"] },
            total: 1,
            completed: 1,
            missed: 1,
            productivityScore: {
              $cond: [
                { $gt: ["$total", 0] },
                { $round: [{ $multiply: [{ $divide: ["$completed", "$total"] }, 100] }, 0] },
                0,
              ],
            },
          },
        },
      ]),
      FollowUp.aggregate([
        { $match: { ...scopeQuery, scheduledDate: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$scheduledDate" } },
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      FollowUp.aggregate([
        { $match: { ...scopeQuery, scheduledDate: { $gte: sixMonthsAgo } } },
        {
          $group: {
            _id: { year: { $year: "$scheduledDate" }, month: { $month: "$scheduledDate" } },
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),
    ]);

  const total = statusBreakdown.reduce((sum, item) => sum + item.value, 0);
  const completed =
    statusBreakdown.find((item) => item._id === "completed")?.value || 0;

  return {
    statusBreakdown: statusBreakdown.map((item) => ({
      name: item._id || "unknown",
      value: item.value,
    })),
    successRate: total ? Math.round((completed / total) * 100) : 0,
    agentPerformance,
    dailyTrend: dailyTrend.map((item) => ({
      day: item._id,
      total: item.total,
      completed: item.completed,
    })),
    monthlyTrend: monthlyTrend.map((item) => ({
      month: `${item._id.year}-${String(item._id.month).padStart(2, "0")}`,
      total: item.total,
      completed: item.completed,
    })),
    conversionRatio: total ? Math.round((completed / total) * 100) : 0,
    averageResponseTime: "2h 15m",
  };
};

exports.getFollowUpCenter = async (req, res) => {
  try {
    await syncLeadFollowUpsToCollection(req.user.id);
    const { scopeQuery, agents } = await getManagerScope(req.user.id);
    const query = await buildQuery(req);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const skip = (page - 1) * limit;
    const sortBy = req.query.sortBy || "scheduledDate";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;

    const [
      followUps,
      total,
      summary,
      analytics,
      upcoming,
      missed,
      timelineDocs,
      leads,
      savedNotifications,
    ] = await Promise.all([
      populateFollowUp(
        FollowUp.find(query)
          .sort({ [sortBy]: sortOrder })
          .skip(skip)
          .limit(limit)
      ).lean(),
      FollowUp.countDocuments(query),
      getSummary(scopeQuery),
      getAnalytics(scopeQuery),
      populateFollowUp(
        FollowUp.find({
          ...scopeQuery,
          scheduledDate: { $gte: new Date() },
          status: { $in: ["pending", "in_progress", "rescheduled"] },
        })
          .sort({ scheduledDate: 1 })
          .limit(8)
      ).lean(),
      populateFollowUp(
        FollowUp.find({
          ...scopeQuery,
          scheduledDate: { $lt: new Date() },
          status: { $in: ["pending", "missed", "in_progress"] },
        })
          .sort({ scheduledDate: 1 })
          .limit(8)
      ).lean(),
      populateFollowUp(FollowUp.find(scopeQuery).sort({ updatedAt: -1 }).limit(20)).lean(),
      Lead.find({
        $or: [
          { assignedManager: toObjectId(req.user.id) },
          { createdBy: toObjectId(req.user.id) },
        ],
      })
        .select("_id name phone email company")
        .limit(100)
        .lean(),
      FollowUpNotification.find({ recipient: toObjectId(req.user.id) })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    const timeline = [];
    timelineDocs.forEach((followUp) => {
      (followUp.activity || []).slice(0, 3).forEach((event) => {
        timeline.push({
          _id: event._id,
          followUpId: followUp._id,
          leadName: followUp.lead?.name || "Lead",
          type: event.type,
          message: event.message,
          user: event.addedBy,
          createdAt: event.createdAt,
        });
      });
    });
    timeline.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      data: {
        followUps,
        summary,
        analytics,
        upcoming,
        missed,
        agents,
        leads,
        notifications: savedNotifications.length
          ? savedNotifications
          : upcoming.slice(0, 5).map((item) => ({
              _id: item._id,
              title: "Upcoming follow-up",
              message: `${item.lead?.name || "Lead"} has a ${item.followUpType} follow-up due soon`,
              type: item.priority === "high" ? "overdue" : "reminder",
              createdAt: item.scheduledDate,
            })),
        timeline: timeline.slice(0, 20),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Manager follow-up center error:", error);
    res.status(500).json({ success: false, message: "Failed to load follow-up center" });
  }
};

exports.getFollowUpDetails = async (req, res) => {
  try {
    await syncLeadFollowUpsToCollection(req.user.id);
    const { scopeQuery } = await getManagerScope(req.user.id);
    const followUp = await populateFollowUp(
      FollowUp.findOne({ _id: req.params.followUpId, ...scopeQuery })
    );
    if (!followUp) {
      return res.status(404).json({ success: false, message: "Follow-up not found" });
    }
    res.json({ success: true, data: followUp });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load follow-up details" });
  }
};

exports.createFollowUp = async (req, res) => {
  try {
    const { managerObjectId, agentIds } = await getManagerScope(req.user.id);
    const assignedTo = req.body.assignedTo || req.user.id;
    const invalidScheduledDate = dateError(req.body.scheduledDate, "Follow-up date");
    if (invalidScheduledDate) return res.status(400).json({ success: false, message: invalidScheduledDate });
    const invalidReminderDate = dateError(req.body.reminderTime, "Reminder date");
    if (invalidReminderDate) return res.status(400).json({ success: false, message: invalidReminderDate });

    if (
      assignedTo !== req.user.id &&
      !agentIds.some((id) => id.toString() === assignedTo)
    ) {
      return res.status(403).json({ success: false, message: "Agent is not in your team" });
    }

    const lead = await Lead.findById(req.body.lead);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const followUp = new FollowUp({
      lead: req.body.lead,
      assignedTo,
      scheduledDate: req.body.scheduledDate,
      scheduledTime: req.body.scheduledTime,
      followUpType: req.body.followUpType || "call",
      priority: req.body.priority || "medium",
      reminderTime: req.body.reminderTime,
      reminderType: req.body.reminderType || ["in_app"],
      status: req.body.status || "pending",
      notes: req.body.notes || "",
      nextAction: req.body.nextAction || "",
      createdBy: req.user.id,
    });
    await logActivity(followUp, "created", "Follow-up created", req.user.id);
    await followUp.save();
    await ensureTenMinuteSmsReminder(followUp);

    if (followUp.reminderTime) {
      await FollowUpReminder.create({
        followUp: followUp._id,
        reminderAt: followUp.reminderTime,
        channels: followUp.reminderType,
      });
    }

    await FollowUpNotification.create({
      followUp: followUp._id,
      recipient: assignedTo,
      title: "Follow-up scheduled",
      message: `${lead.name || "Lead"} follow-up is scheduled`,
      type: "reminder",
    });

    lead.assignedManager = lead.assignedManager || managerObjectId;
    lead.nextFollowUpDate = req.body.scheduledDate;
    lead.followUps.push({
      date: req.body.scheduledDate,
      note: req.body.notes || "",
      status: req.body.status || "pending",
      createdBy: req.user.id,
    });
    lead.timeline.push({
      type: "follow_up_added",
      message: "Follow-up scheduled",
      addedBy: req.user.id,
      meta: { followUpDate: req.body.scheduledDate },
    });
    await lead.save();
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "follow_up_updated",
      title: "Manager created follow-up",
      message: `${formatActor(req.user)} created a follow-up for lead "${lead.name || "Lead"}".`,
      lead: lead._id,
      relatedId: followUp._id,
      actionUrl: `/manager/leads/${lead._id}`,
      metadata: {
        entity: "followup",
        leadName: lead.name,
        assignedTo,
        scheduledDate: req.body.scheduledDate,
        scheduledTime: req.body.scheduledTime,
        status: followUp.status,
        priority: followUp.priority,
        notes: followUp.notes,
      },
    });

    res.status(201).json({ success: true, data: followUp, message: "Follow-up created" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "Failed to create follow-up" });
  }
};

exports.updateFollowUp = async (req, res) => {
  try {
    const { scopeQuery, agentIds } = await getManagerScope(req.user.id);
    const followUp = await FollowUp.findOne({ _id: req.params.followUpId, ...scopeQuery });
    if (!followUp) {
      return res.status(404).json({ success: false, message: "Follow-up not found" });
    }

    if (
      req.body.assignedTo &&
      req.body.assignedTo !== req.user.id &&
      !agentIds.some((id) => id.toString() === req.body.assignedTo)
    ) {
      return res.status(403).json({ success: false, message: "Agent is not in your team" });
    }

    const oldStatus = followUp.status;
    const oldDate = followUp.scheduledDate;
    const scheduledDateChanged =
      req.body.scheduledDate !== undefined && dateKey(req.body.scheduledDate) !== dateKey(oldDate);
    const reminderTimeChanged =
      req.body.reminderTime !== undefined && dateTimeKey(req.body.reminderTime) !== dateTimeKey(followUp.reminderTime);
    const invalidScheduledDate = scheduledDateChanged
      ? dateError(req.body.scheduledDate, "Follow-up date")
      : "";
    if (invalidScheduledDate) return res.status(400).json({ success: false, message: invalidScheduledDate });
    const invalidReminderDate = reminderTimeChanged
      ? dateError(req.body.reminderTime, "Reminder date")
      : "";
    if (invalidReminderDate) return res.status(400).json({ success: false, message: invalidReminderDate });
    [
      "lead",
      "assignedTo",
      "scheduledDate",
      "scheduledTime",
      "followUpType",
      "priority",
      "reminderTime",
      "status",
      "notes",
      "nextAction",
      "outcome",
      "missedReason",
    ].forEach((field) => {
      if (req.body[field] !== undefined) followUp[field] = req.body[field];
    });

    if (req.body.status === "completed" && oldStatus !== "completed") {
      followUp.completedAt = new Date();
      followUp.completedBy = req.user.id;
      await logActivity(followUp, "completed", "Follow-up completed", req.user.id);
      await FollowUpNotification.create({
        followUp: followUp._id,
        recipient: followUp.createdBy || req.user.id,
        title: "Follow-up completed",
        message: "An assigned follow-up was marked completed",
        type: "completed",
      });
    } else if (req.body.scheduledDate && `${oldDate}` !== `${req.body.scheduledDate}`) {
      followUp.rescheduledFrom = oldDate;
      await logActivity(followUp, "rescheduled", "Follow-up rescheduled", req.user.id, {
        from: oldDate,
        to: req.body.scheduledDate,
      });
      await FollowUpNotification.create({
        followUp: followUp._id,
        recipient: followUp.assignedTo,
        title: "Follow-up rescheduled",
        message: "A follow-up date was updated",
        type: "rescheduled",
      });
      if (followUp.reminderTime) {
        await FollowUpReminder.findOneAndUpdate(
          { followUp: followUp._id },
          {
            reminderAt: followUp.reminderTime,
            channels: followUp.reminderType,
            status: "scheduled",
          },
          { upsert: true, new: true }
        );
      }
    } else if (req.body.status && req.body.status !== oldStatus) {
      await logActivity(followUp, "status_changed", `Status changed to ${req.body.status}`, req.user.id);
    }

    await followUp.save();
    await ensureTenMinuteSmsReminder(followUp);
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "follow_up_updated",
      title: "Manager updated follow-up",
      message: `${formatActor(req.user)} updated a follow-up.`,
      lead: followUp.lead,
      relatedId: followUp._id,
      actionUrl: followUp.lead ? `/manager/leads/${followUp.lead}` : "/manager/followups",
      metadata: {
        entity: "followup",
        followUpId: followUp._id,
        oldStatus,
        oldDate,
        changes: req.body,
      },
    });
    res.json({ success: true, data: followUp, message: "Follow-up updated" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update follow-up" });
  }
};

exports.addNote = async (req, res) => {
  try {
    const { scopeQuery } = await getManagerScope(req.user.id);
    const followUp = await FollowUp.findOne({ _id: req.params.followUpId, ...scopeQuery });
    if (!followUp) return res.status(404).json({ success: false, message: "Follow-up not found" });
    if (!req.body.text) return res.status(400).json({ success: false, message: "Note is required" });

    followUp.notesThread.push({
      text: req.body.text,
      addedBy: req.user.id,
      isInternal: req.body.isInternal !== false,
    });
    await FollowUpNote.create({
      followUp: followUp._id,
      lead: followUp.lead,
      text: req.body.text,
      richText: req.body.richText || "",
      addedBy: req.user.id,
      isInternal: req.body.isInternal !== false,
    });
    await logActivity(followUp, "note_added", "Note added", req.user.id);
    await followUp.save();
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "note_added",
      title: "Manager added follow-up note",
      message: `${formatActor(req.user)} added a note on a follow-up.`,
      lead: followUp.lead,
      relatedId: followUp._id,
      actionUrl: followUp.lead ? `/manager/leads/${followUp.lead}` : "/manager/followups",
      metadata: { entity: "followup", followUpId: followUp._id, note: req.body.text },
    });
    res.json({ success: true, data: followUp, message: "Note added" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to add note" });
  }
};

exports.bulkAction = async (req, res) => {
  try {
    const { followUpIds = [], action, payload = {} } = req.body;
    if (!followUpIds.length) {
      return res.status(400).json({ success: false, message: "Select follow-ups first" });
    }

    const { scopeQuery, agentIds } = await getManagerScope(req.user.id);
    const update = {};

    if (action === "assign") {
      if (!agentIds.some((id) => id.toString() === payload.agentId)) {
        return res.status(403).json({ success: false, message: "Agent is not in your team" });
      }
      update.assignedTo = payload.agentId;
    }
    if (action === "status") update.status = payload.status;
    if (action === "reschedule") {
      const invalidScheduledDate = dateError(payload.scheduledDate, "Follow-up date");
      if (invalidScheduledDate) return res.status(400).json({ success: false, message: invalidScheduledDate });
      update.scheduledDate = payload.scheduledDate;
      update.scheduledTime = payload.scheduledTime;
      update.status = "rescheduled";
    }
    if (action === "delete") {
      const followUpsToDelete = await FollowUp.find({ ...scopeQuery, _id: { $in: followUpIds } })
        .select("_id lead legacyLeadFollowUpId")
        .lean();
      const idsToDelete = followUpsToDelete.map((followUp) => followUp._id);
      await Promise.all([
        FollowUp.deleteMany({ _id: { $in: idsToDelete } }),
        FollowUpReminder.deleteMany({ followUp: { $in: idsToDelete } }),
        FollowUpNotification.deleteMany({ followUp: { $in: idsToDelete } }),
        FollowUpNote.deleteMany({ followUp: { $in: idsToDelete } }),
        FollowUpActivity.deleteMany({ followUp: { $in: idsToDelete } }),
        ...followUpsToDelete
          .filter((followUp) => followUp.legacyLeadFollowUpId)
          .map((followUp) =>
            Lead.updateOne(
              { _id: followUp.lead },
              { $pull: { followUps: { _id: followUp.legacyLeadFollowUpId } } }
            )
          ),
      ]);
      await notifyAdminsOfUpdate({
        actor: req.user,
        type: "follow_up_updated",
        title: "Manager deleted follow-ups",
        message: `${formatActor(req.user)} deleted ${idsToDelete.length} follow-ups.`,
        actionUrl: "/manager/followups",
        metadata: { entity: "followup", action, followUpIds, payload },
      });
      return res.json({ success: true, message: "Follow-ups deleted" });
    }
    if (action === "reminder") {
      update.reminderSent = true;
      update.reminderSentAt = new Date();
    }

    await FollowUp.updateMany(
      { ...scopeQuery, _id: { $in: followUpIds } },
      {
        $set: update,
        $push: {
          activity: {
            type: action === "reminder" ? "reminder_sent" : "status_changed",
            message: `Bulk action: ${action}`,
            addedBy: req.user.id,
            createdAt: new Date(),
          },
        },
      }
    );
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "follow_up_updated",
      title: "Manager performed bulk follow-up update",
      message: `${formatActor(req.user)} performed "${action}" on ${followUpIds.length} follow-ups.`,
      actionUrl: "/manager/followups",
      metadata: { entity: "followup", action, followUpIds, payload },
    });

    res.json({ success: true, message: "Bulk action completed" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Bulk action failed" });
  }
};

exports.deleteFollowUp = async (req, res) => {
  try {
    const { scopeQuery } = await getManagerScope(req.user.id);
    const followUp = await FollowUp.findOne({ _id: req.params.followUpId, ...scopeQuery });
    if (!followUp) return res.status(404).json({ success: false, message: "Follow-up not found" });

    await Promise.all([
      FollowUp.deleteOne({ _id: followUp._id }),
      FollowUpReminder.deleteMany({ followUp: followUp._id }),
      FollowUpNotification.deleteMany({ followUp: followUp._id }),
      FollowUpNote.deleteMany({ followUp: followUp._id }),
      FollowUpActivity.deleteMany({ followUp: followUp._id }),
      followUp.legacyLeadFollowUpId
        ? Lead.updateOne(
            { _id: followUp.lead },
            { $pull: { followUps: { _id: followUp.legacyLeadFollowUpId } } }
          )
        : Promise.resolve(),
    ]);
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "follow_up_updated",
      title: "Manager deleted follow-up",
      message: `${formatActor(req.user)} deleted a follow-up.`,
      lead: followUp.lead,
      relatedId: followUp._id,
      actionUrl: followUp.lead ? `/manager/leads/${followUp.lead}` : "/manager/followups",
      metadata: { entity: "followup", followUpId: followUp._id, status: "deleted" },
    });
    res.json({ success: true, message: "Follow-up deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to delete follow-up" });
  }
};
