// Shared navigator param list — its own module (not declared inline in
// App.tsx) so screens can import their own typed props without a circular
// import back to the App shell.
export type RootStackParamList = {
  Home: undefined;
  CreateSession: undefined;
  ScanSession: undefined;
  SessionDetails: { readonly token: string };
  // qrToken is only ever passed right after the HOST creates a session
  // (CreateSessionScreen has it from the create response) — a joining
  // participant's session-repository read deliberately never re-exposes
  // it (no reason for a participant to see the host's re-share code).
  ActiveSession: { readonly sessionId: string; readonly qrToken?: string };
};
