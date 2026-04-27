const User = require("../models/user");
const Lead = require("../models/lead.model");

// Admin: get all managers
exports.getManagers = async (req, res) => {
  try {
    const managers = await User.find({ role: "manager" })
      .select("-password -resetPasswordToken -resetPasswordExpires")
      .sort({ createdAt: -1 });

    const managersWithCounts = await Promise.all(
      managers.map(async (manager) => {
        const agentsCount = await User.countDocuments({
          role: "agent",
          managerId: manager._id,
        });

        const assignedLeadsCount = await Lead.countDocuments({
          managerId: manager._id,
        });

        return {
          _id: manager._id,
          name: manager.name,
          email: manager.email,
          phone: manager.phone,
          role: manager.role,
          status: manager.status,
          agentsCount,
          assignedLeadsCount,
        };
      })
    );

    res.status(200).json({
      success: true,
      managers: managersWithCounts,
    });

    res.json(managers);
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// Admin: get all agents
exports.getAgents = async (req, res) => {
  try {
    const agents = await User.find({ role: "agent" })
      .populate("managerId", "name email role")
      .select("-password -resetPasswordToken -resetPasswordExpires")
      .sort({ createdAt: -1 });


    const agentsWithCounts = await Promise.all(
      agents.map(async (agent) => {
        const assignedLeadsCount = await Lead.countDocuments({
          agentId: agent._id,
        });

        return {
          _id: agent._id,
          name: agent.name,
          email: agent.email,
          phone: agent.phone,
          role: agent.role,
          status: agent.status,
          managerId: agent.managerId,
          assignedLeadsCount,
        };
      })
    );

    res.status(200).json({
      success: true,
      agents: agentsWithCounts,
    });

    res.json(agents);
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// Manager: get only his/her agents
exports.getMyAgents = async (req, res) => {
  try {
    const agents = await User.find({
      role: "agent",
      managerId: req.user.id,
    }).select("-password -resetPasswordToken -resetPasswordExpires");

    res.json(agents);
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
};

// assign agent to manager (admin only)
exports.assignAgentToManager = async (req, res) => {
  try {
    const { agentId } = req.params;
    const { managerId } = req.body;

    const agent = await User.findById(agentId);
    const manager = await User.findById(managerId);

    if (!agent) {
      return res.status(404).json({
        message: "Agent not found",
      });
    }

    if (!manager) {
      return res.status(404).json({
        message: "Manager not found",
      });
    }

    if (agent.role !== "agent") {
      return res.status(400).json({
        message: "Selected user is not an agent",
      });
    }

    if (manager.role !== "manager") {
      return res.status(400).json({
        message: "Selected user is not a manager",
      });
    }

    agent.managerId = managerId;

    await agent.save();

    res.json({
      message: "Agent assigned to manager successfully",
      agent,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
};

// EDIT manager
exports.updateManager = async (req, res) => {
  try {
    const { name, email, phone } = req.body;

    const manager = await User.findOne({
      _id: req.params.id,
      role: "manager",
    });

    if (!manager) {
      return res.status(404).json({
        success: false,
        message: "Manager not found",
      });
    }

    // update fields
    if (name) manager.name = name;
    if (email) manager.email = email;
    if (phone) manager.phone = phone;

    await manager.save();

    res.status(200).json({
      success: true,
      message: "Manager updated successfully",
      manager: {
        _id: manager._id,
        name: manager.name,
        email: manager.email,
        phone: manager.phone,
        role: manager.role,
        status: manager.status,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// EDIT agent
exports.updateAgent = async (req, res) => {
  try {
    const { name, email, phone, managerId } = req.body;

    const agent = await User.findOne({
      _id: req.params.id,
      role: "agent",
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found",
      });
    }

    if (managerId) {
      const manager = await User.findOne({
        _id: managerId,
        role: "manager",
        status: "active",
      });

      if (!manager) {
        return res.status(400).json({
          success: false,
          message: "Active manager not found",
        });
      }

      agent.managerId = managerId;
    }

    if (name) agent.name = name;
    if (email) agent.email = email;
    if (phone) agent.phone = phone;

    await agent.save();

    res.status(200).json({
      success: true,
      message: "Agent updated successfully",
      agent: {
        _id: agent._id,
        name: agent.name,
        email: agent.email,
        phone: agent.phone,
        role: agent.role,
        status: agent.status,
        managerId: agent.managerId,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};