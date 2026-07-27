// Thrown (or passed to next()) anywhere a route/service wants to fail with
// a specific HTTP status and a stable, machine-readable code. `code` — not
// `message` — is the API contract: the mobile app switches on it to pick an
// i18n key, mirroring how AuthFailure.kind is used today (auth-service.ts).
// `message` is diagnostic text for logs only.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}
