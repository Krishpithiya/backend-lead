const mongoose = require('mongoose');

const followUpSchema = new mongoose.Schema({
  lead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true
  },
  legacyLeadFollowUpId: {
    type: mongoose.Schema.Types.ObjectId,
    index: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  scheduledDate: {
    type: Date,
    required: true
  },
  scheduledTime: {
    type: String
  },
  followUpType: {
    type: String,
    enum: [
      'call',
      'whatsapp',
      'email',
      'meeting',
      'video_call',
      'demo',
      'site_visit',
      'consultation',
      'task',
      'other'
    ],
    default: 'call'
  },
  priority: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'missed', 'cancelled', 'rescheduled'],
    default: 'pending'
  },
  notes: {
    type: String,
    default: ''
  },
  nextAction: {
    type: String,
    default: ''
  },
  reminderTime: {
    type: Date
  },
  reminderType: {
    type: [String],
    enum: ['in_app', 'browser', 'email', 'whatsapp', 'sms'],
    default: ['in_app']
  },
  outcome: {
    type: String
  },
  missedReason: {
    type: String,
    default: ''
  },
  rescheduledFrom: {
    type: Date
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  completedAt: {
    type: Date
  },
  completedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reminderSent: {
    type: Boolean,
    default: false
  },
  reminderSentAt: {
    type: Date
  },
  notesThread: [
    {
      text: String,
      addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      isInternal: {
        type: Boolean,
        default: true
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }
  ],
  activity: [
    {
      type: {
        type: String,
        enum: [
          'created',
          'completed',
          'rescheduled',
          'reminder_sent',
          'note_added',
          'status_changed',
          'meeting_scheduled',
          'deleted'
        ]
      },
      message: String,
      meta: mongoose.Schema.Types.Mixed,
      addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }
  ]
}, {
  timestamps: true
});

// Indexes
followUpSchema.index({ lead: 1, scheduledDate: -1 });
followUpSchema.index(
  { lead: 1, legacyLeadFollowUpId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      legacyLeadFollowUpId: { $type: 'objectId' }
    }
  }
);
followUpSchema.index({ assignedTo: 1, scheduledDate: 1 });
followUpSchema.index({ status: 1 });
followUpSchema.index({ scheduledDate: 1 });

module.exports = mongoose.model('FollowUp', followUpSchema);
