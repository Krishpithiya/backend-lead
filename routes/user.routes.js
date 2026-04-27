const express = require("express");
const router = express.Router();

const userController = require("../controllers/user.controller");
const verifyToken = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");

router.get(
  "/managers",
  verifyToken,
  authorizeRoles("admin"),
  userController.getManagers
);

router.get(
  "/agents",
  verifyToken,
  authorizeRoles("admin"),
  userController.getAgents
);

router.get(
  "/my-agents",
  verifyToken,
  authorizeRoles("manager"),
  userController.getMyAgents
);

router.put(
  "/:agentId/assign-manager",
  verifyToken,
  authorizeRoles("admin"),
  userController.assignAgentToManager
);

router.put("/manager/:id", userController.updateManager);
router.put("/agent/:id", userController.updateAgent);

module.exports = router;