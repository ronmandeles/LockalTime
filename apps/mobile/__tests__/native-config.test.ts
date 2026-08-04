import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Contract tests for the native project config produced by `react-native init`
// (bare workflow). The app identifier com.lockaltime.app is a locked decision
// (CLAUDE.md); with no Mac available, this on-disk check is the only iOS
// verification possible on this machine — compiling/running iOS stays
// "manual QA pending (Mac required)".
const MOBILE_ROOT = join(__dirname, '..');

const readNativeFile = (relativePath: string): string => {
  return readFileSync(join(MOBILE_ROOT, relativePath), 'utf8');
};

const findIosPbxprojPath = (): string => {
  const iosDir = join(MOBILE_ROOT, 'ios');
  const xcodeprojDir = readdirSync(iosDir).find((entry) => entry.endsWith('.xcodeproj'));
  if (xcodeprojDir === undefined) {
    throw new Error(`no .xcodeproj directory found under ${iosDir}`);
  }
  return join('ios', xcodeprojDir, 'project.pbxproj');
};

describe('native project configuration', () => {
  it('sets the Android applicationId to com.lockaltime.app', () => {
    const buildGradle = readNativeFile(join('android', 'app', 'build.gradle'));

    expect(buildGradle).toMatch(/applicationId ["']com\.lockaltime\.app["']/);
  });

  it('sets the iOS bundle identifier to com.lockaltime.app', () => {
    const pbxproj = readNativeFile(findIosPbxprojPath());

    expect(pbxproj).toMatch(/PRODUCT_BUNDLE_IDENTIFIER = "?com\.lockaltime\.app"?;/);
  });
});

// The app is dark on every screen, but the two surfaces the OS paints BEFORE
// React Native mounts are not styled by the JS palette at all: iOS draws the
// launch storyboard, Android draws the activity's window background. Left at
// their defaults both flash white on cold start. Neither is observable from
// JS at runtime and neither machine-checks itself, so these on-disk contract
// tests are the only automated verification available here — actually seeing
// the cold start is a manual-QA item (docs/MANUAL_QA.md).
describe('dark launch surfaces', () => {
  describe('iOS launch storyboard', () => {
    const storyboard = (): string =>
      readNativeFile(join('ios', 'LockalTime', 'LaunchScreen.storyboard'));

    it('paints the root view black rather than the system white', () => {
      expect(storyboard()).not.toMatch(/cocoaTouchSystemColor="whiteColor"/);
      expect(storyboard()).toMatch(
        /<color key="backgroundColor"[^>]*red="0\.0"[^>]*green="0\.0"[^>]*blue="0\.0"/,
      );
    });

    it('gives every label a light text color so none of them vanish on black', () => {
      // The storyboard's labels inherit black text by default — turning the
      // background black without this makes the launch screen look broken
      // (blank) rather than merely dark.
      const labelCount = (storyboard().match(/<label /g) ?? []).length;
      const whiteTextColorCount = (
        storyboard().match(/<color key="textColor"[^>]*white="1"/g) ?? []
      ).length;

      expect(labelCount).toBeGreaterThan(0);
      expect(whiteTextColorCount).toBe(labelCount);
    });
  });

  describe('Android window background', () => {
    it('declares a black window background on AppTheme', () => {
      const styles = readNativeFile(
        join('android', 'app', 'src', 'main', 'res', 'values', 'styles.xml'),
      );
      const colors = readNativeFile(
        join('android', 'app', 'src', 'main', 'res', 'values', 'colors.xml'),
      );

      expect(styles).toMatch(
        /<item name="android:windowBackground">@color\/window_background<\/item>/,
      );
      expect(colors).toMatch(/<color name="window_background">#FF000000<\/color>/);
    });

    it('tells the OS to draw LIGHT status-bar icons over it', () => {
      // windowLightStatusBar=true means DARK icons (for a light bar). On a
      // black bar that is exactly backwards, and the clock/battery disappear.
      const styles = readNativeFile(
        join('android', 'app', 'src', 'main', 'res', 'values', 'styles.xml'),
      );

      expect(styles).toMatch(/<item name="android:windowLightStatusBar">false<\/item>/);
    });
  });
});
