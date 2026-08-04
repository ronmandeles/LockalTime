import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config/supabase-config';

// Phase 1 auth wiring: one shared Supabase client for the whole mobile app
// (.claude/skills/supabase-integration/SKILL.md — never scatter client construction). The
// module exports a memoized getSupabaseClient(); this suite pins the
// construction contract: configured URL + anon key from the typed config
// module, session persisted in AsyncStorage (React Native has no
// localStorage), tokens auto-refreshing, and no browser URL detection.
// @supabase/supabase-js and AsyncStorage are native/npm dependencies not yet
// installed at test-writing time; both are now installed and mocked
// normally (same pattern
// as react-native-localize in init-i18n.test.ts) — no test touches the
// network; determinism rule, .claude/skills/testing-standards/SKILL.md.

interface AuthClientOptionsStub {
  readonly autoRefreshToken?: boolean;
  readonly detectSessionInUrl?: boolean;
  readonly persistSession?: boolean;
  readonly storage?: unknown;
}

interface ClientOptionsStub {
  readonly auth?: AuthClientOptionsStub;
}

const CLIENT_SENTINEL = { kind: 'supabase-client-sentinel' } as const;

const mockCreateClient = jest.fn<typeof CLIENT_SENTINEL, [string, string, ClientOptionsStub?]>(
  () => CLIENT_SENTINEL,
);

const mockAsyncStorage = {
  getItem: jest.fn<Promise<string | null>, [string]>(),
  removeItem: jest.fn<Promise<void>, [string]>(),
  setItem: jest.fn<Promise<void>, [string, string]>(),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: [string, string, ClientOptionsStub?]) => mockCreateClient(...args),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: mockAsyncStorage,
}));

interface SupabaseClientModule {
  readonly getSupabaseClient: () => unknown;
}

// The client is a module-level memoized singleton, so each test loads a fresh
// module registry to observe its own construction call — otherwise tests
// would depend on execution order (forbidden by .claude/skills/testing-standards/SKILL.md).
const loadSupabaseClientModule = (): SupabaseClientModule => {
  let loaded: SupabaseClientModule | undefined;
  jest.isolateModules(() => {
    loaded = require('./supabase-client') as SupabaseClientModule;
  });
  if (loaded === undefined) {
    throw new Error('supabase-client module failed to load');
  }
  return loaded;
};

const getConstructionArgs = (): [string, string, ClientOptionsStub?] => {
  const firstCall = mockCreateClient.mock.calls[0];
  if (firstCall === undefined) {
    throw new Error('createClient was never called');
  }
  return firstCall;
};

describe('getSupabaseClient', () => {
  beforeEach(() => {
    mockCreateClient.mockClear();
  });

  it('constructs the client with the configured URL and anon key', () => {
    const { getSupabaseClient } = loadSupabaseClientModule();

    getSupabaseClient();

    const [url, key] = getConstructionArgs();
    expect(url).toBe(SUPABASE_URL);
    expect(key).toBe(SUPABASE_ANON_KEY);
  });

  it('persists the session in AsyncStorage', () => {
    const { getSupabaseClient } = loadSupabaseClientModule();

    getSupabaseClient();

    const [, , options] = getConstructionArgs();
    expect(options?.auth?.persistSession).toBe(true);
    expect(options?.auth?.storage).toBe(mockAsyncStorage);
  });

  it('auto-refreshes tokens and skips browser URL session detection', () => {
    const { getSupabaseClient } = loadSupabaseClientModule();

    getSupabaseClient();

    const [, , options] = getConstructionArgs();
    expect(options?.auth?.autoRefreshToken).toBe(true);
    // React Native has no browser URL to inspect for OAuth callbacks.
    expect(options?.auth?.detectSessionInUrl).toBe(false);
  });

  it('memoizes a single shared client instance', () => {
    const { getSupabaseClient } = loadSupabaseClientModule();

    const first = getSupabaseClient();
    const second = getSupabaseClient();

    expect(first).toBe(second);
    expect(first).toBe(CLIENT_SENTINEL);
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });
});
