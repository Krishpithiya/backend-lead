const User = require("../models/user");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const sendEmail = require("../utils/sendEmail");

exports.register = async (req, res) => {
  try{
    const { email, password, role } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      email,
      password: hashedPassword,
      role
    });

    await user.save();

    res.json({
      message: "User registered successfully"
    });

  } catch (err) {
    res.status(500).json({  
      error: err.message
    });
  }
};

exports.login = async (req, res) => {
  try{
    const { email, password} = req.body;

    const user = await User.findOne({ email});

    if(!user) {
      return res.status(400).json({
        message: "User not found"
      });
    }

    const isMatch = await bcrypt.compare(
      password,
      user.password
    );

    if(!isMatch) {
      return res.status(400).json({
        message: "Invalid password"
      });
    }

    const token = jwt.sign({
      id: user._id,
      role: user.role
    }, process.env.JWT_SECRET,{
      expiresIn: "1d"
    });

    res.json({
      message: "Login successful",
      token,
      role: user.role
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

    const user = await User.findOne({ email});

    if(!user){

      return res.status(400).json({
        message: "No account found with this email"
      }); 
    }
    const resetToken = Math.random().toString(36).substring(2, 12);

    user.resetPasswordToken = resetToken;

    user.resetPasswordExpires = Date.now() + 15*60*1000;

    await user.save();

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

    user.password = hashedPassword;

    user.resetPasswordToken = null;

    user.resetPasswordExpires = null;

    await user.save();

    res.json({
      message: "Password reset successful"
    });
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
};