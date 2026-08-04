import { initI18n } from './init-i18n';
import { en } from './locales/en';
import { he } from './locales/he';

// Phase 1 i18n foundation: initI18n() builds a configured i18next instance
// (react-i18next stack per the locked decision) with the en + he bundles,
// starting in the locale resolved from the device's language preferences and
// falling back to en. react-native-localize is a native module and is mocked
// virtually (it is not installed until Stage B) so no test ever reads the
// machine's real locale — determinism rule, .claude/skills/testing-standards/SKILL.md.

interface DeviceLocaleStub {
  readonly countryCode: string;
  readonly isRTL: boolean;
  readonly languageCode: string;
  readonly languageTag: string;
}

const EN_US: DeviceLocaleStub = {
  countryCode: 'US',
  isRTL: false,
  languageCode: 'en',
  languageTag: 'en-US',
};

const HE_IL: DeviceLocaleStub = {
  countryCode: 'IL',
  isRTL: true,
  languageCode: 'he',
  languageTag: 'he-IL',
};

const FR_FR: DeviceLocaleStub = {
  countryCode: 'FR',
  isRTL: false,
  languageCode: 'fr',
  languageTag: 'fr-FR',
};

const mockGetLocales = jest.fn<DeviceLocaleStub[], []>();

jest.mock('react-native-localize', () => ({
  getLocales: () => mockGetLocales(),
}));

describe('initI18n', () => {
  beforeEach(() => {
    mockGetLocales.mockReset();
    mockGetLocales.mockReturnValue([EN_US]);
  });

  it('registers both the en and he resource bundles', async () => {
    const i18n = await initI18n();

    // 'translation' is i18next's default namespace; the foundation keeps it.
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('he', 'translation')).toBe(true);
  });

  it('starts in he when the device prefers Hebrew', async () => {
    mockGetLocales.mockReturnValue([HE_IL]);

    const i18n = await initI18n();

    expect(i18n.language).toBe('he');
    expect(i18n.t('home.title')).toBe(he.home.title);
  });

  it('falls back to en when the device locale is unsupported', async () => {
    mockGetLocales.mockReturnValue([FR_FR]);

    const i18n = await initI18n();

    expect(i18n.language).toBe('en');
    expect(i18n.t('home.title')).toBe(en.home.title);
  });

  it('falls back to en when the device reports no locale preferences', async () => {
    mockGetLocales.mockReturnValue([]);

    const i18n = await initI18n();

    expect(i18n.language).toBe('en');
  });

  it('reports rtl direction for he and ltr for en', async () => {
    const i18n = await initI18n();

    expect(i18n.dir('he')).toBe('rtl');
    expect(i18n.dir('en')).toBe('ltr');
  });

  it('switches translations at runtime when the language changes', async () => {
    const i18n = await initI18n();
    expect(i18n.t('home.title')).toBe(en.home.title);

    await i18n.changeLanguage('he');

    expect(i18n.t('home.title')).toBe(he.home.title);
  });

  it('returns an isolated instance per call, re-detecting the device locale', async () => {
    // No shared singleton: a second init must not mutate the first instance,
    // and must re-read the (mocked) device preferences. This keeps the
    // testable core free of module-level state per .claude/skills/code-style/SKILL.md.
    const first = await initI18n();
    mockGetLocales.mockReturnValue([HE_IL]);

    const second = await initI18n();

    expect(first.language).toBe('en');
    expect(second.language).toBe('he');
  });
});
