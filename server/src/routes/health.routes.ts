import express from 'express';

export function createHealthRouter(): express.Router {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  return router;
}
