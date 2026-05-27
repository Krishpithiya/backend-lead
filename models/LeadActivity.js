const mongoose = require('mongoose');

const leadActivitySchema = new mongoose.Schema({
  lead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true
  },
  activityType: {
    type: String,
    enum: ['created', 'updated', 'assigned', 'status_changed', 'follow_up_added', 'follow_up_completed', 'call_completed', 'email_sent', 'meeting_scheduled', 'meeting_completed', 'note_added', 'attachment_uploaded', 'lead_converted', 'lead_lost', 'whatsapp_sent'],
    required: true
  },
  description: {
    type: String,
    required: true
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  previousValue: {
    type: mongoose.Schema.Types.Mixed
  },
  newValue: {
    type: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Indexes
leadActivitySchema.index({ lead: 1, createdAt: -1 });
leadActivitySchema.index({ performedBy: 1, createdAt: -1 });
leadActivitySchema.index({ activityType: 1 });

module.exports = mongoose.model('LeadActivity', leadActivitySchema);
