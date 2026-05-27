const FollowUp = require("../models/FollowUp");
const FollowUpNotification = require("../models/FollowUpNotification");
const FollowUpReminder = require("../models/FollowUpReminder");
const { sendTextMessage } = require("./smsService");

const markOverdueFollowUps = async () => {
  const now = new Date();
  const overdue = await FollowUp.find({
    scheduledDate: { $lt: now },
    status: { $in: ["pending", "in_progress", "rescheduled"] },
  })
    .select("_id assignedTo createdBy lead")
    .limit(100);

  for (const followUp of overdue) {
    const actor = followUp.createdBy || followUp.assignedTo;
    await FollowUp.updateOne(
      { _id: followUp._id },
      {
        $set: { status: "missed" },
        $push: {
          activity: {
            type: "status_changed",
            message: "Auto marked as missed after due time",
            addedBy: actor,
            createdAt: now,
          },
        },
      }
    );
    if (actor) {
      await FollowUpNotification.create({
        followUp: followUp._id,
        recipient: actor,
        title: "Missed follow-up alert",
        message: "A follow-up crossed its due time and was marked missed",
        type: "missed",
      });
    }
  }
};

const sendDueReminders = async () => {
  const now = new Date();
  const reminders = await FollowUpReminder.find({
    reminderAt: { $lte: now },
    status: "scheduled",
  })
    .populate({
      path: "followUp",
      select: "assignedTo createdBy lead scheduledDate scheduledTime followUpType status notes nextAction",
      populate: [
        { path: "assignedTo", select: "name phone notificationPreferences" },
        { path: "createdBy", select: "name phone" },
        { path: "lead", select: "name phone company" },
      ],
    })
    .limit(100);

  for (const reminder of reminders) {
    const followUp = reminder.followUp;
    if (!followUp) {
      reminder.status = "cancelled";
      await reminder.save();
      continue;
    }

    if (["completed", "cancelled", "missed"].includes(followUp.status)) {
      reminder.status = "cancelled";
      await reminder.save();
      continue;
    }

    const recipient = followUp.assignedTo || followUp.createdBy;
    const leadName = followUp.lead?.name || "lead";
    const dueTime = followUp.scheduledTime || new Date(followUp.scheduledDate).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const reminderMessage = `${followUp.followUpType || "Follow-up"} for ${leadName} is due in 10 minutes at ${dueTime}.`;

    if (recipient?._id || recipient) {
      await FollowUpNotification.create({
        followUp: followUp._id,
        recipient: recipient?._id || recipient,
        title: "Follow-up reminder",
        message: reminderMessage,
        type: "reminder",
      });
    }

    if (reminder.channels.includes("sms")) {
      if (recipient?.phone) {
        await sendTextMessage({
          to: recipient.phone,
          message: `HYGO LMS: ${reminderMessage}`,
        });
      }
    }

    reminder.status = reminder.repeatEveryMinutes > 0 ? "snoozed" : "sent";
    reminder.sentAt = now;
    if (reminder.repeatEveryMinutes > 0) {
      reminder.snoozedUntil = new Date(now.getTime() + reminder.repeatEveryMinutes * 60000);
      reminder.reminderAt = reminder.snoozedUntil;
      reminder.status = "scheduled";
    }
    await reminder.save();
  }
};

const startFollowUpReminderScheduler = () => {
  const tick = async () => {
    try {
      await Promise.all([markOverdueFollowUps(), sendDueReminders()]);
    } catch (error) {
      console.error("Follow-up scheduler error:", error.message);
    }
  };

  setInterval(tick, 60 * 1000);
  tick();
};

module.exports = { startFollowUpReminderScheduler };
