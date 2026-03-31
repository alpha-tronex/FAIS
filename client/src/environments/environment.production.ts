export const environment = {
  production: true,
  theme: 'style_fas' as const,
  apiUrl: '/api', // same origin; set to full API URL if backend is on another host
  /** Idle timeout (ms) before session expires due to inactivity. Default 15 min. */
  sessionIdleTimeoutMs: 15 * 60 * 1000,
  /** Seconds before idle timeout to show "Session expiring" modal. Override as needed. */
  sessionIdleWarningSec: 120,
  /** Interval (ms) to check idle time when logged in. */
  sessionCheckIntervalMs: 30_000
};
