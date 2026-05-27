const mongoose = require("mongoose");
const Lead = require("../models/lead.model");
const FollowUp = require("../models/FollowUp");
const User = require("../models/user");
const { notifyAdminsOfUpdate, formatActor } = require("../utils/adminNotifications");
const { dateError } = require("../utils/dateValidation");

const ACTIVE_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "proposal_sent",
  "negotiation",
  "follow_up",
  "interested",
  "demo_request",
  "meeting_schedule",
  "no_response",
  "low_priority",
];

const CONVERTED_STATUSES = ["won", "converted"];
const LOST_STATUSES = ["lost", "not_interested"];
const FOLLOW_UP_TYPES = [
  "call",
  "whatsapp",
  "email",
  "meeting",
  "video_call",
  "demo",
  "site_visit",
  "consultation",
  "task",
  "other",
];

const toObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;

const getManagerScope = async (managerId) => {
  const managerObjectId = toObjectId(managerId);
  const agents = await User.find({ managerId: managerObjectId, role: "agent" })
    .select("_id name email status")
    .lean();
  const agentIds = agents.map((agent) => agent._id);

  return {
    managerObjectId,
    agents,
    agentIds,
    scopeQuery: {
      $or: [
        { assignedManager: managerObjectId },
        { assignedAgent: { $in: agentIds } },
        { createdBy: managerObjectId },
      ],
    },
  };
};

const ensureLeadAccess = async (leadId, managerId) => {
  const { scopeQuery } = await getManagerScope(managerId);
  return Lead.findOne({ _id: leadId, ...scopeQuery })
    .populate("assignedAgent", "name email status")
    .populate("assignedManager", "name email")
    .populate("assignedBy", "name email role")
    .populate("leadOwner", "name email role")
    .populate("createdBy", "name email role")
    .populate("notes.addedBy", "name email role")
    .populate("timeline.addedBy", "name email role");
};

const getDateRange = (filter, startDate, endDate) => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (filter === "today") {
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { $gte: start, $lt: end };
  }

  if (filter === "yesterday") {
    const yesterday = new Date(start);
    yesterday.setDate(yesterday.getDate() - 1);
    return { $gte: yesterday, $lt: start };
  }

  if (filter === "last7") {
    const from = new Date(start);
    from.setDate(from.getDate() - 6);
    return { $gte: from };
  }

  if (filter === "last30") {
    const from = new Date(start);
    from.setDate(from.getDate() - 29);
    return { $gte: from };
  }

  if (filter === "custom" && startDate && endDate) {
    const from = new Date(startDate);
    const to = new Date(endDate);
    to.setHours(23, 59, 59, 999);
    return { $gte: from, $lte: to };
  }

  return null;
};

const buildLeadQuery = async (req) => {
  const { scopeQuery, agentIds } = await getManagerScope(req.user.id);
  const {
    search,
    status,
    source,
    priority,
    agent,
    dateFilter,
    startDate,
    endDate,
  } = req.query;

  const query = { ...scopeQuery };

  if (search) {
    const pattern = { $regex: search, $options: "i" };
    query.$and = [
      ...(query.$and || []),
      {
        $or: [
          { name: pattern },
          { email: pattern },
          { phone: pattern },
          { company: pattern },
          { _id: mongoose.Types.ObjectId.isValid(search) ? toObjectId(search) : null },
        ].filter((item) => Object.values(item)[0] !== null),
      },
    ];
  }

  if (status && status !== "all") query.status = status;
  if (source && source !== "all") query.source = source;
  if (priority && priority !== "all") query.priority = priority;

  if (agent === "assigned") query.assignedAgent = { $in: agentIds };
  if (agent === "unassigned") query.assignedAgent = null;
  if (agent && agent !== "all" && agent !== "assigned" && agent !== "unassigned") {
    const agentId = toObjectId(agent);
    if (agentId && agentIds.some((id) => id.toString() === agentId.toString())) {
      query.assignedAgent = agentId;
    }
  }

  const createdAt = getDateRange(dateFilter, startDate, endDate);
  if (createdAt) query.createdAt = createdAt;

  return query;
};

const getGrowth = (current, previous) => {
  if (!previous) return current ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
};

const calculateSummary = async (scopeQuery) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrow = new Date(todayStart);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const previousStart = new Date(todayStart);
  previousStart.setDate(previousStart.getDate() - 1);

  const base = { ...scopeQuery };
  const [
    totalLeads,
    newLeads,
    contactedLeads,
    qualifiedLeads,
    convertedLeads,
    lostLeads,
    followUpPending,
    todayLeads,
    inactiveLeads,
    yesterdayLeads,
  ] = await Promise.all([
    Lead.countDocuments(base),
    Lead.countDocuments({ ...base, status: "new" }),
    Lead.countDocuments({ ...base, status: "contacted" }),
    Lead.countDocuments({ ...base, status: "qualified" }),
    Lead.countDocuments({ ...base, status: { $in: CONVERTED_STATUSES } }),
    Lead.countDocuments({ ...base, status: { $in: LOST_STATUSES } }),
    Lead.countDocuments({ ...base, "followUps.status": "pending" }),
    Lead.countDocuments({ ...base, createdAt: { $gte: todayStart, $lt: tomorrow } }),
    Lead.countDocuments({ ...base, status: { $nin: ACTIVE_STATUSES } }),
    Lead.countDocuments({ ...base, createdAt: { $gte: previousStart, $lt: todayStart } }),
  ]);

  return [
    { key: "total", label: "Total Leads", value: totalLeads, growth: getGrowth(todayLeads, yesterdayLeads) },
    { key: "new", label: "New Leads", value: newLeads, growth: 0 },
    { key: "contacted", label: "Contacted Leads", value: contactedLeads, growth: 0 },
    { key: "qualified", label: "Qualified Leads", value: qualifiedLeads, growth: 0 },
    { key: "converted", label: "Converted Leads", value: convertedLeads, growth: 0 },
    { key: "lost", label: "Lost Leads", value: lostLeads, growth: 0 },
    { key: "followups", label: "Follow-up Pending", value: followUpPending, growth: 0 },
    { key: "today", label: "Today's Leads", value: todayLeads, growth: getGrowth(todayLeads, yesterdayLeads) },
    { key: "inactive", label: "Inactive Leads", value: inactiveLeads, growth: 0 },
  ];
};

const calculateAnalytics = async (scopeQuery) => {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const [byStatus, bySource, monthly, agentPerformance, followUpStats] =
    await Promise.all([
      Lead.aggregate([{ $match: scopeQuery }, { $group: { _id: "$status", value: { $sum: 1 } } }]),
      Lead.aggregate([{ $match: scopeQuery }, { $group: { _id: "$source", value: { $sum: 1 } } }]),
      Lead.aggregate([
        { $match: { ...scopeQuery, createdAt: { $gte: sixMonthsAgo } } },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
            leads: { $sum: 1 },
            converted: { $sum: { $cond: [{ $in: ["$status", CONVERTED_STATUSES] }, 1, 0] } },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),
      Lead.aggregate([
        { $match: scopeQuery },
        { $group: { _id: "$assignedAgent", total: { $sum: 1 }, converted: { $sum: { $cond: [{ $in: ["$status", CONVERTED_STATUSES] }, 1, 0] } } } },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "agent" } },
        { $unwind: { path: "$agent", preserveNullAndEmptyArrays: true } },
        { $project: { name: { $ifNull: ["$agent.name", "Unassigned"] }, total: 1, converted: 1 } },
      ]),
      Lead.aggregate([
        { $match: scopeQuery },
        {
          $project: {
            total: { $size: { $ifNull: ["$followUps", []] } },
            completed: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$followUps", []] },
                  as: "followUp",
                  cond: { $eq: ["$$followUp.status", "completed"] },
                },
              },
            },
          },
        },
        { $group: { _id: null, total: { $sum: "$total" }, completed: { $sum: "$completed" } } },
      ]),
    ]);

  const totalLeads = byStatus.reduce((sum, item) => sum + item.value, 0);
  const converted = byStatus
    .filter((item) => CONVERTED_STATUSES.includes(item._id))
    .reduce((sum, item) => sum + item.value, 0);
  const followUps = followUpStats[0] || { total: 0, completed: 0 };

  return {
    leadsByStatus: byStatus.map((item) => ({ name: item._id || "unknown", value: item.value })),
    leadsBySource: bySource.map((item) => ({ name: item._id || "other", value: item.value })),
    monthlyGrowth: monthly.map((item) => ({
      month: `${item._id.year}-${String(item._id.month).padStart(2, "0")}`,
      leads: item.leads,
      converted: item.converted,
    })),
    conversionRate: totalLeads ? Math.round((converted / totalLeads) * 100) : 0,
    agentPerformance,
    followUpCompletionRate: followUps.total ? Math.round((followUps.completed / followUps.total) * 100) : 0,
  };
};

exports.getLeadsCenter = async (req, res) => {
  try {
    const { scopeQuery, agents } = await getManagerScope(req.user.id);
    const query = await buildLeadQuery(req);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const skip = (page - 1) * limit;
    const sortBy = req.query.sortBy || "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;

    const [leads, total, summary, analytics, activities] = await Promise.all([
      Lead.find(query)
        .populate("assignedAgent", "name email status")
        .populate("assignedManager", "name email")
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
      Lead.countDocuments(query),
      calculateSummary(scopeQuery),
      calculateAnalytics(scopeQuery),
      Lead.find(scopeQuery)
        .populate("timeline.addedBy", "name email role")
        .sort({ updatedAt: -1 })
        .limit(30)
        .lean(),
    ]);

    const timeline = [];
    activities.forEach((lead) => {
      (lead.timeline || []).slice(0, 3).forEach((event) => {
        timeline.push({
          _id: event._id,
          leadId: lead._id,
          leadName: lead.name,
          type: event.type,
          message: event.message,
          createdAt: event.createdAt,
          user: event.addedBy,
        });
      });
    });
    timeline.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      data: {
        leads,
        summary,
        analytics,
        agents,
        notifications: timeline.slice(0, 8).map((item) => ({
          _id: item._id,
          title: item.message,
          message: `${item.leadName} was updated`,
          type: item.type,
          createdAt: item.createdAt,
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
    console.error("Manager leads center error:", error);
    res.status(500).json({ success: false, message: "Failed to load leads center" });
  }
};

exports.getLeadDetails = async (req, res) => {
  try {
    const lead = await ensureLeadAccess(req.params.leadId, req.user.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const collectionFollowUps = await FollowUp.find({ lead: lead._id })
      .populate("assignedTo", "name email phone status")
      .sort({ scheduledDate: -1 })
      .lean();

    const leadData = lead.toObject();
    const followUpSignature = (date, note, status) =>
      `${date ? new Date(date).getTime() : ""}|${note || ""}|${status || "pending"}`;
    const collectionLegacyIds = new Set(
      collectionFollowUps
        .map((followUp) => followUp.legacyLeadFollowUpId?.toString())
        .filter(Boolean)
    );
    const collectionSignatures = new Set(
      collectionFollowUps.map((followUp) =>
        followUpSignature(followUp.scheduledDate, followUp.notes || followUp.nextAction || "", followUp.status)
      )
    );
    const collectionItems = collectionFollowUps.map((followUp) => ({
        _id: followUp._id,
        date: followUp.scheduledDate,
        scheduledDate: followUp.scheduledDate,
        scheduledTime: followUp.scheduledTime,
        note: followUp.notes || followUp.nextAction || "",
        notes: followUp.notes || "",
        nextAction: followUp.nextAction || "",
        status: followUp.status || "pending",
        followUpType: followUp.followUpType || "call",
        priority: followUp.priority || "medium",
        assignedTo: followUp.assignedTo,
        createdAt: followUp.createdAt,
        legacyLeadFollowUpId: followUp.legacyLeadFollowUpId,
    }));
    const embeddedItems = (leadData.followUps || [])
      .filter((followUp) => {
        const legacyId = followUp._id?.toString();
        const signature = followUpSignature(followUp.date, followUp.note || "", followUp.status);
        return !collectionLegacyIds.has(legacyId) && !collectionSignatures.has(signature);
      })
      .map((followUp) => ({
        ...followUp,
        scheduledDate: followUp.date,
        notes: followUp.note || "",
        followUpType: "call",
        priority: lead.priority || "medium",
      }));

    leadData.followUps = [...collectionItems, ...embeddedItems].sort(
      (a, b) => new Date(b.date || 0) - new Date(a.date || 0)
    );

    res.json({ success: true, data: leadData });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load lead details" });
  }
};

exports.updateLead = async (req, res) => {
  try {
    const lead = await ensureLeadAccess(req.params.leadId, req.user.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const allowed = [
      "name",
      "email",
      "phone",
      "company",
      "industry",
      "website",
      "budget",
      "requirement",
      "interestedService",
      "expectedClosingDate",
      "dealValue",
      "source",
      "status",
      "priority",
      "leadScore",
      "nextFollowUpDate",
      "followUpNotes",
      "missedFollowUps",
      "description",
      "address",
    ];
    const oldStatus = lead.status;
    const changes = {};
    const invalidExpectedClosingDate = dateError(req.body.expectedClosingDate, "Expected closing date");
    if (invalidExpectedClosingDate) return res.status(400).json({ success: false, message: invalidExpectedClosingDate });
    const invalidNextFollowUpDate = dateError(req.body.nextFollowUpDate, "Next follow-up date");
    if (invalidNextFollowUpDate) return res.status(400).json({ success: false, message: invalidNextFollowUpDate });
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) {
        changes[field] = { from: lead[field], to: req.body[field] };
        lead[field] = req.body[field];
      }
    });
    lead.isClosed = [...CONVERTED_STATUSES, ...LOST_STATUSES].includes(lead.status);

    if (req.body.status && req.body.status !== oldStatus) {
      lead.timeline.push({
        type: "status_changed",
        message: `Status changed from ${oldStatus} to ${req.body.status}`,
        meta: { oldStatus, newStatus: req.body.status },
        addedBy: req.user.id,
      });
    } else {
      lead.timeline.push({
        type: "status_changed",
        message: "Lead updated",
        addedBy: req.user.id,
      });
    }

    await lead.save();
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: req.body.status && req.body.status !== oldStatus ? "lead_status_updated" : "lead_updated",
      title: "Manager updated lead information",
      message: `${formatActor(req.user)} updated lead "${lead.name}".`,
      lead: lead._id,
      relatedId: lead._id,
      actionUrl: `/manager/leads/${lead._id}`,
      metadata: {
        entity: "lead",
        leadName: lead.name,
        changes,
      },
    });
    res.json({ success: true, data: lead, message: "Lead updated" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "Failed to update lead" });
  }
};

exports.assignAgent = async (req, res) => {
  try {
    const { agentId } = req.body;
    const { managerObjectId, agentIds } = await getManagerScope(req.user.id);
    if (agentId && !agentIds.some((id) => id.toString() === agentId)) {
      return res.status(403).json({ success: false, message: "Agent is not in your team" });
    }

    const lead = await ensureLeadAccess(req.params.leadId, req.user.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    lead.assignedAgent = agentId || null;
    lead.assignedManager = managerObjectId;
    lead.assignedBy = req.user.id;
    lead.assignedDate = new Date();
    lead.leadOwner = agentId || managerObjectId;
    lead.timeline.push({
      type: "assigned",
      message: agentId ? "Lead assigned to agent" : "Lead moved to unassigned",
      addedBy: req.user.id,
    });

    await lead.save();
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "lead_assigned",
      title: "Manager updated lead assignment",
      message: `${formatActor(req.user)} ${agentId ? "assigned" : "unassigned"} lead "${lead.name}".`,
      lead: lead._id,
      relatedId: lead._id,
      actionUrl: `/manager/leads/${lead._id}`,
      metadata: {
        entity: "lead",
        leadName: lead.name,
        assignedAgent: agentId || null,
        assignedManager: managerObjectId,
      },
    });
    res.json({ success: true, data: lead, message: "Lead assignment updated" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to assign lead" });
  }
};

exports.addNote = async (req, res) => {
  try {
    const lead = await ensureLeadAccess(req.params.leadId, req.user.id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    if (!req.body.text) return res.status(400).json({ success: false, message: "Note is required" });

    lead.notes.push({ text: req.body.text, addedBy: req.user.id });
    lead.timeline.push({ type: "note_added", message: "Note added", addedBy: req.user.id });
    await lead.save();
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "note_added",
      title: "Manager added lead note",
      message: `${formatActor(req.user)} added a note on lead "${lead.name}".`,
      lead: lead._id,
      relatedId: lead._id,
      actionUrl: `/manager/leads/${lead._id}`,
      metadata: { entity: "lead", leadName: lead.name, note: req.body.text },
    });
    res.json({ success: true, data: lead, message: "Note added" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to add note" });
  }
};

exports.addFollowUp = async (req, res) => {
  try {
    const lead = await ensureLeadAccess(req.params.leadId, req.user.id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    if (!req.body.date) return res.status(400).json({ success: false, message: "Follow-up date is required" });
    const invalidDate = dateError(req.body.date, "Follow-up date");
    if (invalidDate) return res.status(400).json({ success: false, message: invalidDate });
    const followUpType = FOLLOW_UP_TYPES.includes(req.body.followUpType) ? req.body.followUpType : "call";

    lead.followUps.push({ date: req.body.date, note: req.body.note || "", followUpType, status: "pending", createdBy: req.user.id });
    const embeddedFollowUp = lead.followUps[lead.followUps.length - 1];
    lead.nextFollowUpDate = req.body.date;
    lead.timeline.push({
      type: "follow_up_added",
      message: "Follow-up scheduled",
      meta: { followUpDate: req.body.date },
      addedBy: req.user.id,
    });
    await lead.save();
    await FollowUp.updateOne(
      { lead: lead._id, legacyLeadFollowUpId: embeddedFollowUp._id },
      {
        $setOnInsert: {
          lead: lead._id,
          legacyLeadFollowUpId: embeddedFollowUp._id,
          followUpType,
          priority: lead.priority || "medium",
          createdBy: req.user.id,
          activity: [
            {
              type: "created",
              message: "Follow-up created from lead details",
              addedBy: req.user.id,
              createdAt: new Date(),
            },
          ],
        },
        $set: {
          assignedTo: lead.assignedAgent?._id || lead.assignedAgent || lead.assignedManager?._id || lead.assignedManager || req.user.id,
          scheduledDate: req.body.date,
          scheduledTime: new Date(req.body.date).toISOString().slice(11, 16),
          status: "pending",
          notes: req.body.note || "",
          nextAction: req.body.note || "",
        },
      },
      { upsert: true }
    );
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "follow_up_updated",
      title: "Manager scheduled lead follow-up",
      message: `${formatActor(req.user)} scheduled a follow-up for lead "${lead.name}".`,
      lead: lead._id,
      relatedId: lead._id,
      actionUrl: `/manager/leads/${lead._id}`,
      metadata: { entity: "lead", leadName: lead.name, date: req.body.date, note: req.body.note || "" },
    });
    res.json({ success: true, data: lead, message: "Follow-up added" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to add follow-up" });
  }
};

exports.markFollowUp = async (req, res) => {
  try {
    const lead = await ensureLeadAccess(req.params.leadId, req.user.id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    const followUp = lead.followUps.id(req.params.followUpId);
    if (!followUp) return res.status(404).json({ success: false, message: "Follow-up not found" });
    followUp.status = req.body.status || "completed";
    lead.timeline.push({ type: "follow_up_added", message: `Follow-up marked ${followUp.status}`, addedBy: req.user.id });
    await lead.save();
    res.json({ success: true, data: lead, message: "Follow-up updated" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update follow-up" });
  }
};

exports.bulkAction = async (req, res) => {
  try {
    const { leadIds = [], action, payload = {} } = req.body;
    if (!leadIds.length) return res.status(400).json({ success: false, message: "Select at least one lead" });

    const { scopeQuery, managerObjectId, agentIds } = await getManagerScope(req.user.id);
    const query = { ...scopeQuery, _id: { $in: leadIds } };
    const update = {};

    if (action === "assign") {
      if (payload.agentId && !agentIds.some((id) => id.toString() === payload.agentId)) {
        return res.status(403).json({ success: false, message: "Agent is not in your team" });
      }
      update.assignedAgent = payload.agentId || null;
      update.assignedManager = managerObjectId;
      update.assignedBy = req.user.id;
      update.assignedDate = new Date();
    }

    if (action === "status") update.status = payload.status;
    if (action === "delete") update.isClosed = true;

    await Lead.updateMany(query, {
      $set: update,
      $push: {
        timeline: {
          type: action === "assign" ? "assigned" : "status_changed",
          message: `Bulk action: ${action}`,
          addedBy: req.user.id,
          createdAt: new Date(),
        },
      },
    });
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: action === "assign" ? "lead_assigned" : "lead_updated",
      title: "Manager performed bulk lead update",
      message: `${formatActor(req.user)} performed "${action}" on ${leadIds.length} leads.`,
      actionUrl: "/manager/leads",
      metadata: { entity: "lead", action, leadIds, payload },
    });

    res.json({ success: true, message: "Bulk action completed" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Bulk action failed" });
  }
};

exports.deleteLead = async (req, res) => {
  try {
    const lead = await ensureLeadAccess(req.params.leadId, req.user.id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    const deletedLead = { id: lead._id, name: lead.name, email: lead.email, phone: lead.phone, status: lead.status };
    await lead.deleteOne();
    await notifyAdminsOfUpdate({
      actor: req.user,
      type: "lead_updated",
      title: "Manager deleted a lead",
      message: `${formatActor(req.user)} deleted lead "${deletedLead.name}".`,
      relatedId: deletedLead.id,
      actionUrl: "/manager/leads",
      metadata: { entity: "lead", deletedLead },
    });
    res.json({ success: true, message: "Lead deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to delete lead" });
  }
};
