import { useEffect, useRef, useState } from 'react';

// ARCHITECTURE.md §6: "Only the newly-promoted host gets a small, calm,
// few-second toast — no notification to the old host or other
// participants." Deliberately watches the TRUSTED session.host_id (read
// via Postgres Changes, already wired through use-session.ts) rather than
// the host_migrated Broadcast's payload — Broadcast is UI-hint only and
// carries no host id at all (§5), so re-deriving "was that promotion
// mine?" from the durable session row is both simpler and correct.
const TOAST_DURATION_MS = 4000;

export const useHostMigrationToast = (
  hostId: string | null,
  currentUserId: string | null,
): boolean => {
  // null (not a sentinel host id) means "no prior reading yet" — the guard
  // below on hasPriorReading is what keeps initial hydration (where the
  // current user may already be host, e.g. the session's creator) from
  // being mistaken for a live promotion.
  const previousHostId = useRef<string | null>(null);
  const hasPriorReading = useRef(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const wasHost = hasPriorReading.current && previousHostId.current === currentUserId;
    const isHost = currentUserId !== null && hostId === currentUserId;

    if (!wasHost && isHost && hasPriorReading.current) {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), TOAST_DURATION_MS);
      previousHostId.current = hostId;
      hasPriorReading.current = true;
      return () => clearTimeout(timer);
    }

    previousHostId.current = hostId;
    hasPriorReading.current = true;
    return undefined;
  }, [hostId, currentUserId]);

  return visible;
};
