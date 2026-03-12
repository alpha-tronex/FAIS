import express from 'express';
import { z } from 'zod';
import { sendDemoRequestEmail } from '../services/invite-email.service.js';

const demoRequestSchema = z.object({
  fullName: z.string().min(1).max(120),
  firmName: z.string().min(1).max(160),
  workEmail: z.string().email(),
  phone: z.string().max(50).optional(),
  firmSize: z.string().min(1).max(80),
  monthlyAffidavits: z.string().min(1).max(80),
  currentSoftware: z.string().max(200).optional(),
  biggestPain: z.string().min(1).max(1000),
  details: z.string().max(1500).optional()
});

export function createDemoRequestRouter(): express.Router {
  const router = express.Router();

  router.post('/demo-request', async (req, res) => {
    const parsed = demoRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Please complete the required demo request fields.' });
    }

    const data = {
      ...parsed.data,
      phone: parsed.data.phone?.trim() || undefined,
      currentSoftware: parsed.data.currentSoftware?.trim() || undefined,
      details: parsed.data.details?.trim() || undefined
    };

    try {
      await sendDemoRequestEmail(data);
      return res.json({ ok: true });
    } catch (err) {
      console.warn('[demo-request] Failed to send demo request email:', err);
      return res.status(500).json({ error: 'Unable to send demo request right now. Please try again.' });
    }
  });

  return router;
}
