// Phase 5: reports the device's IANA timezone to users.timezone so the
// server buckets a finalized session into the participant's LOCAL day
// (apply_session_stats(), apps/server) rather than UTC. Fail-open
// throughout, same posture as active-session-store.ts.

const mockGetItem = jest.fn<Promise<string | null>, [string]>();
const mockSetItem = jest.fn<Promise<void>, [string, string]>();

jest.mock(
  '@react-native-async-storage/async-storage',
  () => ({
    __esModule: true,
    default: {
      getItem: (key: string) => mockGetItem(key),
      setItem: (key: string, value: string) => mockSetItem(key, value),
    },
  }),
  { virtual: true },
);

const mockGetTimeZone = jest.fn<string, []>();
jest.mock('react-native-localize', () => ({ getTimeZone: () => mockGetTimeZone() }), {
  virtual: true,
});

const mockEq = jest.fn();
const mockUpdate = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ update: mockUpdate }));

jest.mock('./supabase-client', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

import { REPORTED_TIMEZONE_STORAGE_KEY, reportTimezoneIfChanged } from './user-profile';

const USER_ID = 'user-1';

describe('reportTimezoneIfChanged', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockSetItem.mockReset();
    mockSetItem.mockResolvedValue(undefined);
    mockGetTimeZone.mockReset();
    mockFrom.mockClear();
    mockUpdate.mockClear();
    mockEq.mockReset();
    mockEq.mockResolvedValue({ error: null });
  });

  it('writes the device timezone when nothing was cached yet', async () => {
    mockGetItem.mockResolvedValue(null);
    mockGetTimeZone.mockReturnValue('Asia/Jerusalem');

    await reportTimezoneIfChanged(USER_ID);

    expect(mockGetItem).toHaveBeenCalledWith(REPORTED_TIMEZONE_STORAGE_KEY);
    expect(mockFrom).toHaveBeenCalledWith('users');
    expect(mockUpdate).toHaveBeenCalledWith({ timezone: 'Asia/Jerusalem' });
    expect(mockEq).toHaveBeenCalledWith('id', USER_ID);
    expect(mockSetItem).toHaveBeenCalledWith(REPORTED_TIMEZONE_STORAGE_KEY, 'Asia/Jerusalem');
  });

  it('does not write when the cached value already matches the device timezone', async () => {
    mockGetItem.mockResolvedValue('Asia/Jerusalem');
    mockGetTimeZone.mockReturnValue('Asia/Jerusalem');

    await reportTimezoneIfChanged(USER_ID);

    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('writes again when the device timezone changed since the last report', async () => {
    mockGetItem.mockResolvedValue('America/New_York');
    mockGetTimeZone.mockReturnValue('Asia/Jerusalem');

    await reportTimezoneIfChanged(USER_ID);

    expect(mockUpdate).toHaveBeenCalledWith({ timezone: 'Asia/Jerusalem' });
    expect(mockSetItem).toHaveBeenCalledWith(REPORTED_TIMEZONE_STORAGE_KEY, 'Asia/Jerusalem');
  });

  it('fails open when the cache read throws — treats it as nothing cached', async () => {
    mockGetItem.mockRejectedValue(new Error('storage unavailable'));
    mockGetTimeZone.mockReturnValue('Asia/Jerusalem');

    await expect(reportTimezoneIfChanged(USER_ID)).resolves.toBeUndefined();
    expect(mockFrom).toHaveBeenCalledWith('users');
  });

  it('fails open when the Supabase update errors — never caches, never throws', async () => {
    mockGetItem.mockResolvedValue(null);
    mockGetTimeZone.mockReturnValue('Asia/Jerusalem');
    mockEq.mockResolvedValue({ error: { message: 'network error' } });

    await expect(reportTimezoneIfChanged(USER_ID)).resolves.toBeUndefined();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('fails open when caching the new value throws after a successful write', async () => {
    mockGetItem.mockResolvedValue(null);
    mockGetTimeZone.mockReturnValue('Asia/Jerusalem');
    mockSetItem.mockRejectedValue(new Error('storage unavailable'));

    await expect(reportTimezoneIfChanged(USER_ID)).resolves.toBeUndefined();
  });

  it('never rejects even on a wholly unexpected failure (e.g. native module not linked)', async () => {
    mockGetTimeZone.mockImplementation(() => {
      throw new Error('getTimeZone is not a function');
    });

    await expect(reportTimezoneIfChanged(USER_ID)).resolves.toBeUndefined();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
