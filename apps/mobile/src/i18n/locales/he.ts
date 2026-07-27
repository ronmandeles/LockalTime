import type { TranslationSchema } from './en';

// Hebrew (RTL) bundle. Typed against the en schema so key drift between the
// two locales cannot compile — "both languages from day one" (CLAUDE.md).
// The Hebrew-script brand rendering and the onboarding copy are placeholder
// translations; final copy comes with the deferred palette/copy pass.
export const he: TranslationSchema = {
  home: {
    title: 'לוקאל טיים',
    createSession: 'יצירת סשן',
    scanQr: 'סריקת QR',
  },
  createSession: {
    title: 'יצירת סשן',
    type: {
      label: 'מי יכול להצטרף',
      solo: 'רק אני',
      dynamicQr: 'חברים דרך קוד QR',
    },
    duration: {
      label: 'משך',
      fixed: 'קביעת זמן',
      openEnded: 'עד שאסיים',
      minutesPlaceholder: 'דקות',
    },
    submit: 'התחלת סשן',
    errors: {
      minutesRequired: 'הזינו כמה דקות הסשן יימשך.',
      requestFailed: 'לא הצלחנו ליצור את הסשן. נסו שוב.',
    },
  },
  scanSession: {
    title: 'הצטרפות לסשן',
    body: 'הזינו את הקוד מה-QR של המארח כדי להצטרף לסשן שלו.',
    tokenPlaceholder: 'קוד סשן',
    continue: 'המשך',
    errors: {
      tokenRequired: 'הזינו קוד סשן כדי להמשיך.',
    },
  },
  sessionDetails: {
    title: 'להצטרף לסשן הזה?',
    body: 'אתם עומדים להצטרף לסשן. אפליקציות מסיחות דעת יישארו חסומות לכל הנוכחים עד לסיומו.',
    join: 'הצטרפות לסשן',
    joining: 'מצטרפים…',
    errors: {
      session_not_found: 'הסשן הזה לא קיים או שכבר הסתיים.',
      session_not_joinable: 'הסשן הזה כבר לא מקבל אנשים חדשים.',
      qr_token_expired: 'קוד ה-QR הזה פג תוקף. בקשו מהמארח קוד חדש.',
      session_at_capacity: 'הסשן הזה מלא.',
      invalid_qr_token: 'הקוד הזה לא תקין. בדקו אותו ונסו שוב.',
      unknown: 'משהו השתבש בהצטרפות. נסו שוב.',
    },
  },
  activeSession: {
    title: 'סשן פעיל',
    status: {
      pending: 'ממתין להתחלה',
      active: 'פעיל',
      host_disconnected: 'המארח מתחבר מחדש…',
      participant_reconnecting: 'מתחבר מחדש…',
      degraded_offline: 'לא מקוון',
      completed: 'הסשן הסתיים',
      force_terminated: 'הסשן הסתיים',
    },
    participants: {
      title: 'מי כאן',
      empty: 'ממתינים שאנשים יצטרפו…',
      count: '{{count}} נוכחים',
    },
    timer: {
      elapsed: 'זמן שחלף',
      remaining: 'זמן שנותר',
    },
    qrLabel: 'שתפו קוד זה כדי לאפשר לאחרים להצטרף',
  },
  onboarding: {
    pages: {
      valueProposition: {
        title: 'זמן ביחד, בלי הסחות דעת',
        body: 'לוקאל טיים חוסמת אפליקציות מסיחות דעת בזמן שאתם באמת ביחד — כך שלהיות נוכחים הופך לבחירה הקלה.',
      },
      howSessionsWork: {
        title: 'סשן זה דבר פשוט',
        body: 'מתחילים סשן או סורקים קוד QR של חבר. אפליקציות מסיחות דעת נשארות חסומות עד סוף הסשן, וצוברים נקודות על כל דקה של נוכחות.',
      },
      whyPermissionsMatter: {
        title: 'הרשאה אחת עושה את ההבדל',
        body: 'כדי לחסום אפליקציות באמת, הטלפון דורש הרשאת זמן מסך. נבקש אותה במסך הבא — והיא משמשת אך ורק במהלך סשן שבחרתם להתחיל.',
      },
    },
    skip: 'דילוג',
    next: 'הבא',
    getStarted: 'מתחילים',
  },
  permissionPriming: {
    title: 'אישור חסימת אפליקציות',
    body: 'כדי לחסום אפליקציות מסיחות דעת באמת, הטלפון זקוק להרשאת זמן מסך. ההרשאה חוסמת קטגוריות קבועות — רשתות חברתיות, משחקים ובידור — ורק בזמן סשן שהצטרפתם אליו. היא אינה בשימוש מחוץ לסשן.',
    allow: 'אישור',
    denied: {
      title: 'ההרשאה לא ניתנה',
      body: 'בלעדיה, אפליקציות לא ייחסמו באמת במהלך הסשנים שלכם. אפשר להעניק אותה בכל רגע דרך הגדרות הטלפון, או להמשיך בינתיים בלי חסימה.',
      openSettings: 'פתיחת הגדרות',
      proceedAnyway: 'המשך בלי חסימה',
    },
  },
  auth: {
    title: 'התחברות ללוקאל טיים',
    emailEntry: {
      placeholder: 'כתובת האימייל שלך',
      continue: 'המשך',
      errors: {
        requestFailed: 'לא הצלחנו לשלוח קוד לכתובת הזו. נסו שוב.',
      },
    },
    codeEntry: {
      title: 'בדקו את האימייל',
      body: 'שלחנו קוד בן 6 ספרות לכתובת שלכם. הזינו אותו כאן כדי להתחבר.',
      verify: 'אימות',
      errors: {
        invalidCode: 'הקוד שגוי או שפג תוקפו. בדקו אותו ונסו שוב.',
      },
    },
    errors: {
      network: 'משהו השתבש בתקשורת עם השרת. בדקו את החיבור ונסו שוב.',
    },
    providers: {
      google: 'המשך עם Google',
      apple: 'המשך עם Apple',
      unavailable: 'אפשרות ההתחברות הזו עדיין לא זמינה. המשיכו עם אימייל.',
      error: 'ההתחברות הזו לא הצליחה. נסו שוב או המשיכו עם אימייל.',
    },
    accountLinking: {
      title: 'כבר יש לכם חשבון',
      body: 'האימייל הזה כבר רשום עם אמצעי התחברות אחר. התחברו עם האימייל כדי לשמור על חשבון אחד.',
      useEmail: 'התחברות עם אימייל',
    },
  },
};
