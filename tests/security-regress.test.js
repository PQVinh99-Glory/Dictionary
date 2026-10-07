import { describe, it, expect, vi, afterEach } from 'vitest';

// =============================================================================
// Test hồi quy cho 3 lỗi đã sửa:
//   1) /api/moris/* ném lỗi -> Pages trả 500 "error code: 1101" (text/plain)
//   2) validateSession nhận token không phải JWT -> PostgREST 400 -> 1101
//   3) upload.js gửi Bearer ANON -> app_me không thấy user ->
//      "Session không hợp lệ hoặc đã hết hạn." (thêm ảnh/mã mới LUÔN lỗi)
// =============================================================================
afterEach(() => { vi.unstubAllGlobals(); });

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key'
};

describe('/api/moris/_middleware — bắt lỗi thành JSON đúng mã', () => {
  it('handler ném lỗi có status=401 -> 401 JSON (không phải 500/1101 text/plain)', async () => {
    const { onRequest } = await import('../functions/api/moris/_middleware.js');
    const e = new Error('Session không hợp lệ hoặc đã hết hạn.');
    e.status = 401;
    const res = await onRequest({
      request: new Request('https://example.com/api/moris/health-admin'),
      env: ENV,
      next: async () => { throw e; }
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Session không hợp lệ');
  });

  it('handler ném lỗi không có status -> 500 JSON và KHÔNG lộ thông điệp nội bộ', async () => {
    const { onRequest } = await import('../functions/api/moris/_middleware.js');
    const res = await onRequest({
      request: new Request('https://example.com/api/moris/health-admin'),
      env: ENV,
      next: async () => { throw new Error('supabase internal: chìa khoá xyz'); }
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(JSON.stringify(body)).not.toContain('chìa khoá');
  });

  it('handler chạy OK -> giữ header bảo mật', async () => {
    const { onRequest } = await import('../functions/api/moris/_middleware.js');
    const res = await onRequest({
      request: new Request('https://example.com/api/moris/health'),
      env: ENV,
      next: async () => new Response('ok', { status: 200 })
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('Origin không cho phép -> 403 JSON', async () => {
    const { onRequest } = await import('../functions/api/moris/_middleware.js');
    const res = await onRequest({
      request: new Request('https://example.com/api/moris/search', {
        method: 'POST',
        headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
        body: '{}'
      }),
      env: ENV,
      next: async () => new Response('ok')
    });
    expect(res.status).toBe(403);
    expect((await res.json()).ok).toBe(false);
  });
});

describe('validateSession — chặn token không phải JWT trước PostgREST', () => {
  it('token thiếu dấu chấm -> 401 và KHÔNG gọi Supabase', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { validateSession } = await import('../functions/_lib/moris/v5/connectors/supabase.js');
    const err = await validateSession(ENV, 'token-het-phan').catch(e => e);
    expect(err.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('thiếu token -> 401 rõ ràng', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { validateSession } = await import('../functions/_lib/moris/v5/connectors/supabase.js');
    const err = await validateSession(ENV, '').catch(e => e);
    expect(err.status).toBe(401);
  });

  it('token JWT hợp lệ -> gọi app_me và trả về row', async () => {
    const fetchMock = vi.fn(async () => json([{ ok: true, user_id: 'u1', role_name: 'admin' }]));
    vi.stubGlobal('fetch', fetchMock);
    const { validateSession } = await import('../functions/_lib/moris/v5/connectors/supabase.js');
    const row = await validateSession(ENV, 'aaa.bbb.ccc');
    expect(row.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/rest/v1/rpc/app_me');
    // Bearer phải là CHÍNH token người dùng (auth.jwt()->>'sub')
    expect(opts.headers.authorization).toBe('Bearer aaa.bbb.ccc');
  });
});

describe('/api/upload — app_me phải nhận JWT người dùng (gốc lỗi Session)', () => {
  it('gửi Bearer <token>, KHÔNG gửi Bearer <anon>', async () => {
    const seen = {};
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      if (String(url).includes('/rest/v1/rpc/app_me')) {
        seen.authorization = opts.headers.authorization;
        seen.apikey = opts.headers.apikey;
        return json([{ ok: true, role_name: 'admin' }]);
      }
      throw new Error('fetch không mong đợi: ' + url);
    }));

    const { onRequestPost } = await import('../functions/api/upload.js');
    const request = new Request('https://example.com/api/upload', {
      method: 'POST',
      headers: { 'x-session-token': 'hdr.payload.sig' }
    });
    const res = await onRequestPost({
      request,
      env: { ...ENV, CATALOGUE_BUCKET: {} }
    });

    expect(seen.authorization).toBe('Bearer hdr.payload.sig');
    expect(seen.apikey).toBe('anon-key');
    // không có file -> dừng ở bước parse body (401 đã đi qua trước đó)
    expect(res.status).toBe(400);
  });

  it('token thiếu -> 401 "Thiếu x-session-token."', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { onRequestPost } = await import('../functions/api/upload.js');
    const res = await onRequestPost({
      request: new Request('https://example.com/api/upload', { method: 'POST' }),
      env: { ...ENV, CATALOGUE_BUCKET: {} }
    });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toContain('x-session-token');
  });

  it('token không phải JWT -> 401, không gọi Supabase', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { onRequestPost } = await import('../functions/api/upload.js');
    const res = await onRequestPost({
      request: new Request('https://example.com/api/upload', {
        method: 'POST', headers: { 'x-session-token': 'rác' }
      }),
      env: { ...ENV, CATALOGUE_BUCKET: {} }
    });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
