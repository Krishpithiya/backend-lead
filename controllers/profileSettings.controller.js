const bcrypt = require("bcryptjs");
const User = require("../models/user");
const ProfileActivityLog = require("../models/ProfileActivityLog");
const { notifyAdminsOfUpdate, formatActor } = require("../utils/adminNotifications");

const publicUserFields =
  "-password -refreshToken -resetPasswordToken -resetPasswordExpires";

const getClientMeta = (req) => ({
  ipAddress:
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket?.remoteAddress ||
    "",
  device: req.headers["user-agent"] || "Unknown device",
});

const logActivity = async (req, action, description) => {
  const { ipAddress, device } = getClientMeta(req);
  await ProfileActivityLog.create({
    user: req.user.id,
    action,
    description,
    ipAddress,
    device,
  });
};

const notifyAdminProfileChange = async (req, title, metadata = {}) => {
  if (!["manager", "agent"].includes(req.user?.role)) return;
  await notifyAdminsOfUpdate({
    actor: req.user,
    type: "admin_activity",
    title,
    message: `${formatActor(req.user)} updated account information.`,
    relatedId: req.user.id,
    actionUrl: "/admin/dashboard",
    metadata: { entity: "profile", ...metadata },
  });
};

const getProfileCompletion = (user) => {
  const checks = [
    user.name,
    user.email,
    user.phone,
    user.username,
    user.designation || user.role,
    user.bio,
    user.profilePhoto,
    user.emailVerified,
    user.notificationPreferences,
    user.appearancePreferences,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
};

const formatProfile = async (user) => {
  const logs = await ProfileActivityLog.find({ user: user._id })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
  const plain = user.toObject ? user.toObject() : user;
  delete plain.password;
  delete plain.refreshToken;
  delete plain.resetPasswordToken;
  delete plain.resetPasswordExpires;
  if (plain.email && plain.emailVerified !== false) {
    plain.emailVerified = true;
  }
  return {
    ...plain,
    profileCompletion: getProfileCompletion(plain),
    activityLogs: logs,
  };
};

exports.getProfileSettings = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select(publicUserFields);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.email && user.emailVerified !== true) {
      user.emailVerified = true;
      await user.save();
    }
    res.json({ success: true, data: await formatProfile(user) });
  } catch (error) {
    next(error);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const allowed = ["name", "phone", "username", "designation", "bio", "profilePhoto"];
    const update = {};
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    });

    if (req.body.email && req.body.email !== req.body.currentEmail) {
      update.email = req.body.email;
      update.emailVerified = false;
    }

    const user = await User.findByIdAndUpdate(req.user.id, update, {
      new: true,
      runValidators: true,
    }).select(publicUserFields);

    await logActivity(req, "profile_updated", "Profile information updated");
    await notifyAdminProfileChange(req, "Profile information updated", { changes: update });
    res.json({ success: true, message: "Profile updated successfully", data: await formatProfile(user) });
  } catch (error) {
    next(error);
  }
};

exports.updatePreferences = async (req, res, next) => {
  try {
    const update = {};
    if (req.body.notificationPreferences) {
      update.notificationPreferences = req.body.notificationPreferences;
    }
    if (req.body.appearancePreferences) {
      update.appearancePreferences = req.body.appearancePreferences;
    }
    if (req.body.twoFactorEnabled !== undefined) {
      update.twoFactorEnabled = req.body.twoFactorEnabled;
    }
    if (req.body.sessionTimeoutMinutes !== undefined) {
      update.sessionTimeoutMinutes = req.body.sessionTimeoutMinutes;
    }

    const user = await User.findByIdAndUpdate(req.user.id, update, {
      new: true,
      runValidators: true,
    }).select(publicUserFields);

    await logActivity(req, "preferences_updated", "Account preferences updated");
    await notifyAdminProfileChange(req, "Account preferences updated", { changes: update });
    res.json({ success: true, message: "Preferences saved", data: await formatProfile(user) });
  } catch (error) {
    next(error);
  }
};

exports.updatePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, message: "All password fields are required" });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: "New passwords do not match" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
    }

    const user = await User.findById(req.user.id);
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Current password is incorrect" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    await logActivity(req, "password_updated", "Password changed successfully");
    await notifyAdminProfileChange(req, "Account password changed", { changed: "password" });
    res.json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    next(error);
  }
};

exports.uploadProfilePhoto = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Profile photo is required" });
    }
    const imagePath = `/uploads/profiles/${req.file.filename}`;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    user.profilePhoto = imagePath;
    await user.save();
    const updatedUser = await User.findById(req.user.id).select(publicUserFields);
    await logActivity(req, "profile_photo_updated", "Profile photo updated");
    await notifyAdminProfileChange(req, "Profile photo updated", { profilePhoto: imagePath });
    res.json({ success: true, message: "Profile photo updated", data: await formatProfile(updatedUser) });
  } catch (error) {
    next(error);
  }
};

exports.removeProfilePhoto = async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { profilePhoto: "" },
      { new: true }
    ).select(publicUserFields);
    await logActivity(req, "profile_photo_removed", "Profile photo removed");
    await notifyAdminProfileChange(req, "Profile photo removed", { profilePhoto: "" });
    res.json({ success: true, message: "Profile photo removed", data: await formatProfile(user) });
  } catch (error) {
    next(error);
  }
};

exports.logoutAllDevices = async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { refreshToken: null, activeDevices: [] },
      { new: true }
    ).select(publicUserFields);
    await logActivity(req, "logout_all_devices", "Logged out from all devices");
    res.json({ success: true, message: "All devices logged out", data: await formatProfile(user) });
  } catch (error) {
    next(error);
  }
};
