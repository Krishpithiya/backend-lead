const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const controller = require("../controllers/adminTask.controller");
const verifyToken = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");

const router = express.Router();
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../uploads/task-attachments");
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  },
});
const upload = multer({ storage });

router.use(verifyToken);
router.use(authorizeRoles("admin"));

router.get("/", controller.getTasks);
router.get("/export", controller.exportTasks);
router.post("/", controller.createTask);
router.put("/:taskId", controller.updateTask);
router.delete("/:taskId", controller.deleteTask);
router.post("/:taskId/comments", controller.addComment);
router.post("/:taskId/attachments", upload.single("attachment"), controller.addAttachment);

module.exports = router;
