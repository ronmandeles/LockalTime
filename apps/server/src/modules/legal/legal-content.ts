// Phase 7 (Release Prep): placeholder ToS/Privacy Policy content, drafted
// for owner review per CLAUDE.md's locked decision — not a lawyer-reviewed
// final version. Covers the app's actual data footprint (session/points
// data, device tokens, attestation raw responses, friend graph, username,
// venue data) and explicitly states what is NOT collected (geolocation,
// contacts). English only for now — deliberately not run through the i18n
// pipeline (.claude/skills/i18n/SKILL.md's "no hardcoded strings" rule
// governs in-app UI text; this is server-rendered legal copy the owner is
// still going to revise before it's final, so translating it now would
// mean re-translating it again once the real text lands).
const EFFECTIVE_DATE_PLACEHOLDER = '[EFFECTIVE DATE — fill in before publishing]';
const COMPANY_NAME_PLACEHOLDER = '[LEGAL ENTITY NAME — fill in before publishing]';
const CONTACT_EMAIL_PLACEHOLDER = '[SUPPORT CONTACT EMAIL — fill in before publishing]';

export const TERMS_OF_SERVICE_TEXT = `Lockal Time — Terms of Service (DRAFT — placeholder, not legally reviewed)

Effective date: ${EFFECTIVE_DATE_PLACEHOLDER}
Provided by: ${COMPANY_NAME_PLACEHOLDER}
Contact: ${CONTACT_EMAIL_PLACEHOLDER}

1. Acceptance
By creating an account or using Lockal Time, you agree to these Terms of
Service and our Privacy Policy. If you do not agree, do not use the app.

2. The service
Lockal Time helps you and people you choose to group with commit to
distraction-free time by blocking distracting apps on your device for a
session you or another participant starts. Sessions can be solo, private
(shared via a QR code you generate), or hosted at a participating venue.

3. Accounts
You must provide a valid email (or sign in with Google/Apple) to create an
account. You are responsible for keeping your account credentials secure.
One person, one account — do not create multiple accounts to manipulate
points, streaks, or leaderboards.

4. Points, streaks, and leaderboards
Points, streaks, and any bonus are computed and awarded solely by our
servers based on real session participation. They have no cash value,
cannot be transferred, sold, or redeemed, and may be corrected or reset if
we determine they resulted from a bug, an exploit, or a Terms violation.

5. Native device blocking
When you join or host a session, Lockal Time uses your device's native
capabilities (Android's Usage Access / iOS's Screen Time Family Controls)
to block selected apps for the session's duration. You can end a session
early ("Emergency Exit") at any time; doing so forfeits any bonus tied to
completing the full session.

6. Venues and hosts
A "Verified Host" (e.g. a cafe or business) may host sessions other users
can join. Verified Host status is granted manually by us and may be
revoked. Venue information is a display label only — we do not collect or
display precise location/geolocation data.

7. Acceptable use
Do not: attempt to manipulate points/streaks/leaderboards; interfere with
another user's session or device blocking; use the app for any unlawful
purpose; attempt to access another user's account or data.

8. Account deletion
You may delete your account at any time from Settings in the app. Deleting
your account permanently removes your profile, session history, points,
streaks, and friend connections, per our Privacy Policy's retention
section. This cannot be undone.

9. Disclaimers and limitation of liability
The app is provided "as is." We do not guarantee that device-level
blocking is unbreakable or that it will function correctly on every
device or OS version. To the maximum extent permitted by law, we are not
liable for indirect, incidental, or consequential damages arising from
your use of the app.

10. Changes to these terms
We may update these Terms from time to time. Continued use of the app
after a change constitutes acceptance of the updated Terms.

11. Governing law
[GOVERNING LAW / JURISDICTION — fill in before publishing]
`;

export const PRIVACY_POLICY_TEXT = `Lockal Time — Privacy Policy (DRAFT — placeholder, not legally reviewed)

Effective date: ${EFFECTIVE_DATE_PLACEHOLDER}
Provided by: ${COMPANY_NAME_PLACEHOLDER}
Contact: ${CONTACT_EMAIL_PLACEHOLDER}

This policy describes what data Lockal Time collects, why, and how long we
keep it.

1. Data we collect

- Account data: email address (or a Google/Apple account identifier if you
  sign in that way), a display name, an auto-generated username, and an
  optional avatar image URL.
- Session and points data: sessions you create or join, their duration and
  type, presence intervals (when you joined/left a session), points
  earned, streaks, and milestones achieved.
- Device tokens: a push-notification token for your device, if you enable
  notifications, used only to deliver Lockal Time notifications (e.g. a
  streak-risk reminder).
- Device attestation data: on session creation/join, a device-integrity
  signal (Android Play Integrity / Apple App Attest) and the raw response
  from that provider. This is used only to assess device trust for
  anti-cheat purposes — it is never shown to other users.
- Friend graph: friend requests and friendships you create with other
  users, and your username (used so friends can find you).
- Venue data: if you visit or host a session at a participating venue, the
  venue's display name and a free-text address label the venue's owner
  entered. We do not collect or store GPS coordinates or precise
  geolocation for you or for venues.
- Locale/timezone: your device's language and timezone, used to localize
  notifications and bucket your sessions into the correct calendar day.

2. Data we do NOT collect
We do not collect: geolocation/GPS coordinates, your device's contacts,
photos or files beyond an avatar URL you provide, or browsing history
outside the app.

3. How we use your data
Solely to operate Lockal Time: running sessions, computing points/
streaks/bonuses, showing your friends' leaderboard standing (their total
points and whether they had a session today — never their streak or
session history), sending notifications you've enabled, and improving
reliability (crash/error monitoring).

4. Data sharing
We do not sell your data. We share data only with the service providers
that operate Lockal Time on our behalf (e.g. our database/hosting
provider, push-notification providers, and a crash-reporting provider),
under agreements that restrict them to that purpose.

5. Data retention
We retain your account data for as long as your account exists. If you
delete your account (available any time in Settings), we permanently
delete your profile, session history, points, streaks, friend graph, and
device tokens. This is enforced by database-level cascading deletion, not
a manual process, and cannot be undone once complete.

6. Your rights
You may access, correct, or delete your data at any time. Account
deletion is self-service, in-app (Settings → Delete account). For any
other request, contact us at ${CONTACT_EMAIL_PLACEHOLDER}.

7. Children's privacy
Lockal Time is not directed at children under 13 (or the minimum age
required in your region), and we do not knowingly collect data from them.

8. Changes to this policy
We may update this Privacy Policy from time to time. Continued use of the
app after a change constitutes acceptance of the updated policy.
`;
