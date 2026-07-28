import { randomUUID } from 'crypto';

import { mintVenueQrToken } from './venue-qr-token';
import type { VenueRecord, VenuesStore } from './venues-store';

export interface CreateVenueInput {
  readonly ownerId: string;
  readonly name: string;
  readonly addressLabel: string | null;
}

// Money-equivalent logic (ARCHITECTURE.md §3/§7, .claude/skills/code-style/SKILL.md):
// mints the venue's printed QR token — the only place it's decided. Unlike
// a session's qr_token (qr-token.ts, QR_TOKEN_TTL_MINUTES, regenerated per
// session), a venue token has NO expiry by design: it's meant to be
// printed once and never reprinted (owner decision — see the plan's
// "Static QR" question). Regeneration (POST /venues/:id/qr/regenerate) is
// the only way to invalidate it, always a deliberate, confirmed action.
export const createVenue = async (
  store: VenuesStore,
  qrSigningSecret: string,
  input: CreateVenueInput,
): Promise<VenueRecord> => {
  const id = randomUUID();
  const qrToken = mintVenueQrToken(id, qrSigningSecret);

  return store.createVenue({
    id,
    ownerId: input.ownerId,
    name: input.name,
    addressLabel: input.addressLabel,
    qrToken,
  });
};
