const Lead = require("../models/lead.model");

exports.createLead = async (req, res) => {
  try {
    const { name, email, phone, source } = req.body;

    const lead = new Lead({
      name,
      email,
      phone,
      source,
      createdBy: req.user.id,
    });

    await lead.save();

    res.json({
      message: "Lead created successfully",
      lead,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
};

exports.getLeads = async (req, res) => {
  try {
    let leads;

    if (req.user.role === "admin") {
      // admin can see all leads
      leads = await Lead.find();
      isClosed: false;
    } else if (req.user.role === "manager") {
      // manager sees only assigned leads
      leads = await Lead.find({
        assignedManager: req.user.id,
        isClosed: false,
      });
    } else if (req.user.role === "agent") {
      // agent sees only own leads
      leads = await Lead.find({
        assignedAgent: req.user.id,
        isClosed: false,
      });
    }
    res.json(leads);
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
};

exports.getLeadById = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({
        message: "Lead not found",
      });
    }

    res.json(lead);
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
};

exports.updateLead = async (req, res) => {
  try {
    const leadId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    const lead = await Lead.findById(leadId);

    if (!lead) {
      return res.status(404).json({
        message: "Lead not found",
      });
    }

    if (userRole === "manager") {
      if (!lead.assignedManager || lead.assignedManager.toString() !== userId) {
        return res.status(403).json({
          message: "Managers can update only their assigned leads",
        });
      }
    }

    if (userRole === "agent") {
      if (!lead.assignedAgent || lead.assignedAgent.toString() !== userId) {
        return res.status(403).json({
          message: "Agents can update only their own leads",
        });
      }
    }

    let allowedUpdates = [];

    if (userRole === "admin") {
      allowedUpdates = [
        "name",
        "email",
        "phone",
        "source",
        "status",
        "assignedManager",
        "assignedAgent",
        "reassignmentRequested",
        "reassignmentReason",
      ];
    } else if (userRole === "manager") {
      allowedUpdates = [
        "status",
        "assignedAgent",
        "reassignmentRequested",
        "reassignmentReason",
      ];
    } else if (userRole === "agent") {
      allowedUpdates = ["status"];
    }

    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) {
        lead[field] = req.body[field];
      }
    });
    
    if (lead.status === "won" || lead.status === "lost") {
      lead.isClosed = true;
    } else {
      lead.isClosed = false;
    }

    if (req.body.note) {
      lead.notes.push({
        text: req.body.note,
        addedBy: userId,
      });
    }

    const updatedLead = await lead.save();

    res.json({
      message: "Lead updated successfully",
      lead: updatedLead,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
};
