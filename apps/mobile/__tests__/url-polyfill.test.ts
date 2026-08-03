import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regression guard for a real device-only failure found on the first Android
// emulator run (2026-08-03): the app crashed at startup with
// "Cannot assign to property 'protocol' which has only a getter".
//
// @supabase/supabase-js builds its realtime endpoint by MUTATING a URL object
// (dist/index.cjs: `this.realtimeUrl.protocol = ...replace("http", "ws")`),
// but React Native's built-in URL (Libraries/Blob/URL.js) declares `protocol`
// as a getter with no setter — so createClient() throws, and since the client
// is constructed in App's first effect (attachAuthStateListener), the whole
// app fails to render. react-native-url-polyfill/auto replaces the global URL
// with a spec-compliant one that has a real setter.
//
// This is deliberately an on-disk contract test, not a runtime one (same
// approach as native-config.test.ts). Under Jest the global URL is NODE's
// WHATWG URL, which already allows assigning `protocol` — so a runtime
// `new URL(...).protocol = ...` assertion would pass with OR without the
// polyfill and prove nothing. What actually has to hold is that the entry
// point installs the polyfill BEFORE anything can import Supabase.
const MOBILE_ROOT = join(__dirname, '..');

const POLYFILL_PACKAGE = 'react-native-url-polyfill';
const POLYFILL_IMPORT = `${POLYFILL_PACKAGE}/auto`;

const readMobileFile = (relativePath: string): string => {
  return readFileSync(join(MOBILE_ROOT, relativePath), 'utf8');
};

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
}

describe('URL polyfill wiring', () => {
  it('declares react-native-url-polyfill as a runtime dependency', () => {
    const manifest = JSON.parse(readMobileFile('package.json')) as PackageManifest;

    expect(manifest.dependencies?.[POLYFILL_PACKAGE]).toBeDefined();
  });

  it('imports the polyfill from the app entry point', () => {
    const entryPoint = readMobileFile('index.js');

    expect(entryPoint).toContain(POLYFILL_IMPORT);
  });

  it('installs the polyfill before importing the app tree', () => {
    const entryPoint = readMobileFile('index.js');

    const polyfillIndex = entryPoint.indexOf(POLYFILL_IMPORT);
    const appIndex = entryPoint.indexOf('./src/App');

    // Import order is the whole point: the global URL must be replaced before
    // any module that constructs a Supabase client is evaluated. A reorder
    // would silently reintroduce the startup crash.
    expect(polyfillIndex).toBeGreaterThanOrEqual(0);
    expect(appIndex).toBeGreaterThanOrEqual(0);
    expect(polyfillIndex).toBeLessThan(appIndex);
  });
});
