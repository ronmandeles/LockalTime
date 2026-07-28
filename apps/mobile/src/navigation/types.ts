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
};
