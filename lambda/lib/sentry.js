/**
 * Sentry init shared across meal-planner Lambda functions per platform ADR-0009.
 *
 * Usage:
 *   const { Sentry } = require('./lib/sentry');
 *   exports.handler = Sentry.wrapHandler(async (event, context) => {
 *     // existing handler logic
 *   });
 *
 * Set SENTRY_DSN, DEPLOY_ENV, and RELEASE_VERSION env vars on the Lambda.
 * When SENTRY_DSN is empty Sentry.init is a no-op and wrapHandler passes through.
 */

const Sentry = require('@sentry/aws-serverless');

// Email and JWT scrubbers used by both `beforeSend` and `beforeBreadcrumb` to
// catch any PII that slips past the structured logger's field-level redaction.
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

function scrubString(s) {
  if (typeof s !== 'string') return s;
  return s.replace(EMAIL_RE, '[REDACTED_EMAIL]').replace(JWT_RE, '[REDACTED_JWT]');
}

function scrubObject(obj, depth = 0) {
  if (depth > 4 || obj === null || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') obj[k] = scrubString(v);
    else if (typeof v === 'object') scrubObject(v, depth + 1);
  }
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.DEPLOY_ENV || 'production',
  release: process.env.RELEASE_VERSION || 'unknown',
  tracesSampleRate: 0.1,

  // PII scrubbing per ADR-0006. The default integrations include
  // `consoleIntegration`, which captures every `console.log` (= every line the
  // structured logger emits) as a breadcrumb on subsequent `captureException`
  // events. Without scrubbing here, an email embedded in an upstream error
  // string can land in Sentry via the breadcrumb path.
  beforeSend(event) {
    if (event.user) {
      delete event.user.email;
      delete event.user.username;
      delete event.user.ip_address;
    }
    if (event.breadcrumbs) {
      for (const bc of event.breadcrumbs) {
        if (bc.message) bc.message = scrubString(bc.message);
        if (bc.data) scrubObject(bc.data);
      }
    }
    if (event.exception?.values) {
      for (const ex of event.exception.values) {
        if (ex.value) ex.value = scrubString(ex.value);
      }
    }
    if (event.extra) scrubObject(event.extra);
    return event;
  },

  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.message) breadcrumb.message = scrubString(breadcrumb.message);
    if (breadcrumb.data) scrubObject(breadcrumb.data);
    return breadcrumb;
  },
});

module.exports = { Sentry };