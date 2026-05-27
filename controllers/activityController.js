const LeadActivity = require('../models/LeadActivity');

// @desc    Get activity timeline for a lead
// @route   GET /api/manager/leads/:leadId/activities
// @access  Private (Manager)
exports.getLeadActivities = async (req, res) => {
  try {
    const { leadId } = req.params;
    const { limit = 50 } = req.query;

    const activities = await LeadActivity.find({ lead: leadId })
      .populate('performedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: activities
    });
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching activities',
      error: error.message
    });
  }
};

// @desc    Get all activities for manager
// @route   GET /api/manager/activities
// @access  Private (Manager)
exports.getAllActivities = async (req, res) => {
  try {
    const { page = 1, limit = 20, activityType } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {};
    if (activityType) {
      query.activityType = activityType;
    }

    const activities = await LeadActivity.find(query)
      .populate('lead', 'name email company')
      .populate('performedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await LeadActivity.countDocuments(query);

    res.json({
      success: true,
      data: {
        activities,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching activities',
      error: error.message
    });
  }
};
