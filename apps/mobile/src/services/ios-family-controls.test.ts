const mockGetKnownIds = jest.fn();
const mockApplyKnownSelection = jest.fn();
const mockApplyCachedSelection = jest.fn();
const mockPresentPicker = jest.fn();

import { NativeModules, Platform } from 'react-native';

const NATIVE_MODULE_STUB = {
  getKnownIds: () => mockGetKnownIds(),
  applyKnownSelection: (ids: readonly string[]) => mockApplyKnownSelection(ids),
  applyCachedSelection: (key: string) => mockApplyCachedSelection(key),
  presentPicker: (options: unknown) => mockPresentPicker(options),
};

import { prepareIosBlocklistSelection } from './ios-family-controls';

// The iOS join step (docs/BLOCKLIST_SELECTION_PLAN.md §7), over a mocked
// bridge — the only kind of test possible for it (no Mac, §12).
//
// What this pins is the ORCHESTRATION: which of the three paths runs, in
// what order, and what happens when each fails. The decision rule itself is
// tested directly in ios-blocklist-selection.test.ts; the Swift side is a
// keyed store with no branching, precisely so there is nothing left in it
// for a test to have to reach.

const setPlatform = (os: 'android' | 'ios'): void => {
  (Platform as unknown as { OS: string }).OS = os;
};

const COPY = { headerText: 'Select: Instagram', footerText: 'Then tap Done.' };

beforeEach(() => {
  setPlatform('ios');
  (NativeModules as Record<string, unknown>).IosFamilyControlsModule = NATIVE_MODULE_STUB;
  mockGetKnownIds.mockReset().mockResolvedValue([]);
  mockApplyKnownSelection.mockReset().mockResolvedValue(true);
  mockApplyCachedSelection.mockReset().mockResolvedValue(false);
  mockPresentPicker.mockReset().mockResolvedValue(true);
});

describe('when there is no iOS token machinery', () => {
  it('is not applicable on Android, which resolves everything locally', async () => {
    setPlatform('android');

    await expect(
      prepareIosBlocklistSelection({ categories: ['social'], packages: [], ...COPY }),
    ).resolves.toBe('not_applicable');
    expect(mockPresentPicker).not.toHaveBeenCalled();
  });

  it('is not applicable on an iOS build with no module linked', async () => {
    delete (NativeModules as Record<string, unknown>).IosFamilyControlsModule;

    await expect(
      prepareIosBlocklistSelection({ categories: ['social'], packages: [], ...COPY }),
    ).resolves.toBe('not_applicable');
  });
});

describe('the cached-selection path', () => {
  it('skips the picker entirely for a blocklist this device has selected before', async () => {
    mockApplyCachedSelection.mockResolvedValue(true);

    await expect(
      prepareIosBlocklistSelection({
        categories: ['social'],
        packages: ['com.instagram.android'],
        ...COPY,
      }),
    ).resolves.toBe('ready');

    expect(mockPresentPicker).not.toHaveBeenCalled();
    expect(mockGetKnownIds).not.toHaveBeenCalled();
  });

  it('is consulted before anything else', async () => {
    mockApplyCachedSelection.mockResolvedValue(true);

    await prepareIosBlocklistSelection({ categories: ['social'], packages: [], ...COPY });

    expect(mockApplyCachedSelection).toHaveBeenCalledWith('c:social|p:');
  });

  it('falls through when nothing is cached', async () => {
    mockApplyCachedSelection.mockResolvedValue(false);
    mockGetKnownIds.mockResolvedValue(['social']);

    await expect(
      prepareIosBlocklistSelection({ categories: ['social'], packages: [], ...COPY }),
    ).resolves.toBe('ready');
    expect(mockApplyKnownSelection).toHaveBeenCalledWith(['social']);
  });
});

describe('the token map', () => {
  it('composes the selection with no picker when it covers the whole blocklist', async () => {
    mockGetKnownIds.mockResolvedValue(['social', 'com.instagram.android', 'games']);

    await expect(
      prepareIosBlocklistSelection({
        categories: ['social'],
        packages: ['com.instagram.android'],
        ...COPY,
      }),
    ).resolves.toBe('ready');

    expect(mockApplyKnownSelection).toHaveBeenCalledWith(['social', 'com.instagram.android']);
    expect(mockPresentPicker).not.toHaveBeenCalled();
  });

  it('pre-seeds the picker with what it knows and names the one thing it does not', async () => {
    mockGetKnownIds.mockResolvedValue(['social']);

    await expect(
      prepareIosBlocklistSelection({
        categories: ['social'],
        packages: ['com.instagram.android'],
        ...COPY,
      }),
    ).resolves.toBe('ready');

    expect(mockPresentPicker).toHaveBeenCalledWith({
      seedIds: ['social'],
      learnId: 'com.instagram.android',
      cacheKey: 'c:social|p:com.instagram.android',
      headerText: 'Select: Instagram',
      footerText: 'Then tap Done.',
    });
  });

  // Two unknowns cannot be told apart by subtraction, so learning is
  // switched off rather than guessed at — a wrong entry in the map would be
  // permanent and undetectable.
  it('learns nothing when two items are unknown', async () => {
    mockGetKnownIds.mockResolvedValue([]);

    await prepareIosBlocklistSelection({
      categories: ['social', 'news'],
      packages: [],
      ...COPY,
    });

    expect(mockPresentPicker).toHaveBeenCalledWith(
      expect.objectContaining({ learnId: null, seedIds: [] }),
    );
  });

  // Most likely cause: a token the map still lists but iOS has since
  // rotated (plan §2). Joining with nothing applied is the one outcome
  // this whole step exists to prevent.
  it('falls back to the picker when composing from the map fails', async () => {
    mockGetKnownIds.mockResolvedValue(['social']);
    mockApplyKnownSelection.mockResolvedValue(false);

    await expect(
      prepareIosBlocklistSelection({ categories: ['social'], packages: [], ...COPY }),
    ).resolves.toBe('ready');
    expect(mockPresentPicker).toHaveBeenCalledWith(
      expect.objectContaining({ seedIds: [], learnId: null }),
    );
  });

  it('treats an unreadable map as an empty one rather than failing the join', async () => {
    mockGetKnownIds.mockRejectedValue(new Error('app group unavailable'));

    await expect(
      prepareIosBlocklistSelection({ categories: ['social'], packages: [], ...COPY }),
    ).resolves.toBe('ready');
    expect(mockPresentPicker).toHaveBeenCalled();
  });

  it('ignores non-string entries the bridge might hand back', async () => {
    mockGetKnownIds.mockResolvedValue(['social', 42, null, '']);

    await prepareIosBlocklistSelection({
      categories: ['social'],
      packages: ['com.instagram.android'],
      ...COPY,
    });

    expect(mockPresentPicker).toHaveBeenCalledWith(
      expect.objectContaining({ seedIds: ['social'], learnId: 'com.instagram.android' }),
    );
  });
});

describe('cancelling', () => {
  // Plan §9: not joined. No half-joined state, and no markBlockerReady.
  it('reports a dismissed picker as cancelled', async () => {
    mockPresentPicker.mockResolvedValue(false);

    await expect(
      prepareIosBlocklistSelection({ categories: ['social'], packages: [], ...COPY }),
    ).resolves.toBe('cancelled');
  });

  it('treats a rejected picker call as cancelled rather than as success', async () => {
    mockPresentPicker.mockRejectedValue(new Error('presentation failed'));

    await expect(
      prepareIosBlocklistSelection({ categories: ['social'], packages: [], ...COPY }),
    ).resolves.toBe('cancelled');
  });

  it('treats any non-true answer as cancelled', async () => {
    mockPresentPicker.mockResolvedValue('probably');

    await expect(
      prepareIosBlocklistSelection({ categories: ['social'], packages: [], ...COPY }),
    ).resolves.toBe('cancelled');
  });
});

describe('an empty blocklist', () => {
  // The server rejects one, so this is unreachable in practice — but
  // presenting Apple's picker with nothing to select would be a dead end
  // with no way forward.
  it('needs no selection and shows no picker', async () => {
    await expect(
      prepareIosBlocklistSelection({ categories: [], packages: [], ...COPY }),
    ).resolves.toBe('ready');
    expect(mockPresentPicker).not.toHaveBeenCalled();
  });
});
