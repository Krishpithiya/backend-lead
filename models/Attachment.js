const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
  lead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true
  },
  fileName: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  fileType: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  description: {
    type: String
  }
}, {
  timestamps: true
});

// Indexes
attachmentSchema.index({ lead: 1, createdAt: -1 });
attachmentSchema.index({ uploadedBy: 1, createdAt: -1 });

module.exports = mongoose.model('Attachment', attachmentSchema);
