require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const helmet = require("helmet");
const morgan = require("morgan");

// Routes
const authRoutes = require("./routes/auth.routes");
const leadRoutes = require("./routes/lead.routes");
const userRoutes = require("./routes/user.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const aiRoutes = require("./routes/aiRoutes");

const app = express();

/* ================= SECURITY ================= */

// Hide Express server info
app.disable("x-powered-by");

// Security headers
app.use(helmet());

// Logging
app.use(morgan("dev"));

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

/* ================= DATABASE ================= */

if (!process.env.MONGO_URL) {
  console.error("❌ MONGO_URL is not defined in .env");
  process.exit(1);
}

mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
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

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});





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

