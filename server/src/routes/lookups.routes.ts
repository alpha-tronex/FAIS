import express from 'express';
import mongoose from 'mongoose';
import type { AuthMiddlewares } from './middleware.js';

type LookupItem = { id: number; name: string; circuitId?: number; abbrev?: string };

export function createLookupsRouter(auth: Pick<AuthMiddlewares, 'requireAuth'>): express.Router {
  const router = express.Router();

  // Public: needed for self-registration.
  router.get('/lookups/states', async (_req, res) => {
    const rows = await mongoose
      .connection
      .collection('lookup_states')
      .find({})
      .project({ id: 1, name: 1, abbrev: 1 })
      .sort({ name: 1 })
      .toArray();

    const items: LookupItem[] = rows
      .map((r: any) => ({
        id: Number(r?.id),
        name: String(r?.name ?? '').trim(),
        abbrev: String(r?.abbrev ?? '').trim()
      }))
      .filter((x) => Number.isFinite(x.id) && x.id > 0 && x.name && x.abbrev);

    return res.json(items);
  });

  router.get('/lookups/:name', auth.requireAuth, async (req, res) => {
    const name = String(req.params.name || '').toLowerCase();

    const collectionByName: Record<string, string> = {
      divisions: 'lookup_divisions',
      circuits: 'lookup_circuits',
      counties: 'lookup_counties',
      states: 'lookup_states',
      'pay-frequency-types': 'lookup_pay_frequency_types',
      'monthly-income-types': 'lookup_monthly_income_types',
      'monthly-deduction-types': 'lookup_monthly_deduction_types',
      'monthly-household-expense-types': 'lookup_monthly_household_expense_types',
      'assets-types': 'lookup_assets_types',
      'liabilities-types': 'lookup_liabilities_types',
      'non-marital-types': 'lookup_non_marital_types'
    };

    const collectionName = collectionByName[name];
    if (!collectionName) return res.status(404).json({ error: 'Unknown lookup' });

    const rows = await mongoose
      .connection
      .collection(collectionName)
      .find({})
      .project({ id: 1, name: 1, circuitId: 1 })
      .sort({ id: 1 })
      .toArray();

    const items: LookupItem[] = rows
      .map((r: any) => ({ id: Number(r?.id), name: String(r?.name ?? '').trim() }))
      .filter((x) => Number.isFinite(x.id) && x.id > 0 && x.name);

    if (name === 'counties') {
      return res.json(
        items.map((x) => {
          const row = rows.find((r: any) => Number(r?.id) === x.id);
          const circuitId = Number((row as any)?.circuitId);
          return Number.isFinite(circuitId) ? { ...x, circuitId } : { ...x };
        })
      );
    }

    return res.json(items);
  });

  return router;
}
