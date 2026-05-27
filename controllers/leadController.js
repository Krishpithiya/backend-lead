const Lead = require('../models/Lead');
const LeadActivity = require('../models/LeadActivity');
const FollowUp = require('../models/FollowUp');
const Note = require('../models/Note');
const Attachment = require('../models/Attachment');
const Notification = require('../models/Notification');
const { dateError } = require('../utils/dateValidation');

// @desc    Get all leads with pagination and filters
// @route   GET /api/manager/leads
// @access  Private (Manager)
exports.getAllLeads = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 15,
      search = '',
      status,
      source,
      priority,
      agent,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = {
      isDeleted: false,
      createdBy: req.user.id
    };

    // Search filter
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } }
      ];
    }

    // Status filter
    if (status && status !== 'all') {
      query.status = status;
    }

    // Source filter
    if (source && source !== 'all') {
      query.source = source;
    }

    // Priority filter
    if (priority && priority !== 'all') {
      query.priority = priority;
    }

    // Agent filter
    if (agent === 'assigned') {
      query.assignedAgent = { $ne: null };
    } else if (agent === 'unassigned') {
      query.assignedAgent = null;
    } else if (agent && agent !== 'all') {
      query.assignedAgent = agent;
    }

    // Date filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // Sort
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query
    const leads = await Lead.find(query)
      .populate('assignedAgent', 'name email phone')
      .populate('assignedBy', 'name email')
      .populate('leadOwner', 'name email')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Lead.countDocuments(query);

    res.json({
      success: true,
      data: {
        leads,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching leads',
      error: error.message
    });
  }
};

// @desc    Get lead by ID
// @route   GET /api/manager/leads/:id
// @access  Private (Manager)
exports.getLeadById = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('assignedAgent', 'name email phone')
      .populate('assignedBy', 'name email')
      .populate('leadOwner', 'name email')
      .populate('createdBy', 'name email');

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found'
      });
    }

    res.json({
      success: true,
      data: lead
    });
  } catch (error) {
    console.error('Error fetching lead:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching lead',
      error: error.message
    });
  }
};

// @desc    Create new lead
// @route   POST /api/manager/leads
// @access  Private (Manager)
exports.createLead = async (req, res) => {
  try {
    const leadData = {
      ...req.body,
      createdBy: req.user.id,
      updatedBy: req.user.id
    };

    const lead = await Lead.create(leadData);

    // Log activity
    await LeadActivity.create({
      lead: lead._id,
      activityType: 'created',
      description: `Lead "${lead.name}" was created`,
      performedBy: req.user.id,
      metadata: { leadId: lead._id }
    });

    // Create notification
    if (lead.assignedAgent) {
      await Notification.create({
        recipient: lead.assignedAgent,
        type: 'lead_assigned',
        title: 'New Lead Assigned',
        message: `You have been assigned a new lead: ${lead.name}`,
        lead: lead._id,
        actionUrl: `/manager/leads/${lead._id}`
      });
    }

    const populatedLead = await Lead.findById(lead._id)
      .populate('assignedAgent', 'name email phone')
      .populate('assignedBy', 'name email')
      .populate('leadOwner', 'name email')
      .populate('createdBy', 'name email');

    res.status(201).json({
      success: true,
      data: populatedLead,
      message: 'Lead created successfully'
    });
  } catch (error) {
    console.error('Error creating lead:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating lead',
      error: error.message
    });
  }
};

// @desc    Update lead
// @route   PUT /api/manager/leads/:id
// @access  Private (Manager)
exports.updateLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found'
      });
    }

    // Track changes for activity log
    const changes = {};
    const previousValues = {};
    const newValues = {};
    const invalidExpectedClosingDate = dateError(req.body.expectedClosingDate, 'Expected closing date');
    if (invalidExpectedClosingDate) return res.status(400).json({ success: false, message: invalidExpectedClosingDate });
    const invalidNextFollowUpDate = dateError(req.body.nextFollowUpDate, 'Next follow-up date');
    if (invalidNextFollowUpDate) return res.status(400).json({ success: false, message: invalidNextFollowUpDate });

    Object.keys(req.body).forEach(key => {
      if (lead[key] !== req.body[key]) {
        previousValues[key] = lead[key];
        newValues[key] = req.body[key];
        changes[key] = req.body[key];
      }
    });

    // Update lead
    const updatedLead = await Lead.findByIdAndUpdate(
      req.params.id,
      {
        ...req.body,
        updatedBy: req.user.id
      },
      { new: true, runValidators: true }
    )
      .populate('assignedAgent', 'name email phone')
      .populate('assignedBy', 'name email')
      .populate('leadOwner', 'name email')
      .populate('createdBy', 'name email');

    // Log activity if there are changes
    if (Object.keys(changes).length > 0) {
      await LeadActivity.create({
        lead: lead._id,
        activityType: 'updated',
        description: `Lead "${lead.name}" was updated`,
        performedBy: req.user.id,
        previousValue: previousValues,
        newValue: newValues,
        metadata: { changes }
      });
    }

    // If status changed, log specific activity
    if (req.body.status && req.body.status !== lead.status) {
      await LeadActivity.create({
        lead: lead._id,
        activityType: 'status_changed',
        description: `Lead status changed from "${lead.status}" to "${req.body.status}"`,
        performedBy: req.user.id,
        previousValue: { status: lead.status },
        newValue: { status: req.body.status }
      });

      // If converted
      if (req.body.status === 'converted') {
        await LeadActivity.create({
          lead: lead._id,
          activityType: 'lead_converted',
          description: `Lead "${lead.name}" was converted`,
          performedBy: req.user.id
        });

        // Notify assigned agent
        if (lead.assignedAgent) {
          await Notification.create({
            recipient: lead.assignedAgent,
            type: 'lead_converted',
            title: 'Lead Converted',
            message: `Lead "${lead.name}" has been converted!`,
            lead: lead._id,
            actionUrl: `/manager/leads/${lead._id}`
          });
        }
      }

      // If lost
      if (req.body.status === 'lost') {
        await LeadActivity.create({
          lead: lead._id,
          activityType: 'lead_lost',
          description: `Lead "${lead.name}" was marked as lost`,
          performedBy: req.user.id
        });
      }
    }

    res.json({
      success: true,
      data: updatedLead,
      message: 'Lead updated successfully'
    });
  } catch (error) {
    console.error('Error updating lead:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating lead',
      error: error.message
    });
  }
};

// @desc    Delete lead (soft delete)
// @route   DELETE /api/manager/leads/:id
// @access  Private (Manager)
exports.deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found'
      });
    }

    lead.isDeleted = true;
    lead.updatedBy = req.user.id;
    await lead.save();

    // Log activity
    await LeadActivity.create({
      lead: lead._id,
      activityType: 'updated',
      description: `Lead "${lead.name}" was deleted`,
      performedBy: req.user.id
    });

    res.json({
      success: true,
      message: 'Lead deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting lead:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting lead',
      error: error.message
    });
  }
};

// @desc    Assign lead to agent
// @route   PUT /api/manager/leads/:id/assign
// @access  Private (Manager)
exports.assignLead = async (req, res) => {
  try {
    const { agentId } = req.body;
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found'
      });
    }

    const previousAgent = lead.assignedAgent;

    lead.assignedAgent = agentId;
    lead.assignedBy = req.user.id;
    lead.assignedDate = new Date();
    lead.updatedBy = req.user.id;
    await lead.save();

    // Log activity
    await LeadActivity.create({
      lead: lead._id,
      activityType: 'assigned',
      description: `Lead "${lead.name}" was assigned to agent`,
      performedBy: req.user.id,
      previousValue: { assignedAgent: previousAgent },
      newValue: { assignedAgent: agentId }
    });

    // Create notification
    if (agentId) {
      await Notification.create({
        recipient: agentId,
        type: 'lead_assigned',
        title: 'New Lead Assigned',
        message: `You have been assigned a new lead: ${lead.name}`,
        lead: lead._id,
        actionUrl: `/manager/leads/${lead._id}`
      });
    }

    const populatedLead = await Lead.findById(lead._id)
      .populate('assignedAgent', 'name email phone')
      .populate('assignedBy', 'name email')
      .populate('leadOwner', 'name email')
      .populate('createdBy', 'name email');

    res.json({
      success: true,
      data: populatedLead,
      message: 'Lead assigned successfully'
    });
  } catch (error) {
    console.error('Error assigning lead:', error);
    res.status(500).json({
      success: false,
      message: 'Error assigning lead',
      error: error.message
    });
  }
};

// @desc    Get lead analytics
// @route   GET /api/manager/leads/analytics
// @access  Private (Manager)
exports.getLeadAnalytics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    const baseQuery = {
      isDeleted: false,
      createdBy: req.user.id,
      ...dateFilter
    };

    // Get counts by status
    const statusCounts = await Lead.aggregate([
      { $match: baseQuery },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Get counts by source
    const sourceCounts = await Lead.aggregate([
      { $match: baseQuery },
      { $group: { _id: '$source', count: { $sum: 1 } } }
    ]);

    // Get counts by priority
    const priorityCounts = await Lead.aggregate([
      { $match: baseQuery },
      { $group: { _id: '$priority', count: { $sum: 1 } } }
    ]);

    // Get conversion rate
    const totalLeads = await Lead.countDocuments(baseQuery);
    const convertedLeads = await Lead.countDocuments({
      ...baseQuery,
      status: 'converted'
    });
    const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(2) : 0;

    // Get assigned vs unassigned
    const assignedCount = await Lead.countDocuments({
      ...baseQuery,
      assignedAgent: { $ne: null }
    });
    const unassignedCount = await Lead.countDocuments({
      ...baseQuery,
      assignedAgent: null
    });

    // Get follow-up stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayFollowUps = await FollowUp.countDocuments({
      scheduledDate: { $gte: today, $lt: tomorrow },
      status: 'pending'
    });

    const missedFollowUps = await FollowUp.countDocuments({
      scheduledDate: { $lt: today },
      status: 'pending'
    });

    // Calculate revenue
    const convertedLeadsData = await Lead.find({
      ...baseQuery,
      status: 'converted'
    });
    const totalRevenue = convertedLeadsData.reduce((sum, lead) => sum + (lead.dealValue || 0), 0);

    res.json({
      success: true,
      data: {
        totalLeads,
        convertedLeads,
        conversionRate: parseFloat(conversionRate),
        assignedCount,
        unassignedCount,
        statusCounts: statusCounts.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        sourceCounts: sourceCounts.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        priorityCounts: priorityCounts.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        todayFollowUps,
        missedFollowUps,
        totalRevenue
      }
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching analytics',
      error: error.message
    });
  }
};

// @desc    Bulk update leads
// @route   PUT /api/manager/leads/bulk
// @access  Private (Manager)
exports.bulkUpdateLeads = async (req, res) => {
  try {
    const { leadIds, updates } = req.body;

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lead IDs'
      });
    }

    const result = await Lead.updateMany(
      { _id: { $in: leadIds }, isDeleted: false },
      {
        ...updates,
        updatedBy: req.user.id
      }
    );

    // Log activity for each lead
    for (const leadId of leadIds) {
      await LeadActivity.create({
        lead: leadId,
        activityType: 'updated',
        description: `Lead was bulk updated`,
        performedBy: req.user.id,
        newValue: updates,
        metadata: { bulkUpdate: true }
      });
    }

    res.json({
      success: true,
      data: { modifiedCount: result.modifiedCount },
      message: `${result.modifiedCount} leads updated successfully`
    });
  } catch (error) {
    console.error('Error bulk updating leads:', error);
    res.status(500).json({
      success: false,
      message: 'Error bulk updating leads',
      error: error.message
    });
  }
};

// @desc    Bulk delete leads
// @route   DELETE /api/manager/leads/bulk
// @access  Private (Manager)
exports.bulkDeleteLeads = async (req, res) => {
  try {
    const { leadIds } = req.body;

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lead IDs'
      });
    }

    const result = await Lead.updateMany(
      { _id: { $in: leadIds }, isDeleted: false },
      { isDeleted: true, updatedBy: req.user.id }
    );

    // Log activity for each lead
    for (const leadId of leadIds) {
      await LeadActivity.create({
        lead: leadId,
        activityType: 'updated',
        description: `Lead was bulk deleted`,
        performedBy: req.user.id,
        metadata: { bulkDelete: true }
      });
    }

    res.json({
      success: true,
      data: { modifiedCount: result.modifiedCount },
      message: `${result.modifiedCount} leads deleted successfully`
    });
  } catch (error) {
    console.error('Error bulk deleting leads:', error);
    res.status(500).json({
      success: false,
      message: 'Error bulk deleting leads',
      error: error.message
    });
  }
};
