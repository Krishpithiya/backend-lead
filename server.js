const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();

const authRoutes = require("./routes/auth.routes");
const leadRoutes = require("./routes/lead.routes");

const app = express();

app.use(cors());
app.use(express.json());

// mongoDB atlas connection

mongoose.connect(process.env.MONGO_URL)
.then(() => console.log("MongoDB connected"))
.catch((err) => console.log(err));

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/leads", leadRoutes);

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});