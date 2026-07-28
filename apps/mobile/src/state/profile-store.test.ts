const mockFetchUserProfile = jest.fn();
jest.mock('../services/user-profile', () => ({
  fetchUserProfile: (userId: string) => mockFetchUserProfile(userId),
}));

import { hydrateProfile, resetProfile, useProfileStore } from './profile-store';

const USER_ID = 'user-1';

describe('profile-store', () => {
  beforeEach(() => {
    mockFetchUserProfile.mockReset();
    useProfileStore.setState({ role: null });
  });

  describe('hydrateProfile', () => {
    it('sets the role on a successful fetch', async () => {
      mockFetchUserProfile.mockResolvedValue({ ok: true, value: { role: 'verified_host' } });

      await hydrateProfile(USER_ID);

      expect(useProfileStore.getState().role).toBe('verified_host');
      expect(mockFetchUserProfile).toHaveBeenCalledWith(USER_ID);
    });

    it('leaves role at null when the fetch fails — fails open, never throws', async () => {
      mockFetchUserProfile.mockResolvedValue({ ok: false, error: { message: 'network error' } });

      await expect(hydrateProfile(USER_ID)).resolves.toBeUndefined();
      expect(useProfileStore.getState().role).toBeNull();
    });

    it('leaves role at null for a user with no profile row yet', async () => {
      mockFetchUserProfile.mockResolvedValue({ ok: true, value: null });

      await hydrateProfile(USER_ID);

      expect(useProfileStore.getState().role).toBeNull();
    });

    it('never rejects even when the fetch itself throws', async () => {
      mockFetchUserProfile.mockRejectedValue(new Error('unexpected'));

      await expect(hydrateProfile(USER_ID)).resolves.toBeUndefined();
      expect(useProfileStore.getState().role).toBeNull();
    });
  });

  describe('resetProfile', () => {
    it('clears a previously-hydrated role', () => {
      useProfileStore.setState({ role: 'admin' });

      resetProfile();

      expect(useProfileStore.getState().role).toBeNull();
    });
  });
});
