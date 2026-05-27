const Lead = require("../models/lead.model");
const User = require("../models/user");
const mongoose = require("mongoose");

// Get Manager Agent Dashboard Summary
exports.getAgentDashboardSummary = async (req, res) => {
  try {
    const { id: managerId } = req.user;
    const managerObjectId = new mongoose.Types.ObjectId(managerId);

    // Get all agents under this manager
    const agents = await User.find({
      managerId: managerObjectId,
      role: "agent",
    })
      .select("name email status createdAt")
      .lean();

    const agentIds = agents.map((a) => a._id);
    const totalAgents = agents.length;
    const activeAgents = agents.filter((a) => a.status === "active").length;
    const inactiveAgents = agents.filter((a) => a.status === "inactive").length;

    // Get all leads for this manager's team
    const allLeads = await Lead.find({
      assignedAgent: { $in: agentIds },
    });

    const totalLeads = allLeads.length;
    const activeLeads = allLeads.filter(
      (l) => !["won", "lost", "not_interested"].includes(l.status),
    ).length;
    const inactiveLeads = allLeads.filter((l) =>
      ["won", "lost", "not_interested"].includes(l.status),
    ).length;

    // Follow-ups
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayFollowUps = allLeads.filter(
      (lead) =>
        lead.followUps &&
        lead.followUps.some(
          (fu) => new Date(fu.date) >= today && new Date(fu.date) < tomorrow,
        ),
    ).length;

    const totalFollowUps = allLeads.reduce(
      (acc, lead) => acc + (lead.followUps ? lead.followUps.length : 0),
      0,
    );

    // Notifications count (simplified - in real app, would query notifications collection)
    const totalNotifications = allLeads.filter(
      (l) => l.status === "new" || l.status === "interested",
    ).length;

    // Growth calculations
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);

    const lastMonth = new Date(thisMonth);
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    const thisMonthLeads = allLeads.filter(
      (l) => new Date(l.createdAt) >= thisMonth,
    ).length;
    const lastMonthLeads = allLeads.filter(
      (l) =>
        new Date(l.createdAt) >= lastMonth && new Date(l.createdAt) < thisMonth,
    ).length;

    const leadsGrowth =
      lastMonthLeads > 0
        ? (((thisMonthLeads - lastMonthLeads) / lastMonthLeads) * 100).toFixed(
            1,
          )
        : thisMonthLeads > 0
          ? 100
          : 0;

    const agentsGrowth = 0; // Would need historical data

    res.json({
      success: true,
      data: {
        summary: {
          totalAgents,
          activeAgents,
          inactiveAgents,
          totalLeads,
          activeLeads,
          inactiveLeads,
          totalFollowUps,
          totalNotifications,
        },
        growth: {
          leadsGrowth: parseFloat(leadsGrowth),
          agentsGrowth,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching agent dashboard summary:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard summary",
    });
  }
};

// Get All Agents for Manager
exports.getManagerAgents = async (req, res) => {
  try {
    const { id: managerId } = req.user;
    const managerObjectId = new mongoose.Types.ObjectId(managerId);

    const agents = await User.find({
      managerId: managerObjectId,
      role: "agent",
    })
      .select("name email phone status createdAt")
      .lean();

    // Get lead counts for each agent
    const agentIds = agents.map((a) => a._id);

    const agentPerformance = await Lead.aggregate([
      { $match: { assignedAgent: { $in: agentIds } } },
      {
        $group: {
          _id: "$assignedAgent",
          totalLeads: { $sum: 1 },
          convertedLeads: {
            $sum: { $cond: [{ $in: ["$status", ["won", "qualified"]] }, 1, 0] },
          },
          pendingLeads: {
            $sum: {
              $cond: [
                {
                  $in: [
                    "$status",
                    ["new", "contacted", "interested", "follow_up"],
                  ],
                },
                1,
                0,
              ],
            },
          },
          activeFollowUps: {
            $sum: {
              $cond: [
                {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: "$followUps",
                          cond: { $eq: ["$$this.status", "pending"] },
                        },
                      },
                    },
                    0,
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const enrichedAgents = agents.map((agent) => {
      const perf = agentPerformance.find(
        (p) => p._id.toString() === agent._id.toString(),
      ) || {
        totalLeads: 0,
        convertedLeads: 0,
        pendingLeads: 0,
        activeFollowUps: 0,
      };

      const conversionRate =
        perf.totalLeads > 0
          ? ((perf.convertedLeads / perf.totalLeads) * 100).toFixed(1)
          : 0;

      return {
        ...agent,
        performance: {
          assignedLeads: perf.totalLeads,
          convertedLeads: perf.convertedLeads,
          pendingLeads: perf.pendingLeads,
          activeFollowUps: perf.activeFollowUps,
          conversionRate: parseFloat(conversionRate),
        },
        onlineStatus: Math.random() > 0.3 ? "online" : "offline", // Simulated - would use real-time tracking
        lastActive: agent.updatedAt || agent.createdAt,
      };
    });

    // Sort by performance
    enrichedAgents.sort(
      (a, b) => b.performance.convertedLeads - a.performance.convertedLeads,
    );

    res.json({
      success: true,
      data: enrichedAgents,
    });
  } catch (error) {
    console.error("Error fetching manager agents:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch agents",
    });
  }
};

// Get Specific Agent Details
exports.getAgentDetails = async (req, res) => {
  try {
    const { id: managerId } = req.user;
    const { agentId } = req.params;
    const managerObjectId = new mongoose.Types.ObjectId(managerId);
    const agentObjectId = new mongoose.Types.ObjectId(agentId);

    // Verify agent belongs to this manager
    const agent = await User.findOne({
      _id: agentObjectId,
      managerId: managerObjectId,
      role: "agent",
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found or not authorized",
      });
    }

    // Get agent's leads
    const leads = await Lead.find({ assignedAgent: agentObjectId })
      .populate("assignedManager", "name")
      .sort({ createdAt: -1 });

    const totalLeads = leads.length;
    const convertedLeads = leads.filter((l) =>
      ["won", "qualified"].includes(l.status),
    ).length;
    const pendingLeads = leads.filter((l) =>
      ["new", "contacted", "interested", "follow_up"].includes(l.status),
    ).length;
    const lostLeads = leads.filter((l) =>
      ["lost", "not_interested"].includes(l.status),
    ).length;

    // Revenue (simplified - would need actual revenue field)
    const revenueGenerated = convertedLeads * 1000; // Placeholder calculation

    // Lead source analytics
    const leadsBySource = leads.reduce((acc, lead) => {
      acc[lead.source] = (acc[lead.source] || 0) + 1;
      return acc;
    }, {});

    // Follow-ups
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayFollowUps = leads.filter(
      (lead) =>
        lead.followUps &&
        lead.followUps.some(
          (fu) => new Date(fu.date) >= today && new Date(fu.date) < tomorrow,
        ),
    ).length;

    const missedFollowUps = leads.filter(
      (lead) =>
        lead.followUps &&
        lead.followUps.some(
          (fu) => new Date(fu.date) < today && fu.status === "pending",
        ),
    ).length;

    res.json({
      success: true,
      data: {
        agent: {
          _id: agent._id,
          name: agent.name,
          email: agent.email,
          phone: agent.phone,
          status: agent.status,
          createdAt: agent.createdAt,
        },
        analytics: {
          totalLeads,
          convertedLeads,
          pendingLeads,
          lostLeads,
          revenueGenerated,
          conversionRate:
            totalLeads > 0
              ? ((convertedLeads / totalLeads) * 100).toFixed(1)
              : 0,
          leadsBySource,
          todayFollowUps,
          missedFollowUps,
        },
        recentLeads: leads.slice(0, 10),
      },
    });
  } catch (error) {
    console.error("Error fetching agent details:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch agent details",
    });
  }
};

// Get Agent Performance Analytics
exports.getAgentPerformance = async (req, res) => {
  try {
    const { id: managerId } = req.user;
    const { agentId } = req.params;
    const managerObjectId = new mongoose.Types.ObjectId(managerId);
    const agentObjectId = new mongoose.Types.ObjectId(agentId);

    // Verify agent belongs to this manager
    const agent = await User.findOne({
      _id: agentObjectId,
      managerId: managerObjectId,
      role: "agent",
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found or not authorized",
      });
    }

    // Monthly performance (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);

    const monthlyPerformance = await Lead.aggregate([
      {
        $match: {
          assignedAgent: agentObjectId,
          createdAt: { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          totalLeads: { $sum: 1 },
          convertedLeads: {
            $sum: { $cond: [{ $in: ["$status", ["won", "qualified"]] }, 1, 0] },
          },
          revenue: {
            $sum: { $cond: [{ $in: ["$status", ["won"]] }, 1000, 0] }, // Placeholder
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
    const monthlyData = monthlyPerformance.map((mp) => ({
      month: monthNames[mp._id.month - 1],
      year: mp._id.year,
      totalLeads: mp.totalLeads,
      convertedLeads: mp.convertedLeads,
      revenue: mp.revenue,
    }));

    // Lead conversion by status
    const leadsByStatus = await Lead.aggregate([
      { $match: { assignedAgent: agentObjectId } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    // Activity chart (daily for last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyActivity = await Lead.aggregate([
      {
        $match: {
          assignedAgent: agentObjectId,
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          leads: { $sum: 1 },
          converted: {
            $sum: { $cond: [{ $in: ["$status", ["won", "qualified"]] }, 1, 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Follow-up completion rate
    const followUpStats = await Lead.aggregate([
      { $match: { assignedAgent: agentObjectId } },
      {
        $project: {
          totalFollowUps: { $size: "$followUps" },
          completedFollowUps: {
            $size: {
              $filter: {
                input: "$followUps",
                cond: { $eq: ["$$this.status", "completed"] },
              },
            },
          },
        },
      },
      {
        $group: {
          _id: null,
          totalFollowUps: { $sum: "$totalFollowUps" },
          completedFollowUps: { $sum: "$completedFollowUps" },
        },
      },
    ]);

    const followUpCompletion = followUpStats[0] || {
      totalFollowUps: 0,
      completedFollowUps: 0,
    };
    const completionRate =
      followUpCompletion.totalFollowUps > 0
        ? (
            (followUpCompletion.completedFollowUps /
              followUpCompletion.totalFollowUps) *
            100
          ).toFixed(1)
        : 0;

    res.json({
      success: true,
      data: {
        monthlyPerformance: monthlyData,
        leadsByStatus: leadsByStatus.map((lbs) => ({
          status: lbs._id,
          count: lbs.count,
        })),
        dailyActivity,
        followUpStats: {
          total: followUpCompletion.totalFollowUps,
          completed: followUpCompletion.completedFollowUps,
          completionRate: parseFloat(completionRate),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching agent performance:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch agent performance",
    });
  }
};

// Get Recent Leads (supports optional ?agentId= to filter by a specific agent)
exports.getRecentLeads = async (req, res) => {
  try {
    const { id: managerId } = req.user;
    const managerObjectId = new mongoose.Types.ObjectId(managerId);

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;
    const skip = (page - 1) * limit;

    const search = req.query.search || "";
    const status = req.query.status || "";
    const source = req.query.source || "";
    const agentIdFilter = req.query.agentId || ""; // ← new: filter by specific agent

    // Get all agents under this manager
    const agents = await User.find({
      managerId: managerObjectId,
      role: "agent",
    })
      .select("_id")
      .lean();

    const agentIds = agents.map((a) => a._id);

    // Build base query
    let query = { assignedAgent: { $in: agentIds } };

    // If a specific agentId is requested, narrow to that agent only
    // (but only if that agent actually belongs to this manager)
    if (agentIdFilter) {
      try {
        const specificId = new mongoose.Types.ObjectId(agentIdFilter);
        const belongs = agentIds.some((id) => id.toString() === agentIdFilter);
        if (belongs) {
          query.assignedAgent = specificId;
        } else {
          return res
            .status(403)
            .json({
              success: false,
              message: "Agent not under your management",
            });
        }
      } catch (e) {
        /* invalid ObjectId – ignore */
      }
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    if (status) query.status = status;
    if (source) query.source = source;

    const [leads, total] = await Promise.all([
      Lead.find(query)
        .populate("assignedAgent", "name email")
        .populate("assignedManager", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Lead.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        leads,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching recent leads:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch recent leads",
    });
  }
};

// Get Follow-ups
exports.getFollowUps = async (req, res) => {
  try {
    const { id: managerId } = req.user;
    const managerObjectId = new mongoose.Types.ObjectId(managerId);

    const type = req.query.type || "all"; // all, today, missed, upcoming

    // Get agents under this manager
    const agents = await User.find({
      managerId: managerObjectId,
      role: "agent",
    })
      .select("_id")
      .lean();

    const agentIds = agents.map((a) => a._id);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let query = {
      assignedAgent: { $in: agentIds },
      "followUps.0": { $exists: true },
    };

    if (type === "today") {
      query["followUps.date"] = {
        $gte: today,
        $lt: tomorrow,
      };
    } else if (type === "missed") {
      query["followUps.date"] = { $lt: today };
      query["followUps.status"] = "pending";
    } else if (type === "upcoming") {
      query["followUps.date"] = { $gte: tomorrow };
    }

    const leads = await Lead.find(query)
      .populate("assignedAgent", "name email")
      .sort({ "followUps.date": 1 })
      .limit(50);

    // Extract follow-ups
    const followUps = [];
    leads.forEach((lead) => {
      lead.followUps.forEach((fu) => {
        const fuDate = new Date(fu.date);
        const isToday = fuDate >= today && fuDate < tomorrow;
        const isMissed = fuDate < today && fu.status === "pending";
        const isUpcoming = fuDate >= tomorrow;

        if (
          type === "all" ||
          (type === "today" && isToday) ||
          (type === "missed" && isMissed) ||
          (type === "upcoming" && isUpcoming)
        ) {
          followUps.push({
            _id: fu._id || `${lead._id}-${fu.date}`,
            leadId: lead._id,
            leadName: lead.name,
            leadPhone: lead.phone,
            leadEmail: lead.email,
            agentName: lead.assignedAgent?.name || "Unassigned",
            agentId: lead.assignedAgent?._id,
            date: fu.date,
            note: fu.note || "",
            status: fu.status,
            type: isToday ? "today" : isMissed ? "missed" : "upcoming",
          });
        }
      });
    });

    followUps.sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({
      success: true,
      data: followUps,
    });
  } catch (error) {
    console.error("Error fetching follow-ups:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch follow-ups",
    });
  }
};

// Get Activity Timeline
exports.getActivityTimeline = async (req, res) => {
  try {
    const { id: managerId } = req.user;
    const managerObjectId = new mongoose.Types.ObjectId(managerId);
    const limit = parseInt(req.query.limit) || 20;

    // Get agents under this manager
    const agents = await User.find({
      managerId: managerObjectId,
      role: "agent",
    })
      .select("_id")
      .lean();

    const agentIds = agents.map((a) => a._id);

    const leads = await Lead.find({
      assignedAgent: { $in: agentIds },
    })
      .populate("timeline.addedBy", "name email")
      .populate("assignedAgent", "name")
      .sort({ updatedAt: -1 })
      .limit(50);

    const activities = [];
    leads.forEach((lead) => {
      (lead.timeline || []).forEach((event) => {
        activities.push({
          _id: event._id || `${lead._id}-${event.createdAt}`,
          type: event.type,
          message: event.message,
          leadName: lead.name,
          leadId: lead._id,
          agentName:
            event.addedBy?.name || lead.assignedAgent?.name || "System",
          agentEmail: event.addedBy?.email || "",
          meta: event.meta,
          createdAt: event.createdAt,
        });
      });
    });

    activities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      data: activities.slice(0, limit),
    });
  } catch (error) {
    console.error("Error fetching activity timeline:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch activity timeline",
    });
  }
};

// Get Agent Status
exports.getAgentStatus = async (req, res) => {
  try {
    const { id: managerId } = req.user;
    const managerObjectId = new mongoose.Types.ObjectId(managerId);

    const agents = await User.find({
      managerId: managerObjectId,
      role: "agent",
    })
      .select("name email status updatedAt createdAt")
      .lean();

    // Simulate online status - in real app, would use Socket.IO or last activity tracking
    const agentStatus = agents.map((agent) => {
      const lastActive = agent.updatedAt || agent.createdAt;
      const minutesSinceActive =
        (Date.now() - new Date(lastActive).getTime()) / (1000 * 60);

      let status = "offline";
      if (minutesSinceActive < 5) {
        status = "online";
      } else if (minutesSinceActive < 30) {
        status = "away";
      }

      return {
        _id: agent._id,
        name: agent.name,
        email: agent.email,
        accountStatus: agent.status,
        onlineStatus: status,
        lastActive: lastActive,
      };
    });

    res.json({
      success: true,
      data: agentStatus,
    });
  } catch (error) {
    console.error("Error fetching agent status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch agent status",
    });
  }
};
