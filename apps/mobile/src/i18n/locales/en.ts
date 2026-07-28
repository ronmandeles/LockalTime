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
    },
    duration: {
      label: 'Duration',
      fixed: 'Set a time',
      openEnded: 'Until I end it',
      minutesPlaceholder: 'Minutes',
    },
    submit: 'Start session',
    errors: {
      minutesRequired: 'Enter how many minutes this session should run.',
      requestFailed: "We couldn't create the session. Please try again.",
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
    errors: {
      session_not_found: "This session doesn't exist or has already ended.",
      session_not_joinable: 'This session is no longer accepting new people.',
      qr_token_expired: "This QR code has expired. Ask the host for a new one.",
      session_at_capacity: 'This session is full.',
      invalid_qr_token: "That code isn't valid. Check it and try again.",
      not_a_prior_participant: "You weren't part of this session, so it can't be rejoined this way.",
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
  // Onboarding copy is PLACEHOLDER, flagged for the deferred copy pass. Each
  // page resolves one hesitation (DESIGN_GUIDELINES §9): why this app / how
  // sessions work / why the permission ask is coming.
  onboarding: {
    pages: {
      valueProposition: {
        title: 'Time together, undistracted',
        body: 'Lockal Time blocks distracting apps while you and your friends are actually together — so being present is the easy choice.',
      },
      howSessionsWork: {
        title: 'Sessions are simple',
        body: "Start a session or scan a friend's QR code. Distracting apps stay blocked until the session ends, and you earn points for every minute you're present.",
      },
      whyPermissionsMatter: {
        title: 'One permission makes it real',
        body: "To truly block apps, your phone requires a screen-time permission. We'll ask on the next screen — it's only ever used during a session you chose to start.",
      },
    },
    skip: 'Skip',
    next: 'Next',
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
  },
};

export type TranslationSchema = typeof en;
