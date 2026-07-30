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
const mockGetLocales = jest.fn<Array<{ languageCode: string }>, []>();
jest.mock(
  'react-native-localize',
  () => ({
    getTimeZone: () => mockGetTimeZone(),
    getLocales: () => mockGetLocales(),
  }),
  { virtual: true },
);

const mockIs = jest.fn();
const mockEq = jest.fn();
const mockUpdate = jest.fn(() => ({ eq: mockEq }));
const mockUpsert = jest.fn();
const mockMaybeSingle = jest.fn();
const mockSelectEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn(() => ({ eq: mockSelectEq }));
const mockFrom = jest.fn(() => ({ update: mockUpdate, select: mockSelect, upsert: mockUpsert }));

jest.mock('./supabase-client', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

const mockGetToken = jest.fn();
jest.mock('./push-registration', () => ({
  pushRegistration: { getToken: () => mockGetToken() },
}));

import {
  ACCEPTED_TOS_STORAGE_KEY,
  REPORTED_LOCALE_STORAGE_KEY,
  REPORTED_PUSH_TOKEN_STORAGE_KEY,
  REPORTED_TIMEZONE_STORAGE_KEY,
  acceptTosIfNeeded,
  fetchUserProfile,
  registerPushTokenIfChanged,
  reportLocaleIfChanged,
  reportTimezoneIfChanged,
} from './user-profile';

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

describe('reportLocaleIfChanged', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockSetItem.mockReset();
    mockSetItem.mockResolvedValue(undefined);
    mockGetLocales.mockReset();
    mockFrom.mockClear();
    mockUpdate.mockClear();
    mockEq.mockReset();
    mockEq.mockResolvedValue({ error: null });
  });

  it('writes the resolved device locale when nothing was cached yet', async () => {
    mockGetItem.mockResolvedValue(null);
    mockGetLocales.mockReturnValue([{ languageCode: 'he' }]);

    await reportLocaleIfChanged(USER_ID);

    expect(mockGetItem).toHaveBeenCalledWith(REPORTED_LOCALE_STORAGE_KEY);
    expect(mockFrom).toHaveBeenCalledWith('users');
    expect(mockUpdate).toHaveBeenCalledWith({ locale: 'he' });
    expect(mockEq).toHaveBeenCalledWith('id', USER_ID);
    expect(mockSetItem).toHaveBeenCalledWith(REPORTED_LOCALE_STORAGE_KEY, 'he');
  });

  it('does not write when the cached value already matches the resolved locale', async () => {
    mockGetItem.mockResolvedValue('en');
    mockGetLocales.mockReturnValue([{ languageCode: 'en' }]);

    await reportLocaleIfChanged(USER_ID);

    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('falls back to en for an unsupported device language, same as the app UI itself', async () => {
    mockGetItem.mockResolvedValue(null);
    mockGetLocales.mockReturnValue([{ languageCode: 'fr' }]);

    await reportLocaleIfChanged(USER_ID);

    expect(mockUpdate).toHaveBeenCalledWith({ locale: 'en' });
  });

  it('fails open when the Supabase update errors — never caches, never throws', async () => {
    mockGetItem.mockResolvedValue(null);
    mockGetLocales.mockReturnValue([{ languageCode: 'he' }]);
    mockEq.mockResolvedValue({ error: { message: 'network error' } });

    await expect(reportLocaleIfChanged(USER_ID)).resolves.toBeUndefined();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('never rejects even on a wholly unexpected failure (e.g. native module not linked)', async () => {
    mockGetLocales.mockImplementation(() => {
      throw new Error('getLocales is not a function');
    });

    await expect(reportLocaleIfChanged(USER_ID)).resolves.toBeUndefined();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('acceptTosIfNeeded', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockSetItem.mockReset();
    mockSetItem.mockResolvedValue(undefined);
    mockFrom.mockClear();
    mockUpdate.mockClear();
    mockEq.mockReset();
    mockEq.mockReturnValue({ is: mockIs });
    mockIs.mockReset();
    mockIs.mockResolvedValue({ error: null });
  });

  it('conditionally writes tos_accepted_at when nothing is cached yet', async () => {
    mockGetItem.mockResolvedValue(null);

    await acceptTosIfNeeded(USER_ID);

    expect(mockGetItem).toHaveBeenCalledWith(ACCEPTED_TOS_STORAGE_KEY);
    expect(mockFrom).toHaveBeenCalledWith('users');
    expect(mockUpdate).toHaveBeenCalledWith({ tos_accepted_at: expect.any(String) });
    expect(mockEq).toHaveBeenCalledWith('id', USER_ID);
    // The database condition (not the cache) is what actually prevents a
    // second acceptance from bumping the timestamp — this must always be
    // sent, even though the cache below also short-circuits most calls.
    expect(mockIs).toHaveBeenCalledWith('tos_accepted_at', null);
    expect(mockSetItem).toHaveBeenCalledWith(ACCEPTED_TOS_STORAGE_KEY, 'true');
  });

  it('does not call Supabase at all when already cached as accepted', async () => {
    mockGetItem.mockResolvedValue('true');

    await acceptTosIfNeeded(USER_ID);

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('fails open when the cache read throws — treats it as not yet accepted', async () => {
    mockGetItem.mockRejectedValue(new Error('storage unavailable'));

    await expect(acceptTosIfNeeded(USER_ID)).resolves.toBeUndefined();
    expect(mockFrom).toHaveBeenCalledWith('users');
  });

  it('fails open when the Supabase update errors — never caches, never throws', async () => {
    mockGetItem.mockResolvedValue(null);
    mockIs.mockResolvedValue({ error: { message: 'network error' } });

    await expect(acceptTosIfNeeded(USER_ID)).resolves.toBeUndefined();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('fails open when caching after a successful (possibly no-op) write throws', async () => {
    mockGetItem.mockResolvedValue(null);
    mockSetItem.mockRejectedValue(new Error('storage unavailable'));

    await expect(acceptTosIfNeeded(USER_ID)).resolves.toBeUndefined();
  });
});

describe('registerPushTokenIfChanged', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockSetItem.mockReset();
    mockSetItem.mockResolvedValue(undefined);
    mockGetToken.mockReset();
    mockFrom.mockClear();
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({ error: null });
  });

  it('does nothing when no push token is available — honest no-op, not a fabricated token', async () => {
    mockGetToken.mockResolvedValue({ status: 'unavailable' });

    await registerPushTokenIfChanged(USER_ID);

    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('upserts the token on (user_id, platform) when nothing was cached yet', async () => {
    mockGetItem.mockResolvedValue(null);
    mockGetToken.mockResolvedValue({ status: 'granted', token: 'device-token-1', platform: 'android' });

    await registerPushTokenIfChanged(USER_ID);

    expect(mockGetItem).toHaveBeenCalledWith(REPORTED_PUSH_TOKEN_STORAGE_KEY);
    expect(mockFrom).toHaveBeenCalledWith('device_tokens');
    expect(mockUpsert).toHaveBeenCalledWith(
      { user_id: USER_ID, platform: 'android', token: 'device-token-1' },
      { onConflict: 'user_id,platform' },
    );
    expect(mockSetItem).toHaveBeenCalledWith(REPORTED_PUSH_TOKEN_STORAGE_KEY, 'device-token-1');
  });

  it('does not write when the cached token already matches the current one', async () => {
    mockGetItem.mockResolvedValue('device-token-1');
    mockGetToken.mockResolvedValue({ status: 'granted', token: 'device-token-1', platform: 'android' });

    await registerPushTokenIfChanged(USER_ID);

    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('re-registers when the token changed since the last report (e.g. reinstall)', async () => {
    mockGetItem.mockResolvedValue('old-token');
    mockGetToken.mockResolvedValue({ status: 'granted', token: 'new-token', platform: 'ios' });

    await registerPushTokenIfChanged(USER_ID);

    expect(mockUpsert).toHaveBeenCalledWith(
      { user_id: USER_ID, platform: 'ios', token: 'new-token' },
      { onConflict: 'user_id,platform' },
    );
    expect(mockSetItem).toHaveBeenCalledWith(REPORTED_PUSH_TOKEN_STORAGE_KEY, 'new-token');
  });

  it('fails open when the Supabase upsert errors — never caches, never throws', async () => {
    mockGetItem.mockResolvedValue(null);
    mockGetToken.mockResolvedValue({ status: 'granted', token: 'device-token-1', platform: 'android' });
    mockUpsert.mockResolvedValue({ error: { message: 'network error' } });

    await expect(registerPushTokenIfChanged(USER_ID)).resolves.toBeUndefined();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('never rejects even on a wholly unexpected failure', async () => {
    mockGetToken.mockRejectedValue(new Error('native module not linked'));

    await expect(registerPushTokenIfChanged(USER_ID)).resolves.toBeUndefined();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('fetchUserProfile', () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockSelect.mockClear();
    mockSelectEq.mockClear();
    mockMaybeSingle.mockReset();
  });

  it("reads the user's role from the users table", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { role: 'verified_host' }, error: null });

    const result = await fetchUserProfile(USER_ID);

    expect(mockFrom).toHaveBeenCalledWith('users');
    expect(mockSelect).toHaveBeenCalledWith('role');
    expect(mockSelectEq).toHaveBeenCalledWith('id', USER_ID);
    expect(result).toEqual({ ok: true, value: { role: 'verified_host' } });
  });

  it('returns null (not an error) for a user with no profile row yet', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await fetchUserProfile(USER_ID);

    expect(result).toEqual({ ok: true, value: null });
  });

  it('maps a Supabase error to a typed failure', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'network error' } });

    const result = await fetchUserProfile(USER_ID);

    expect(result).toEqual({ ok: false, error: { message: 'network error' } });
  });
});
