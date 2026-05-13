const express = require("express");
const router = express.Router();

const verifyToken = require("../middleware/auth.middleware");
const { getDashboardData } = require("../controllers/dashboardController");

// ✅ PROTECT DASHBOARD ROUTE with role-based data
router.get("/", verifyToken, getDashboardData);

module.exports = router;