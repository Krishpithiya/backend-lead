const Notification = require("../models/Notification");
const User = require("../models/user");

const compact = (value) =>
  Object.fromEntries(
    Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== null && item !== "")
  );

const formatActor = (user) => `${user?.name || "User"}${user?.role ? ` (${user.role})` : ""}`;

const createAdminNotification = async ({
  actor,
  type = "admin_activity",
  title,
  message,
  lead,
  relatedId,
  actionUrl,
  metadata = {},
}) => {
  try {
    const admins = await User.find({ role: "admin" }).select("_id").lean();
    if (!admins.length) return [];

    const docs = admins.map((admin) => ({
      recipient: admin._id,
      type,
      title,
      message,
      lead,
      relatedId,
      actionUrl,
      metadata: compact({
        actorId: actor?.id || actor?._id,
        actorName: actor?.name,
        actorRole: actor?.role,
        ...metadata,
      }),
    }));

    const notifications = await Notification.insertMany(docs);
    return notifications;
  } catch (error) {
    console.error("Admin notification failed:", error.message);
    return [];
  }
};

const notifyAdminsOfUpdate = async (payload) =>
  createAdminNotification({
    ...payload,
    title: payload.title || "CRM information updated",
    message: payload.message || `${formatActor(payload.actor)} updated CRM information.`,
  });

module.exports = {
  createAdminNotification,
  notifyAdminsOfUpdate,
  formatActor,
};
