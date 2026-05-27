const express = require("express");
const router = express.Router();
const controller = require("../controllers/managerTask.controller");
const verifyToken = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");

router.use(verifyToken);
router.use(authorizeRoles("manager", "admin"));

router.get("/", controller.getTaskCenter);
router.get("/export", controller.exportTasks);
router.post("/", controller.createTask);
router.post("/bulk", controller.bulkAction);
router.get("/:taskId", controller.getTaskDetails);
router.put("/:taskId", controller.updateTask);
router.delete("/:taskId", controller.deleteTask);
router.post("/:taskId/comments", controller.addComment);

module.exports = router;
