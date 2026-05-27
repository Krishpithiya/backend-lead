  const User = require("../models/user");
  const bcrypt = require("bcryptjs");
  const jwt = require("jsonwebtoken");
  const sendEmail = require("../utils/sendEmail");

  exports.register = async (req, res) => {
    try {
      const { name, email, password, phone, role, managerId } = req.body;

      console.log("Register request received:", { name, email, phone, role, managerId });
      console.log("User from token:", req.user);

      if (!name || !email || !password || !phone || !role) {
        return res.status(400).json({
          message: "Name, email, password, phone and role are required"
        });
      }

      const existingUser = await User.findOne({ email });

      if (existingUser) {
        return res.status(400).json({
          message: "User already exists with this email"
        });
      }

      if (!["admin", "manager", "agent"].includes(role)) {
        return res.status(400).json({
          message: "Invalid role"
        });
      }

      // Only admin can create manager
      if (role === "manager" && req.user.role !== "admin") {
        return res.status(403).json({
          message: "Only admin can create manager"
        });
      }

      // Manager can create only agent
      if (req.user.role === "manager" && role !== "agent") {
        return res.status(403).json({
          message: "Manager can create only agents"
        });
      }

      let finalManagerId = null;

      if (role === "agent") {
        if (req.user.role === "manager") {
          finalManagerId = req.user.id;
        }

        if (req.user.role === "admin") {
          finalManagerId = managerId || null;
        }
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const user = new User({
        name,
        email,
        password: hashedPassword,
        phone,
        role,
        managerId: finalManagerId
      });

      await user.save();

      console.log("User created successfully:", user.email);

      res.status(201).json({
        message: "User created successfully",
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          managerId: user.managerId
        }
      });
    } catch (err) {
      console.error("Register error:", err);
      res.status(500).json({
        error: err.message
      });
    }
  };

  exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({
        message: "User not found"
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        message: "Invalid password"
      });
    }

    const accessToken = jwt.sign(
      {
        id: user._id,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    const refreshToken = jwt.sign(
      {
        id: user._id,
        role: user.role
      },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    const lastLoginIp =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.socket?.remoteAddress ||
      "";

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          refreshToken,
          lastLoginAt: new Date(),
          lastLoginIp,
          activeDevices: [
            ...(user.activeDevices || []).slice(-4),
            {
              device: req.headers["user-agent"] || "Unknown device",
              browser: req.headers["user-agent"] || "Unknown browser",
              ipAddress: lastLoginIp,
              lastActiveAt: new Date(),
            },
          ],
        },
      },
    );

    // ✅ ✅ FIXED RESPONSE (IMPORTANT)
    res.json({
      success: true,
      message: "Login successful",
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      }
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
};

  exports.refreshToken = async (req, res) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(401).json({
          message: "Refresh token is required"
        });
      }

      const user = await User.findOne({ refreshToken });

      if (!user) {
        return res.status(403).json({
          message: "Invalid refresh token"
        });
      }

      jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET,
        (err, decoded) => {
          if (err) {
            return res.status(403).json({
              message: "Refresh token expired or invalid"
            });
          }

          const newAccessToken = jwt.sign({
            id: decoded.id,
            role: decoded.role
          }, process.env.JWT_SECRET, {
            expiresIn: "15m"
          });

          res.json({
            message: "New access token generated",
            accessToken: newAccessToken
          });
        }
      );

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  };

  exports.logout = async (req, res) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          message: "Refresh token is required"
        });
      }

      const user = await User.findOne({ refreshToken });

      if (!user) {
        return res.status(404).json({
          message: "User already logged out or invalid token"
        });
      }

      user.refreshToken = null;
      await user.save();

      res.json({
        message: "Logout successful"
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  };

  exports.forgotPassword = async (req, res) => {
    try{
      const { email } = req.body;

      const user = await User.findOne({ email }).select("_id email");

      if(!user){

        return res.status(400).json({
          message: "No account found with this email"
        }); 
      }
      const resetToken = Math.random().toString(36).substring(2, 12);

      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            resetPasswordToken: resetToken,
            resetPasswordExpires: new Date(Date.now() + 15 * 60 * 1000),
          },
        },
      );

      const resetLink = `http://localhost:3000/reset-password/${resetToken}`;

      await sendEmail(

        user.email,

        "Password Reset",

        `Click here to reset password: ${resetLink}`
      );

      res.json({
        message: "Password reset link sent",
      });

    } catch (err){
      res.status(500).json({
        error: err.message
      });
    }
  };

  exports.resetPassword = async (req, res) => {
    try{
      const { token } = req.params;

      const {
        newPassword,
        confirmPassword
      } = req.body;

      if (newPassword !== confirmPassword){
        return res.status(400).json({
          message: "Passwords do not match"
        });
      }

      const user = await User.findOne({
        resetPasswordToken: token,

        resetPasswordExpires: {
          $gt: Date.now()
        }
      });

      if(!user) {
        return res.status(400).json({
          message: "Invalid or expired token"
        });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await User.updateOne(
        { _id: user._id },
        {
          $set: { password: hashedPassword },
          $unset: { resetPasswordToken: "", resetPasswordExpires: "" },
        },
      );

      res.json({
        message: "Password reset successful"
      });
    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  };
