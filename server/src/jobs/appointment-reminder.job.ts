import cron from 'node-cron';
import { AppointmentModel, User } from '../models.js';
import { sendAppointmentReminder } from '../services/invite-email.service.js';

/**
 * Schedule daily job to send appointment reminders on the eve of the appointment.
 * Runs at 6:00 PM server time; finds appointments scheduled for "tomorrow" (calendar day)
 * and sends a reminder email to both petitioner and petitioner attorney.
 */
export function scheduleAppointmentReminderJob(): void {
  cron.schedule('0 18 * * *', async () => {
    try {
      const now = new Date();
      const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
      const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0, 0);

      const appointments = await AppointmentModel.find({
        scheduledAt: { $gte: tomorrowStart, $lt: tomorrowEnd },
        status: { $in: ['pending', 'accepted'] },
      })
        .select({ petitionerId: 1, petitionerAttId: 1, legalAssistantId: 1, scheduledAt: 1 })
        .lean<any[]>();

      const appUrl = process.env.APP_BASE_URL?.trim() || 'http://localhost:4200';

      for (const a of appointments) {
        const petitionerId = (a.petitionerId?._id ?? a.petitionerId)?.toString();
        const attorneyId = (a.petitionerAttId?._id ?? a.petitionerAttId)?.toString();
        const legalAssistantId = (a.legalAssistantId?._id ?? a.legalAssistantId)?.toString();
        const otherPartyId = attorneyId ?? legalAssistantId;
        if (!petitionerId || !otherPartyId) continue;

        const [petitionerUser, otherUser] = await Promise.all([
          User.findById(petitionerId).select({ email: 1, firstName: 1, lastName: 1 }).lean<any>(),
          User.findById(otherPartyId).select({ email: 1, firstName: 1, lastName: 1 }).lean<any>(),
        ]);

        const petitionerName =
          petitionerUser &&
          [petitionerUser.firstName, petitionerUser.lastName].filter(Boolean).join(' ');
        const otherName =
          otherUser &&
          [otherUser.firstName, otherUser.lastName].filter(Boolean).join(' ');

        if (petitionerUser?.email && !petitionerUser.email.includes('@placeholder')) {
          await sendAppointmentReminder({
            to: petitionerUser.email,
            scheduledAt: a.scheduledAt,
            otherPartyName: otherName || undefined,
            appUrl,
          });
        }
        if (otherUser?.email && !otherUser.email.includes('@placeholder')) {
          await sendAppointmentReminder({
            to: otherUser.email,
            scheduledAt: a.scheduledAt,
            otherPartyName: petitionerName || undefined,
            appUrl,
          });
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[appointment-reminder] Job failed:', err);
    }
  });
}
