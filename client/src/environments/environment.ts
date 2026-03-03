export const environment = {
  production: false,
  theme: 'style_fiori' as const,
  apiUrl: '/api',
  /** Idle timeout (ms) before session expires due to inactivity. Default 15 min. */
  sessionIdleTimeoutMs: 15 * 60 * 1000,
  /** Seconds before idle timeout to show "Session expiring" modal (countdown length). Default 120. */
  sessionIdleWarningSec: 120,
  /** Interval (ms) to check idle time when logged in. Default 30_000. */
  sessionCheckIntervalMs: 30_000
};
