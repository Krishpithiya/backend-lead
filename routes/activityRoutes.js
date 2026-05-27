const express = require('express');
const router = express.Router();
const {
  getLeadActivities,
  getAllActivities
} = require('../controllers/activityController');
const verifyToken = require('../middleware/auth.middleware');
const authorizeRoles = require('../middleware/role.middleware');

// All routes are protected and require manager role
router.use(verifyToken);
router.use(authorizeRoles('manager', 'admin'));

// Activity routes
router.route('/')
  .get(getAllActivities);

module.exports = router;
