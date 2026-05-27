const express = require('express');
const router = express.Router();
const {
  getAllLeads,
  getLeadById,
  createLead,
  updateLead,
  deleteLead,
  assignLead,
  getLeadAnalytics,
  bulkUpdateLeads,
  bulkDeleteLeads
} = require('../controllers/leadController');
const verifyToken = require('../middleware/auth.middleware');
const authorizeRoles = require('../middleware/role.middleware');

// All routes are protected and require manager role
router.use(verifyToken);
router.use(authorizeRoles('manager', 'admin'));

// Lead routes
router.route('/')
  .get(getAllLeads)
  .post(createLead);

router.route('/analytics')
  .get(getLeadAnalytics);

router.route('/bulk')
  .put(bulkUpdateLeads)
  .delete(bulkDeleteLeads);

router.route('/:id')
  .get(getLeadById)
  .put(updateLead)
  .delete(deleteLead);

router.route('/:id/assign')
  .put(assignLead);

module.exports = router;
