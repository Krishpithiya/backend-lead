const express = require("express");
const router = express.Router();

const leadController = require("../controllers/lead.controller");
const verifyToken = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");

// 🔥 (NEW) file upload middleware
const multer = require("multer");
const upload = multer({ dest: "uploads/" });


// ================= CREATE LEAD =================
router.post(
  "/",
  verifyToken,
  authorizeRoles("admin", "manager", "agent"),
  leadController.createLead
);

// ================= GET ALL LEADS =================
router.get(
  "/",
  verifyToken,
  authorizeRoles("admin", "manager", "agent"),
  leadController.getLeads
);

// ================= GET SINGLE LEAD =================
router.get(
  "/:id",
  verifyToken,
  authorizeRoles("admin", "manager", "agent"),
  leadController.getLeadById
);

// ================= UPDATE LEAD =================
router.put(
  "/:id",
  verifyToken,
  authorizeRoles("admin", "manager", "agent"),
  leadController.updateLead
);



// ================= 🔥 NEW APIs =================

// ✅ ADD FOLLOW-UP
router.post(
  "/:id/followup",
  verifyToken,
  authorizeRoles("admin", "manager", "agent"),
  leadController.addFollowUp
);

// ✅ ADD CALL LOG
router.post(
  "/:id/call",
  verifyToken,
  authorizeRoles("admin", "manager", "agent"),
  leadController.addCallLog
);

// ✅ ADD MEETING
router.post(
  "/:id/meeting",
  verifyToken,
  authorizeRoles("admin", "manager", "agent"),
  leadController.addMeeting
);

// ✅ FILE UPLOAD
router.post(
  "/:id/upload",
  verifyToken,
  authorizeRoles("admin", "manager", "agent"),
  upload.single("file"),
  leadController.uploadFile
);

// ✅ FILTER TIMELINE
router.get(
  "/:id/timeline",
  verifyToken,
  authorizeRoles("admin", "manager", "agent"),
  leadController.getFilteredTimeline
);


module.exports = router;

// const express = require("express");
// const router = express.Router();

// const leadController = require("../controllers/lead.controller");
// const verifyToken = require("../middleware/auth.middleware");
// const authorizeRoles = require("../middleware/role.middleware");

// router.post(
//   "/",
//   verifyToken,
//   authorizeRoles("admin", "manager", "agent"),
//   leadController.createLead,
// );

// router.get(
//   "/",
//   verifyToken,
//   authorizeRoles("admin", "manager", "agent"),
//   leadController.getLeads,
// );
// router.get(
//   "/:id",
//   verifyToken,
//   authorizeRoles("admin", "manager", "agent"),
//   leadController.getLeadById,
// );

// router.put(
//   "/:id",
//   verifyToken,
//   authorizeRoles("admin", "manager", "agent"),
//   leadController.updateLead,
// );

// module.exports = router;
