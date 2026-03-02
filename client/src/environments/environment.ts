export const environment = {
  production: false,
  theme: 'style_fiori' as const,
  apiUrl: '/api',
  /** Seconds before token expiry to show "Session expiring" modal (countdown length). Default 120. */
  sessionWarningBeforeExpirySec: 120,
  /** Interval (ms) to check token expiry when logged in. Default 30_000. */
  sessionCheckIntervalMs: 30_000
};
