# Testing the session expiry popup

To see the “Session expiring” popup after about **15 seconds** instead of waiting for the real token expiry:

## 1. Server: short-lived token

Start the API with a 25-second token (so the warning can show when ~15 seconds are left):

```bash
cd server
JWT_EXPIRES_IN=25s npm start
```

(Or add `JWT_EXPIRES_IN=25s` to your `.env`. Use the `s` suffix for seconds.)

## 2. Client: session-test configuration

Run the client with the session-test config (warning at 15s, check every 2s):

```bash
cd client
npm start -- --configuration=session-test
```

Or with `ng serve`:

```bash
ng serve --configuration=session-test
```

## 3. Manual flow

1. Open the app (e.g. http://localhost:4200).
2. **Log in.**
3. Go to **Profile** (or any authenticated page).
4. Wait **about 15 seconds** (no need to click).
5. The **“Session expiring”** modal should appear with a countdown (e.g. 15, 14, 13…).
6. Try **“Stay logged in”** (new token) or **“Log out”**, or let the countdown reach 0 to be logged out.

## Alternative: edit dev environment

Instead of using `session-test`, you can temporarily change **`src/environments/environment.development.ts`**:

- `sessionWarningBeforeExpirySec: 15`
- `sessionCheckIntervalMs: 2000`

Then run the client with the normal dev config and the server with `JWT_EXPIRES_IN=25s` as above.

## Restore normal behavior

- Server: omit `JWT_EXPIRES_IN` or set it to `15m` (default).
- Client: run without `--configuration=session-test` (or revert the dev environment values).
