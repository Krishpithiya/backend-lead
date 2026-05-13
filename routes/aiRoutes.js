const express = require("express");
const { generateLeadNote } = require("../Controllers/aiController");

const router = express.Router();

router.post("/generate-note", generateLeadNote);

module.exports = router;