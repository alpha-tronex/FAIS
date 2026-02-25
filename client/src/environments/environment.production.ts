export const environment = {
  production: true,
  theme: 'b' as const,
  apiUrl: '/api', // same origin; set to full API URL if backend is on another host
  /** Seconds before token expiry to show "Session expiring" modal. Override as needed. */
  sessionWarningBeforeExpirySec: 120,
  /** Interval (ms) to check token expiry when logged in. */
  sessionCheckIntervalMs: 30_000
};
