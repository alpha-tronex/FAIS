/**
 * Use this only for testing the session-expiry popup (idle-based).
 * Run: ng serve --configuration=session-test
 * Then: login → do not touch the page → after ~15s idle the popup appears with countdown.
 */
export const environment = {
  production: false,
  theme: 'style_fas' as const,
  apiUrl: '/api',
  sessionIdleTimeoutMs: 25_000,
  sessionIdleWarningSec: 15,
  sessionCheckIntervalMs: 2000
};
