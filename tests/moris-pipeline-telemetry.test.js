import { describe, it, expect, vi } from 'vitest';
import { debugEnabled } from '../functions/api/moris/search.js';
import { trace, summarizeTrace } from '../functions/_lib/moris/v5/runtime/trace.js';

describe('P01 Moris diagnostics access and timings', () => {
  it('requires both the existing debug flag and a server-validated admin role', () => {
    const enabled = { MORIS_DEBUG_EXPOSE_INTERNAL: 'true' };
    expect(debugEnabled(enabled, { role_name: 'viewer' })).toBe(false);
    expect(debugEnabled(enabled, { role_name: 'editor' })).toBe(false);
    expect(debugEnabled(enabled, null)).toBe(false);
    expect(debugEnabled({}, { role_name: 'admin' })).toBe(false);
    expect(debugEnabled(enabled, { role_name: 'admin' })).toBe(true);
  });

  it('reports monotonic stage durations without exposing trace payload fields', () => {
    const spy = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(125)
      .mockReturnValueOnce(145);
    try {
      const ctx = { trace: [], started_monotonic_ms: 90 };
      trace(ctx, 'preprocess', { secret: 'must stay internal' });
      trace(ctx, 'encode');
      expect(summarizeTrace(ctx)).toEqual([
        { stage: 'preprocess', elapsed_ms: 10, duration_ms: 25 },
        { stage: 'encode', elapsed_ms: 35, duration_ms: 20 }
      ]);
      expect(JSON.stringify(summarizeTrace(ctx))).not.toContain('must stay internal');
    } finally {
      spy.mockRestore();
    }
  });
});
