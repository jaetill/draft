/**
 * Sentry browser SDK init per platform ADR-0009.
 * Imported from index.html before any app code (additive — no-op without VITE_SENTRY_DSN).
 * PII-aware per ADR-0006.
 */

import * as Sentry from '@sentry/browser';

const dsn = import.meta.env.VITE_SENTRY_DSN;
const environment = import.meta.env.VITE_DEPLOY_ENV ?? 'production';
const release = import.meta.env.VITE_RELEASE_VERSION;

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    release,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.feedbackIntegration({
        colorScheme: 'system',
        showBranding: false,
        autoInject: true,
        formTitle: 'Report a bug',
        submitButtonLabel: 'Send report',
        successMessageText: 'Thanks — we got it.',
      }),
    ],
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    beforeSend(event) {
      if (event.user) {
        delete event.user.email;
        delete event.user.username;
      }
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => {
          if (b.category === 'ui.input' && b.message) {
            b.message = b.message.replace(/value=".*?"/g, 'value="[REDACTED]"');
          }
          return b;
        });
      }
      return event;
    },
  });
}
