import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); });

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

/**
 * Mock toàn bộ Supabase (PostgREST RPC + GoTrue admin).
 * `me` = kết quả RPC app_me; `profile` = profiles row của token hiện tại.
 */
function mockSupabase({ me, profile, users = [] }) {
  const state = { calls: [] };
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = String(opts.method || 'GET').toUpperCase();
    state.calls.push(`${method} ${u}`);

    if (u.includes('/rest/v1/rpc/app_me')) return json(me ?? { ok: false, message: 'Session hết hạn' });
    if (u.includes('/rest/v1/rpc/app_admin_list_profiles')) return json(users);
    if (u.includes('/rest/v1/rpc/app_admin_set_profile_role')) {
      const args = JSON.parse(opts.body || '{}');
      return json({ ok: true, role_name: args.p_role_name });
    }
    if (u.includes('/rest/v1/rpc/app_admin_unlock_profile')) {
      return json({ ok: true, message: 'Đã mở khóa tài khoản.' });
    }
    if (u.includes('/auth/v1/admin/users/')) return json({ id: 'x', aud: 'authenticated' });
    if (u.includes('/rest/v1/profiles')) return json(profile ? [profile] : []);
    if (u.includes('/rest/v1/user_security')) return json([]);
    if (u.includes('/auth/v1/logout')) return json({});

    throw new Error(`fetch không mong đợi: ${method} ${u}`);
  }));
  return state;
}

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key'
};

function req(path, { method = 'GET', token = '', body = null } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  return new Request(`https://example.com${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
}

const ADMIN_PROFILE = {
  id: 'admin-1', email: 'admin@example.com',
  role_name: 'admin', is_active: true
};

async function read(handler, request) {
  const res = await handler({ request, env: ENV });
  return { res, data: await res.json().catch(() => null) };
}

describe('GET /api/auth/session', () => {
  it('thiếu token -> 401', async () => {
    mockSupabase({ me: { ok: true }, profile: ADMIN_PROFILE });
    const { onRequestGet } = await import('../functions/api/auth/session.js');
    const { res } = await read(onRequestGet, req('/api/auth/session'));
    expect(res.status).toBe(401);
  });

  it('token hợp lệ -> trả user + role_name viết thường', async () => {
    mockSupabase({
      me: { ok: true, user_id: 'admin-1', username: 'admin@example.com', display_name: 'admin', role_name: 'Admin' },
      profile: { ...ADMIN_PROFILE, role_name: 'ADMIN' }
    });
    const { onRequestGet } = await import('../functions/api/auth/session.js');
    const { res, data } = await read(onRequestGet, req('/api/auth/session', { token: 'jwt' }));
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.user.role_name).toBe('admin');
    expect(data.user.email).toBe('admin@example.com');
  });

  it('profile is_active=false -> 403', async () => {
    mockSupabase({
      me: { ok: true, user_id: 'admin-1', username: 'a@b.c', display_name: 'a', role_name: 'admin' },
      profile: { ...ADMIN_PROFILE, is_active: false }
    });
    const { onRequestGet } = await import('../functions/api/auth/session.js');
    const { res } = await read(onRequestGet, req('/api/auth/session', { token: 'jwt' }));
    expect(res.status).toBe(403);
  });

  it('session hết hạn (app_me ok:false) -> 401', async () => {
    mockSupabase({ me: { ok: false, message: 'Session hết hạn' }, profile: ADMIN_PROFILE });
    const { onRequestGet } = await import('../functions/api/auth/session.js');
    const { res } = await read(onRequestGet, req('/api/auth/session', { token: 'jwt' }));
    expect(res.status).toBe(401);
  });
});

describe('/api/auth/users — phân quyền admin', () => {
  const LISTED = [{
    user_id: 'u1', email: 'vinh@example.com', display_name: 'vinh',
    role_name: 'viewer', is_active: true, failed_count: 5,
    locked_until: '2026-10-07T02:00:00.000Z', permanent_lock: false,
    must_reset: false, last_login_at: null
  }];

  it('GET khi không phải admin -> 403 đúng thông điệp', async () => {
    mockSupabase({
      me: { ok: true, user_id: 'u1', username: 'v@x.c', display_name: 'v', role_name: 'viewer' },
      profile: { id: 'u1', email: 'v@x.c', role_name: 'viewer', is_active: true }
    });
    const { onRequestGet } = await import('../functions/api/auth/users.js');
    const { res, data } = await read(onRequestGet, req('/api/auth/users', { token: 'jwt' }));
    expect(res.status).toBe(403);
    expect(data.error).toBe('Bạn chưa được cấp quyền, liên hệ admin.');
  });

  it('GET khi là admin -> danh sách user kèm trạng thái khóa', async () => {
    mockSupabase({
      me: { ok: true, user_id: 'admin-1', username: 'admin@x.c', display_name: 'admin', role_name: 'admin' },
      profile: ADMIN_PROFILE,
      users: LISTED
    });
    const { onRequestGet } = await import('../functions/api/auth/users.js');
    const { res, data } = await read(onRequestGet, req('/api/auth/users', { token: 'jwt' }));
    expect(res.status).toBe(200);
    expect(data.users).toHaveLength(1);
    expect(data.users[0].failed_count).toBe(5);
    expect(data.users[0].permanent_lock).toBe(false);
  });

  it('POST khi không phải admin -> 403 (không đổi được role)', async () => {
    const state = mockSupabase({
      me: { ok: true, user_id: 'u1', username: 'v@x.c', display_name: 'v', role_name: 'converter' },
      profile: { id: 'u1', email: 'v@x.c', role_name: 'converter', is_active: true }
    });
    const { onRequestPost } = await import('../functions/api/auth/users.js');
    const { res } = await read(onRequestPost, req('/api/auth/users', {
      method: 'POST', token: 'jwt',
      body: { user_id: 'u1', action: 'set_role', role: 'admin' }
    }));
    expect(res.status).toBe(403);
    expect(state.calls.some((c) => c.includes('app_admin_set_profile_role'))).toBe(false);
  });

  it('POST set_role với role lạ -> 400', async () => {
    mockSupabase({
      me: { ok: true, user_id: 'admin-1', username: 'a@x.c', display_name: 'a', role_name: 'admin' },
      profile: ADMIN_PROFILE
    });
    const { onRequestPost } = await import('../functions/api/auth/users.js');
    const { res, data } = await read(onRequestPost, req('/api/auth/users', {
      method: 'POST', token: 'jwt',
      body: { user_id: 'u1', action: 'set_role', role: 'superuser' }
    }));
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/viewer \| converter \| admin/);
  });

  it('admin set_role thành công -> 200', async () => {
    mockSupabase({
      me: { ok: true, user_id: 'admin-1', username: 'a@x.c', display_name: 'a', role_name: 'admin' },
      profile: ADMIN_PROFILE
    });
    const { onRequestPost } = await import('../functions/api/auth/users.js');
    const { res, data } = await read(onRequestPost, req('/api/auth/users', {
      method: 'POST', token: 'jwt',
      body: { user_id: 'u1', action: 'set_role', role: 'converter' }
    }));
    expect(res.status).toBe(200);
    expect(data.role_name).toBe('converter');
  });

  it('admin unlock -> 200', async () => {
    mockSupabase({
      me: { ok: true, user_id: 'admin-1', username: 'a@x.c', display_name: 'a', role_name: 'admin' },
      profile: ADMIN_PROFILE
    });
    const { onRequestPost } = await import('../functions/api/auth/users.js');
    const { res, data } = await read(onRequestPost, req('/api/auth/users', {
      method: 'POST', token: 'jwt',
      body: { user_id: 'u1', action: 'unlock' }
    }));
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('admin reset_password -> trả mật khẩu tạm (kể cả khi user_security chưa có row)', async () => {
    mockSupabase({
      me: { ok: true, user_id: 'admin-1', username: 'a@x.c', display_name: 'a', role_name: 'admin' },
      profile: ADMIN_PROFILE
    });
    const { onRequestPost } = await import('../functions/api/auth/users.js');
    const { res, data } = await read(onRequestPost, req('/api/auth/users', {
      method: 'POST', token: 'jwt',
      body: { user_id: 'u1', action: 'reset_password' }
    }));
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.temp_password).toMatch(/^[A-Za-z0-9]{12,}$/);
    expect(data.must_reset).toBe(true);
  });

  it('action lạ -> 400', async () => {
    mockSupabase({
      me: { ok: true, user_id: 'admin-1', username: 'a@x.c', display_name: 'a', role_name: 'admin' },
      profile: ADMIN_PROFILE
    });
    const { onRequestPost } = await import('../functions/api/auth/users.js');
    const { res } = await read(onRequestPost, req('/api/auth/users', {
      method: 'POST', token: 'jwt',
      body: { user_id: 'u1', action: 'delete_user' }
    }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/logout', () => {
  it('luôn trả ok (best-effort thu hồi phiên)', async () => {
    mockSupabase({ me: { ok: true }, profile: ADMIN_PROFILE });
    const { onRequestPost } = await import('../functions/api/auth/logout.js');
    const { res, data } = await read(onRequestPost, req('/api/auth/logout', {
      method: 'POST', body: { access_token: 'at' }
    }));
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('thiếu config -> 503', async () => {
    mockSupabase({ me: { ok: true }, profile: ADMIN_PROFILE });
    const { onRequestPost } = await import('../functions/api/auth/logout.js');
    const res = await onRequestPost({
      request: req('/api/auth/logout', { method: 'POST', body: {} }),
      env: {}
    });
    expect(res.status).toBe(503);
  });
});
