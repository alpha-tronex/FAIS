import express from 'express';
import mongoose from 'mongoose';
import { ROLE_TYPES } from '../models.js';
import type { AuthMiddlewares } from './middleware.js';

export function createRoleTypesRouter(auth: Pick<AuthMiddlewares, 'requireAuth'>): express.Router {
  const router = express.Router();

  router.get('/role-types', auth.requireAuth, async (_req, res) => {
    // Prefer the DB collection if present; fall back to the in-code seed list.
    try {
      const rows = await mongoose
        .connection
        .collection('roletype')
        .find({})
        .project({ id: 1, name: 1 })
        .sort({ id: 1 })
        .toArray();

      const items = rows
        .map((r: any) => ({ id: Number(r?.id), name: String(r?.name ?? '').trim() }))
        .filter((x) => Number.isFinite(x.id) && x.id > 0 && x.name);

      if (items.length > 0) return res.json(items);
    } catch {
      // ignore
    }

    return res.json(ROLE_TYPES);
  });

  return router;
}
