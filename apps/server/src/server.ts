import dotenv from 'dotenv';

import { createApp } from './app';
import { loadEnv } from './config/env';

// Populates process.env from a local .env file (see .env.example) — a
// no-op if one isn't present, e.g. in CI, where the real env vars are set
// directly. Must run before loadEnv reads process.env below.
dotenv.config();

// The only place process.env is read directly — everything downstream
// receives the already-validated Env object (config/env.ts's fail-fast
// contract).
const env = loadEnv(process.env);

const app = createApp(env);

app.listen(env.PORT, () => {
  console.log(`Lockal Time API listening on port ${env.PORT}`);
});
