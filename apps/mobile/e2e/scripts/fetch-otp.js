#!/usr/bin/env node
// Phase 7 (Release Prep) E2E helper: reads the 6-digit email-OTP code sent
// to a test address from Mailpit's HTTP API, so a Maestro flow can be fed
// the real code via an -e env var between two `maestro test` invocations
// (Maestro flows are static YAML with no HTTP capability of their own to
// fetch it themselves). Mirrors
// apps/mobile/integration/email-otp-flow.integration.test.ts's
// readOtpFromMailpit() exactly -- same polling shape, same local-only
// target (Mailpit only exists against the LOCAL/staging Supabase stack,
// never production).
//
// Usage: node fetch-otp.js <email> — prints the 6-digit code to stdout,
// nothing else, so a shell script can do OTP_CODE=$(node fetch-otp.js ...).

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}`);
  }
  return response.json();
};

const readOtpFromMailpit = async (email) => {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const list = await fetchJson(`${MAILPIT_URL}/api/v1/messages`);
    const match = list.messages.find((message) =>
      message.To.some((to) => to.Address.toLowerCase() === email.toLowerCase()),
    );
    if (match !== undefined) {
      const detail = await fetchJson(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
      const codeMatch = /\b(\d{6})\b/.exec(detail.Text);
      if (codeMatch !== null) {
        return codeMatch[1];
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`No OTP email arrived for ${email} within ${(POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
};

const email = process.argv[2];
if (email === undefined || email.length === 0) {
  console.error('Usage: node fetch-otp.js <email>');
  process.exit(1);
}

readOtpFromMailpit(email)
  .then((code) => {
    process.stdout.write(code);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
