/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // integration/ hits the real local Supabase stack — run it explicitly via
  // `npm run test:integration` (jest.integration.config.js), never as part
  // of the default unit suite (same split as apps/mobile).
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/integration/'],
};
