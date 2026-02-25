/**
 * Use this only for testing the session-expiry popup.
 * Run: ng serve --configuration=session-test
 * And start the server with: JWT_EXPIRES_IN=25s npm start
 * Then: login → Profile → wait ~15 seconds → popup appears with countdown.
 */
export const environment = {
  production: false,
  theme: 'b' as const,
  apiUrl: '/api',
  sessionWarningBeforeExpirySec: 15,
  sessionCheckIntervalMs: 2000
};
