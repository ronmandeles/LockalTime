// English bundle — the canonical translation schema. Every other locale is
// typed as TranslationSchema (= typeof en), so a missing or extra key in any
// locale is a compile-time error; the runtime walk in locale-parity.test.ts
// is the belt-and-braces guard on top (.claude/skills/i18n/SKILL.md). Keys nest by
// screen/domain, leaf values are plain strings.
export const en = {
  home: {
    title: 'Lockal Time',
    createSession: 'Create Session',
    scanQr: 'Scan QR',
    historyCta: 'History',
    statsCta: 'Stats',
    // Phase 6: shown only for verified_host/admin (useProfileStore) —
    // a subdued link, not a third competing CTA (DESIGN_GUIDELINES §1).
    manageVenuesCta: 'Manage venues',
    venueDashboardCta: 'Venue activity',
    // Phase 6.5 — available to every user, not role-gated.
    friendsCta: 'Friends',
    // Phase 7 (Release Prep) — sign-out and account deletion's one entry
    // point, available to every user.
    settingsCta: 'Settings',
    // Phase 5 gamification summary card — copy is PLACEHOLDER, flagged for
    // the deferred copy pass. Streak/milestones stay visually quiet per
    // ARCHITECTURE.md §9 (a fact being stated, not a prize being dangled).
    summary: {
      streakCount: '{{count}} day streak',
      streakNone: 'Start a streak today',
      totalPoints: 'Total points',
      milestoneProgress: '{{count}} more sessions to {{milestone}}',
      allMilestonesReached: "You've reached every milestone",
    },
  },
  // History (Screen 11, Phase 5 task 8) copy is PLACEHOLDER, flagged for
  // the deferred copy pass.
  history: {
    title: 'History',
    filters: {
      all: 'All',
      solo: 'Solo',
      group: 'Group',
    },
    type: {
      solo: 'Solo session',
      dynamic_qr: 'Group session',
      static_qr: 'Group session',
    },
    minutesPresent: '{{count}} min',
    pointsEarned: '+{{count}}',
    groupBonusChip: 'Group bonus',
    completionBonusChip: 'Completion bonus',
    empty: {
      all: "You haven't completed any sessions yet.",
      solo: "You haven't completed any solo sessions yet.",
      group: "You haven't completed any group sessions yet.",
    },
    loadError: "We couldn't load your history. Please try again.",
    retry: 'Retry',
  },
  // Stats (Screen 12, Phase 5 task 9) copy is PLACEHOLDER, flagged for the
  // deferred copy pass.
  stats: {
    title: 'Stats',
    totalPoints: 'Total points',
    totalMinutes: 'Total minutes',
    currentStreak: 'Current streak',
    longestStreak: 'Longest streak',
    chartTitle: 'Last 7 days',
    milestonesTitle: 'Milestones reached',
    noMilestonesYet: 'No milestones reached yet',
  },
  // Phase 5 milestone ladder — slug is the i18n key (docs/DATABASE.md),
  // since the DB row's own `name` column is never rendered directly.
  milestones: {
    sessions_5: 'First Five',
    sessions_10: 'Ten Sessions',
    sessions_25: 'Quarter Century',
    sessions_50: 'Half Century',
    sessions_100: 'Centurion',
    sessions_250: 'Dedicated',
  },
  // Phase 2 session screens (4-8 skeleton) — placeholder copy, flagged for
  // the deferred copy pass. No native blocking yet; sessions are "virtual"
  // (backlog Phase 2 DoD).
  createSession: {
    title: 'Create a session',
    type: {
      label: 'Who can join',
      solo: 'Just me',
      dynamicQr: 'Friends via QR code',
      // Phase 6: only offered when useProfileStore's role is verified_host
      // or admin (venues are a strictly B2B construct).
      staticQr: 'Customers at my venue',
    },
    duration: {
      label: 'Duration',
      fixed: 'Set a time',
      openEnded: 'Until I end it',
      minutesPlaceholder: 'Minutes',
    },
    // Phase 6: shown only when type is static_qr.
    venuePicker: {
      label: 'Venue',
      loading: 'Loading your venues…',
      empty: 'You have no venues yet. Add one from Manage Venues on Home.',
      error: "We couldn't load your venues. Please try again.",
    },
    // Phase 9 (docs/BLOCKLIST_SELECTION_PLAN.md §7). App NAMES never appear
    // here and never get translated — brands aren't localized, and the
    // receiving device resolves them from its own catalog or PackageManager
    // so nothing a host types travels (§6).
    blocklist: {
      label: 'What this session blocks',
      categoriesLabel: 'Categories',
      category: {
        social: 'Social',
        games: 'Games',
        entertainment: 'Entertainment',
        news: 'News',
        maps: 'Maps',
        productivity: 'Work',
      },
      categoriesNote:
        'A category also covers apps installed later. A named app only counts if it is already installed.',
      mapsNote: 'Blocking Maps also blocks navigation. You can always leave the session.',
      appsLabel: 'Specific apps',
      appsLoading: 'Looking at your apps…',
      appsEmpty: 'No apps to choose from. Use the categories above.',
      notInstalledNote:
        'Not on this device: {{count}}. They will still block for anyone who has them.',
      venueNote: 'This venue is approved to block only what is shown here.',
    },
    submit: 'Start session',
    errors: {
      minutesRequired: 'Enter how many minutes this session should run.',
      requestFailed: "We couldn't create the session. Please try again.",
      venueRequired: 'Choose which venue this session is for.',
      venueNotOwned: "That venue isn't yours.",
      venueNotFound: "That venue couldn't be found.",
      blocklistRequired: 'Choose at least one category or app to block.',
      blocklistNotVenueApproved: 'This venue is not approved to block everything you picked.',
      blockedPackageNotAllowed: 'That app can never be blocked.',
    },
  },
  // Phase 9 (plan §8): the Android blocker overlay is a bare native
  // TextView built in Kotlin, with no i18next of its own. Rather than a
  // parallel set of Android string resources needing their own values-iw,
  // the resolved copy is handed across the bridge at start() — one
  // translation source of truth. '%s' is substituted natively with the
  // blocked app's own name, which only PackageManager knows.
  blocker: {
    overlay: {
      blockedApp: '%s is blocked during this session.',
      blockedGeneric: 'This app is blocked during this session.',
    },
  },
  scanSession: {
    title: 'Join a session',
    body: "Enter the code from the host's QR to join their session.",
    tokenPlaceholder: 'Session code',
    continue: 'Continue',
    scanWithCamera: 'Scan with camera',
    enterManually: 'Enter code manually',
    cameraPermission: {
      body: 'Allow camera access to scan a QR code instead of typing it.',
      allow: 'Allow camera access',
    },
    errors: {
      tokenRequired: 'Enter a session code to continue.',
    },
  },
  sessionDetails: {
    title: 'Join this session?',
    body: "You're about to join a session. Distracting apps will stay blocked for everyone present until it ends.",
    join: 'Join session',
    joining: 'Joining…',
    // Screen 13's "Welcome Back" flow (Phase 4 task 12) reuses this screen
    // for a token-free rejoin — same CTA testID/behavior, distinct copy.
    rejoinTitle: 'Rejoin this session?',
    rejoinBody: "You're picking back up a session you were already part of. Distracting apps will stay blocked for everyone present until it ends.",
    rejoin: 'Rejoin session',
    rejoining: 'Rejoining…',
    // Phase 6 task 7: real details fetched via the preview endpoint (join
    // mode) or a direct RLS-protected read (rejoin mode, already a prior
    // participant) before the CTA appears at all.
    preview: {
      loading: 'Loading session details…',
      error: "We couldn't load this session's details. Please try again.",
      retry: 'Retry',
      elapsedMinutes: 'Started {{count}} minutes ago',
      participantCount: '{{count}} people here now',
      atVenue: 'At {{name}}',
    },
    completionBonusUnavailable: "This session's completion bonus is no longer available to you, but you'll still earn points for the time you're present.",
    // Phase 9 (docs/BLOCKLIST_SELECTION_PLAN.md §7): what joining costs you,
    // stated before you join. On iOS this list is also what the member works
    // from inside Apple's own sheet, so it is load-bearing, not decoration.
    blocklist: {
      label: 'This session blocks',
      // Shown on iOS only, and only when this device has to acquire tokens —
      // it is a real extra step, not a formality, so it is announced rather
      // than sprung on them.
      iosNote: "On iPhone, tap Join and you'll pick these in Apple's own sheet.",
      pickerHeader: 'Select these in the list below',
      pickerFooter: 'Tap Done when you have selected all of them.',
    },
    recovery: {
      scanAgain: 'Scan again',
      backToHome: 'Back to Home',
      retry: 'Retry',
    },
    errors: {
      session_not_found: "This session doesn't exist or has already ended.",
      session_not_joinable: 'This session is no longer accepting new people.',
      qr_token_expired: "This QR code has expired. Ask the host for a new one.",
      session_at_capacity: 'This session is full.',
      invalid_qr_token: "That code isn't valid. Check it and try again.",
      not_a_prior_participant: "You weren't part of this session, so it can't be rejoined this way.",
      venue_not_found: "That venue couldn't be found.",
      no_active_session_at_venue: 'No session is currently running at this venue.',
      // Cancelling Apple's sheet means not joining — there is no
      // half-joined state where someone is in a session enforcing nothing.
      selection_cancelled: 'You need to select the blocked items before you can join.',
      unknown: "Something went wrong joining. Please try again.",
    },
  },
  activeSession: {
    title: 'Session in progress',
    status: {
      pending: 'Waiting to start',
      active: 'Active',
      host_disconnected: 'Host reconnecting…',
      participant_reconnecting: 'Reconnecting…',
      degraded_offline: 'Offline',
      completed: 'Session ended',
      force_terminated: 'Session ended',
    },
    participants: {
      title: 'Who is here',
      empty: 'Waiting for people to join…',
      count: '{{count}} present',
    },
    timer: {
      elapsed: 'Elapsed',
      remaining: 'Remaining',
    },
    qrLabel: 'Share this code to let others join',
    emergencyExit: 'Emergency exit',
    hostMigrationToast: "You're hosting now",
    // Phase 6 task 7: a dedicated banner for the two realtime-connectivity
    // states that warrant more than the quiet status label alone.
    offlineBanner: {
      participant_reconnecting: 'Reconnecting… blocking stays on while we try.',
      degraded_offline: "You've been offline for a while — blocking has paused until you reconnect.",
    },
    blockerViolation: {
      message: {
        permission_revoked: 'Blocking permission was turned off — this session is no longer enforced.',
        service_killed: 'Blocking was interrupted — this session is no longer enforced.',
        battery_critical: 'Battery saver may have paused blocking for this session.',
      },
      openSettings: 'Open settings',
    },
  },
  // Emergency Exit (Screen 9) copy is PLACEHOLDER, flagged for the deferred
  // copy pass. In-session surface (DESIGN_GUIDELINES §0) — quiet, no new
  // stimulation; the hold-to-confirm interaction itself is what carries the
  // "this is high-stakes" weight (§7), not louder copy.
  emergencyExit: {
    title: 'Emergency exit',
    body: "Leaving now forfeits any group or completion bonus for this session. You'll still keep the points you've already earned.",
    holdToExit: 'Hold to exit',
    cancel: 'Cancel',
    errors: {
      requestFailed: "We couldn't complete the exit. Please try again.",
    },
  },
  // Session Completion (Screen 10) copy is PLACEHOLDER, flagged for the
  // deferred copy pass. Acquisition surface (DESIGN_GUIDELINES §0) — full
  // design effort; bonuses always broken out separately, never bundled
  // (ARCHITECTURE.md §9).
  sessionCompletion: {
    title: {
      completed: 'Session complete',
      left: 'You left early',
    },
    pointsEarned: 'Points earned',
    breakdown: {
      base: 'Base points',
      groupBonus: 'Group bonus',
      completionBonus: 'Completion bonus',
    },
    forfeitedNote: "Bonuses aren't available for sessions you didn't stay in until the end.",
    minutesPresent: '{{count}} minutes present',
    done: 'Done',
    loading: 'Calculating your points…',
    notReady: "Your results aren't ready yet — check History in a moment.",
  },
  // Screen 13 — Welcome Back / Session Interrupted (Phase 4 task 12,
  // ARCHITECTURE.md §2 item 13). Shows elapsed presence TIME, deliberately
  // never a points figure: an in-progress session has no authoritative
  // points value yet (bonuses aren't decided until it ends), and the
  // Money-Equivalent Logic Rule (CLAUDE.md) forbids showing anything else.
  welcomeBack: {
    title: 'Welcome back',
    minutesElapsed: '{{count}} minutes into this session so far',
    rejoin: 'Rejoin session',
  },
  // Onboarding copy is PLACEHOLDER, flagged for the deferred copy pass. One
  // welcome page carrying the value proposition — the three-page carousel
  // (how sessions work / why the permission ask is coming) was collapsed to a
  // single screen, so that copy no longer exists anywhere in onboarding.
  // Re-introducing it somewhere is an open product/copy call
  // (docs/NAVY_THEME_PLAN.md §8).
  onboarding: {
    title: 'Time together, undistracted',
    body: 'Lockal Time blocks distracting apps while you and your friends are actually together — so being present is the easy choice.',
    getStarted: 'Get Started',
  },
  // Permission-priming copy (Screen 2) is PLACEHOLDER, flagged for the
  // deferred copy pass. It resolves the one "why permissions" hesitation
  // (DESIGN_GUIDELINES §9) and honestly reflects ARCHITECTURE §4: a fixed set
  // of default categories, applied only while a session runs.
  permissionPriming: {
    title: 'Allow app blocking',
    body: 'To block distracting apps for real, your phone needs a screen-time permission. It blocks a fixed set of categories — social, games, and entertainment — and only while a session you joined is running. It is never used outside a session.',
    allow: 'Allow',
    // Shown in the PRIMING state, beside Allow — distinct from the denied
    // state's proceedAnyway below, which appears only after a real refusal.
    // Two separate keys because the two links live in different states and
    // their copy should be free to diverge.
    maybeLater: 'Maybe later',
    denied: {
      title: 'Permission not granted',
      body: "Without it, apps won't actually be blocked during your sessions. You can grant it any time from your phone's settings, or continue without blocking for now.",
      openSettings: 'Open settings',
      proceedAnyway: 'Continue without blocking',
    },
  },
  // Auth copy (Screen 3) is PLACEHOLDER, flagged for the deferred copy pass.
  // Error strings are user-facing copy keyed off AuthFailure.kind only — the
  // failure's diagnostic message is never rendered
  // (.claude/skills/supabase-integration/SKILL.md).
  auth: {
    title: 'Sign in to Lockal Time',
    emailEntry: {
      placeholder: 'Your email address',
      continue: 'Continue',
      errors: {
        requestFailed: "We couldn't send a code to that address. Please try again.",
      },
    },
    codeEntry: {
      title: 'Check your email',
      body: 'We sent a 6-digit code to your address. Enter it here to sign in.',
      verify: 'Verify',
      errors: {
        invalidCode: "That code isn't right or has expired. Check it and try again.",
      },
    },
    errors: {
      network: "Something went wrong reaching the server. Check your connection and try again.",
    },
    providers: {
      google: 'Continue with Google',
      apple: 'Continue with Apple',
      unavailable: 'This sign-in option is not available yet. Please continue with email.',
      error: "That sign-in didn't work. Please try again or continue with email.",
    },
    accountLinking: {
      title: 'You already have an account',
      body: 'This email is already registered with a different sign-in method. Sign in with your email to keep everything in one account.',
      useEmail: 'Sign in with email',
    },
    // Phase 7 (Release Prep): a passive disclosure, not a blocking
    // checkbox — this screen handles both new and returning users through
    // the same flow (Supabase email-OTP creates the account on first
    // verify), so there is no separate "sign up" moment to gate. Tapping
    // either link opens the corresponding server-hosted route
    // (GET /legal/terms, /legal/privacy) via Linking.openURL.
    legalDisclosure: {
      prefix: 'By continuing, you agree to our',
      termsOfService: 'Terms of Service',
      and: 'and',
      privacyPolicy: 'Privacy Policy',
    },
  },
  // Phase 6 (B2B) — verified_host/admin only, gated at the route by
  // useProfileStore's role. Copy is PLACEHOLDER, flagged for the deferred
  // copy pass, same as every other screen in this file.
  venueManagement: {
    title: 'Your venues',
    empty: 'No venues yet. Add your first one below.',
    loadError: "We couldn't load your venues. Please try again.",
    retry: 'Retry',
    nameLabel: 'Venue name',
    namePlaceholder: 'e.g. Joe’s Cafe',
    addressLabel: 'Address (optional)',
    addressPlaceholder: 'e.g. 123 Main St',
    addVenue: 'Add venue',
    errors: {
      nameRequired: 'Enter a venue name.',
      requestFailed: "We couldn't add that venue. Please try again.",
    },
    // Printed as plain text (no QR-rendering library exists in this
    // codebase yet — same limitation ActiveSessionScreen's dynamic_qr card
    // already carries) — a business prints/copies this string, it doesn't
    // scan a rendered image from this screen.
    qrLabel: 'Venue code',
    regenerate: 'Regenerate code',
    regenerateConfirmTitle: 'Regenerate this venue’s code?',
    regenerateConfirmBody: 'The old printed code will stop working immediately. You’ll need to print the new one.',
    regenerateConfirm: 'Regenerate',
    regenerateCancel: 'Cancel',
    regenerateSuccess: 'New code generated.',
    regenerateError: "We couldn't regenerate the code. Please try again.",
  },
  // Phase 6 (B2B dashboard, ARCHITECTURE.md §10) — verified_host/admin
  // only. Aggregates only, no individual customers ever shown here.
  venueDashboard: {
    title: 'Venue activity',
    noVenues: 'Add a venue from Manage Venues to see its activity here.',
    loadError: "We couldn't load this venue's activity. Please try again.",
    retry: 'Retry',
    refresh: 'Refresh',
    concurrentCustomers: 'Customers here now',
    avgMinutesPerCustomer: 'Avg. minutes per customer ({{count}}-day)',
    sessionsInWindow: '{{count}} sessions in the last {{days}} days',
  },
  // Phase 6.5 (Social & Comparison Surfaces) — a friends-only leaderboard
  // ranked by total lifetime points, plus username search/request/accept.
  // Only totalPoints and a coarse "active today" signal are ever shown for
  // a friend — never their real streak length or session history.
  friends: {
    title: 'Friends',
    loadError: "We couldn't load your friends. Please try again.",
    retry: 'Retry',
    emptyLeaderboard: 'Add a friend to see how you compare.',
    you: 'You',
    pointsLabel: '{{count}} points',
    activeToday: 'Active today',
    search: {
      placeholder: 'Search by username',
      tooShort: 'Enter at least 2 characters.',
      noResults: 'No users found.',
      add: 'Add',
      requested: 'Requested',
      incoming: 'Respond below',
      friends: 'Friends',
      error: "We couldn't search right now. Please try again.",
    },
    requests: {
      title: 'Friend requests',
      accept: 'Accept',
      decline: 'Decline',
      error: "We couldn't do that. Please try again.",
    },
    remove: {
      label: 'Remove',
      confirmTitle: 'Remove this friend?',
      confirmBody: 'You can send a new request later if you change your mind.',
      confirm: 'Remove',
      cancel: 'Cancel',
      error: "We couldn't remove this friend. Please try again.",
    },
  },
  // Settings (Phase 7, Release Prep) — sign-out and the App/Play Store-
  // mandated account deletion path both live here, the app's first
  // settings/account surface.
  settings: {
    title: 'Settings',
    signOut: 'Sign out',
    signOutError: "We couldn't sign you out. Please try again.",
    legal: {
      title: 'Legal',
      termsOfService: 'Terms of Service',
      privacyPolicy: 'Privacy Policy',
    },
    deleteAccount: {
      title: 'Delete account',
      body: 'This permanently deletes your account and all its data — points, streaks, session history, and friends. This cannot be undone.',
      holdToDelete: 'Hold to delete account',
      cancel: 'Cancel',
      error: "We couldn't delete your account. Please try again.",
    },
  },
};

export type TranslationSchema = typeof en;
