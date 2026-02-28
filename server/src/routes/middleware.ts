import type express from 'express';
import jwt from 'jsonwebtoken';
import { sendErrorWithMessage } from './error.js';

export type AuthPayload = {
  sub: string;
  roleTypeId: number;
  uname: string;
};

export type AuthMiddlewares = {
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => void;
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => void;
  requireStaffOrAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => void;
  requireReportAccess: (req: express.Request, res: express.Response, next: express.NextFunction) => void;
};

function getBearerToken(req: express.Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

export function createAuthMiddlewares(jwtSecret: string): AuthMiddlewares {
  function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const token = getBearerToken(req);
    if (!token) return sendErrorWithMessage(res, 'Missing token', 401);

    try {
      const payload = jwt.verify(token, jwtSecret) as AuthPayload;
      (req as any).auth = payload;
      next();
    } catch {
      return sendErrorWithMessage(res, 'Invalid token', 401);
    }
  }

  function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    const auth = (req as any).auth as AuthPayload | undefined;
    if (auth?.roleTypeId === 5) return next();
    return sendErrorWithMessage(res, 'Forbidden', 403);
  }

  // Under the simplified role model, the only elevated role is Administrator (5).
  function requireStaffOrAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    return requireAdmin(req, res, next);
  }

  /** Petitioner Attorney (3) or Administrator (5) may access report endpoints. */
  function requireReportAccess(req: express.Request, res: express.Response, next: express.NextFunction) {
    const auth = (req as any).auth as AuthPayload | undefined;
    if (auth?.roleTypeId === 3 || auth?.roleTypeId === 5) return next();
    return sendErrorWithMessage(res, 'Forbidden', 403);
  }

  return { requireAuth, requireAdmin, requireStaffOrAdmin, requireReportAccess };
}
