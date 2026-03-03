# Testing the session expiry popup

The app uses **idle-based** session timeout: the user is logged out after a period of **inactivity** (no clicks, keystrokes, navigation, or API requests). The "Session expiring" modal appears shortly before the idle timeout so the user can choose "Stay logged in" or "Log out".

To see the popup quickly without waiting the default 15 minutes:

## 1. Client: session-test configuration

Run the client with the session-test config (25s idle timeout, warning at 15s, check every 2s):

```bash
cd client
npm start -- --configuration=session-test
```

Or with `ng serve`:

```bash
ng serve --configuration=session-test
```

**No server change is required** for this test; the timeout is driven by client-side idle detection.

## 2. Manual flow

1. Open the app (e.g. http://localhost:4200).
2. **Log in.**
3. Go to **Profile** (or any authenticated page).
4. **Do not click, type, or navigate** — stay idle.
5. After about **10 seconds** of inactivity, the **"Session expiring"** modal should appear with a countdown (e.g. 15, 14, 13…).
6. Try **"Stay logged in"** (resets the idle timer and refreshes the token) or **"Log out"**, or let the countdown reach 0 to be logged out.

## Environment options (client)

In `src/environments/environment*.ts`:

| Option | Description | Default |
|--------|-------------|---------|
| `sessionIdleTimeoutMs` | Idle timeout in ms before session expires. | `15 * 60 * 1000` (15 min) |
| `sessionIdleWarningSec` | Seconds before idle timeout to show the modal (countdown length). | `120` |
| `sessionCheckIntervalMs` | How often to check idle time when logged in. | `30_000` |

Activity (clicks, keydown, navigation, API requests) resets the idle timer.

## Alternative: edit dev environment

Instead of using `session-test`, you can temporarily change **`src/environments/environment.development.ts`**:

- `sessionIdleTimeoutMs: 25_000`
- `sessionIdleWarningSec: 15`
- `sessionCheckIntervalMs: 2000`

Then run the client with the normal dev config.

## Restore normal behavior

Run the client without `--configuration=session-test` (or revert any temporary environment values). Default is 15 minutes of inactivity before the warning, with a 2-minute countdown.
