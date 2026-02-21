import type express from 'express';

/**
 * Send a uniform JSON error response. Uses error.status (if present) and error.message,
 * otherwise defaultStatus (or 500) and 'Failed'.
 */
export function sendError(res: express.Response, e: unknown, defaultStatus?: number): void {
  const err = e as { status?: number; message?: string };
  const status = err?.status ?? defaultStatus ?? 500;
  const message = err?.message ?? 'Failed';
  res.status(status).json({ error: message });
}

/** Send a JSON error response with an explicit message and status. */
export function sendErrorWithMessage(res: express.Response, message: string, status = 500): void {
  res.status(status).json({ error: message });
}
