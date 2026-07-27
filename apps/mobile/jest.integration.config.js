// Integration suite: node environment (no React Native runtime), real local
// Supabase stack + Mailpit. Run via `npm run test:integration` with
// `npx supabase start` (full stack) up; the CI db job runs it after pgTAP.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/integration/**/*.integration.test.ts'],
  // babel-jest with the project's RN babel preset handles the TypeScript.
  transform: {
    '^.+\\.(js|ts|tsx)$': 'babel-jest',
  },
  // supabase-js's Realtime client (session-channel.integration.test.ts)
  // keeps a WebSocket/heartbeat timer alive past test completion even
  // after removeChannel() — a known supabase-js Node quirk, not a leak in
  // this repo's code. Without this, CI would hang waiting for a handle
  // that was never going to close on its own.
  forceExit: true,
};
