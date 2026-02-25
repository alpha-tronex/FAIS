import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { User } from './models.js';
import { createAuthMiddlewares } from './routes/middleware.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createRoleTypesRouter } from './routes/role-types.routes.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createUsersRouter } from './routes/users.routes.js';
import { createCasesRouter } from './routes/cases.routes.js';
import { createLookupsRouter } from './routes/lookups.routes.js';
import { createAffidavitRouter } from './routes/affidavit.routes.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3001);
const MONGODB_URI = process.env.MONGODB_URI?.trim();
const JWT_SECRET = process.env.JWT_SECRET;
const SSN_ENCRYPTION_KEY_B64 = process.env.SSN_ENCRYPTION_KEY_B64;

if (!MONGODB_URI) {
  throw new Error('Missing MONGODB_URI');
}
if (!/^mongodb(\+srv)?:\/\//.test(MONGODB_URI)) {
  throw new Error(
    'MONGODB_URI must start with mongodb:// or mongodb+srv://. Check for extra spaces, newlines, or a wrong value in your environment.'
  );
}
if (!JWT_SECRET) {
  throw new Error('Missing JWT_SECRET');
}

if (!SSN_ENCRYPTION_KEY_B64) {
  // eslint-disable-next-line no-console
  console.warn(
    'WARNING: SSN_ENCRYPTION_KEY_B64 is not set. ' +
      'SSN registration/view/update will fail until configured. ' +
      'Generate one with: node -e \'console.log(require("crypto").randomBytes(32).toString("base64"))\''
  );
}

const mongoUri: string = MONGODB_URI;
const jwtSecret: string = JWT_SECRET;
/** JWT lifetime for login/refresh tokens (e.g. '15m', '1h'). Default 15m. */
const jwtExpiresIn = process.env.JWT_EXPIRES_IN?.trim() || '15m';

declare global {
  // eslint-disable-next-line no-var
  var __fais: never;
}

const app = express();

// API responses should not be cached by browsers/proxies.
// In particular, a 304 Not Modified can result in an empty body for XHR/fetch,
// which breaks JSON API consumers.
app.set('etag', false);
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.json());
app.use(
  cors({
    origin: true,
    credentials: true
  })
);

const { requireAuth, requireAdmin, requireStaffOrAdmin } = createAuthMiddlewares(jwtSecret);

// Mount all API routes under /api for production (client calls /api/...)
const apiRouter = express.Router();
apiRouter.use(createHealthRouter());
apiRouter.use(createRoleTypesRouter({ requireAuth }));
apiRouter.use(createAuthRouter({ jwtSecret, jwtExpiresIn, requireAuth }));
apiRouter.use(createUsersRouter({ requireAuth, requireAdmin }));
apiRouter.use(createCasesRouter({ requireAuth, requireStaffOrAdmin }));
apiRouter.use(createLookupsRouter({ requireAuth }));
apiRouter.use(createAffidavitRouter({ requireAuth }));
app.use('/api', apiRouter);

// Serve built Angular app when present (production: client build copied to server/dist/public)
const publicDir = path.join(__dirname, 'public');
const fs = await import('fs');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  // Express 5 / path-to-regexp v8 require named wildcard; {*splat} matches everything including /
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

async function main() {
  await mongoose.connect(mongoUri);

  // Best-effort startup checks to surface role data issues early.
  try {
    const legacyAdminCount = await User.countDocuments({ roleTypeId: 4, passwordHash: { $exists: true } });
    if (legacyAdminCount > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `WARNING: Detected ${legacyAdminCount} user(s) with roleTypeId=4. ` +
          `Run: npm run migrate:role:admin-4-to-5 (with correct MONGODB_URI).`
      );
    }

    const invalidRoleCount = await User.countDocuments({ roleTypeId: { $nin: [1, 2, 3, 4, 5] }, passwordHash: { $exists: true } });
    if (invalidRoleCount > 0) {
      // eslint-disable-next-line no-console
      console.warn(`WARNING: Detected ${invalidRoleCount} user(s) with invalid roleTypeId (expected 1-5).`);
    }
  } catch {
    // ignore
  }

  try {
    const roleTypeCount = await mongoose.connection.collection('roletype').countDocuments({});
    if (roleTypeCount === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `WARNING: Collection 'roletype' is empty or missing. ` +
          `Run: npm run migrate:seed:role-types (with correct MONGODB_URI).`
      );
    }
  } catch {
    // ignore
  }

  // Best-effort startup checks for normalized lookup seeds.
  try {
    const [divisions, circuits, counties] = await Promise.all([
      mongoose.connection.collection('lookup_divisions').countDocuments({}),
      mongoose.connection.collection('lookup_circuits').countDocuments({}),
      mongoose.connection.collection('lookup_counties').countDocuments({})
    ]);

    if (divisions === 0 || circuits === 0 || counties === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `WARNING: One or more lookup collections are empty (lookup_divisions=${divisions}, lookup_circuits=${circuits}, lookup_counties=${counties}). ` +
          `Run: npm run migrate:seed:lookups (with correct MONGODB_URI).`
      );
    }
  } catch {
    // ignore
  }

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
