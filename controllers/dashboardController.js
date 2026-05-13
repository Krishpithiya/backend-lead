const Lead = require("../models/lead.model");
const User = require("../models/user");

const getDashboardData = async (req, res) => {
  try {
    const { role, userId } = req.user;
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
      role
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard data"
    });
  }
};

const getAdminDashboardData = async () => {
  const totalLeads = await Lead.countDocuments();
  const totalUsers = await User.countDocuments();
  const totalAgents = await User.countDocuments({ role: "agent" });
  const totalManagers = await User.countDocuments({ role: "manager" });

  const leadsByStatus = await Lead.aggregate([
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 }
      }
    }
  ]);

  const leadsBySource = await Lead.aggregate([
    {
      $group: {
        _id: "$source",
        count: { $sum: 1 }
      }
    }
  ]);

  const monthlyLeads = await Lead.aggregate([
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" }
        },
        count: { $sum: 1 }
      }
    },
    {
      $sort: { "_id.year": -1, "_id.month": -1 }
    },
    {
      $limit: 12
    }
  ]);

  const managers = await User.find({ role: "manager" }).select("name email").lean();
  const topPerformers = await Promise.all(
    managers.map(async (manager) => {
      const totalLeads = await Lead.countDocuments({ assignedManager: manager._id });
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
    })
  );
  topPerformers.sort((a, b) => b.convertedLeads - a.convertedLeads || b.totalLeads - a.totalLeads);

  const recentLeads = await Lead.find()
    .populate("assignedAgent", "name email")
    .populate("assignedManager", "name email")
    .sort({ createdAt: -1 })
    .limit(10);

  const followupLeads = await Lead.find({
    "followUps.status": "pending"
  })
    .populate("assignedAgent", "name email")
    .populate("assignedManager", "name email")
    .sort({ updatedAt: -1 })
    .limit(10);

  return {
    stats: [
      { title: "Total Leads", value: totalLeads, color: "#6366f1", icon: "people" },
      { title: "Total Users", value: totalUsers, color: "#8b5cf6", icon: "users" },
      { title: "Active Agents", value: totalAgents, color: "#3b82f6", icon: "user-tie" },
      { title: "Managers", value: totalManagers, color: "#10b981", icon: "briefcase" }
    ],
    charts: {
      leadsByStatus: leadsByStatus.map(item => ({
        name: item._id,
        value: item.count
      })),
      leadsBySource: leadsBySource.map(item => ({
        name: item._id,
        value: item.count
      })),
      monthlyTrends: monthlyLeads.map(item => ({
        month: `${item._id.year}-${item._id.month.toString().padStart(2, '0')}`,
        leads: item.count
      }))
    },
    tables: {
      topPerformers,
      recentLeads,
      followupLeads
    }
  };
};

const getManagerDashboardData = async (managerId) => {
  const assignedLeads = await Lead.find({ assignedManager: managerId });
  const totalLeads = assignedLeads.length;
  
  const agents = await User.find({ assignedManager: managerId, role: "agent" });
  const agentIds = agents.map(agent => agent._id);

  const leadsByStatus = await Lead.aggregate([
    {
      $match: { assignedManager: managerId }
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 }
      }
    }
  ]);

  const agentPerformance = await Lead.aggregate([
    {
      $match: { assignedAgent: { $in: agentIds } }
    },
    {
      $group: {
        _id: "$assignedAgent",
        totalLeads: { $sum: 1 },
        convertedLeads: {
          $sum: {
            $cond: [
              { $in: ["$status", ["won", "qualified"]] },
              1,
              0
            ]
          }
        }
      }
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "agent"
      }
    },
    {
      $unwind: "$agent"
    },
    {
      $project: {
        name: "$agent.name",
        email: "$agent.email",
        totalLeads: 1,
        convertedLeads: 1,
        agent: "$agent"
      }
    }
  ]);

  const recentLeads = await Lead.find({ assignedManager: managerId })
    .populate("assignedAgent", "name email")
    .sort({ createdAt: -1 })
    .limit(10);

  return {
    stats: [
      { title: "Total Leads", value: totalLeads, color: "#6366f1", icon: "people" },
      { title: "Team Size", value: agents.length, color: "#3b82f6", icon: "users" },
      { title: "This Month", value: assignedLeads.filter(lead => {
        const now = new Date();
        const leadDate = new Date(lead.createdAt);
        return leadDate.getMonth() === now.getMonth() && 
               leadDate.getFullYear() === now.getFullYear();
      }).length, color: "#10b981", icon: "calendar" },
      { title: "Conversion Rate", value: `${totalLeads > 0 ? Math.round((leadsByStatus.find(s => s._id === "won")?.count || 0) / totalLeads * 100) : 0}%`, color: "#f59e0b", icon: "trending-up" }
    ],
    charts: {
      leadsByStatus: leadsByStatus.map(item => ({
        name: item._id,
        value: item.count
      })),
      agentPerformance: agentPerformance.map(item => ({
        name: item.agent.name,
        total: item.totalLeads,
        converted: item.convertedLeads
      }))
    },
    tables: {
      agents: agentPerformance,
      recentLeads
    }
  };
};

const getAgentDashboardData = async (agentId) => {
  const assignedLeads = await Lead.find({ assignedAgent: agentId });
  const totalLeads = assignedLeads.length;

  const leadsByStatus = await Lead.aggregate([
    {
      $match: { assignedAgent: agentId }
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 }
      }
    }
  ]);

  const todayFollowUps = await Lead.find({
    assignedAgent: agentId,
    "followUps.date": {
      $gte: new Date(new Date().setHours(0, 0, 0, 0)),
      $lt: new Date(new Date().setHours(23, 59, 59, 999))
    }
  });

  const recentLeads = await Lead.find({ assignedAgent: agentId })
    .populate("assignedManager", "name email")
    .sort({ createdAt: -1 })
    .limit(10);

  const conversionRate = totalLeads > 0 ? 
    Math.round(((leadsByStatus.find(s => s._id === "won")?.count || 0) / totalLeads) * 100) : 0;

  return {
    stats: [
      { title: "My Leads", value: totalLeads, color: "#6366f1", icon: "people" },
      { title: "Today's Follow-ups", value: todayFollowUps.length, color: "#ef4444", icon: "clock" },
      { title: "This Month", value: assignedLeads.filter(lead => {
        const now = new Date();
        const leadDate = new Date(lead.createdAt);
        return leadDate.getMonth() === now.getMonth() && 
               leadDate.getFullYear() === now.getFullYear();
      }).length, color: "#10b981", icon: "calendar" },
      { title: "Conversion Rate", value: `${conversionRate}%`, color: "#f59e0b", icon: "trending-up" }
    ],
    charts: {
      leadsByStatus: leadsByStatus.map(item => ({
        name: item._id,
        value: item.count
      })),
      weeklyActivity: await getWeeklyActivity(agentId)
    },
    tables: {
      recentLeads,
      followUps: todayFollowUps
    }
  };
};

const getWeeklyActivity = async (agentId) => {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const dailyActivity = await Lead.aggregate([
    {
      $match: {
        assignedAgent: agentId,
        createdAt: { $gte: oneWeekAgo }
      }
    },
    {
      $group: {
        _id: {
          day: { $dayOfWeek: "$createdAt" }
        },
        count: { $sum: 1 }
      }
    }
  ]);

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days.map((day, index) => ({
    day,
    leads: dailyActivity.find(d => d._id.day === index + 1)?.count || 0
  }));
};

module.exports = {
  getDashboardData,
  getAdminDashboardData,
  getManagerDashboardData,
  getAgentDashboardData,
  getWeeklyActivity
};