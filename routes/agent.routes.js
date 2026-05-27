const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const router = express.Router();
const controller = require("../controllers/agent.controller");
const verifyToken = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");

const documentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../uploads/lead-documents");
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const uploadDocument = multer({ storage: documentStorage });

router.use(verifyToken);
router.use(authorizeRoles("agent"));

router.get("/dashboard", controller.getDashboard);
router.get("/leads", controller.getLeads);
router.get("/leads/export/all", controller.exportLeads);
router.get("/leads/:leadId", controller.getLeadDetails);
router.patch("/leads/:leadId/status", controller.updateLeadStatus);
router.post("/leads/:leadId/notes", controller.addLeadNote);
router.post("/leads/:leadId/followups", controller.scheduleLeadFollowup);
router.post("/leads/:leadId/calls", controller.addCallSummary);
router.post("/leads/:leadId/documents", uploadDocument.single("document"), controller.addLeadDocument);
router.get("/followups", controller.getFollowups);
router.post("/followups", controller.createFollowup);
router.put("/followups/:followupId", controller.updateFollowup);
router.delete("/followups/:followupId", controller.deleteFollowup);
router.get("/tasks", controller.getTasks);
router.patch("/tasks/:taskId/status", controller.updateTaskStatus);
router.post("/tasks/:taskId/notes", controller.addTaskNote);
router.post("/tasks/:taskId/files", controller.addTaskFile);
router.get("/reports", controller.getReports);
router.get("/notifications", controller.getNotifications);
router.get("/notifications/unread-count", controller.getNotificationUnreadCount);
router.put("/notifications/read-all", controller.markAllNotificationsRead);
router.put("/notifications/:notificationId/read", controller.markNotificationRead);
router.delete("/notifications/:notificationId", controller.deleteNotification);

module.exports = router;
