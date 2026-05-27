const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const controller = require("../controllers/adminSettings.controller");
const verifyToken = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");

const router = express.Router();

const uploadDir = path.join(__dirname, "../uploads/settings");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "-")}`),
});
const upload = multer({ storage });

router.use(verifyToken, authorizeRoles("admin"));

router.get("/", controller.getOverview);
router.put("/profile", controller.updateProfile);
router.put("/password", controller.changePassword);
router.post("/assets", upload.single("file"), controller.uploadAsset);
router.put("/sections/:section", controller.updateSection);

router.post("/roles", controller.createRole);
router.put("/roles/:id", controller.updateRole);
router.delete("/roles/:id", controller.deleteRole);

router.put("/users/:id/status", controller.updateUserStatus);
router.post("/users/:id/reset-password", controller.resetUserPassword);

router.post("/pipelines", controller.createPipelineStage);
router.put("/pipelines/:id", controller.updatePipelineStage);
router.delete("/pipelines/:id", controller.deletePipelineStage);

router.put("/integrations/:provider", controller.upsertIntegration);
router.post("/email/test", controller.testEmail);

router.post("/data/import", upload.single("file"), controller.importCsv);
router.get("/data/export", controller.exportData);

router.post("/backups", controller.createBackup);
router.get("/logs", controller.getLogs);

module.exports = router;
