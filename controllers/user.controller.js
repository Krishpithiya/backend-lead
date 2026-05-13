const User = require("../models/user");
const Lead = require("../models/lead.model");

// ================= HELPER: GET AGENT COUNT =================
const getAgentCount = async (managerId) => {
  return await User.countDocuments({
    role: "agent",
    managerId,
  });
};

// ================= HELPER: GET LEAD COUNT =================
const getLeadCountForManager = async (managerId) => {
  return await Lead.countDocuments({
    assignedManager: managerId,
  });
};

// ================= HELPER: GET LEAD COUNT FOR AGENT =================
const getLeadCountForAgent = async (agentId) => {
  return await Lead.countDocuments({
    assignedAgent: agentId,
  });
};

// ================= HELPER: GET DETAILED LEAD STATS FOR AGENT =================
const getAgentLeadStats = async (agentId) => {
  const totalLeads = await Lead.countDocuments({ assignedAgent: agentId });
  const wonLeads = await Lead.countDocuments({ assignedAgent: agentId, status: "Won" });
  const lostLeads = await Lead.countDocuments({ assignedAgent: agentId, status: "Lost" });
  const activeLeads = await Lead.countDocuments({ assignedAgent: agentId, status: "Active" });
  const inactiveLeads = await Lead.countDocuments({ assignedAgent: agentId, status: "Inactive" });
  
  return {
    totalLeads,
    wonLeads,
    lostLeads,
    activeLeads,
    inactiveLeads,
  };
};

// ================= GET ALL MANAGERS =================
exports.getManagers = async (req, res) => {
  try {
    const managers = await User.find({ role: "manager" })
      .select("-password -resetPasswordToken -resetPasswordExpires")
      .sort({ createdAt: -1 });

    const data = await Promise.all(
      managers.map(async (manager) => {
        const [agentsCount, assignedLeadsCount] = await Promise.all([
          getAgentCount(manager._id),
          getLeadCountForManager(manager._id),
        ]);

        return {
          _id: manager._id,
          name: manager.name,
          email: manager.email,
          phone: manager.phone,
          role: manager.role,
          status: manager.status,
          createdAt: manager.createdAt,
          agentsCount,
          assignedLeadsCount,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ================= GET SINGLE MANAGER =================
exports.getManagerById = async (req, res) => {
  try {
    const manager = await User.findOne({
      _id: req.params.id,
      role: "manager",
    }).select("-password -resetPasswordToken -resetPasswordExpires");

    if (!manager) {
      return res.status(404).json({
        success: false,
        message: "Manager not found",
      });
    }

    // Get all agents assigned to this manager
    const agents = await User.find({
      managerId: req.params.id,
      role: "agent",
    }).select("-password -resetPasswordToken -resetPasswordExpires");

    // Get all leads assigned to this manager
    const leads = await Lead.find({
      assignedManager: req.params.id,
    });

    return res.status(200).json({
      success: true,
      data: {
        ...manager.toObject(),
        agents: agents,
        assignedLeads: leads,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ================= GET ALL AGENTS =================
exports.getAgents = async (req, res) => {
  try {
    const { managerId } = req.query;

    const filter = {
      role: "agent",
    };

    if (managerId) {
      filter.managerId = managerId;
    }

    const agents = await User.find(filter)
      .populate("managerId", "name email role")
      .select("-password -resetPasswordToken -resetPasswordExpires")
      .sort({ createdAt: -1 });

    const data = await Promise.all(
      agents.map(async (agent) => {
        const leadStats = await getAgentLeadStats(agent._id);

        return {
          _id: agent._id,
          name: agent.name,
          email: agent.email,
          phone: agent.phone,
          role: agent.role,
          status: agent.status,
          managerId: agent.managerId,
          assignedLeadsCount: leadStats.totalLeads,
          wonLeads: leadStats.wonLeads,
          lostLeads: leadStats.lostLeads,
          activeLeadsCount: leadStats.activeLeads,
          inactiveLeadsCount: leadStats.inactiveLeads,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ================= GET SINGLE AGENT =================
exports.getAgentById = async (req, res) => {
  try {
    const { id } = req.params;

    console.log("Get agent by ID request:", { id });

    const agent = await User.findOne({
      _id: id,
      role: "agent",
    })
      .populate("managerId", "name email role")
      .select("-password -resetPasswordToken -resetPasswordExpires");

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found",
      });
    }

    // Get lead count for the agent
    const assignedLeadsCount = await getLeadCountForAgent(agent._id);

    const data = {
      _id: agent._id,
      name: agent.name,
      email: agent.email,
      phone: agent.phone,
      role: agent.role,
      status: agent.status,
      managerId: agent.managerId,
      createdAt: agent.createdAt,
      assignedLeadsCount,
    };

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    console.error("Get agent by ID error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ================= GET MY AGENTS =================
exports.getMyAgents = async (req, res) => {
  try {
    const agents = await User.find({
      role: "agent",
      managerId: req.user.id,
    }).select("-password -resetPasswordToken -resetPasswordExpires");

    return res.status(200).json({
      success: true,
      data: agents,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ================= ASSIGN AGENT TO MANAGER =================
exports.assignAgentToManager = async (req, res) => {
  try {
    const { agentId } = req.params;
    const { managerId } = req.body;

    console.log("Assign agent request:", { agentId, managerId });
    console.log("User from token:", req.user);

    if (!agentId || !managerId) {
      return res.status(400).json({
        success: false,
        message: "Agent ID and Manager ID are required",
      });
    }

    const agent = await User.findById(agentId);
    const manager = await User.findById(managerId);

    console.log("Found agent:", agent ? agent.name : null, "role:", agent ? agent.role : null);
    console.log("Found manager:", manager ? manager.name : null, "role:", manager ? manager.role : null);

    if (!agent || agent.role !== "agent") {
      return res.status(400).json({
        success: false,
        message: "Invalid agent",
      });
    }

    // Skip manager validation when unassigning (managerId is null)
    if (managerId && (!manager || manager.role !== "manager")) {
      return res.status(400).json({
        success: false,
        message: "Invalid manager",
      });
    }

    // Validation: Check if agent is already assigned to a different manager
    // Allow null managerId to unassign agent
    if (managerId && agent.managerId && agent.managerId.toString() !== managerId) {
      const currentManager = await User.findById(agent.managerId);
      return res.status(400).json({
        success: false,
        message: `Agent is already assigned to manager "${currentManager ? currentManager.name : 'Unknown'}". Please reassign from current manager first.`,
      });
    }

    // Use findByIdAndUpdate to avoid validation errors on existing documents
    const updatedAgent = await User.findByIdAndUpdate(
      agentId,
      { managerId: managerId },
      { new: true, runValidators: false }
    );

    console.log("Agent assigned successfully:", updatedAgent.name, "->", manager.name);

    return res.status(200).json({
      success: true,
      message: "Agent assigned successfully",
      data: updatedAgent,
    });
  } catch (err) {
    console.error("Assign agent error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ================= UPDATE AGENT STATUS =================
exports.updateAgentStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const { agentId } = req.params;

    console.log("Update agent status request:", { agentId, status });

    if (!status || !["active", "inactive"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be either 'active' or 'inactive'",
      });
    }

    const agent = await User.findOne({
      _id: agentId,
      role: "agent",
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found",
      });
    }

    // Use findByIdAndUpdate to avoid validation errors
    const updatedAgent = await User.findByIdAndUpdate(
      agentId,
      { status: status },
      { new: true, runValidators: false }
    );

    console.log("Agent status updated:", updatedAgent.name, "->", status);

    return res.status(200).json({
      success: true,
      message: `Agent ${status === "active" ? "activated" : "deactivated"} successfully`,
      data: updatedAgent,
    });
  } catch (err) {
    console.error("Update agent status error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ================= UPDATE MANAGER =================
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

    if (name) manager.name = name;
    if (email) manager.email = email;
    if (phone) manager.phone = phone;

    await manager.save();

    return res.status(200).json({
      success: true,
      message: "Manager updated successfully",
      data: manager,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ================= UPDATE MANAGER STATUS =================
exports.updateManagerStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const { managerId } = req.params;

    console.log("Update manager status request:", { managerId, status });

    if (!status || !["active", "inactive"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be either 'active' or 'inactive'",
      });
    }

    const manager = await User.findOne({
      _id: managerId,
      role: "manager",
    });

    if (!manager) {
      return res.status(404).json({
        success: false,
        message: "Manager not found",
      });
    }

    // Use findByIdAndUpdate to avoid validation errors
    const updatedManager = await User.findByIdAndUpdate(
      managerId,
      { status: status },
      { new: true, runValidators: false }
    );

    console.log("Manager status updated:", updatedManager.name, "->", status);

    return res.status(200).json({
      success: true,
      message: `Manager ${status === "active" ? "activated" : "deactivated"} successfully`,
      data: updatedManager,
    });
  } catch (err) {
    console.error("Update manager status error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ================= UPDATE AGENT =================
exports.updateAgent = async (req, res) => {
  try {
    const { name, email, phone, managerId } = req.body;

    console.log("Update agent request:", { id: req.params.id, name, email, phone, managerId });

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

    // Handle manager assignment/unassignment
    if (managerId !== undefined) {
      if (managerId === null || managerId === "" || managerId === "null") {
        // Unassign manager
        console.log("Unassigning manager from agent");
        agent.managerId = null;
      } else {
        // Assign to new manager
        console.log("Looking for manager with ID:", managerId);

        // Look for manager (accept those without status field as active by default)
        const manager = await User.findOne({
          _id: managerId,
          role: "manager",
          $or: [
            { status: "active" },
            { status: { $exists: false } },
            { status: null }
          ]
        });

        console.log("Manager lookup result:", manager ? "Found" : "Not found");

        if (!manager) {
          // Check if manager exists but is explicitly inactive
          const inactiveManager = await User.findOne({
            _id: managerId,
            role: "manager",
            status: "inactive"
          });

          if (inactiveManager) {
            console.log("Manager found but is inactive:", inactiveManager.name);
            return res.status(400).json({
              success: false,
              message: `Manager "${inactiveManager.name}" is inactive. Please select an active manager.`,
            });
          }

          return res.status(400).json({
            success: false,
            message: "Active manager not found",
          });
        }

        console.log("Assigning to manager:", manager.name);
        agent.managerId = managerId;
      }
    }

    if (name !== undefined) agent.name = name;
    if (email !== undefined) agent.email = email;
    if (phone !== undefined) agent.phone = phone;

    await agent.save();

    console.log("Agent updated successfully:", agent.name);

    return res.status(200).json({
      success: true,
      message: "Agent updated successfully",
      data: agent,
    });
  } catch (err) {
    console.error("Update agent error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ================= DELETE AGENT =================
exports.deleteAgent = async (req, res) => {
  try {
    const { agentId } = req.params;

    console.log("Delete agent request:", { agentId });

    const agent = await User.findOne({
      _id: agentId,
      role: "agent",
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found",
      });
    }

    // Use findByIdAndDelete to remove the agent
    await User.findByIdAndDelete(agentId);

    console.log("Agent deleted successfully:", agent.name);

    return res.status(200).json({
      success: true,
      message: "Agent deleted successfully",
    });
  } catch (err) {
    console.error("Delete agent error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};









// const User = require("../models/user");
// const Lead = require("../models/lead.model");

// // ================= GET ALL MANAGERS =================
// exports.getManagers = async (req, res) => {
//   try {
//     const managers = await User.find({ role: "manager" })
//       .select("-password -resetPasswordToken -resetPasswordExpires")
//       .sort({ createdAt: -1 });

//     const managersWithCounts = await Promise.all(
//       managers.map(async (manager) => {
//         const agentsCount = await User.countDocuments({
//           role: "agent",
//           managerId: manager._id,
//         });

//         const assignedLeadsCount = await Lead.countDocuments({
//           assignedManager: manager._id,
//         });

//         return {
//           _id: manager._id,
//           name: manager.name,
//           email: manager.email,
//           phone: manager.phone,
//           role: manager.role,
//           status: manager.status,
//           agentsCount,
//           assignedLeadsCount,
//         };
//       })
//     );

//     res.status(200).json({
//       success: true,
//       data: managersWithCounts,
//     });

//   } catch (err) {
//     res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

// // ================= GET SINGLE MANAGER =================
// exports.getManagerById = async (req, res) => {
//   try {
//     const manager = await User.findOne({
//       _id: req.params.id,
//       role: "manager",
//     }).select("-password");

//     if (!manager) {
//       return res.status(404).json({
//         success: false,
//         message: "Manager not found",
//       });
//     }

//     res.json({
//       success: true,
//       data: manager,
//     });
//   } catch (err) {
//     res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

// // ================= GET ALL AGENTS (🔥 FIXED) =================
// exports.getAgents = async (req, res) => {
//   try {
//     const { managerId } = req.query; // ✅ NEW

//     // ✅ dynamic filter
//     let filter = { role: "agent", status: "active" }; // ✅ only active agents

//     if (managerId) {
//       filter.managerId = managerId; // ✅ FILTER BY MANAGER
//     }

//     const agents = await User.find(filter)
//       .populate("managerId", "name email role")
//       .select("-password -resetPasswordToken -resetPasswordExpires")
//       .sort({ createdAt: -1 });

//     const agentsWithCounts = await Promise.all(
//       agents.map(async (agent) => {
//         const assignedLeadsCount = await Lead.countDocuments({
//           assignedAgent: agent._id,
//         });

//         return {
//           _id: agent._id,
//           name: agent.name,
//           email: agent.email,
//           phone: agent.phone,
//           role: agent.role,
//           status: agent.status,
//           managerId: agent.managerId,
//           assignedLeadsCount,
//         };
//       })
//     );

//     res.status(200).json({
//       success: true,
//       data: agentsWithCounts,
//     });

//   } catch (err) {
//     res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };


// // ================= GET MY AGENTS =================
// exports.getMyAgents = async (req, res) => {
//   try {
//     const agents = await User.find({
//       role: "agent",
//       managerId: req.user.id,
//     }).select("-password -resetPasswordToken -resetPasswordExpires");

//     res.json({
//       success: true,
//       data: agents,
//     });

//   } catch (err) {
//     res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };


// // ================= ASSIGN AGENT TO MANAGER =================
// exports.assignAgentToManager = async (req, res) => {
//   try {
//     const { agentId } = req.params;
//     const { managerId } = req.body;

//     const agent = await User.findById(agentId);
//     const manager = await User.findById(managerId);

//     if (!agent || agent.role !== "agent") {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid agent",
//       });
//     }

//     if (!manager || manager.role !== "manager") {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid manager",
//       });
//     }

//     agent.managerId = managerId;
//     await agent.save();

//     res.json({
//       success: true,
//       message: "Agent assigned to manager successfully",
//       data: agent,
//     });

//   } catch (err) {
//     res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };


// // ================= UPDATE MANAGER =================
// exports.updateManager = async (req, res) => {
//   try {
//     const { name, email, phone } = req.body;

//     const manager = await User.findOne({
//       _id: req.params.id,
//       role: "manager",
//     });

//     if (!manager) {
//       return res.status(404).json({
//         success: false,
//         message: "Manager not found",
//       });
//     }

//     if (name) manager.name = name;
//     if (email) manager.email = email;
//     if (phone) manager.phone = phone;

//     await manager.save();

//     res.status(200).json({
//       success: true,
//       message: "Manager updated successfully",
//       data: manager,
//     });

//   } catch (err) {
//     res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };


// // ================= UPDATE AGENT =================
// exports.updateAgent = async (req, res) => {
//   try {
//     const { name, email, phone, managerId } = req.body;

//     const agent = await User.findOne({
//       _id: req.params.id,
//       role: "agent",
//     });

//     if (!agent) {
//       return res.status(404).json({
//         success: false,
//         message: "Agent not found",
//       });
//     }

//     if (managerId) {
//       const manager = await User.findOne({
//         _id: managerId,
//         role: "manager",
//         status: "active",
//       });

//       if (!manager) {
//         return res.status(400).json({
//           success: false,
//           message: "Active manager not found",
//         });
//       }

//       agent.managerId = managerId;
//     }

//     if (name) agent.name = name;
//     if (email) agent.email = email;
//     if (phone) agent.phone = phone;

//     await agent.save();

//     res.status(200).json({
//       success: true,
//       message: "Agent updated successfully",
//       data: agent,
//     });

//   } catch (err) {
//     res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };


