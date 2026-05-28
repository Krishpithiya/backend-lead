require("dotenv").config();

const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  const noop = () => undefined;
  ["log", "debug", "trace", "table", "group", "groupCollapsed", "groupEnd"].forEach(
    (method) => {
      console[method] = noop;
    }
  );
}

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");

// Routes
const authRoutes = require("./routes/auth.routes");
const leadRoutes = require("./routes/lead.routes");
const userRoutes = require("./routes/user.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const aiRoutes = require("./routes/aiRoutes");
const agentManagementRoutes = require("./routes/agentManagement.routes");
const managerReportsRoutes = require("./routes/managerReports.routes");
const profileSettingsRoutes = require("./routes/profileSettings.routes");
const managerTaskRoutes = require("./routes/managerTask.routes");
const agentRoutes = require("./routes/agent.routes");
const notificationRoutes = require("./routes/notificationRoutes");
const adminSettingsRoutes = require("./routes/adminSettings.routes");
const adminTaskRoutes = require("./routes/adminTask.routes");
const { startFollowUpReminderScheduler } = require("./services/followUpReminderScheduler");
const ensureFollowUpIndexes = require("./utils/ensureFollowUpIndexes");

const app = express();

/* ================= SECURITY ================= */

// Hide Express server info
app.disable("x-powered-by");

// Security headers
app.use(helmet());

// Logging
if (!isProduction) {
  app.use(morgan("dev"));
}

/* ================= CORS ================= */

app.use(
  cors({
    origin: process.env.CLIENT_URL || true,
    credentials: true,
  })
);

/* ================= BODY PARSER ================= */

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ================= DATABASE ================= */

if (!process.env.MONGO_URL) {
  console.error("❌ MONGO_URL is not defined in .env");
  process.exit(1);
}

mongoose
  .connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 8000 })
  .then(() => console.info("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    console.error("Server is still running; database-backed APIs will recover when MongoDB is reachable.");
  });

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.send("🚀 API is running...");
});

// API Routes
app.use("/api/ai", aiRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/users", userRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/manager/reports", managerReportsRoutes);
app.use("/api/manager/profile-settings", profileSettingsRoutes);
app.use("/api/profile-settings", profileSettingsRoutes);
app.use("/api/manager/tasks", managerTaskRoutes);
app.use("/api/manager/notifications", notificationRoutes);
app.use("/api/admin/notifications", notificationRoutes);
app.use("/api/admin/settings", adminSettingsRoutes);
app.use("/api/admin/tasks", adminTaskRoutes);
app.use("/api/manager", agentManagementRoutes);
app.use("/api/agent", agentRoutes);

/* ================= ERROR HANDLING ================= */

// Global error handler
app.use((err, req, res, next) => {
  console.error("🔥 Error:", err.message);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Server Error",
  });
});

// 404 handler (must be last)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

/* ================= SERVER ================= */

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.info(`🚀 Server running on port ${PORT}`);
  ensureFollowUpIndexes().catch((error) =>
    console.error("Follow-up index repair failed:", error.message)
  );
  startFollowUpReminderScheduler();
});

try {
  const { Server } = require("socket.io");
  const io = new Server(server, {
    cors: { origin: process.env.CLIENT_URL || true, credentials: true },
  });
  app.set("io", io);
  io.on("connection", (socket) => socket.emit("task:connected", { connected: true }));
  console.info("Socket.io task channel enabled");
} catch {
  app.set("io", null);
  console.warn("Socket.io not installed; task REST APIs are running without realtime channel");
}





// require("dotenv").config();
// const express = require("express");
// const cors = require("cors");
// const mongoose = require("mongoose");
// const dotenv = require("dotenv");
// const helmet = require("helmet");
// const morgan = require("morgan");
// const aiRoutes = require("./routes/aiRoutes");

// dotenv.config();

// const authRoutes = require("./routes/auth.routes");
// const leadRoutes = require("./routes/lead.routes");
// const userRoutes = require("./routes/user.routes");
// const dashboardRoutes = require("./routes/dashboard.routes");

// const app = express();

// /* ================= SECURITY ================= */

// // Hide express info
// app.disable("x-powered-by");

// // Security headers
// app.use(helmet());

// // Logging
// app.use(morgan("dev"));

// app.use("/api/ai", aiRoutes);

// /* ================= CORS ================= */

// // Allow all origins (good for development)
// app.use(
//   cors({
//     origin: true,
//     credentials: true,
//   })
// );

// /* ================= BODY PARSER ================= */

// app.use(express.json({ limit: "10mb" }));
// app.use(express.urlencoded({ extended: true }));

// /* ================= DATABASE ================= */

// if (!process.env.MONGO_URL) {
//   console.error("❌ MONGO_URL is not defined in .env");
//   process.exit(1);
// }

// mongoose
//   .connect(process.env.MONGO_URL)
//   .then(() => console.log("✅ MongoDB connected"))
//   .catch((err) => {
//     console.error("❌ MongoDB connection error:", err);
//     process.exit(1);
//   });

// /* ================= ROUTES ================= */

// app.get("/", (req, res) => {
//   res.send("🚀 API is running...");
// });

// // API routes
// app.use("/api/auth", authRoutes);
// app.use("/api/leads", leadRoutes);
// app.use("/api/users", userRoutes);
// app.use("/api/dashboard", dashboardRoutes);

// /* ================= ERROR HANDLING ================= */

// // Global error handler (must be before 404)
// app.use((err, req, res, next) => {
//   console.error("🔥 Error:", err);

//   res.status(err.status || 500).json({
//     success: false,
//     message: err.message || "Server Error",
//   });
// });

// // 404 handler (must be last)
// app.use((req, res) => {
//   res.status(404).json({
//     success: false,
//     message: "Route not found",
//   });
// });

// /* ================= SERVER ================= */

// const PORT = process.env.PORT || 5000;

// app.listen(PORT, () => {
//   console.log(`🚀 Server running on port ${PORT}`);
// });

