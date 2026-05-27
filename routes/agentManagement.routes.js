const express = require("express");
const router = express.Router();
const agentManagementController = require("../controllers/agentManagement.controller");
const managerLeadController = require("../controllers/managerLead.controller");
const managerFollowUpController = require("../controllers/managerFollowUp.controller");
const verifyToken = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");

// All routes require authentication
router.use(verifyToken);
router.use(authorizeRoles("manager", "admin"));

// Dashboard Summary
router.get("/dashboard/summary", agentManagementController.getAgentDashboardSummary);

// Lead Management Center
router.get("/leads", managerLeadController.getLeadsCenter);
router.get("/leads/recent", agentManagementController.getRecentLeads);
router.post("/leads/bulk", managerLeadController.bulkAction);
router.get("/leads/:leadId", managerLeadController.getLeadDetails);
router.put("/leads/:leadId", managerLeadController.updateLead);
router.delete("/leads/:leadId", managerLeadController.deleteLead);
router.put("/leads/:leadId/assign", managerLeadController.assignAgent);
router.post("/leads/:leadId/notes", managerLeadController.addNote);
router.post("/leads/:leadId/followups", managerLeadController.addFollowUp);
router.put(
  "/leads/:leadId/followups/:followUpId",
  managerLeadController.markFollowUp
);

// Agent Management
router.get("/agents", agentManagementController.getManagerAgents);
router.get("/agents/status", agentManagementController.getAgentStatus);
router.get("/agents/:id", agentManagementController.getAgentDetails);
router.get("/agents/:id/performance", agentManagementController.getAgentPerformance);

// Follow-Up Management Center
router.get("/followups", managerFollowUpController.getFollowUpCenter);
router.post("/followups", managerFollowUpController.createFollowUp);
router.post("/followups/bulk", managerFollowUpController.bulkAction);
router.get("/followups/:followUpId", managerFollowUpController.getFollowUpDetails);
router.put("/followups/:followUpId", managerFollowUpController.updateFollowUp);
router.delete("/followups/:followUpId", managerFollowUpController.deleteFollowUp);
router.post("/followups/:followUpId/notes", managerFollowUpController.addNote);

// Activity Timeline
router.get("/activity", agentManagementController.getActivityTimeline);

module.exports = router;
