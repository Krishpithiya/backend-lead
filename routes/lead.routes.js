const express = require("express");
const router = express.Router();

const leadController = require("../controllers/lead.controller");
const verifyToken = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");

router.post("/", verifyToken, authorizeRoles("admin", "manager", "agent"), leadController.createLead);

router.get("/", verifyToken, authorizeRoles("admin", "manager", "agent"), leadController.getLeads);

router.get("/:id", verifyToken, authorizeRoles("admin", "manager", "agent"), leadController.getLeadById);

module.exports = router;