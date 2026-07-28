// Shared navigator param list — its own module (not declared inline in
// App.tsx) so screens can import their own typed props without a circular
// import back to the App shell.
export type RootStackParamList = {
  Home: undefined;
  CreateSession: undefined;
  ScanSession: undefined;
  // Two mutually exclusive entry modes: a scanned QR token (normal join) or
  // a bare sessionId (Screen 13's token-free rejoin — ARCHITECTURE.md §2
  // item 13, no QR re-scan since the session id is already known).
  SessionDetails: { readonly token: string } | { readonly sessionId: string };
  // qrToken is only ever passed right after the HOST creates a session
  // (CreateSessionScreen has it from the create response) — a joining
  // participant's session-repository read deliberately never re-exposes
  // it (no reason for a participant to see the host's re-share code).
  ActiveSession: { readonly sessionId: string; readonly qrToken?: string };
  // Screen 9 — participant-initiated, forfeits both bonuses unconditionally
  // (ARCHITECTURE.md §7). Long-press/slide confirmation, not a tap.
  EmergencyExit: { readonly sessionId: string };
  // Screen 10 — the points receipt, reached either from a normal session
  // end (host-ended/duration-reached/force-terminated) or from a
  // successful Emergency Exit; the exit_reason on the fetched row is what
  // tells the two apart, not a route param.
  SessionCompletion: { readonly sessionId: string };
  // Screen 11 (Phase 5 task 8) — the Solo/Group/All filter is local screen
  // state, not a route param (matching every other screen's own UI-state
  // convention in this codebase), so no params are needed here.
  History: undefined;
  // Screen 12 (Phase 5 task 9) — lifetime aggregates, streak, 7-day chart,
  // achieved milestones. No params: it reads entirely off the
  // authenticated user, same as History.
  Stats: undefined;
  // Phase 6 (B2B) — verified_host/admin only, reached from Home's
  // manageVenuesCta link (itself gated on useProfileStore's role). No
  // params: reads/writes entirely through the requireRole-gated /venues
  // endpoints for the authenticated user.
  VenueManagement: undefined;
  // Phase 6 task 6 (B2B dashboard, ARCHITECTURE.md §10) — same gate as
  // VenueManagement. No params: picks among the caller's own venues
  // in-screen, same "local UI state, not a route param" convention as
  // History's filter.
  VenueDashboard: undefined;
  // Phase 6.5 (Social & Comparison Surfaces) — reached from Home's
  // friendsCta link, available to every user (not role-gated). No params:
  // search, pending requests, and the leaderboard all read/write entirely
  // through the /friends endpoints for the authenticated user.
  Friends: undefined;
};
