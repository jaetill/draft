// Lambda: POST /feedback â€” accepts user-submitted feedback, files a GitHub Issue.
//
// Per Platform Standard 11 / ADR-0012.
// Adapted from game-night-pwa pattern.
//
// Environment variables:
//   GITHUB_REPO_OWNER  â€” defaults to "jaetill"
//   GITHUB_REPO_NAME   â€” defaults to "draft"
//   GITHUB_SECRET_ID   â€” defaults to "draft/github-token"
//
// Secrets Manager value at GITHUB_SECRET_ID must be JSON: { "GITHUB_TOKEN": "ghp_..." }

'use strict';

const { Sentry } = require('./lib/sentry');
const logger = require('./lib/logger');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const REGION = process.env.AWS_REGION || 'us-east-2';
const REPO_OWNER = process.env.GITHUB_REPO_OWNER || 'jaetill';
const REPO_NAME = process.env.GITHUB_REPO_NAME || 'draft';
const SECRET_ID = process.env.GITHUB_SECRET_ID || 'draft/github-token';

const ALLOWED_ORIGINS = new Set(['https://draft.jaetill.com', 'http://localhost:5173']);

const SAFE_PAGE_ENTRIES = [{ origin: 'https://draft.jaetill.com', pathPrefix: '' }];

function isSafePageUrl(url) {
  if (typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return SAFE_PAGE_ENTRIES.some(
    (e) =>
      parsed.origin === e.origin &&
      (e.pathPrefix === '' || parsed.pathname.startsWith(e.pathPrefix)),
  );
}

const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = 10;
const RATE_LIMITS_MAX_KEYS = 10_000;

function makeRateLimiter() {
  const buckets = new Map();
  return function checkRateLimit(ip) {
    const now = Date.now();
    const existing = buckets.get(ip);
    if (!existing || now - existing.windowStart >= WINDOW_MS) {
      if (buckets.size >= RATE_LIMITS_MAX_KEYS) {
        for (const [k, e] of buckets.entries()) {
          if (now - e.windowStart >= WINDOW_MS) buckets.delete(k);
        }
      }
      buckets.set(ip, { count: 1, windowStart: now });
      return { allowed: true };
    }
    if (existing.count >= LIMIT) {
      return {
        allowed: false,
        retryAfter: Math.ceil((WINDOW_MS - (now - existing.windowStart)) / 1000),
      };
    }
    existing.count += 1;
    return { allowed: true };
  };
}

function escapeMarkdown(str) {
  return str.replace(/[\\*_#[\]`<>!]/g, '\\$&');
}

const ALLOWED_TYPES = new Set(['bug', 'feature', 'other']);

function validate(input) {
  if (!input || typeof input !== 'object') return 'body must be an object';
  if (!ALLOWED_TYPES.has(input.type)) return 'type must be one of: bug, feature, other';
  if (typeof input.description !== 'string') return 'description must be a string';
  if (input.description.length < 10 || input.description.length > 2000) {
    return 'description must be 10-2000 characters';
  }
  if (input.email !== undefined) {
    if (typeof input.email !== 'string' || !input.email.includes('@') || input.email.length > 254) {
      return 'email must be a valid email address';
    }
  }
  if (
    input.page_url !== undefined &&
    (typeof input.page_url !== 'string' || input.page_url.length > 2048)
  ) {
    return 'page_url must be a string under 2048 chars';
  }
  if (
    input.user_agent !== undefined &&
    (typeof input.user_agent !== 'string' || input.user_agent.length > 512)
  ) {
    return 'user_agent must be a string under 512 chars';
  }
  return null;
}

function corsHeaders(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin)
      ? origin
      : 'https://draft.jaetill.com',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json',
  };
}

function respond(status, body, headers) {
  return { statusCode: status, headers, body: JSON.stringify(body) };
}

function createHandler(deps = {}) {
  const smClient = deps.smClient || new SecretsManagerClient({ region: REGION });
  const checkRateLimit = deps.checkRateLimit || makeRateLimiter();

  let _secrets;
  async function getSecrets() {
    if (!_secrets) {
      const res = await smClient.send(new GetSecretValueCommand({ SecretId: SECRET_ID }));
      _secrets = JSON.parse(res.SecretString);
    }
    return _secrets;
  }

  let _octokitClass = deps.Octokit;
  let _octokit;
  async function getOctokit() {
    if (!_octokit) {
      if (!_octokitClass) {
        const mod = await import('@octokit/rest');
        _octokitClass = mod.Octokit;
      }
      const { GITHUB_TOKEN } = await getSecrets();
      if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN missing from Secrets Manager value');
      _octokit = new _octokitClass({ auth: GITHUB_TOKEN });
    }
    return _octokit;
  }

  return Sentry.wrapHandler(async (event, context) => {
    logger.info('handler.invoked', {
      request_id: context?.awsRequestId,
      method: event.requestContext?.http?.method || event.httpMethod,
    });

    const CORS = corsHeaders(event);
    const method = event.requestContext?.http?.method || event.httpMethod;

    if (method === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
    if (method !== 'POST') return respond(405, { error: 'method_not_allowed' }, CORS);

    const ip =
      event.requestContext?.http?.sourceIp || event.requestContext?.identity?.sourceIp || 'unknown';

    const rl = checkRateLimit(ip);
    if (!rl.allowed) {
      return respond(
        429,
        { error: 'rate_limited', retry_after_seconds: rl.retryAfter },
        { ...CORS, 'Retry-After': String(rl.retryAfter) },
      );
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return respond(400, { error: 'invalid_json' }, CORS);
    }

    if (typeof body.website === 'string' && body.website.length > 0) {
      logger.warn('feedback.honeypot_triggered', { request_id: context?.awsRequestId, ip });
      return respond(201, { id: `FB-DROPPED-${Date.now()}`, status: 'received' }, CORS);
    }

    const violation = validate(body);
    if (violation) return respond(400, { error: 'validation_error', detail: violation }, CORS);

    const titleBody =
      body.description.length > 60
        ? body.description.slice(0, 60).trim() + '...'
        : body.description;
    const issueTitle = `[${body.type}] ${escapeMarkdown(titleBody)}`;
    const issueBody = [
      '## Description',
      escapeMarkdown(body.description),
      '',
      '## Context',
      body.page_url && isSafePageUrl(body.page_url)
        ? `- Page: ${escapeMarkdown(body.page_url)}`
        : null,
      body.user_agent ? `- UA: ${escapeMarkdown(body.user_agent)}` : null,
      body.email ? `- Email: ${escapeMarkdown(body.email)}` : null,
      `- Source IP: ${ip}`,
      `- Lambda request: ${context?.awsRequestId || 'unknown'}`,
      '',
      '## Triage',
      'Will be classified by `triage-bot` agent on next scheduled scan.',
    ]
      .filter(Boolean)
      .join('\n');

    let octokit;
    try {
      octokit = await getOctokit();
    } catch (err) {
      logger.error('feedback.secrets_failed', {
        request_id: context?.awsRequestId,
        error: err.message,
      });
      Sentry.captureException(err);
      return respond(500, { error: 'configuration_error' }, CORS);
    }

    try {
      const result = await octokit.rest.issues.create({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        title: issueTitle,
        body: issueBody,
        labels: ['feedback:user-submitted', `type:${body.type}`],
      });
      const id = `FB-${new Date().getFullYear()}-${String(result.data.number).padStart(6, '0')}`;
      logger.info('feedback.received', {
        request_id: context?.awsRequestId,
        id,
        type: body.type,
        issue_number: result.data.number,
      });
      return respond(201, { id, status: 'received' }, CORS);
    } catch (err) {
      logger.error('feedback.github_failed', {
        request_id: context?.awsRequestId,
        error: err.message,
        status: err.status,
      });
      Sentry.captureException(err);
      return respond(502, { error: 'github_issue_creation_failed' }, CORS);
    }
  });
}

exports.handler = createHandler();

exports._createHandler = createHandler;
exports._validate = validate;
exports._makeRateLimiter = makeRateLimiter;
exports._escapeMarkdown = escapeMarkdown;
exports._isSafePageUrl = isSafePageUrl;
