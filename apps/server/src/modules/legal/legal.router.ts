import { Router } from 'express';

import { PRIVACY_POLICY_TEXT, TERMS_OF_SERVICE_TEXT } from './legal-content';

// Public (no requireAuth): a user must be able to read these BEFORE
// signing up, and the mobile app's SettingsScreen/AuthScreen link here via
// a plain Linking.openURL — no bearer token to send. The one stable
// hosting URL the phase plan calls for is just "wherever the API is
// deployed" (Railway) — no separate marketing site/domain needed for
// placeholder content the owner is still going to revise.
export const createLegalRouter = (): Router => {
  const router = Router();

  router.get('/terms', (_req, res) => {
    res.type('text/plain; charset=utf-8').status(200).send(TERMS_OF_SERVICE_TEXT);
  });

  router.get('/privacy', (_req, res) => {
    res.type('text/plain; charset=utf-8').status(200).send(PRIVACY_POLICY_TEXT);
  });

  return router;
};
