/** @type {import('jest').Config} */
// Integration suite: real local Supabase stack. Run via
// `npm run test:integration` with `npx supabase start` up; the CI db job
// runs it after pgTAP (same split as apps/mobile's jest.integration.config.js).
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/integration/**/*.integration.test.ts'],
};
