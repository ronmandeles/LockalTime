const mockGetItem = jest.fn<Promise<string | null>, [string]>();
const mockSetItem = jest.fn<Promise<void>, [string, string]>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (key: string) => mockGetItem(key),
    setItem: (key: string, value: string) => mockSetItem(key, value),
  },
}));

import {
  BLOCKLIST_PREFERENCE_STORAGE_KEY,
  DEFAULT_BLOCKLIST_SELECTION,
  hydrateBlocklistPreference,
  rememberBlocklistPreference,
  useBlocklistPreferenceStore,
} from './blocklist-preference-store';

// Phase 9 task 5 — the host's last blocklist choice, pre-filled on Create
// Session. Mirrors active-session-store.ts's hydrating/ready gate and
// fail-open policy.
//
// Nothing here is money-equivalent, and the reason matters: a RUNNING
// session reads its blocklist from the server row, so this default cannot
// leak into one that is already going (the frozen-blocklist rule, plan
// §9). It is a pre-fill and nothing else.

beforeEach(() => {
  mockGetItem.mockReset();
  mockSetItem.mockReset();
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
  useBlocklistPreferenceStore.setState({ preference: { status: 'hydrating' } });
});

describe('hydrateBlocklistPreference', () => {
  it('starts hydrating, so nothing can render a pre-fill before storage is consulted', () => {
    expect(useBlocklistPreferenceStore.getState().preference.status).toBe('hydrating');
  });

  it('reads a stored selection', async () => {
    mockGetItem.mockResolvedValue(
      JSON.stringify({ categories: ['news'], packages: ['com.instagram.android'] }),
    );

    await hydrateBlocklistPreference();

    expect(useBlocklistPreferenceStore.getState().preference).toEqual({
      status: 'ready',
      selection: { categories: ['news'], packages: ['com.instagram.android'] },
    });
  });

  it('reads from the pinned storage key', async () => {
    await hydrateBlocklistPreference();

    expect(mockGetItem).toHaveBeenCalledWith(BLOCKLIST_PREFERENCE_STORAGE_KEY);
    expect(BLOCKLIST_PREFERENCE_STORAGE_KEY).toBe('@lockal-time/blocklist-preference');
  });

  it('falls back to the historical three categories when nothing is stored', async () => {
    await hydrateBlocklistPreference();

    expect(useBlocklistPreferenceStore.getState().preference).toEqual({
      status: 'ready',
      selection: DEFAULT_BLOCKLIST_SELECTION,
    });
    expect(DEFAULT_BLOCKLIST_SELECTION.categories).toEqual(['social', 'games', 'entertainment']);
  });

  it('fails open to the default when storage throws', async () => {
    mockGetItem.mockRejectedValue(new Error('storage unavailable'));

    await hydrateBlocklistPreference();

    expect(useBlocklistPreferenceStore.getState().preference).toEqual({
      status: 'ready',
      selection: DEFAULT_BLOCKLIST_SELECTION,
    });
  });

  it('fails open to the default on unparseable stored data', async () => {
    mockGetItem.mockResolvedValue('not json at all');

    await hydrateBlocklistPreference();

    expect(useBlocklistPreferenceStore.getState().preference).toEqual({
      status: 'ready',
      selection: DEFAULT_BLOCKLIST_SELECTION,
    });
  });

  // A stored value is as untrusted as a bridge payload. This is the real
  // case of someone who saved a category a later version removed.
  it('drops a stored category that is no longer part of the vocabulary', async () => {
    mockGetItem.mockResolvedValue(
      JSON.stringify({ categories: ['social', 'photography'], packages: [] }),
    );

    await hydrateBlocklistPreference();

    expect(useBlocklistPreferenceStore.getState().preference).toEqual({
      status: 'ready',
      selection: { categories: ['social'], packages: [] },
    });
  });

  it('drops a stored package that is not a string', async () => {
    mockGetItem.mockResolvedValue(
      JSON.stringify({ categories: ['social'], packages: ['com.instagram.android', 42, ''] }),
    );

    await hydrateBlocklistPreference();

    expect(useBlocklistPreferenceStore.getState().preference).toEqual({
      status: 'ready',
      selection: { categories: ['social'], packages: ['com.instagram.android'] },
    });
  });

  // The server rejects a session that blocks nothing, so pre-filling an
  // empty selection would hand the host a form they cannot submit without
  // understanding why.
  it('falls back to the default rather than pre-filling a selection that survives as empty', async () => {
    mockGetItem.mockResolvedValue(
      JSON.stringify({ categories: ['photography'], packages: [42] }),
    );

    await hydrateBlocklistPreference();

    expect(useBlocklistPreferenceStore.getState().preference).toEqual({
      status: 'ready',
      selection: DEFAULT_BLOCKLIST_SELECTION,
    });
  });
});

describe('rememberBlocklistPreference', () => {
  it('persists the selection under the pinned key', async () => {
    await rememberBlocklistPreference({ categories: ['maps'], packages: ['com.waze'] });

    expect(mockSetItem).toHaveBeenCalledWith(
      BLOCKLIST_PREFERENCE_STORAGE_KEY,
      JSON.stringify({ categories: ['maps'], packages: ['com.waze'] }),
    );
  });

  it('updates the store immediately', async () => {
    await rememberBlocklistPreference({ categories: ['maps'], packages: [] });

    expect(useBlocklistPreferenceStore.getState().preference).toEqual({
      status: 'ready',
      selection: { categories: ['maps'], packages: [] },
    });
  });

  it('still updates in memory when the write fails', async () => {
    mockSetItem.mockRejectedValue(new Error('disk full'));

    await rememberBlocklistPreference({ categories: ['news'], packages: [] });

    expect(useBlocklistPreferenceStore.getState().preference).toEqual({
      status: 'ready',
      selection: { categories: ['news'], packages: [] },
    });
  });
});
