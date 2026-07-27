/** @type {import('jest').Config} */
// Integration suite: real local Supabase stack. Run via
// `npm run test:integration` with `npx supabase start` up; the CI db job
// runs it after pgTAP (same split as apps/mobile's jest.integration.config.js).
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/integration/**/*.integration.test.ts'],
  // supabase-js's Realtime client (session-sweep.integration.test.ts)
  // keeps a WebSocket/heartbeat timer alive past test completion even
  // after removeChannel() — a known supabase-js Node quirk (same one
  // apps/mobile/jest.integration.config.js already works around), not a
  // leak in this repo's code. Without this, the run hangs waiting for a
  // handle that was never going to close on its own.
  forceExit: true,
};
