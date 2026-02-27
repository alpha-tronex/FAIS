import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AppointmentModel, CaseModel, User } from '../models.js';
import { toUserSummaryDTO } from '../mappers/user.mapper.js';
import { sendError } from './error.js';
import type { AuthMiddlewares, AuthPayload } from './middleware.js';
import { sendAppointmentInvite } from '../services/invite-email.service.js';

const appointmentCreateSchema = z.object({
  caseId: z.string().min(1),
  petitionerId: z.string().min(1),
  petitionerAttId: z.string().optional(),
  legalAssistantId: z.string().optional(),
  scheduledAt: z.string().min(1),
  notes: z.string().max(500).optional(),
});

const appointmentUpdateSchema = z.object({
  status: z.enum(['pending', 'accepted', 'rejected', 'cancelled', 'reschedule_requested']),
});

const appointmentRescheduleSchema = z.object({
  scheduledAt: z.string().min(1),
  notes: z.string().max(500).optional(),
  resendInvites: z.boolean().optional(),
});

function parseObjectId(value: string, fieldName: string): mongoose.Types.ObjectId {
  if (!value || !mongoose.isValidObjectId(value)) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return new mongoose.Types.ObjectId(value);
}

function toUserSummary(u: any): { id: string; uname: string; firstName?: string; lastName?: string } {
  return toUserSummaryDTO(u);
}

export function createAppointmentsRouter(
  auth: Pick<AuthMiddlewares, 'requireAuth'>
): express.Router {
  const router = express.Router();

  router.get('/appointments/pending-actions-count', auth.requireAuth, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const rawRole = authPayload.roleTypeId;
    const roleTypeId = typeof rawRole === 'string' ? Number(rawRole) : rawRole;
    const userId = authPayload.sub;

    if (roleTypeId !== 1 && roleTypeId !== 3 && roleTypeId !== 5 && roleTypeId !== 6) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const filter: Record<string, unknown> = {};
    if (roleTypeId === 1) {
      filter.petitionerId = new mongoose.Types.ObjectId(userId);
      filter.status = 'pending';
    } else if (roleTypeId === 3) {
      filter.petitionerAttId = new mongoose.Types.ObjectId(userId);
      filter.status = 'reschedule_requested';
    } else if (roleTypeId === 6) {
      filter.legalAssistantId = new mongoose.Types.ObjectId(userId);
      filter.status = 'reschedule_requested';
    } else {
      filter.status = 'reschedule_requested';
    }

    const count = await AppointmentModel.countDocuments(filter);
    res.json({ count });
  });

  router.get('/appointments', auth.requireAuth, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const roleTypeId = authPayload.roleTypeId;
    const userId = authPayload.sub;

    // Petitioner (1), petitioner attorney (3), legal assistant (6), and admin (5) can list appointments.
    if (roleTypeId !== 1 && roleTypeId !== 3 && roleTypeId !== 5 && roleTypeId !== 6) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const queryCaseId = String((req.query?.caseId ?? '') as string).trim();
    const filter: Record<string, unknown> = {};

    if (roleTypeId === 1) {
      filter.petitionerId = new mongoose.Types.ObjectId(userId);
    } else if (roleTypeId === 3) {
      filter.petitionerAttId = new mongoose.Types.ObjectId(userId);
    } else if (roleTypeId === 6) {
      filter.legalAssistantId = new mongoose.Types.ObjectId(userId);
    } else {
      // Admin: optional filter by caseId
      if (queryCaseId && mongoose.isValidObjectId(queryCaseId)) {
        filter.caseId = new mongoose.Types.ObjectId(queryCaseId);
      }
    }

    const appointments = await AppointmentModel.find(filter)
      .sort({ scheduledAt: 1, _id: 1 })
      .lean<any[]>();

    const caseIds = [...new Set(appointments.map((a) => (a.caseId?._id ?? a.caseId)?.toString()).filter(Boolean))];
    const userIds = new Set<string>();
    for (const a of appointments) {
      const pid = (a.petitionerId?._id ?? a.petitionerId)?.toString();
      const paid = (a.petitionerAttId?._id ?? a.petitionerAttId)?.toString();
      const laid = (a.legalAssistantId?._id ?? a.legalAssistantId)?.toString();
      if (pid) userIds.add(pid);
      if (paid) userIds.add(paid);
      if (laid) userIds.add(laid);
    }

    const [cases, users] = await Promise.all([
      caseIds.length > 0
        ? CaseModel.find({ _id: { $in: caseIds.map((id) => new mongoose.Types.ObjectId(id)) } })
            .select({ caseNumber: 1 })
            .lean<any[]>()
        : [],
      userIds.size > 0
        ? User.find({ _id: { $in: Array.from(userIds).map((id) => new mongoose.Types.ObjectId(id)) } })
            .select({ uname: 1, firstName: 1, lastName: 1 })
            .lean<any[]>()
        : [],
    ]);

    const caseById = new Map(cases.map((c: any) => [c._id.toString(), c]));
    const userById = new Map(users.map((u: any) => [u._id.toString(), u]));

    res.json(
      appointments.map((a: any) => {
        const cid = (a.caseId?._id ?? a.caseId)?.toString();
        const pid = (a.petitionerId?._id ?? a.petitionerId)?.toString();
        const paid = (a.petitionerAttId?._id ?? a.petitionerAttId)?.toString();
        const laid = (a.legalAssistantId?._id ?? a.legalAssistantId)?.toString();
        return {
          id: a._id.toString(),
          caseId: cid ?? null,
          caseNumber: cid && caseById.has(cid) ? (caseById.get(cid) as any).caseNumber : null,
          petitionerId: pid ?? null,
          petitioner: pid && userById.has(pid) ? toUserSummary(userById.get(pid)) : null,
          petitionerAttId: paid ?? null,
          petitionerAttorney: paid && userById.has(paid) ? toUserSummary(userById.get(paid)) : null,
          legalAssistantId: laid ?? null,
          legalAssistant: laid && userById.has(laid) ? toUserSummary(userById.get(laid)) : null,
          scheduledAt: a.scheduledAt ?? null,
          notes: a.notes ?? null,
          status: a.status ?? 'pending',
          createdAt: a.createdAt ?? null,
        };
      })
    );
  });

  router.post('/appointments', auth.requireAuth, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const roleTypeId = authPayload.roleTypeId;

    if (roleTypeId !== 3 && roleTypeId !== 5 && roleTypeId !== 6) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const parsed = appointmentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    }

    const hasAtt = typeof parsed.data.petitionerAttId === 'string' && parsed.data.petitionerAttId.trim().length > 0;
    const hasLA = typeof parsed.data.legalAssistantId === 'string' && parsed.data.legalAssistantId.trim().length > 0;
    if (hasAtt === hasLA) {
      return res.status(400).json({ error: 'Provide exactly one of petitionerAttId or legalAssistantId' });
    }

    let caseId: mongoose.Types.ObjectId;
    let petitionerId: mongoose.Types.ObjectId;
    let petitionerAttId: mongoose.Types.ObjectId | undefined;
    let legalAssistantId: mongoose.Types.ObjectId | undefined;
    try {
      caseId = parseObjectId(parsed.data.caseId, 'caseId');
      petitionerId = parseObjectId(parsed.data.petitionerId, 'petitionerId');
      if (hasAtt && parsed.data.petitionerAttId) {
        petitionerAttId = parseObjectId(parsed.data.petitionerAttId, 'petitionerAttId');
      } else if (hasLA && parsed.data.legalAssistantId) {
        legalAssistantId = parseObjectId(parsed.data.legalAssistantId, 'legalAssistantId');
      }
    } catch (e) {
      return sendError(res, e, 400);
    }

    const caseDoc = await CaseModel.findById(caseId).lean<any>();
    if (!caseDoc) {
      return res.status(400).json({ error: 'Case not found' });
    }

    const casePetitionerId = (caseDoc.petitionerId?._id ?? caseDoc.petitionerId)?.toString();
    const casePetitionerAttId = (caseDoc.petitionerAttId?._id ?? caseDoc.petitionerAttId)?.toString();
    const caseLegalAssistantId = (caseDoc.legalAssistantId?._id ?? caseDoc.legalAssistantId)?.toString();
    if (casePetitionerId !== petitionerId.toString()) {
      return res.status(400).json({ error: 'Petitioner is not on this case' });
    }
    if (petitionerAttId) {
      if (casePetitionerAttId !== petitionerAttId.toString()) {
        return res.status(400).json({ error: 'Petitioner attorney is not on this case' });
      }
      if (roleTypeId === 3 && casePetitionerAttId !== authPayload.sub) {
        return res.status(403).json({ error: 'You can only create appointments for cases where you are the petitioner attorney' });
      }
    } else if (legalAssistantId) {
      if (caseLegalAssistantId !== legalAssistantId.toString()) {
        return res.status(400).json({ error: 'Legal assistant is not on this case' });
      }
      if (roleTypeId === 6 && caseLegalAssistantId !== authPayload.sub) {
        return res.status(403).json({ error: 'You can only create appointments for cases where you are the legal assistant' });
      }
    }

    const scheduledAt = new Date(parsed.data.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      return res.status(400).json({ error: 'Invalid scheduledAt' });
    }

    const created = await AppointmentModel.create({
      caseId,
      petitionerId,
      petitionerAttId: petitionerAttId ?? undefined,
      legalAssistantId: legalAssistantId ?? undefined,
      scheduledAt,
      notes: parsed.data.notes?.trim() || undefined,
      status: 'pending',
      createdBy: new mongoose.Types.ObjectId(authPayload.sub),
    });

    const otherPartyId = petitionerAttId?.toString() ?? legalAssistantId?.toString();
    let emailSent = true;
    try {
      const [petitionerUser, otherUser] = await Promise.all([
        User.findById(petitionerId).select({ email: 1, firstName: 1, lastName: 1 }).lean<any>(),
        otherPartyId ? User.findById(otherPartyId).select({ email: 1, firstName: 1, lastName: 1 }).lean<any>() : null,
      ]);
      const appUrl = process.env.APP_BASE_URL?.trim() || 'http://localhost:4200';
      const petitionerName = petitionerUser
        ? [petitionerUser.firstName, petitionerUser.lastName].filter(Boolean).join(' ') || petitionerUser.uname
        : 'Petitioner';
      const attorneyName = otherUser
        ? [otherUser.firstName, otherUser.lastName].filter(Boolean).join(' ') || otherUser.uname
        : petitionerAttId ? 'Attorney' : 'Legal Assistant';
      const caseNumber = caseDoc.caseNumber ?? '';

      if (petitionerUser?.email && !petitionerUser.email.includes('@placeholder')) {
        await sendAppointmentInvite({
          to: petitionerUser.email,
          petitionerName,
          attorneyName,
          scheduledAt: created.scheduledAt,
          appUrl,
          caseNumber,
        });
      }
      if (otherUser?.email && !otherUser.email.includes('@placeholder')) {
        await sendAppointmentInvite({
          to: otherUser.email,
          petitionerName,
          attorneyName,
          scheduledAt: created.scheduledAt,
          appUrl,
          caseNumber,
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[appointments] Failed to send invite emails:', err);
      emailSent = false;
    }

    res.status(201).json({
      id: created._id.toString(),
      emailSent,
    });
  });

  router.patch('/appointments/:id', auth.requireAuth, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const roleTypeId = authPayload.roleTypeId;
    const userId = authPayload.sub;

    if (roleTypeId !== 1 && roleTypeId !== 3 && roleTypeId !== 5 && roleTypeId !== 6) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const appointmentId = req.params.id;
    if (!mongoose.isValidObjectId(appointmentId)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const appointment = await AppointmentModel.findById(appointmentId).lean<any>();
    if (!appointment) {
      return res.status(404).json({ error: 'Not found' });
    }

    const petitionerAttIdStr = (appointment.petitionerAttId?._id ?? appointment.petitionerAttId)?.toString();
    const legalAssistantIdStr = (appointment.legalAssistantId?._id ?? appointment.legalAssistantId)?.toString();
    const currentStatus = (appointment.status as string) ?? 'pending';

    // Reschedule path: body has scheduledAt, status is reschedule_requested, caller is admin or initiator
    if (typeof (req.body as any)?.scheduledAt === 'string' && (req.body as any).scheduledAt.trim().length > 0) {
      const rescheduleParsed = appointmentRescheduleSchema.safeParse(req.body);
      if (!rescheduleParsed.success) {
        return res.status(400).json({ error: 'Invalid payload', details: rescheduleParsed.error.flatten() });
      }
      if (currentStatus !== 'reschedule_requested') {
        return res.status(400).json({ error: 'Only appointments with reschedule requested can be rescheduled' });
      }
      const isAdmin = roleTypeId === 5;
      const isInitiator =
        (roleTypeId === 3 && petitionerAttIdStr === userId) || (roleTypeId === 6 && legalAssistantIdStr === userId);
      if (!isAdmin && !isInitiator) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const scheduledAt = new Date(rescheduleParsed.data.scheduledAt);
      if (Number.isNaN(scheduledAt.getTime())) {
        return res.status(400).json({ error: 'Invalid scheduledAt' });
      }
      const update: Record<string, unknown> = {
        scheduledAt,
        status: 'pending',
      };
      if (rescheduleParsed.data.notes !== undefined) {
        update.notes = rescheduleParsed.data.notes?.trim() || undefined;
      }
      await AppointmentModel.findByIdAndUpdate(appointmentId, { $set: update });

      let emailSent = false;
      if (rescheduleParsed.data.resendInvites) {
        try {
          const petitionerId = (appointment.petitionerId?._id ?? appointment.petitionerId)?.toString();
          const otherPartyId = petitionerAttIdStr ?? legalAssistantIdStr;
          const caseDoc = await CaseModel.findById(appointment.caseId).lean<any>();
          const appUrl = process.env.APP_BASE_URL?.trim() || 'http://localhost:4200';
          const caseNumber = caseDoc?.caseNumber ?? '';
          const [petitionerUser, otherUser] = await Promise.all([
            User.findById(petitionerId).select({ email: 1, firstName: 1, lastName: 1 }).lean<any>(),
            otherPartyId ? User.findById(otherPartyId).select({ email: 1, firstName: 1, lastName: 1 }).lean<any>() : null,
          ]);
          const petitionerName = petitionerUser
            ? [petitionerUser.firstName, petitionerUser.lastName].filter(Boolean).join(' ') || petitionerUser.uname
            : 'Petitioner';
          const attorneyName = otherUser
            ? [otherUser.firstName, otherUser.lastName].filter(Boolean).join(' ') || otherUser.uname
            : 'Attorney';
          if (petitionerUser?.email && !petitionerUser.email.includes('@placeholder')) {
            await sendAppointmentInvite({
              to: petitionerUser.email,
              petitionerName,
              attorneyName,
              scheduledAt,
              appUrl,
              caseNumber,
            });
          }
          if (otherUser?.email && !otherUser.email.includes('@placeholder')) {
            await sendAppointmentInvite({
              to: otherUser.email,
              petitionerName,
              attorneyName,
              scheduledAt,
              appUrl,
              caseNumber,
            });
          }
          emailSent = true;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[appointments] Reschedule invite emails failed:', err);
        }
      }
      return res.json({ ok: true, emailSent });
    }

    const parsed = appointmentUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const petitionerIdStr = (appointment.petitionerId?._id ?? appointment.petitionerId)?.toString();
    const newStatus = parsed.data.status;

    if (roleTypeId === 1) {
      if (petitionerIdStr !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (currentStatus === 'pending') {
        if (newStatus !== 'accepted' && newStatus !== 'rejected' && newStatus !== 'reschedule_requested') {
          return res.status(400).json({ error: 'When an appointment is pending, you may only accept, reject, or request reschedule' });
        }
      } else if (currentStatus === 'accepted') {
        if (newStatus !== 'cancelled' && newStatus !== 'reschedule_requested') {
          return res.status(400).json({ error: 'Once accepted, you may only cancel or request reschedule' });
        }
      } else {
        return res.status(400).json({ error: 'Cannot change status once rejected, cancelled, or reschedule requested' });
      }
    } else {
      // Attorney or admin: may only cancel
      if (newStatus !== 'cancelled') {
        return res.status(400).json({ error: 'Only the petitioner can accept or reject; you may cancel the appointment' });
      }
      if (roleTypeId === 3 && petitionerAttIdStr !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (roleTypeId === 6 && legalAssistantIdStr !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    await AppointmentModel.findByIdAndUpdate(appointmentId, { $set: { status: newStatus } });

    res.json({ ok: true });
  });

  return router;
}
