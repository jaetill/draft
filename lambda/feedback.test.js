import { describe, test, expect, vi } from 'vitest';
import { _corsHeaders } from './feedback.js';

// Prevent @sentry/aws-serverless OTEL instrumentation from running at load time.
vi.mock('./lib/sentry', () => ({
  Sentry: {
    wrapHandler: (fn) => fn,
    captureException: vi.fn(),
  },
}));

describe('corsHeaders()', () => {
  test('reflects https://draft.jaetill.com (primary allowed origin)', () => {
    const h = _corsHeaders({ headers: { origin: 'https://draft.jaetill.com' } });
    expect(h['Access-Control-Allow-Origin']).toBe('https://draft.jaetill.com');
  });

  test('reflects http://localhost:5173 (dev allowed origin)', () => {
    const h = _corsHeaders({ headers: { origin: 'http://localhost:5173' } });
    expect(h['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
  });

  test('falls back to draft.jaetill.com for wrong-app origin meals.jaetill.com', () => {
    const h = _corsHeaders({ headers: { origin: 'https://meals.jaetill.com' } });
    expect(h['Access-Control-Allow-Origin']).toBe('https://draft.jaetill.com');
  });

  test('falls back to draft.jaetill.com for unknown origin', () => {
    const h = _corsHeaders({ headers: { origin: 'https://evil.example.com' } });
    expect(h['Access-Control-Allow-Origin']).toBe('https://draft.jaetill.com');
  });
});
