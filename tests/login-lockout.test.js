import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  sessionExpiry, tempPassword, configMissing, FAIL_WARN_AT, FAIL_PERMANENT_AT
} from '../functions/_lib/auth.js';

afterEach(() => { vi.unstubAllGlobals(); });

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

/**
 * Mock GoTrue (password grant) + PostgREST (profiles/user_security).
 * `state` cho phép test điều khiển số lần sai / khóa.
 */
function mockBackend({ profile, grantOk }) {
  const state = { sec: null, grantCalls: 0 };
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = String(opts.method || 'GET').toUpperCase();

    if (u.includes('/auth/v1/token')) {
      state.grantCalls += 1;
      if (!grantOk) return jsonResponse({ msg: 'Invalid login credentials' }, 400);
      return jsonResponse({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: profile?.id || 'u1', email: profile?.email || 'a@b.c' }
      });
    }

    if (u.includes('/rest/v1/profiles')) {
      return jsonResponse(profile ? [profile] : []);
    }

    if (u.includes('/rest/v1/user_security')) {
      if (method === 'GET') return jsonResponse(state.sec ? [state.sec] : []);
      if (method === 'PATCH') {
        state.sec = {
          failed_count: 0, locked_until: null, permanent_lock: false, must_reset: false,
          ...(state.sec || {}),
          ...JSON.parse(opts.body || '{}')
        };
        return jsonResponse([state.sec]);
      }
      if (method === 'POST') {
        const body = JSON.parse(opts.body || '{}');
        state.sec = {
          failed_count: 0, locked_until: null, permanent_lock: false, must_reset: false,
          ...body
        };
        return jsonResponse([state.sec]);
      }
    }

    throw new Error(`fetch không mong đợi: ${method} ${u}`);
  }));
  return state;
}

function loginRequest(body) {
  return new Request('https://example.com/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key'
};

const PROFILE = { id: 'u1', email: 'vinh@example.com', role_name: 'admin', is_active: true };

async function postLogin(body, env = ENV) {
  const { onRequestPost } = await import('../functions/api/auth/login.js');
  const res = await onRequestPost({ request: loginRequest(body), env });
  const data = await res.json().catch(() => null);
  return { res, data };
}

describe('sessionExpiry — chu kỳ 24h bắt đầu 07:00 giờ Việt Nam (00:00 UTC)', () => {
  it('hạn phiên luôn là 00:00 UTC kế tiếp', () => {
    // 2026-10-07 23:30 UTC -> hạn 2026-10-08 00:00 UTC
    expect(sessionExpiry(Date.parse('2026-10-07T23:30:00Z')))
      .toBe('2026-10-08T00:00:00.000Z');
    // 2026-10-07 00:00:00.000 (đúng mốc) -> không thuộc chu kỳ cũ -> hôm sau
    expect(sessionExpiry(Date.parse('2026-10-07T00:00:00Z')))
      .toBe('2026-10-08T00:00:00.000Z');
    // 2026-10-07 07:15 (= 00:15 UTC) -> hạn cùng ngày 00:00Z kế = 08/10
    expect(sessionExpiry(Date.parse('2026-10-07T00:15:00Z')))
      .toBe('2026-10-08T00:00:00.000Z');
    // 06:59 giờ VN hôm nay = 23:59Z hôm trước -> hạn 00:00Z hôm nay (còn <1 phút)
    expect(sessionExpiry(Date.parse('2026-10-06T23:59:00Z')))
      .toBe('2026-10-07T00:00:00.000Z');
  });

  it('hạn phiên luôn nằm trong tương lai so với thời điểm đăng nhập', () => {
    const now = Date.parse('2026-12-31T20:00:00Z');
    expect(Date.parse(sessionExpiry(now))).toBeGreaterThan(now);
  });
});

describe('tempPassword — mật khẩu tạm do admin cấp lại', () => {
  it('đủ độ dài, không ký tự dễ nhầm, có chữ/số', () => {
    for (let i = 0; i < 50; i++) {
      const pw = tempPassword();
      expect(pw.length).toBeGreaterThanOrEqual(12);
      expect(pw).toMatch(/^[A-Za-z0-9]+$/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).not.toMatch(/[O0Il1]/);
    }
  });
});

describe('configMissing — chặn chạy khi thiếu secret', () => {
  it('báo đúng biến còn thiếu', () => {
    expect(configMissing({})).toMatch(/SUPABASE_URL/);
    expect(configMissing({ SUPABASE_URL: 'https://x' })).toMatch(/SUPABASE_ANON_KEY/);
    expect(configMissing({
      SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'a'
    })).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(configMissing({
      SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'a', SUPABASE_SECRET_KEY: 's'
    })).toBe('');
  });
});

describe('POST /api/auth/login — chống dò mật khẩu', () => {
  it('sai 1..4 lần: trả 401 + "Còn X lần thử"', async () => {
    const state = mockBackend({ profile: PROFILE, grantOk: false });

    const first = await postLogin({ email: PROFILE.email, password: 'sai' });
    expect(first.res.status).toBe(401);
    expect(first.data.code).toBe('INVALID_CREDENTIALS');
    expect(first.data.remaining).toBe(FAIL_WARN_AT - 1);
    expect(first.data.error).toContain(`Còn ${FAIL_WARN_AT - 1} lần thử`);
    expect(state.sec.failed_count).toBe(1);

    let last = first;
    for (let i = 2; i < FAIL_WARN_AT; i++) {
      last = await postLogin({ email: PROFILE.email, password: 'sai' });
      expect(last.res.status).toBe(401);
      expect(last.data.remaining).toBe(FAIL_WARN_AT - i);
      expect(last.data.error).toContain(`Còn ${FAIL_WARN_AT - i} lần thử`);
    }
    expect(last.data.remaining).toBe(1);
    expect(state.sec.failed_count).toBe(4);
    expect(state.sec.locked_until).toBeNull();
  });

  it('lần sai thứ 5: khóa 1 giờ (423) và không gọi GoTrue nữa khi đang khóa', async () => {
    const state = mockBackend({ profile: PROFILE, grantOk: false });

    for (let i = 0; i < 4; i++) await postLogin({ email: PROFILE.email, password: 'sai' });

    const fifth = await postLogin({ email: PROFILE.email, password: 'sai' });
    expect(fifth.res.status).toBe(423);
    expect(fifth.data.code).toBe('LOCKED_TEMP');
    expect(fifth.data.error).toMatch(/khóa 1 giờ/i);
    expect(state.sec.failed_count).toBe(5);
    expect(new Date(state.sec.locked_until).getTime()).toBeGreaterThan(Date.now());

    const callsAfterLock = state.grantCalls;
    const blocked = await postLogin({ email: PROFILE.email, password: 'dung' });
    expect(blocked.res.status).toBe(423);
    expect(state.grantCalls).toBe(callsAfterLock); // không thử mật khẩu khi đang khóa
  });

  it('hết hạn khóa 1 giờ: bộ đếm về 0', async () => {
    const state = mockBackend({ profile: PROFILE, grantOk: false });
    state.sec = {
      user_id: PROFILE.id, failed_count: 5,
      locked_until: new Date(Date.now() - 60_000).toISOString(),
      permanent_lock: false, must_reset: false
    };

    const res = await postLogin({ email: PROFILE.email, password: 'sai' });
    expect(res.res.status).toBe(401);            // coi như lần sai #1
    expect(res.data.remaining).toBe(FAIL_WARN_AT - 1);
    expect(state.sec.failed_count).toBe(1);
    expect(state.sec.locked_until).toBeNull();
  });

  it('lần thử thứ 7 trong lúc đang khóa: khóa vĩnh viễn tới khi admin cấp lại', async () => {
    const state = mockBackend({ profile: PROFILE, grantOk: false });
    // Đang khóa (1h sau lần sai thứ 5) và đã thử thêm tới lần thứ 6
    state.sec = {
      user_id: PROFILE.id, failed_count: 6,
      locked_until: new Date(Date.now() + 30 * 60_000).toISOString(),
      permanent_lock: false, must_reset: false
    };

    const calls = state.grantCalls;
    const res = await postLogin({ email: PROFILE.email, password: 'sai' });
    expect(res.res.status).toBe(423);
    expect(res.data.code).toBe('LOCKED_PERMANENT');
    expect(state.sec.permanent_lock).toBe(true);
    expect(state.grantCalls).toBe(calls);          // vẫn không gọi GoTrue

    // Sau khi khóa vĩnh viễn: kể cả mật khẩu đúng cũng không vào được.
    const blocked = await postLogin({ email: PROFILE.email, password: 'dung' });
    expect(blocked.res.status).toBe(423);
    expect(blocked.data.code).toBe('LOCKED_PERMANENT');
    expect(state.grantCalls).toBe(calls);
  });

  it('mật khẩu đúng: trả session + hạn phiên 00:00 UTC + reset bộ đếm', async () => {
    const state = mockBackend({ profile: PROFILE, grantOk: true });
    state.sec = {
      user_id: PROFILE.id, failed_count: 3,
      locked_until: null, permanent_lock: false, must_reset: true
    };

    const res = await postLogin({ email: PROFILE.email, password: 'dung' });
    expect(res.res.status).toBe(200);
    expect(res.data.ok).toBe(true);
    expect(res.data.user.role_name).toBe('admin');
    expect(res.data.session.access_token).toBe('access-token');
    expect(Date.parse(res.data.expires_at)).toBeGreaterThan(Date.now());
    expect(res.data.expires_at).toMatch(/T00:00:00\.000Z$/);   // 07:00 giờ VN

    expect(state.sec.failed_count).toBe(0);
    expect(state.sec.locked_until).toBeNull();
    expect(state.sec.permanent_lock).toBe(false);
    expect(state.sec.must_reset).toBe(false);
    expect(state.sec.last_login_at).toBeTruthy();
  });

  it('mật khẩu đúng nhưng profile is_active=false: 403 INACTIVE', async () => {
    mockBackend({ profile: { ...PROFILE, is_active: false }, grantOk: true });
    const res = await postLogin({ email: PROFILE.email, password: 'dung' });
    expect(res.res.status).toBe(403);
    expect(res.data.code).toBe('INACTIVE');
  });

  it('mật khẩu đúng nhưng chưa có profile: 403 NO_PROFILE', async () => {
    const state = mockBackend({ profile: null, grantOk: true });
    state.grantCalls = 0;
    const res = await postLogin({ email: 'khongton@example.com', password: 'dung' });
    expect(res.res.status).toBe(403);
    expect(res.data.code).toBe('NO_PROFILE');
  });

  it('thiếu email/mật khẩu: 400', async () => {
    mockBackend({ profile: PROFILE, grantOk: true });
    const res = await postLogin({ email: '', password: '' });
    expect(res.res.status).toBe(400);
  });

  it('thiếu service key: 503 (không âm thầm bỏ qua khóa tài khoản)', async () => {
    mockBackend({ profile: PROFILE, grantOk: true });
    const res = await postLogin(
      { email: PROFILE.email, password: 'x' },
      { SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'a' }
    );
    expect(res.res.status).toBe(503);
    expect(res.data.error).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('email không dấu/khoảng trắng vẫn tra được profile', async () => {
    const state = mockBackend({ profile: PROFILE, grantOk: false });
    await postLogin({ username: '  Vinh@Example.com ', password: 'sai' });
    expect(state.sec?.failed_count).toBe(1);
  });

  it('admin hệ thống (pquangvinh1999@gmail.com): sai >= 7 lần KHÔNG bị khóa vĩnh viễn (chống DoS)', async () => {
    const sysAdminProfile = {
      id: 'sys-admin-1',
      email: 'pquangvinh1999@gmail.com',
      role_name: 'admin',
      is_active: true
    };
    const state = mockBackend({ profile: sysAdminProfile, grantOk: false });
    state.sec = {
      user_id: sysAdminProfile.id,
      failed_count: 6,
      locked_until: new Date(Date.now() + 30 * 60_000).toISOString(),
      permanent_lock: false,
      must_reset: false
    };

    const res = await postLogin({ email: sysAdminProfile.email, password: 'sai' });
    expect(res.res.status).toBe(423);
    expect(res.data.code).toBe('LOCKED_TEMP');
    expect(res.data.error).toContain('admin hệ thống');
    expect(state.sec.permanent_lock).toBe(false);
  });
});
