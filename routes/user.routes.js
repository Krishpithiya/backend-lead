const express = require("express");
const router = express.Router();

const userController = require("../controllers/user.controller");
const verifyToken = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");

// ================= MANAGERS =================

// GET ALL MANAGERS
router.get(
  "/managers",
  verifyToken,
  authorizeRoles("admin"),
  userController.getManagers
);

// GET SINGLE MANAGER ✅ (IMPORTANT)
router.get(
  "/manager/:id",
  verifyToken,
  authorizeRoles("admin"),
  userController.getManagerById
);

// UPDATE MANAGER
router.put(
  "/manager/:id",
  verifyToken,
  authorizeRoles("admin"),
  userController.updateManager
);

// UPDATE MANAGER STATUS (active/inactive)
router.put(
  "/manager/:managerId/status",
  verifyToken,
  authorizeRoles("admin"),
  userController.updateManagerStatus
);

// ================= AGENTS =================

// GET ALL AGENTS
router.get(
  "/agents",
  verifyToken,
  authorizeRoles("admin"),
  userController.getAgents
);

// GET MY AGENTS (manager)
router.get(
  "/my-agents",
  verifyToken,
  authorizeRoles("manager"),
  userController.getMyAgents
);

// GET SINGLE AGENT
router.get(
  "/agent/:id",
  verifyToken,
  authorizeRoles("admin"),
  userController.getAgentById
);

// UPDATE AGENT
router.put(
  "/agent/:id",
  verifyToken,
  authorizeRoles("admin"),
  userController.updateAgent
);

// ASSIGN AGENT TO MANAGER
router.put(
  "/agent/:agentId/assign-manager",
  verifyToken,
  authorizeRoles("admin"),
  userController.assignAgentToManager
);

// UPDATE AGENT STATUS (active/inactive)
router.put(
  "/agent/:agentId/status",
  verifyToken,
  authorizeRoles("admin"),
  userController.updateAgentStatus
);

// DELETE AGENT
router.delete(
  "/agent/:agentId",
  verifyToken,
  authorizeRoles("admin"),
  userController.deleteAgent
);

module.exports = router;










// const express = require("express");
// const router = express.Router();

// const userController = require("../controllers/user.controller");
// const verifyToken = require("../middleware/auth.middleware");
// const authorizeRoles = require("../middleware/role.middleware");

// router.get(
//   "/managers",
//   verifyToken,
//   authorizeRoles("admin"),
//   userController.getManagers
// );

// router.get(
//   "/agents",
//   verifyToken,
//   authorizeRoles("admin"),
//   userController.getAgents
// );

// router.get(
//   "/my-agents",
//   verifyToken,
//   authorizeRoles("manager"),
//   userController.getMyAgents
// );

// router.put("/:agentId/assign-manager", verifyToken, authorizeRoles("admin"), 
//   userController.assignAgentToManager
// );

// router.put("/manager/:id", verifyToken, authorizeRoles("admin"), userController.updateManager);

// router.put("/agent/:id", verifyToken, authorizeRoles("admin"), userController.updateAgent);

// // router.put("/manager/:id", userController.updateManager);
// // router.put("/agent/:id", userController.updateAgent);

// // router.get("/managers", verifyToken, userController.getManagers);
// router.get("/agents", verifyToken, userController.getAgents);



// module.exports = router;