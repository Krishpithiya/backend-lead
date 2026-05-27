const FollowUpReminder = require("../models/FollowUpReminder");

const TEN_MINUTES = 10 * 60 * 1000;

const getTenMinuteReminderAt = (scheduledDate) =>
  new Date(new Date(scheduledDate).getTime() - TEN_MINUTES);

const ensureTenMinuteSmsReminder = async (followUp) => {
  try {
    if (!followUp?.scheduledDate) return null;

    const reminderAt = getTenMinuteReminderAt(followUp.scheduledDate);
    const now = new Date();
    if (reminderAt <= now) {
      await FollowUpReminder.updateMany(
        { followUp: followUp._id, channels: { $all: ["sms"] }, status: "scheduled" },
        { status: "cancelled" }
      );
      return null;
    }

    return FollowUpReminder.findOneAndUpdate(
      { followUp: followUp._id, channels: { $all: ["sms"] }, repeatEveryMinutes: 0 },
      {
        followUp: followUp._id,
        reminderAt,
        channels: ["in_app", "sms"],
        status: "scheduled",
        sentAt: null,
        snoozedUntil: null,
        repeatEveryMinutes: 0,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    console.error("Follow-up SMS reminder setup failed:", error.message);
    return null;
  }
};

module.exports = {
  ensureTenMinuteSmsReminder,
  getTenMinuteReminderAt,
};
