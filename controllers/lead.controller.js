const Lead = require("../models/lead.model");

exports.createLead = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      source,
      status,
      assignedManager,
      assignedAgent,
      notes,
      note,
    } = req.body;

    const userId = req.user.id;
    const leadStatus = status || "new";
    const initialNotes = Array.isArray(notes) ? notes : [];
    const noteText = typeof note === "string" ? note.trim() : "";

    const lead = new Lead({
      name,
      email,
      phone,
      source: source || "manual",
      status: leadStatus,
      createdBy: userId,
      isClosed: ["won", "lost"].includes(leadStatus),
      assignedManager: assignedManager || null,
      assignedAgent: assignedAgent || null,
      notes: [
        ...initialNotes.map((item) => ({
          text: item.text,
          addedBy: userId,
        })),
        ...(noteText ? [{ text: noteText, addedBy: userId }] : []),
      ].filter((item) => item.text),
    });

    if (assignedManager) {
      lead.timeline.push({
        type: "assigned",
        message: "Lead assigned to manager",
        addedBy: userId,
      });
    }

    if (assignedAgent) {
      lead.timeline.push({
        type: "assigned",
        message: "Lead assigned to agent",
        addedBy: userId,
      });
    }

    if (noteText || initialNotes.length) {
      lead.timeline.push({
        type: "note_added",
        message: noteText || "Initial note added",
        addedBy: userId,
      });
    }

    await lead.save();

    res.status(201).json({
      success: true,
      message: "Lead created successfully",
      data: lead,
    });
  } catch (err) {
    console.error("CREATE LEAD ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.getLeads = async (req, res) => {
  try {
    let query = {};

    if (req.user.role === "manager") {
      query = {
        assignedManager: req.user.id,
        isClosed: false,
      };
    } else if (req.user.role === "agent") {
      query = {
        assignedAgent: req.user.id,
        isClosed: false,
      };
    } else if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized role",
      });
    }

    const leads = await Lead.find(query)
      .populate("assignedManager", "name email")
      .populate("assignedAgent", "name email")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: leads.length,
      data: leads,
    });
  } catch (err) {
    console.error("GET LEADS ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.getLeadById = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate("assignedManager", "name email")
      .populate("assignedAgent", "name email")
      .populate("timeline.addedBy", "name");

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    if (
      req.user.role === "manager" &&
      (!lead.assignedManager ||
        lead.assignedManager._id.toString() !== req.user.id)
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    if (
      req.user.role === "agent" &&
      (!lead.assignedAgent || lead.assignedAgent._id.toString() !== req.user.id)
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    res.json({
      success: true,
      data: lead,
    });
  } catch (err) {
    console.error("GET LEAD BY ID ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message,
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
        success: false,
        message: "Lead not found",
      });
    }

    if (req.body.assignedManager === "") req.body.assignedManager = null;
    if (req.body.assignedAgent === "") req.body.assignedAgent = null;

    if (
      userRole === "manager" &&
      (!lead.assignedManager || lead.assignedManager.toString() !== userId)
    ) {
      return res.status(403).json({
        success: false,
        message: "Managers can update only their leads",
      });
    }

    if (
      userRole === "agent" &&
      (!lead.assignedAgent || lead.assignedAgent.toString() !== userId)
    ) {
      return res.status(403).json({
        success: false,
        message: "Agents can update only their leads",
      });
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

    const oldStatus = lead.status;
    const oldAgent = lead.assignedAgent;
    const oldManager = lead.assignedManager;

    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) {
        lead[field] = req.body[field];
      }
    });

    lead.isClosed = ["won", "lost"].includes(lead.status);

    if (req.body.status && oldStatus !== req.body.status) {
      lead.timeline.push({
        type: "status_changed",
        message: `Status changed from ${oldStatus} to ${req.body.status}`,
        meta: {
          oldStatus,
          newStatus: req.body.status,
        },
        addedBy: userId,
      });
    }

    if (req.body.assignedAgent && oldAgent?.toString() !== req.body.assignedAgent) {
      lead.timeline.push({
        type: "assigned",
        message: "Lead assigned to new agent",
        addedBy: userId,
      });
    }

    if (
      req.body.assignedManager &&
      oldManager?.toString() !== req.body.assignedManager
    ) {
      lead.timeline.push({
        type: "assigned",
        message: "Lead assigned to new manager",
        addedBy: userId,
      });
    }

    if (typeof req.body.note === "string" && req.body.note.trim()) {
      lead.notes.push({
        text: req.body.note,
        addedBy: userId,
        createdAt: new Date(),
      });

      lead.timeline.push({
        type: "note_added",
        message: req.body.note,
        addedBy: userId,
      });
    }

    if (["won", "lost"].includes(req.body.status)) {
      lead.timeline.push({
        type: "closed",
        message: `Lead marked as ${req.body.status}`,
        addedBy: userId,
      });
    }

    // Append new call logs (if sent from unified update)
    if (Array.isArray(req.body.newCallLogs)) {
      req.body.newCallLogs.forEach((log) => {
        lead.callLogs.push({
          callType: log.callType,
          duration: log.duration,
          status: log.status,
          note: log.note,
          addedBy: userId,
        });
      });
      lead.timeline.push({
        type: "call_logged",
        message: "Call logged",
        addedBy: userId,
      });
    }

    // Append new follow-ups
    if (Array.isArray(req.body.newFollowUps)) {
      req.body.newFollowUps.forEach((f) => {
        lead.followUps.push({
          date: f.date,
          note: f.note,
          status: "pending",
          createdBy: userId,
        });
      });
      lead.timeline.push({
        type: "follow_up_added",
        message: "Follow-up scheduled",
        meta: { followUpDate: req.body.newFollowUps[0]?.date },
        addedBy: userId,
      });
    }

    // Append new meetings
    if (Array.isArray(req.body.newMeetings)) {
      req.body.newMeetings.forEach((m) => {
        lead.meetings.push({
          title: m.title,
          date: m.date,
          location: m.location,
          description: m.description,
          createdBy: userId,
        });
      });
      lead.timeline.push({
        type: "meeting_scheduled",
        message: `Meeting scheduled: ${req.body.newMeetings[0]?.title}`,
        meta: { followUpDate: req.body.newMeetings[0]?.date },
        addedBy: userId,
      });
    }

    const updatedLead = await lead.save();

    res.json({
      success: true,
      message: "Lead updated successfully",
      data: updatedLead,
    });
  } catch (err) {
    console.error("UPDATE LEAD ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    res.json({
      success: true,
      message: "Lead deleted successfully",
    });
  } catch (err) {
    console.error("DELETE LEAD ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.addFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, note } = req.body;

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    lead.followUps.push({
      date,
      note,
      createdBy: req.user.id,
    });

    lead.timeline.push({
      type: "follow_up_added",
      message: "Follow-up scheduled",
      meta: { followUpDate: date },
      addedBy: req.user.id,
    });

    await lead.save();

    res.json({ success: true, message: "Follow-up added", data: lead });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.addCallLog = async (req, res) => {
  try {
    const { id } = req.params;
    const { callType, duration, status, note } = req.body;

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    lead.callLogs.push({
      callType,
      duration,
      status,
      note,
      addedBy: req.user.id,
    });

    lead.timeline.push({
      type: "call_logged",
      message: `Call ${status}`,
      meta: { callDuration: duration },
      addedBy: req.user.id,
    });

    await lead.save();

    res.json({ success: true, message: "Call log added", data: lead });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.addMeeting = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, date, location, description } = req.body;

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (!lead.meetings) lead.meetings = [];
    lead.meetings.push({
      title,
      date,
      location,
      description,
      createdBy: req.user.id,
    });

    lead.timeline.push({
      type: "meeting_scheduled",
      message: `Meeting scheduled: ${title}`,
      meta: { followUpDate: date },
      addedBy: req.user.id,
    });

    await lead.save();

    res.json({ success: true, message: "Meeting scheduled", data: lead });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.uploadFile = async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (!file) {
      return res.status(400).json({ success: false, message: "File is required" });
    }

    lead.attachments.push({
      fileName: file.originalname,
      fileUrl: file.path,
      fileType: file.mimetype,
      uploadedBy: req.user.id,
    });

    lead.timeline.push({
      type: "file_uploaded",
      message: "File uploaded",
      meta: { fileUrl: file.path },
      addedBy: req.user.id,
    });

    await lead.save();

    res.json({ success: true, message: "File uploaded", data: lead });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getFilteredTimeline = async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.query;

    const lead = await Lead.findById(id).populate("timeline.addedBy", "name");

    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    let timeline = lead.timeline;

    if (type) {
      timeline = timeline.filter((item) => item.type === type);
    }

    res.json({
      success: true,
      data: timeline,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
