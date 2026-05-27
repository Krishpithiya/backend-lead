const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const router = express.Router();
const profileSettingsController = require("../controllers/profileSettings.controller");
const verifyToken = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../uploads/profiles");
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || ".jpg");
    cb(null, `${req.user.id}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image uploads are allowed"));
    }
    cb(null, true);
  },
});

router.use(verifyToken);
router.use(authorizeRoles("manager", "admin", "agent"));

router.get("/", profileSettingsController.getProfileSettings);
router.put("/profile", profileSettingsController.updateProfile);
router.put("/preferences", profileSettingsController.updatePreferences);
router.put("/password", profileSettingsController.updatePassword);
router.post("/photo", upload.single("profilePhoto"), profileSettingsController.uploadProfilePhoto);
router.delete("/photo", profileSettingsController.removeProfilePhoto);
router.post("/logout-all-devices", profileSettingsController.logoutAllDevices);

module.exports = router;
