const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  lead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true
  },
  content: {
    type: String,
    required: true
  },
  noteType: {
    type: String,
    enum: ['internal', 'public', 'agent'],
    default: 'internal'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isEdited: {
    type: Boolean,
    default: false
  },
  editedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  editedAt: {
    type: Date
  },
  mentions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true
});

// Indexes
noteSchema.index({ lead: 1, createdAt: -1 });
noteSchema.index({ createdBy: 1, createdAt: -1 });
noteSchema.index({ noteType: 1 });

module.exports = mongoose.model('Note', noteSchema);
