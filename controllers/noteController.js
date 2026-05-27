const Note = require('../models/Note');
const LeadActivity = require('../models/LeadActivity');
const Notification = require('../models/Notification');

// @desc    Get all notes for a lead
// @route   GET /api/manager/leads/:leadId/notes
// @access  Private (Manager)
exports.getLeadNotes = async (req, res) => {
  try {
    const { leadId } = req.params;
    const { noteType } = req.query;

    const query = { lead: leadId };
    if (noteType) {
      query.noteType = noteType;
    }

    const notes = await Note.find(query)
      .populate('createdBy', 'name email')
      .populate('editedBy', 'name email')
      .populate('mentions', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: notes
    });
  } catch (error) {
    console.error('Error fetching notes:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching notes',
      error: error.message
    });
  }
};

// @desc    Create note
// @route   POST /api/manager/leads/:leadId/notes
// @access  Private (Manager)
exports.createNote = async (req, res) => {
  try {
    const { leadId } = req.params;
    const noteData = {
      ...req.body,
      lead: leadId,
      createdBy: req.user.id
    };

    const note = await Note.create(noteData);

    // Log activity
    await LeadActivity.create({
      lead: leadId,
      activityType: 'note_added',
      description: `Note was added to lead`,
      performedBy: req.user.id,
      metadata: { noteId: note._id }
    });

    // Create notifications for mentions
    if (note.mentions && note.mentions.length > 0) {
      for (const mentionId of note.mentions) {
        await Notification.create({
          recipient: mentionId,
          type: 'note_added',
          title: 'You were mentioned in a note',
          message: `You were mentioned in a note for lead`,
          lead: leadId,
          actionUrl: `/manager/leads/${leadId}`
        });
      }
    }

    const populatedNote = await Note.findById(note._id)
      .populate('createdBy', 'name email')
      .populate('editedBy', 'name email')
      .populate('mentions', 'name email');

    res.status(201).json({
      success: true,
      data: populatedNote,
      message: 'Note created successfully'
    });
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating note',
      error: error.message
    });
  }
};

// @desc    Update note
// @route   PUT /api/manager/notes/:id
// @access  Private (Manager)
exports.updateNote = async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found'
      });
    }

    const updatedNote = await Note.findByIdAndUpdate(
      req.params.id,
      {
        ...req.body,
        isEdited: true,
        editedBy: req.user.id,
        editedAt: new Date()
      },
      { new: true, runValidators: true }
    )
      .populate('createdBy', 'name email')
      .populate('editedBy', 'name email')
      .populate('mentions', 'name email');

    // Log activity
    await LeadActivity.create({
      lead: note.lead,
      activityType: 'updated',
      description: `Note was updated`,
      performedBy: req.user.id,
      metadata: { noteId: note._id }
    });

    res.json({
      success: true,
      data: updatedNote,
      message: 'Note updated successfully'
    });
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating note',
      error: error.message
    });
  }
};

// @desc    Delete note
// @route   DELETE /api/manager/notes/:id
// @access  Private (Manager)
exports.deleteNote = async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found'
      });
    }

    await Note.findByIdAndDelete(req.params.id);

    // Log activity
    await LeadActivity.create({
      lead: note.lead,
      activityType: 'updated',
      description: `Note was deleted`,
      performedBy: req.user.id,
      metadata: { noteId: note._id }
    });

    res.json({
      success: true,
      message: 'Note deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting note',
      error: error.message
    });
  }
};
