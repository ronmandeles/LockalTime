import { ApiError } from './api-error';

describe('ApiError', () => {
  it('carries a status, a stable machine-readable code, and a message', () => {
    const error = new ApiError(404, 'session_not_found', 'No session with that id');

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(404);
    expect(error.code).toBe('session_not_found');
    expect(error.message).toBe('No session with that id');
  });
});
