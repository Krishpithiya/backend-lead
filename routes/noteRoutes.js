const express = require('express');
const router = express.Router();
const {
  getLeadNotes,
  createNote,
  updateNote,
  deleteNote
} = require('../controllers/noteController');
const verifyToken = require('../middleware/auth.middleware');
const authorizeRoles = require('../middleware/role.middleware');

// All routes are protected and require manager role
router.use(verifyToken);
router.use(authorizeRoles('manager', 'admin'));

// Note routes
router.route('/:id')
  .put(updateNote)
  .delete(deleteNote);

module.exports = router;
