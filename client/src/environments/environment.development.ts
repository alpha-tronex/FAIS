export const environment = {
  production: false,
  theme: 'style_fiori' as const,
  /** Point directly at backend so API calls get JSON even if proxy isn't used; backend must run on 3001 */
  apiUrl: 'http://localhost:3001/api',
  sessionIdleTimeoutMs: 15 * 60 * 1000,
  sessionIdleWarningSec: 120,
  sessionCheckIntervalMs: 30_000
};
