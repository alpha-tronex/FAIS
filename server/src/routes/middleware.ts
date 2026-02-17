import type express from 'express';
import jwt from 'jsonwebtoken';

export type AuthPayload = {
  sub: string;
  roleTypeId: number;
  uname: string;
};

export type AuthMiddlewares = {
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => void;
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => void;
  requireStaffOrAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => void;
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
    if (!token) return res.status(401).json({ error: 'Missing token' });

    try {
      const payload = jwt.verify(token, jwtSecret) as AuthPayload;
      (req as any).auth = payload;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    const auth = (req as any).auth as AuthPayload | undefined;
    if (auth?.roleTypeId === 5) return next();
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Under the simplified role model, the only elevated role is Administrator (5).
  function requireStaffOrAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    return requireAdmin(req, res, next);
  }

  return { requireAuth, requireAdmin, requireStaffOrAdmin };
}
