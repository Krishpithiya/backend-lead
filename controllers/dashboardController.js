const Lead = require("../models/lead.model");
const User = require("../models/user");
const mongoose = require("mongoose");

const getDashboardData = async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    let dashboardData = {};

    if (role === "admin") {
      dashboardData = await getAdminDashboardData();
    } else if (role === "manager") {
      dashboardData = await getManagerDashboardData(userId);
    } else if (role === "agent") {
      dashboardData = await getAgentDashboardData(userId);
    }

    res.json({
      success: true,
      data: dashboardData,
      role,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard data",
    });
  }
};

const getAdminDashboardData = async () => {
  const totalLeads = await Lead.countDocuments();
  const totalUsers = await User.countDocuments();
  const totalAgents = await User.countDocuments({ role: "agent" });
  const totalManagers = await User.countDocuments({ role: "manager" });
  const totalAssignedLeads = await Lead.countDocuments({
    $or: [
      { assignedAgent: { $exists: true, $ne: null } },
      { assignedManager: { $exists: true, $ne: null } },
    ],
  });

  const leadsByStatus = await Lead.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const leadsBySource = await Lead.aggregate([
    { $group: { _id: "$source", count: { $sum: 1 } } },
  ]);

  const monthlyLeads = await Lead.aggregate([
    {
      $group: {
        _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.year": -1, "_id.month": -1 } },
    { $limit: 12 },
  ]);

  const managers = await User.find({ role: "manager" })
    .select("name email")
    .lean();
  const topPerformers = await Promise.all(
    managers.map(async (manager) => {
      const totalLeads = await Lead.countDocuments({
        assignedManager: manager._id,
      });
      const convertedLeads = await Lead.countDocuments({
        assignedManager: manager._id,
        status: { $in: ["won", "qualified"] },
      });
      return {
        _id: manager._id,
        name: manager.name,
        email: manager.email,
        totalLeads,
        convertedLeads,
      };
    }),
  );
  topPerformers.sort(
    (a, b) =>
      b.convertedLeads - a.convertedLeads || b.totalLeads - a.totalLeads,
  );

  const recentLeads = await Lead.find()
    .populate("assignedAgent", "name email")
    .populate("assignedManager", "name email")
    .sort({ createdAt: -1 })
    .limit(10);

  const followupLeads = await Lead.find({ "followUps.status": "pending" })
    .populate("assignedAgent", "name email")
    .populate("assignedManager", "name email")
    .sort({ updatedAt: -1 })
    .limit(10);

  return {
    stats: [
      {
        title: "Total Leads",
        value: totalLeads,
        color: "#6366f1",
        icon: "people",
      },
      {
        title: "Total Users",
        value: totalUsers,
        color: "#8b5cf6",
        icon: "users",
      },
      {
        title: "Active Agents",
        value: totalAgents,
        color: "#3b82f6",
        icon: "user-tie",
      },
      {
        title: "Managers",
        value: totalManagers,
        color: "#10b981",
        icon: "briefcase",
      },
      {
        title: "Total Assigned Leads",
        value: totalAssignedLeads,
        color: "#14b8a6",
        icon: "user-check",
      },
    ],
    charts: {
      leadsByStatus: leadsByStatus.map((item) => ({
        name: item._id,
        value: item.count,
      })),
      leadsBySource: leadsBySource.map((item) => ({
        name: item._id,
        value: item.count,
      })),
      monthlyTrends: monthlyLeads.map((item) => ({
        month: `${item._id.year}-${item._id.month.toString().padStart(2, "0")}`,
        leads: item.count,
      })),
    },
    tables: { topPerformers, recentLeads, followupLeads },
  };
};

const getManagerDashboardData = async (managerId) => {
  const managerObjectId = new mongoose.Types.ObjectId(managerId);

  const convertedStatuses = ["won", "qualified"];
  const pendingStatuses = [
    "follow_up",
    "interested",
    "contacted",
    "proposal_sent",
    "negotiation",
    "meeting_schedule",
    "demo_request",
    "no_response",
    "low_priority",
  ];
  const lostStatuses = ["lost", "not_interested"];

  // Agents under this manager
  const agents = await User.find({ managerId: managerObjectId, role: "agent" });
  const agentIds = agents.map((a) => a._id);

  // Match the Manager Leads page scope: manager-assigned, manager-created, or assigned to this manager's agents.
  const managerScopeQuery = {
    $or: [
      { assignedManager: managerObjectId },
      { assignedAgent: { $in: agentIds } },
      { createdBy: managerObjectId },
    ],
  };

  // Get all leads for this manager scope
  const allLeads = await Lead.find(managerScopeQuery);
  const totalLeads = allLeads.length;

  const newLeads = allLeads.filter((l) => l.status === "new").length;
  const convertedLeads = allLeads.filter((l) =>
    convertedStatuses.includes(l.status),
  ).length;
  const pendingLeads = allLeads.filter((l) =>
    pendingStatuses.includes(l.status),
  ).length;
  const lostLeads = allLeads.filter((l) =>
    lostStatuses.includes(l.status),
  ).length;
  const conversionRate =
    totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

  // Current month
  const now = new Date();
  const thisMonthLeads = allLeads.filter((lead) => {
    const d = new Date(lead.createdAt);
    return (
      d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    );
  }).length;

  // Last month for growth
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    0,
    23,
    59,
    59,
  );
  const lastMonthLeads = allLeads.filter((lead) => {
    const d = new Date(lead.createdAt);
    return d >= lastMonthStart && d <= lastMonthEnd;
  }).length;
  const monthlyGrowth =
    lastMonthLeads > 0
      ? Math.round(((thisMonthLeads - lastMonthLeads) / lastMonthLeads) * 100)
      : thisMonthLeads > 0
        ? 100
        : 0;

  // Agent performance via aggregation
  const agentAgg = await Lead.aggregate([
    { $match: { assignedAgent: { $in: agentIds } } },
    {
      $group: {
        _id: "$assignedAgent",
        totalLeads: { $sum: 1 },
        convertedLeads: {
          $sum: { $cond: [{ $in: ["$status", convertedStatuses] }, 1, 0] },
        },
        pendingLeads: {
          $sum: { $cond: [{ $in: ["$status", pendingStatuses] }, 1, 0] },
        },
        lostLeads: {
          $sum: { $cond: [{ $in: ["$status", lostStatuses] }, 1, 0] },
        },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "agentInfo",
      },
    },
    { $unwind: { path: "$agentInfo", preserveNullAndEmptyArrays: true } },
  ]);

  // Add agents with 0 leads
  const agentIdsWithLeads = agentAgg.map((a) => a._id.toString());
  agents.forEach((agent) => {
    if (!agentIdsWithLeads.includes(agent._id.toString())) {
      agentAgg.push({
        _id: agent._id,
        totalLeads: 0,
        convertedLeads: 0,
        pendingLeads: 0,
        lostLeads: 0,
        agentInfo: agent,
      });
    }
  });

  const maxConverted = Math.max(...agentAgg.map((a) => a.convertedLeads), 0);
  const processedAgents = agentAgg.map((a) => ({
    agent: {
      _id: a._id,
      name: a.agentInfo?.name || "Unknown",
      email: a.agentInfo?.email || "",
    },
    totalLeads: a.totalLeads,
    convertedLeads: a.convertedLeads,
    pendingLeads: a.pendingLeads,
    lostLeads: a.lostLeads,
    performanceRate:
      a.totalLeads > 0
        ? Math.round((a.convertedLeads / a.totalLeads) * 100)
        : 0,
    isTopPerformer: maxConverted > 0 && a.convertedLeads === maxConverted,
  }));

  // Leads by status chart
  const leadsByStatus = await Lead.aggregate([
    { $match: managerScopeQuery },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  // Leads by source chart
  const leadsBySource = await Lead.aggregate([
    { $match: managerScopeQuery },
    { $group: { _id: "$source", count: { $sum: 1 } } },
  ]);

  // Monthly trends (last 6 months)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const monthlyRaw = await Lead.aggregate([
    {
      $match: {
        ...managerScopeQuery,
        createdAt: { $gte: sixMonthsAgo },
      },
    },
    {
      $group: {
        _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
        leads: { $sum: 1 },
        converted: {
          $sum: { $cond: [{ $in: ["$status", convertedStatuses] }, 1, 0] },
        },
      },
    },
    { $sort: { "_id.year": 1, "_id.month": 1 } },
  ]);

  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const monthlyTrends = monthlyRaw.map((item) => ({
    month: monthNames[item._id.month - 1],
    leads: item.leads,
    converted: item.converted,
  }));

  // Recent leads
  const recentLeads = await Lead.find(managerScopeQuery)
    .populate("assignedAgent", "name email")
    .sort({ createdAt: -1 })
    .limit(10);

  // Follow-ups
  const leadsWithFU = await Lead.find({
    ...managerScopeQuery,
    "followUps.0": { $exists: true },
  })
    .populate("assignedAgent", "name email")
    .sort({ updatedAt: -1 })
    .limit(30);

  const followUps = [];
  leadsWithFU.forEach((lead) => {
    lead.followUps.forEach((fu) => {
      followUps.push({
        leadId: lead._id,
        leadName: lead.name,
        followUpDate: fu.date,
        note: fu.note || "",
        status: fu.status,
        agentName: lead.assignedAgent?.name || "Unassigned",
      });
    });
  });
  followUps.sort((a, b) => new Date(a.followUpDate) - new Date(b.followUpDate));

  // Activity timeline from lead timelines
  const recentForTimeline = await Lead.find(managerScopeQuery)
    .populate("timeline.addedBy", "name")
    .sort({ updatedAt: -1 })
    .limit(15);

  const activityTimeline = [];
  recentForTimeline.forEach((lead) => {
    (lead.timeline || []).slice(0, 2).forEach((event) => {
      activityTimeline.push({
        type: event.type,
        message: event.message,
        leadName: lead.name,
        agentName: event.addedBy?.name || "System",
        createdAt: event.createdAt,
      });
    });
  });
  activityTimeline.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );

  // Funnel
  const funnelStages = [
    { stage: "New", statuses: ["new"], color: "#3B82F6" },
    {
      stage: "Contacted",
      statuses: ["contacted", "no_response"],
      color: "#8B5CF6",
    },
    {
      stage: "Interested",
      statuses: [
        "interested",
        "demo_request",
        "meeting_schedule",
        "proposal_sent",
        "negotiation",
        "qualified",
      ],
      color: "#F59E0B",
    },
    {
      stage: "Follow-up",
      statuses: ["follow_up", "low_priority"],
      color: "#EF4444",
    },
    { stage: "Converted", statuses: ["won"], color: "#10B981" },
  ];
  const funnel = funnelStages.map((fs) => {
    const count = allLeads.filter((l) => fs.statuses.includes(l.status)).length;
    return {
      stage: fs.stage,
      count,
      color: fs.color,
      percentage: totalLeads > 0 ? Math.round((count / totalLeads) * 100) : 0,
    };
  });

  return {
    kpi: {
      totalLeads,
      newLeads,
      convertedLeads,
      pendingLeads,
      lostLeads,
      teamMembers: agents.length,
      conversionRate,
      monthlyGrowth,
      thisMonth: thisMonthLeads,
    },
    funnel,
    charts: {
      leadsByStatus: leadsByStatus.map((item) => ({
        name: item._id,
        value: item.count,
      })),
      leadsBySource: leadsBySource.map((item) => ({
        name: item._id || "other",
        value: item.count,
      })),
      agentPerformance: processedAgents.map((a) => ({
        name: a.agent.name,
        total: a.totalLeads,
        converted: a.convertedLeads,
        pending: a.pendingLeads,
      })),
      monthlyTrends,
    },
    tables: {
      agents: processedAgents,
      recentLeads,
      followUps: followUps.slice(0, 15),
    },
    activityTimeline: activityTimeline.slice(0, 20),
    stats: [
      {
        title: "Total Leads",
        value: totalLeads,
        color: "#6366f1",
        icon: "people",
      },
      {
        title: "Team Size",
        value: agents.length,
        color: "#3b82f6",
        icon: "users",
      },
      {
        title: "This Month",
        value: thisMonthLeads,
        color: "#10b981",
        icon: "calendar",
      },
      {
        title: "Conversion Rate",
        value: `${conversionRate}%`,
        color: "#f59e0b",
        icon: "trending-up",
      },
    ],
  };
};

const getAgentDashboardData = async (agentId) => {
  const agentObjectId = new mongoose.Types.ObjectId(agentId);
  const assignedLeads = await Lead.find({ assignedAgent: agentObjectId });
  const totalLeads = assignedLeads.length;

  const leadsByStatus = await Lead.aggregate([
    { $match: { assignedAgent: agentObjectId } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const todayFollowUps = await Lead.find({
    assignedAgent: agentObjectId,
    "followUps.date": {
      $gte: new Date(new Date().setHours(0, 0, 0, 0)),
      $lt: new Date(new Date().setHours(23, 59, 59, 999)),
    },
  });

  const recentLeads = await Lead.find({ assignedAgent: agentObjectId })
    .populate("assignedManager", "name email")
    .sort({ createdAt: -1 })
    .limit(10);

  const conversionRate =
    totalLeads > 0
      ? Math.round(
          ((leadsByStatus.find((s) => s._id === "won")?.count || 0) /
            totalLeads) *
            100,
        )
      : 0;

  const now = new Date();

  return {
    stats: [
      {
        title: "My Leads",
        value: totalLeads,
        color: "#6366f1",
        icon: "people",
      },
      {
        title: "Today's Follow-ups",
        value: todayFollowUps.length,
        color: "#ef4444",
        icon: "clock",
      },
      {
        title: "This Month",
        value: assignedLeads.filter((lead) => {
          const leadDate = new Date(lead.createdAt);
          return (
            leadDate.getMonth() === now.getMonth() &&
            leadDate.getFullYear() === now.getFullYear()
          );
        }).length,
        color: "#10b981",
        icon: "calendar",
      },
      {
        title: "Conversion Rate",
        value: `${conversionRate}%`,
        color: "#f59e0b",
        icon: "trending-up",
      },
    ],
    charts: {
      leadsByStatus: leadsByStatus.map((item) => ({
        name: item._id,
        value: item.count,
      })),
      weeklyActivity: await getWeeklyActivity(agentObjectId),
    },
    tables: {
      recentLeads,
      followUps: todayFollowUps,
    },
  };
};

const getWeeklyActivity = async (agentId) => {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const dailyActivity = await Lead.aggregate([
    { $match: { assignedAgent: agentId, createdAt: { $gte: oneWeekAgo } } },
    {
      $group: {
        _id: { day: { $dayOfWeek: "$createdAt" } },
        count: { $sum: 1 },
      },
    },
  ]);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days.map((day, index) => ({
    day,
    leads: dailyActivity.find((d) => d._id.day === index + 1)?.count || 0,
  }));
};

module.exports = {
  getDashboardData,
  getAdminDashboardData,
  getManagerDashboardData,
  getAgentDashboardData,
  getWeeklyActivity,
};
