const express = require("express");
const router = express.Router();
const managerReportsController = require("../controllers/managerReports.controller");
const verifyToken = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");

router.use(verifyToken);
router.use(authorizeRoles("manager", "admin"));

router.get("/", managerReportsController.getReports);
router.get("/export", managerReportsController.exportReport);
router.post("/schedules", managerReportsController.createSchedule);

module.exports = router;
