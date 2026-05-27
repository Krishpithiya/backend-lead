const FollowUp = require('../models/FollowUp');
const Lead = require('../models/Lead');
const LeadActivity = require('../models/LeadActivity');
const Notification = require('../models/Notification');
const { dateError } = require('../utils/dateValidation');

// @desc    Get all follow-ups for a lead
// @route   GET /api/manager/leads/:leadId/follow-ups
// @access  Private (Manager)
exports.getLeadFollowUps = async (req, res) => {
  try {
    const { leadId } = req.params;
    const { status } = req.query;

    const query = { lead: leadId };
    if (status) {
      query.status = status;
    }

    const followUps = await FollowUp.find(query)
      .populate('assignedTo', 'name email phone')
      .populate('completedBy', 'name email')
      .sort({ scheduledDate: -1 });

    res.json({
      success: true,
      data: followUps
    });
  } catch (error) {
    console.error('Error fetching follow-ups:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching follow-ups',
      error: error.message
    });
  }
};

// @desc    Create follow-up
// @route   POST /api/manager/leads/:leadId/follow-ups
// @access  Private (Manager)
exports.createFollowUp = async (req, res) => {
  try {
    const { leadId } = req.params;
    const followUpData = {
      ...req.body,
      lead: leadId,
      assignedTo: req.body.assignedTo || req.user.id
    };
    const invalidScheduledDate = dateError(followUpData.scheduledDate, 'Follow-up date');
    if (invalidScheduledDate) return res.status(400).json({ success: false, message: invalidScheduledDate });
    const invalidReminderDate = dateError(followUpData.reminderTime, 'Reminder date');
    if (invalidReminderDate) return res.status(400).json({ success: false, message: invalidReminderDate });

    const followUp = await FollowUp.create(followUpData);

    // Update lead's next follow-up date
    const lead = await Lead.findById(leadId);
    if (lead) {
      lead.nextFollowUpDate = followUp.scheduledDate;
      lead.followUpNotes = followUp.notes;
      lead.updatedBy = req.user.id;
      await lead.save();
    }

    // Log activity
    await LeadActivity.create({
      lead: leadId,
      activityType: 'follow_up_added',
      description: `Follow-up scheduled for ${followUp.scheduledDate}`,
      performedBy: req.user.id,
      metadata: { followUpId: followUp._id }
    });

    // Create notification
    await Notification.create({
      recipient: followUp.assignedTo,
      type: 'follow_up_due',
      title: 'New Follow-up Scheduled',
      message: `You have a new follow-up scheduled for ${followUp.scheduledDate}`,
      lead: leadId,
      actionUrl: `/manager/leads/${leadId}`
    });

    const populatedFollowUp = await FollowUp.findById(followUp._id)
      .populate('assignedTo', 'name email phone')
      .populate('completedBy', 'name email');

    res.status(201).json({
      success: true,
      data: populatedFollowUp,
      message: 'Follow-up created successfully'
    });
  } catch (error) {
    console.error('Error creating follow-up:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating follow-up',
      error: error.message
    });
  }
};

// @desc    Update follow-up
// @route   PUT /api/manager/follow-ups/:id
// @access  Private (Manager)
exports.updateFollowUp = async (req, res) => {
  try {
    const followUp = await FollowUp.findById(req.params.id);

    if (!followUp) {
      return res.status(404).json({
        success: false,
        message: 'Follow-up not found'
      });
    }
    const invalidScheduledDate = dateError(req.body.scheduledDate, 'Follow-up date');
    if (invalidScheduledDate) return res.status(400).json({ success: false, message: invalidScheduledDate });
    const invalidReminderDate = dateError(req.body.reminderTime, 'Reminder date');
    if (invalidReminderDate) return res.status(400).json({ success: false, message: invalidReminderDate });

    const updatedFollowUp = await FollowUp.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
      .populate('assignedTo', 'name email phone')
      .populate('completedBy', 'name email');

    // Log activity
    await LeadActivity.create({
      lead: followUp.lead,
      activityType: 'follow_up_added',
      description: `Follow-up was updated`,
      performedBy: req.user.id,
      metadata: { followUpId: followUp._id }
    });

    res.json({
      success: true,
      data: updatedFollowUp,
      message: 'Follow-up updated successfully'
    });
  } catch (error) {
    console.error('Error updating follow-up:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating follow-up',
      error: error.message
    });
  }
};

// @desc    Complete follow-up
// @route   PUT /api/manager/follow-ups/:id/complete
// @access  Private (Manager)
exports.completeFollowUp = async (req, res) => {
  try {
    const { outcome } = req.body;
    const followUp = await FollowUp.findById(req.params.id);

    if (!followUp) {
      return res.status(404).json({
        success: false,
        message: 'Follow-up not found'
      });
    }

    followUp.status = 'completed';
    followUp.outcome = outcome;
    followUp.completedAt = new Date();
    followUp.completedBy = req.user.id;
    await followUp.save();

    // Update lead's missed follow-ups count
    const lead = await Lead.findById(followUp.lead);
    if (lead) {
      if (followUp.scheduledDate < new Date()) {
        lead.missedFollowUps = Math.max(0, lead.missedFollowUps - 1);
      }
      lead.updatedBy = req.user.id;
      await lead.save();
    }

    // Log activity
    await LeadActivity.create({
      lead: followUp.lead,
      activityType: 'follow_up_completed',
      description: `Follow-up was completed`,
      performedBy: req.user.id,
      metadata: { followUpId: followUp._id, outcome }
    });

    const populatedFollowUp = await FollowUp.findById(followUp._id)
      .populate('assignedTo', 'name email phone')
      .populate('completedBy', 'name email');

    res.json({
      success: true,
      data: populatedFollowUp,
      message: 'Follow-up completed successfully'
    });
  } catch (error) {
    console.error('Error completing follow-up:', error);
    res.status(500).json({
      success: false,
      message: 'Error completing follow-up',
      error: error.message
    });
  }
};

// @desc    Delete follow-up
// @route   DELETE /api/manager/follow-ups/:id
// @access  Private (Manager)
exports.deleteFollowUp = async (req, res) => {
  try {
    const followUp = await FollowUp.findById(req.params.id);

    if (!followUp) {
      return res.status(404).json({
        success: false,
        message: 'Follow-up not found'
      });
    }

    await FollowUp.findByIdAndDelete(req.params.id);

    // Log activity
    await LeadActivity.create({
      lead: followUp.lead,
      activityType: 'updated',
      description: `Follow-up was deleted`,
      performedBy: req.user.id,
      metadata: { followUpId: followUp._id }
    });

    res.json({
      success: true,
      message: 'Follow-up deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting follow-up:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting follow-up',
      error: error.message
    });
  }
};

// @desc    Get today's follow-ups
// @route   GET /api/manager/follow-ups/today
// @access  Private (Manager)
exports.getTodayFollowUps = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const followUps = await FollowUp.find({
      assignedTo: req.user.id,
      scheduledDate: { $gte: today, $lt: tomorrow },
      status: 'pending'
    })
      .populate('lead', 'name email phone company')
      .sort({ scheduledDate: 1 });

    res.json({
      success: true,
      data: followUps
    });
  } catch (error) {
    console.error('Error fetching today follow-ups:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching today follow-ups',
      error: error.message
    });
  }
};

// @desc    Get missed follow-ups
// @route   GET /api/manager/follow-ups/missed
// @access  Private (Manager)
exports.getMissedFollowUps = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const followUps = await FollowUp.find({
      assignedTo: req.user.id,
      scheduledDate: { $lt: today },
      status: 'pending'
    })
      .populate('lead', 'name email phone company')
      .sort({ scheduledDate: -1 });

    res.json({
      success: true,
      data: followUps
    });
  } catch (error) {
    console.error('Error fetching missed follow-ups:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching missed follow-ups',
      error: error.message
    });
  }
};
