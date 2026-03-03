export const environment = {
  production: false,
  theme: 'style_fiori' as const,
  /** Same-origin /api; dev server proxy forwards to backend (3001) */
  apiUrl: '/api',
  sessionIdleTimeoutMs: 15 * 60 * 1000,
  sessionIdleWarningSec: 120,
  sessionCheckIntervalMs: 30_000
};
