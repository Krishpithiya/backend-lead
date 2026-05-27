const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    trim: true
  },
  company: {
    type: String,
    trim: true
  },
  address: {
    street: String,
    city: String,
    state: String,
    country: String,
    zipCode: String
  },
  industry: {
    type: String,
    trim: true
  },
  website: {
    type: String,
    trim: true
  },

  // Business Information
  budget: {
    type: Number,
    default: 0
  },
  requirement: {
    type: String,
    trim: true
  },
  interestedService: {
    type: String,
    trim: true
  },
  expectedClosingDate: {
    type: Date
  },
  dealValue: {
    type: Number,
    default: 0
  },

  // Lead Classification
  status: {
    type: String,
    enum: ['new', 'contacted', 'interested', 'qualified', 'proposal_sent', 'negotiation', 'converted', 'lost', 'not_interested', 'follow_up', 'no_response', 'meeting_schedule', 'demo_request', 'low_priority'],
    default: 'new'
  },
  source: {
    type: String,
    enum: ['website', 'facebook', 'instagram', 'google', 'whatsapp', 'referral', 'linkedin', 'manual', 'call', 'other'],
    default: 'manual'
  },
  priority: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium'
  },
  leadScore: {
    type: String,
    enum: ['hot', 'warm', 'cold'],
    default: 'cold'
  },

  // Assignment Information
  assignedAgent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  assignedDate: {
    type: Date
  },
  leadOwner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Follow-up Information
  nextFollowUpDate: {
    type: Date
  },
  followUpNotes: {
    type: String
  },
  missedFollowUps: {
    type: Number,
    default: 0
  },

  // Additional Information
  tags: [{
    type: String
  }],
  description: {
    type: String
  },
  
  // Metadata
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  duplicateOf: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    default: null
  }
}, {
  timestamps: true
});

// Indexes for better query performance
leadSchema.index({ name: 'text', email: 'text', phone: 'text', company: 'text' });
leadSchema.index({ status: 1 });
leadSchema.index({ source: 1 });
leadSchema.index({ priority: 1 });
leadSchema.index({ assignedAgent: 1 });
leadSchema.index({ createdBy: 1 });
leadSchema.index({ createdAt: -1 });
leadSchema.index({ nextFollowUpDate: 1 });

module.exports = mongoose.model('Lead', leadSchema);
