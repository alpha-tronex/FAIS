import express from 'express';
import mongoose from 'mongoose';
import OpenAI from 'openai';
import { z } from 'zod';
import { AppointmentModel, CaseModel, User } from '../models.js';
import { toUserSummaryDTO } from '../mappers/user.mapper.js';
import { sendError } from './error.js';
import type { AuthMiddlewares, AuthPayload } from './middleware.js';
import { sendAppointmentInvite } from '../services/invite-email.service.js';
import { getOpenAIClient } from '../lib/openai.js';
import { resolveUsername } from '../lib/user-resolve.js';

const appointmentCreateSchema = z.object({
  caseId: z.string().min(1),
  petitionerId: z.string().min(1),
  petitionerAttId: z.string().optional(),
  legalAssistantId: z.string().optional(),
  scheduledAt: z.string().min(1),
  durationMinutes: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]).optional(),
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

const scheduleFromPromptSchema = z.object({
  prompt: z.string().min(1),
});

const SCHEDULE_FROM_PROMPT_SYSTEM = `You must output only valid JSON with these keys: petitionerUsername, attorneyUsername, legalAssistantUsername, scheduledAt, durationMinutes.
- petitionerUsername: string, the username (uname) of the petitioner to schedule (the "user" in "schedule user X").
- attorneyUsername: string or null. If the appointment is with a petitioner attorney, set this to their username; otherwise null.
- legalAssistantUsername: string or null. If the appointment is with a legal assistant, set this to their username; otherwise null. Exactly one of attorneyUsername or legalAssistantUsername must be non-null.
- scheduledAt: string, ISO 8601 datetime for the start of the appointment (e.g. "2026-03-03T13:00:00" for 1 PM). Infer from phrases like "3/3/2026 1PM", "March 3 2026 from 1PM to 2PM", "1:00 PM on 3/3/2026". Use a 24-hour or ISO format that JavaScript Date can parse.
- durationMinutes: number, one of 15, 30, 45, or 60. Infer from "1PM to 2PM" as 60, "30 min" as 30; default 60 if not clear.
Output no other keys and no markdown or explanation.`;

type SchedulePromptParams = {
  petitionerUsername: string;
  attorneyUsername: string | null;
  legalAssistantUsername: string | null;
  scheduledAt: string;
  durationMinutes: number;
};

function parseSchedulePromptResponse(text: string): SchedulePromptParams | null {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const petitionerUsername = typeof obj.petitionerUsername === 'string' && obj.petitionerUsername.trim() ? obj.petitionerUsername.trim() : '';
    const attorneyUsername = typeof obj.attorneyUsername === 'string' && obj.attorneyUsername.trim() ? obj.attorneyUsername.trim() : null;
    const legalAssistantUsername = typeof obj.legalAssistantUsername === 'string' && obj.legalAssistantUsername.trim() ? obj.legalAssistantUsername.trim() : null;
    const scheduledAt = typeof obj.scheduledAt === 'string' && obj.scheduledAt.trim() ? obj.scheduledAt.trim() : '';
    let durationMinutes = typeof obj.durationMinutes === 'number' && [15, 30, 45, 60].includes(obj.durationMinutes) ? obj.durationMinutes : 60;
    if (![15, 30, 45, 60].includes(durationMinutes)) durationMinutes = 60;
    if (!petitionerUsername || !scheduledAt) return null;
    if (!attorneyUsername && !legalAssistantUsername) return null;
    if (attorneyUsername && legalAssistantUsername) return null;
    return { petitionerUsername, attorneyUsername, legalAssistantUsername, scheduledAt, durationMinutes };
  } catch {
    return null;
  }
}

async function callLLM(client: OpenAI, system: string, userPrompt: string): Promise<string> {
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 256,
  });
  const content = completion.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

function parseObjectId(value: string, fieldName: string): mongoose.Types.ObjectId {
  if (!value || !mongoose.isValidObjectId(value)) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return new mongoose.Types.ObjectId(value);
}

function toUserSummary(u: any): { id: string; uname: string; firstName?: string; lastName?: string } {
  return toUserSummaryDTO(u);
}

/** 6:00–22:00 in 15-min steps (HH:mm) for next-available search. */
const TIME_SLOTS_15: string[] = (() => {
  const out: string[] = [];
  for (let h = 6; h <= 22; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 22 && m > 0) break;
      out.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
    }
  }
  return out;
})();

function slotCount(durationMinutes: number): number {
  return Math.max(1, Math.min(4, Math.round(durationMinutes / 15)));
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

  router.get('/appointments/next-available', auth.requireAuth, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const roleTypeId = authPayload.roleTypeId;
    const userId = authPayload.sub;

    if (roleTypeId !== 3 && roleTypeId !== 5 && roleTypeId !== 6) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const queryPetitionerId = String((req.query?.petitionerId ?? '') as string).trim();
    const queryFrom = String((req.query?.from ?? '') as string).trim();
    const queryDuration = String((req.query?.durationMinutes ?? '15') as string).trim();
    const queryUserId = String((req.query?.userId ?? '') as string).trim();

    if (!queryPetitionerId || !mongoose.isValidObjectId(queryPetitionerId)) {
      return res.status(400).json({ error: 'petitionerId is required' });
    }

    const durationMinutes = Math.min(60, Math.max(15, parseInt(queryDuration, 10) || 15));
    if (![15, 30, 45, 60].includes(durationMinutes)) {
      return res.status(400).json({ error: 'durationMinutes must be 15, 30, 45, or 60' });
    }

    const count = slotCount(durationMinutes);

    let staffUserId: string;
    if (roleTypeId === 5 && queryUserId && mongoose.isValidObjectId(queryUserId)) {
      staffUserId = queryUserId;
    } else if (roleTypeId === 3 || roleTypeId === 6) {
      staffUserId = userId;
    } else {
      return res.status(400).json({ error: 'userId required when admin' });
    }

    let fromDate: Date;
    if (queryFrom && /^\d{4}-\d{2}-\d{2}$/.test(queryFrom)) {
      const [y, m, d] = queryFrom.split('-').map(Number);
      fromDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    } else {
      fromDate = new Date();
      fromDate.setUTCHours(0, 0, 0, 0);
    }

    const maxDays = 30;
    for (let dayOffset = 0; dayOffset < maxDays; dayOffset++) {
      const d = new Date(fromDate);
      d.setUTCDate(d.getUTCDate() + dayOffset);
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth();
      const day = d.getUTCDate();
      const startOfDay = new Date(Date.UTC(y, m, day, 0, 0, 0, 0));
      const endOfDay = new Date(Date.UTC(y, m, day + 1, 0, 0, 0, 0));
      const dateStr = `${y}-${(m + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

      const staffFilter = {
        $or: [
          { petitionerAttId: new mongoose.Types.ObjectId(staffUserId) },
          { legalAssistantId: new mongoose.Types.ObjectId(staffUserId) },
        ],
        status: { $ne: 'cancelled' },
        scheduledAt: { $gte: startOfDay, $lt: endOfDay },
      };
      const petitionerFilter = {
        petitionerId: new mongoose.Types.ObjectId(queryPetitionerId),
        status: { $ne: 'cancelled' },
        scheduledAt: { $gte: startOfDay, $lt: endOfDay },
      };

      const [staffAppointments, petitionerAppointments] = await Promise.all([
        AppointmentModel.find(staffFilter).select({ scheduledAt: 1, durationMinutes: 1 }).lean<any[]>(),
        AppointmentModel.find(petitionerFilter).select({ scheduledAt: 1, durationMinutes: 1 }).lean<any[]>(),
      ]);

      const busySet = new Set<string>();
      for (const a of [...staffAppointments, ...petitionerAppointments]) {
        const at = new Date(a.scheduledAt);
        let h = at.getUTCHours();
        let m = at.getUTCMinutes();
        const rounded = Math.round(m / 15) * 15;
        if (rounded === 60) {
          h += 1;
          m = 0;
        } else {
          m = rounded;
        }
        const slot = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        const dur = a.durationMinutes ?? 15;
        const n = slotCount(dur);
        const idx = TIME_SLOTS_15.indexOf(slot);
        if (idx === -1) continue;
        for (let i = 0; i < n && idx + i < TIME_SLOTS_15.length; i++) {
          busySet.add(TIME_SLOTS_15[idx + i]);
        }
      }

      for (let i = 0; i <= TIME_SLOTS_15.length - count; i++) {
        const candidate = TIME_SLOTS_15[i];
        let allFree = true;
        for (let j = 0; j < count; j++) {
          if (busySet.has(TIME_SLOTS_15[i + j])) {
            allFree = false;
            break;
          }
        }
        if (allFree) {
          return res.json({ date: dateStr, time: candidate });
        }
      }
    }

    return res.status(404).json({ error: 'No available slot found in the next 30 days' });
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
    const queryDate = String((req.query?.date ?? '') as string).trim();
    const queryUserId = String((req.query?.userId ?? '') as string).trim();
    const queryPetitionerId = String((req.query?.petitionerId ?? '') as string).trim();
    const filter: Record<string, unknown> = {};

    // When petitionerId is requested (by staff/admin), return that petitioner's appointments only (for availability: avoid double-booking the client).
    const requestingPetitionerSlots =
      (roleTypeId === 3 || roleTypeId === 5 || roleTypeId === 6) &&
      queryPetitionerId &&
      mongoose.isValidObjectId(queryPetitionerId);

    if (requestingPetitionerSlots) {
      filter.petitionerId = new mongoose.Types.ObjectId(queryPetitionerId);
    } else if (roleTypeId === 1) {
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
      // Admin: optional filter by userId (for availability: appointments for this attorney/LA)
      if (queryUserId && mongoose.isValidObjectId(queryUserId)) {
        filter.$or = [
          { petitionerAttId: new mongoose.Types.ObjectId(queryUserId) },
          { legalAssistantId: new mongoose.Types.ObjectId(queryUserId) },
        ];
      }
    }

    // Optional: restrict to appointments on a specific calendar day (UTC)
    if (queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
      const [y, m, d] = queryDate.split('-').map(Number);
      const startOfDay = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
      const endOfDay = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0, 0));
      filter.scheduledAt = { $gte: startOfDay, $lt: endOfDay };
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
          durationMinutes: a.durationMinutes ?? 15,
          notes: a.notes ?? null,
          status: a.status ?? 'pending',
          createdAt: a.createdAt ?? null,
        };
      })
    );
  });

  router.post('/appointments/schedule-from-prompt', auth.requireAuth, async (req, res) => {
    const authPayload = (req as any).auth as AuthPayload;
    const roleTypeId = authPayload.roleTypeId;

    if (roleTypeId !== 3 && roleTypeId !== 5 && roleTypeId !== 6) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const bodyParsed = scheduleFromPromptSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return res.status(400).json({ error: 'Prompt is required.', details: bodyParsed.error.flatten() });
    }
    const prompt = bodyParsed.data.prompt.trim();

    const client = getOpenAIClient();
    if (!client) {
      return res.status(503).json({ error: 'AI scheduling is not configured. Set OPENAI_API_KEY in server environment.' });
    }

    let params: SchedulePromptParams | null;
    try {
      const raw = await callLLM(client, SCHEDULE_FROM_PROMPT_SYSTEM, prompt);
      params = parseSchedulePromptResponse(raw);
      if (!params) {
        return res.status(400).json({
          error: 'Could not understand the request. Include petitioner username, attorney or legal assistant username, and date/time (e.g. "schedule user john with attorney jane on 3/3/2026 from 1PM to 2PM").',
        });
      }
    } catch (e) {
      const err = e as { status?: number };
      if (err?.status === 429 || err?.status === 402) {
        return res.status(err.status).json({
          error: 'AI quota exceeded. Check your OpenAI plan and billing.',
        });
      }
      return sendError(res, e);
    }

    const petitionerId = await resolveUsername(params.petitionerUsername);
    if (!petitionerId) {
      return res.status(400).json({ error: `User "${params.petitionerUsername}" not found.` });
    }
    const attorneyId = params.attorneyUsername ? await resolveUsername(params.attorneyUsername) : null;
    const legalAssistantId = params.legalAssistantUsername ? await resolveUsername(params.legalAssistantUsername) : null;
    if (params.attorneyUsername && !attorneyId) {
      return res.status(400).json({ error: `Attorney "${params.attorneyUsername}" not found.` });
    }
    if (params.legalAssistantUsername && !legalAssistantId) {
      return res.status(400).json({ error: `Legal assistant "${params.legalAssistantUsername}" not found.` });
    }

    if (roleTypeId === 3 && attorneyId && attorneyId !== authPayload.sub) {
      return res.status(403).json({ error: 'You can only schedule appointments with yourself as the attorney.' });
    }
    if (roleTypeId === 6 && legalAssistantId && legalAssistantId !== authPayload.sub) {
      return res.status(403).json({ error: 'You can only schedule appointments with yourself as the legal assistant.' });
    }

    const caseFilter: Record<string, unknown> = {
      petitionerId: new mongoose.Types.ObjectId(petitionerId),
    };
    if (attorneyId) caseFilter.petitionerAttId = new mongoose.Types.ObjectId(attorneyId);
    else if (legalAssistantId) caseFilter.legalAssistantId = new mongoose.Types.ObjectId(legalAssistantId);

    const cases = await CaseModel.find(caseFilter).limit(2).lean<any[]>();
    if (cases.length === 0) {
      return res.status(400).json({
        error: 'No case found for that petitioner and attorney/assistant. Check that the petitioner and attorney (or legal assistant) are assigned to the same case.',
      });
    }
    if (cases.length > 1) {
      return res.status(400).json({
        error: 'Multiple cases match. Please specify which case (e.g. by case number) or use the Schedule button to pick a case.',
      });
    }
    const caseDoc = cases[0];
    const caseId = caseDoc._id.toString();

    const scheduledAt = new Date(params.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      return res.status(400).json({ error: 'Invalid date or time. Use a format like 3/3/2026 1PM or March 3, 2026 at 1:00 PM.' });
    }
    const durationMinutes = [15, 30, 45, 60].includes(params.durationMinutes) ? params.durationMinutes : 60;

    const createPayload = {
      caseId,
      petitionerId,
      ...(attorneyId ? { petitionerAttId: attorneyId } : { legalAssistantId: legalAssistantId! }),
      scheduledAt: params.scheduledAt,
      durationMinutes,
    };

    const parsed = appointmentCreateSchema.safeParse(createPayload);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid scheduling parameters.', details: parsed.error.flatten() });
    }

    const hasAtt = typeof parsed.data.petitionerAttId === 'string' && parsed.data.petitionerAttId.trim().length > 0;
    const hasLA = typeof parsed.data.legalAssistantId === 'string' && parsed.data.legalAssistantId.trim().length > 0;
    let petitionerAttId: mongoose.Types.ObjectId | undefined;
    let laId: mongoose.Types.ObjectId | undefined;
    try {
      if (hasAtt && parsed.data.petitionerAttId) {
        petitionerAttId = parseObjectId(parsed.data.petitionerAttId, 'petitionerAttId');
      } else if (hasLA && parsed.data.legalAssistantId) {
        laId = parseObjectId(parsed.data.legalAssistantId, 'legalAssistantId');
      }
    } catch (e) {
      return sendError(res, e, 400);
    }

    const casePetitionerId = (caseDoc.petitionerId?._id ?? caseDoc.petitionerId)?.toString();
    const casePetitionerAttId = (caseDoc.petitionerAttId?._id ?? caseDoc.petitionerAttId)?.toString();
    const caseLegalAssistantId = (caseDoc.legalAssistantId?._id ?? caseDoc.legalAssistantId)?.toString();
    if (casePetitionerId !== petitionerId) {
      return res.status(400).json({ error: 'Petitioner is not on this case.' });
    }
    if (petitionerAttId) {
      if (casePetitionerAttId !== petitionerAttId.toString()) {
        return res.status(400).json({ error: 'Petitioner attorney is not on this case.' });
      }
      if (roleTypeId === 3 && casePetitionerAttId !== authPayload.sub) {
        return res.status(403).json({ error: 'You can only create appointments for cases where you are the petitioner attorney.' });
      }
    } else if (laId) {
      if (caseLegalAssistantId !== laId.toString()) {
        return res.status(400).json({ error: 'Legal assistant is not on this case.' });
      }
      if (roleTypeId === 6 && caseLegalAssistantId !== authPayload.sub) {
        return res.status(403).json({ error: 'You can only create appointments for cases where you are the legal assistant.' });
      }
    }

    const petitionerIdObj = parseObjectId(petitionerId, 'petitionerId');
    const created = await AppointmentModel.create({
      caseId: new mongoose.Types.ObjectId(caseId),
      petitionerId: petitionerIdObj,
      petitionerAttId: petitionerAttId ?? undefined,
      legalAssistantId: laId ?? undefined,
      scheduledAt,
      durationMinutes,
      notes: undefined,
      status: 'pending',
      createdBy: new mongoose.Types.ObjectId(authPayload.sub),
    });

    const otherPartyId = petitionerAttId?.toString() ?? laId?.toString();
    let emailSent = true;
    try {
      const [petitionerUser, otherUser] = await Promise.all([
        User.findById(petitionerIdObj).select({ email: 1, firstName: 1, lastName: 1 }).lean<any>(),
        otherPartyId ? User.findById(otherPartyId).select({ email: 1, firstName: 1, lastName: 1 }).lean<any>() : null,
      ]);
      const appUrl = process.env.APP_BASE_URL?.trim() || 'http://localhost:4200';
      const petitionerName = petitionerUser
        ? [petitionerUser.firstName, petitionerUser.lastName].filter(Boolean).join(' ') || (petitionerUser as any).uname
        : 'Petitioner';
      const attorneyName = otherUser
        ? [otherUser.firstName, otherUser.lastName].filter(Boolean).join(' ') || (otherUser as any).uname
        : petitionerAttId ? 'Attorney' : 'Legal Assistant';
      const caseNumber = caseDoc.caseNumber ?? '';

      if (petitionerUser?.email && !(petitionerUser as any).email?.includes?.('@placeholder')) {
        await sendAppointmentInvite({
          to: (petitionerUser as any).email,
          petitionerName,
          attorneyName,
          scheduledAt: created.scheduledAt,
          appUrl,
          caseNumber,
        });
      }
      if (otherUser?.email && !(otherUser as any).email?.includes?.('@placeholder')) {
        await sendAppointmentInvite({
          to: (otherUser as any).email,
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

    const durationMinutes = parsed.data.durationMinutes ?? 15;
    if (![15, 30, 45, 60].includes(durationMinutes)) {
      return res.status(400).json({ error: 'durationMinutes must be 15, 30, 45, or 60' });
    }

    const created = await AppointmentModel.create({
      caseId,
      petitionerId,
      petitionerAttId: petitionerAttId ?? undefined,
      legalAssistantId: legalAssistantId ?? undefined,
      scheduledAt,
      durationMinutes,
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
