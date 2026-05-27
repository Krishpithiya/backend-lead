const express = require('express');
const router = express.Router();
const {
  getLeadFollowUps,
  createFollowUp,
  updateFollowUp,
  completeFollowUp,
  deleteFollowUp,
  getTodayFollowUps,
  getMissedFollowUps
} = require('../controllers/followUpController');
const verifyToken = require('../middleware/auth.middleware');
const authorizeRoles = require('../middleware/role.middleware');

// All routes are protected and require manager role
router.use(verifyToken);
router.use(authorizeRoles('manager', 'admin'));

// Follow-up routes
router.route('/today')
  .get(getTodayFollowUps);

router.route('/missed')
  .get(getMissedFollowUps);

router.route('/:id')
  .put(updateFollowUp)
  .delete(deleteFollowUp);

router.route('/:id/complete')
  .put(completeFollowUp);

module.exports = router;
