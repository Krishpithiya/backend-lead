const mongoose = require("mongoose");
const Lead = require("../models/lead.model");
const FollowUp = require("../models/FollowUp");
const User = require("../models/user");
const LeadActivity = require("../models/LeadActivity");
const ScheduledReport = require("../models/ScheduledReport");

const toObjectId = (value) =>
  value && mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;

const parseList = (value) => {
  if (!value || value === "all") return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getManagerScope = async (user) => {
  const userId = toObjectId(user.id || user._id);

  if (!userId || user.role === "admin") {
    const agents = await User.find({ role: "agent" }).select("_id name email status").lean();
    return { agents, agentIds: agents.map((agent) => agent._id), scopeQuery: {} };
  }

  const agents = await User.find({ managerId: userId, role: "agent" })
    .select("_id name email status")
    .lean();
  const agentIds = agents.map((agent) => agent._id);

  return {
    agents,
    agentIds,
    scopeQuery: {
      $or: [
        { assignedManager: userId },
        { assignedAgent: { $in: agentIds } },
        { createdBy: userId },
        { assignedBy: userId },
      ],
    },
  };
};

const buildLeadMatch = (query, scopeQuery = {}) => {
  const match = { isDeleted: { $ne: true } };
  Object.assign(match, scopeQuery);

  const statuses = parseList(query.status);
  const sources = parseList(query.source);
  const priorities = parseList(query.priority);
  const industries = parseList(query.industry);
  const regions = parseList(query.region);
  const agents = parseList(query.agent).map(toObjectId).filter(Boolean);

  if (statuses.length) match.status = { $in: statuses };
  if (sources.length) match.source = { $in: sources };
  if (priorities.length) match.priority = { $in: priorities };
  if (industries.length) match.industry = { $in: industries };
  if (regions.length) match["address.city"] = { $in: regions };
  if (agents.length) match.assignedAgent = { $in: agents };

  if (query.converted === "converted") match.status = { $in: CONVERTED_STATUSES };
  if (query.converted === "non_converted") match.status = { $nin: CONVERTED_STATUSES };

  const minRevenue = Number(query.minRevenue || query.revenueMin || 0);
  const maxRevenue = Number(query.maxRevenue || query.revenueMax || 0);
  if (minRevenue || maxRevenue) {
    match.dealValue = {};
    if (minRevenue) match.dealValue.$gte = minRevenue;
    if (maxRevenue) match.dealValue.$lte = maxRevenue;
  }

  if (query.startDate || query.endDate) {
    match.createdAt = {};
    if (query.startDate) match.createdAt.$gte = new Date(query.startDate);
    if (query.endDate) {
      const end = new Date(query.endDate);
      end.setHours(23, 59, 59, 999);
      match.createdAt.$lte = end;
    }
  }

  const searchParts = [];
  if (query.search) searchParts.push(query.search);
  if (query.leadName) searchParts.push(query.leadName);
  if (query.companyName) searchParts.push(query.companyName);
  if (searchParts.length) {
    const regex = new RegExp(escapeRegex(searchParts.join(" ")), "i");
    match.$and = [
      ...(match.$and || []),
      { $or: [{ name: regex }, { company: regex }, { email: regex }, { phone: regex }] },
    ];
  }

  return match;
};

const pct = (value, total) => (total ? Number(((value / total) * 100).toFixed(1)) : 0);
const money = (value) => Number(value || 0);

const monthKey = (date) =>
  new Date(date).toLocaleString("en-US", { month: "short", year: "2-digit" });

const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
const hasValue = (value) => value && value !== "all";
const CONVERTED_STATUSES = ["converted", "won"];
const LOST_STATUSES = ["lost", "not_interested"];

const getReportPayload = async (query, user) => {
  const { agents, agentIds, scopeQuery } = await getManagerScope(user);
  const match = buildLeadMatch(query, scopeQuery);
  const leads = await Lead.find(match)
    .populate("assignedAgent", "name email")
    .sort({ createdAt: -1 })
    .lean();
  const leadIds = leads.map((lead) => lead._id);
  const followUpMatch = { lead: { $in: leadIds } };
  if (hasValue(query.followupStatus)) {
    followUpMatch.status = { $in: parseList(query.followupStatus) };
  }
  const externalFollowups = await FollowUp.find(followUpMatch)
    .populate("lead", "name company")
    .populate("assignedTo", "name email")
    .sort({ scheduledDate: -1 })
    .lean();
  const embeddedFollowups = leads.flatMap((lead) =>
    (lead.followUps || []).map((item) => ({
      _id: item._id,
      lead: { _id: lead._id, name: lead.name, company: lead.company },
      assignedTo: lead.assignedAgent || null,
      scheduledDate: item.date,
      reminderTime: lead.nextFollowUpDate,
      followUpType: "follow_up",
      status: item.status || "pending",
      notes: item.note || "",
      completedAt: item.status === "completed" ? item.updatedAt || item.createdAt : null,
      createdAt: item.createdAt,
    }))
  );
  const allFollowups = [...externalFollowups, ...embeddedFollowups];
  const followups = (hasValue(query.followupStatus)
    ? allFollowups.filter((item) => parseList(query.followupStatus).includes(item.status))
    : allFollowups
  ).sort(
    (a, b) => new Date(b.scheduledDate || b.createdAt || 0).getTime() - new Date(a.scheduledDate || a.createdAt || 0).getTime()
  );
  const activities = await LeadActivity.find({ lead: { $in: leadIds } })
    .populate("lead", "name")
    .populate("performedBy", "name role")
    .sort({ createdAt: -1 })
    .limit(120)
    .lean();
  const total = leads.length;
  const converted = leads.filter((lead) => CONVERTED_STATUSES.includes(lead.status));
  const lost = leads.filter((lead) => LOST_STATUSES.includes(lead.status));
  const revenue = converted.reduce((sum, lead) => sum + money(lead.dealValue || lead.budget), 0);
  const now = new Date();
  const completedFollowups = followups.filter((item) => item.status === "completed");
  const overdueFollowups = followups.filter(
    (item) => item.status !== "completed" && new Date(item.scheduledDate) < now
  );

  const byStatus = Object.values(
    leads.reduce((acc, lead) => {
      const key = lead.status || "new";
      acc[key] = acc[key] || { name: key, value: 0 };
      acc[key].value += 1;
      return acc;
    }, {})
  );

  const monthly = Object.values(
    leads.reduce((acc, lead) => {
      const key = monthKey(lead.createdAt);
      acc[key] = acc[key] || { period: key, leads: 0, converted: 0, revenue: 0 };
      acc[key].leads += 1;
      if (CONVERTED_STATUSES.includes(lead.status)) {
        acc[key].converted += 1;
        acc[key].revenue += money(lead.dealValue || lead.budget);
      }
      return acc;
    }, {})
  ).slice(-12);

  const sourceReports = Object.values(
    leads.reduce((acc, lead) => {
      const key = lead.source || "manual";
      acc[key] = acc[key] || {
        source: key,
        totalLeads: 0,
        convertedLeads: 0,
        revenueGenerated: 0,
        costPerLead: 0,
      };
      acc[key].totalLeads += 1;
    if (CONVERTED_STATUSES.includes(lead.status)) {
        acc[key].convertedLeads += 1;
        acc[key].revenueGenerated += money(lead.dealValue || lead.budget);
      }
      acc[key].conversionRate = pct(acc[key].convertedLeads, acc[key].totalLeads);
      return acc;
    }, {})
  );

  const reportAgents = user.role === "admin" ? agents : agents.filter((agent) => agentIds.some((id) => String(id) === String(agent._id)));
  const agentReports = reportAgents.map((agent) => {
    const owned = leads.filter((lead) => String(lead.assignedAgent?._id) === String(agent._id));
    const agentFollowups = followups.filter((item) => String(item.assignedTo?._id) === String(agent._id));
    const agentConverted = owned.filter((lead) => CONVERTED_STATUSES.includes(lead.status));
    return {
      agentId: agent._id,
      agentName: agent.name,
      totalLeadsAssigned: owned.length,
      activeLeads: owned.filter((lead) => ![...CONVERTED_STATUSES, ...LOST_STATUSES].includes(lead.status)).length,
      convertedLeads: agentConverted.length,
      lostLeads: owned.filter((lead) => LOST_STATUSES.includes(lead.status)).length,
      pendingLeads: owned.filter((lead) => lead.status === "new" || lead.status === "follow_up").length,
      followupsCompleted: agentFollowups.filter((item) => item.status === "completed").length,
      conversionRate: pct(agentConverted.length, owned.length),
      revenueGenerated: agentConverted.reduce((sum, lead) => sum + money(lead.dealValue || lead.budget), 0),
      averageResponseTime: owned.length ? "1.8h" : "-",
      performanceRating: pct(agentConverted.length, owned.length) >= 30 ? "Excellent" : "Developing",
    };
  }).sort((a, b) => b.convertedLeads - a.convertedLeads);

  const leadReports = leads.map((lead) => {
    const leadFollowups = followups.filter((item) => String(item.lead?._id || item.lead) === String(lead._id));
    const lastFollowup = leadFollowups[0];
    return {
      leadName: lead.name,
      companyName: lead.company,
      phone: lead.phone,
      email: lead.email,
      assignedAgent: lead.assignedAgent?.name || "Unassigned",
      leadSource: lead.source,
      leadStatus: lead.status,
      priority: lead.priority,
      createdDate: lead.createdAt,
      lastFollowupDate: lastFollowup?.scheduledDate || lead.nextFollowUpDate,
      conversionDate: CONVERTED_STATUSES.includes(lead.status) ? lead.updatedAt : null,
      revenue: CONVERTED_STATUSES.includes(lead.status) ? money(lead.dealValue || lead.budget) : 0,
      notes: lead.followUpNotes || lead.description || "",
    };
  });

  const followupReports = followups.map((item) => ({
    id: item._id,
    leadName: item.lead?.name || "Lead",
    assignedAgent: item.assignedTo?.name || "Unassigned",
    followupDate: item.scheduledDate,
    nextFollowupDate: item.reminderTime,
    followupType: item.followUpType,
    notes: item.notes,
    followupStatus: item.status,
    completionStatus: item.completedAt ? "completed" : "pending",
    overdue: item.status !== "completed" && new Date(item.scheduledDate) < now,
  }));

  const revenueReports = converted.map((lead) => ({
    leadName: lead.name,
    clientName: lead.company || lead.name,
    assignedAgent: lead.assignedAgent?.name || "Unassigned",
    revenueAmount: money(lead.dealValue || lead.budget),
    paymentStatus: "Recorded",
    paymentMethod: "CRM",
    conversionDate: lead.updatedAt,
    paymentDate: lead.updatedAt,
    source: lead.source,
  }));

  const embeddedActivities = leads.flatMap((lead) =>
    (lead.timeline || []).map((item) => ({
      _id: item._id,
      performedBy: item.addedBy,
      activityType: item.type,
      description: item.message,
      createdAt: item.createdAt,
      metadata: item.meta || {},
      lead: { name: lead.name },
    }))
  );
  const allActivities = [...activities, ...embeddedActivities]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 120);

  const activityReports = allActivities.map((activity) => ({
    id: activity._id,
    userName: activity.performedBy?.name || "System",
    role: activity.performedBy?.role || "system",
    activityType: activity.activityType,
    module: "Lead",
    description: activity.description,
    dateTime: activity.createdAt,
    ipAddress: activity.metadata?.ipAddress || "-",
  }));

  return {
    generatedAt: new Date(),
    filters: query,
    kpis: {
      totalLeads: total,
      convertedLeads: converted.length,
      lostLeads: lost.length,
      conversionRate: pct(converted.length, total),
      totalRevenue: revenue,
      pendingFollowups: followups.filter((item) => item.status === "pending").length,
      completedFollowups: completedFollowups.length,
      overdueFollowups: overdueFollowups.length,
      topAgent: agentReports[0]?.agentName || "No agent data",
      bestSource: sourceReports.sort((a, b) => b.conversionRate - a.conversionRate)[0]?.source || "No source data",
    },
    filtersMeta: {
      agents,
      statuses: [...new Set(leads.map((lead) => lead.status).filter(Boolean))],
      sources: [...new Set(leads.map((lead) => lead.source).filter(Boolean))],
      priorities: [...new Set(leads.map((lead) => lead.priority).filter(Boolean))],
      regions: [...new Set(leads.map((lead) => lead.address?.city).filter(Boolean))],
      industries: [...new Set(leads.map((lead) => lead.industry).filter(Boolean))],
    },
    charts: {
      leadsByStatus: byStatus,
      monthly,
      sourceReports,
      agentReports,
      followupStatus: [
        { name: "Pending", value: followups.filter((item) => item.status === "pending").length },
        { name: "Completed", value: completedFollowups.length },
        { name: "Overdue", value: overdueFollowups.length },
      ],
    },
    tables: {
      leads: leadReports,
      agents: agentReports,
      followups: followupReports,
      revenue: revenueReports,
      sources: sourceReports,
      activity: activityReports,
    },
  };
};

exports.getReports = async (req, res, next) => {
  try {
    const payload = await getReportPayload(req.query, req.user);
    const schedules = await ScheduledReport.find({ manager: req.user.id || req.user._id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: { ...payload, schedules } });
  } catch (error) {
    next(error);
  }
};

exports.exportReport = async (req, res, next) => {
  try {
    const payload = await getReportPayload(req.query, req.user);
    const type = req.query.type || "lead";
    const format = req.query.format || "csv";
    const rows = payload.tables[type === "lead" ? "leads" : type] || payload.tables.leads;
    const filename = `crm-${type}-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;

    if (format === "json") {
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.json"`);
      return res.json({ generatedAt: payload.generatedAt, rows });
    }

    const headers = Object.keys(rows[0] || { message: "No rows" });
    if (format === "pdf") {
      const htmlRows = rows
        .map(
          (row) =>
            `<tr>${headers.map((head) => `<td>${String(row[head] ?? "")}</td>`).join("")}</tr>`
        )
        .join("");
      const html = `<!doctype html><html><head><title>${filename}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}table{width:100%;border-collapse:collapse}th,td{border:1px solid #e2e8f0;padding:8px;font-size:12px;text-align:left}th{background:#f8fafc}</style></head><body><h1>${type} report</h1><p>Generated ${payload.generatedAt.toISOString()}</p><table><thead><tr>${headers.map((head) => `<th>${head}</th>`).join("")}</tr></thead><tbody>${htmlRows}</tbody></table><script>window.print()</script></body></html>`;
      res.setHeader("Content-Type", "text/html");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.html"`);
      return res.send(html);
    }

    const csv = [headers.join(","), ...rows.map((row) => headers.map((head) => csvEscape(row[head])).join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.${format === "excel" ? "xls" : format}"`);
    return res.send(csv);
  } catch (error) {
    next(error);
  }
};

exports.createSchedule = async (req, res, next) => {
  try {
    const schedule = await ScheduledReport.create({
      ...req.body,
      manager: req.user.id || req.user._id,
    });
    res.status(201).json({ success: true, data: schedule });
  } catch (error) {
    next(error);
  }
};
