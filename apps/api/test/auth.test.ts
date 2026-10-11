import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { PASSWORD, bearer, createUser, fakeGoogle, refreshCookie, testApi } from './helpers';

const login = (api: ReturnType<typeof testApi>, email: string, password = PASSWORD) =>
  api.post('/api/auth/login').send({ email, password });

describe('POST /api/auth/login', () => {
  it('returns an access token, the user and an httpOnly refresh cookie', async () => {
    const user = await createUser({ role: 'OM', email: 'om@intellicar.in' });
    const res = await login(testApi(), 'OM@Intellicar.in ');

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ id: user.id, email: 'om@intellicar.in', role: 'OM' });
    expect(res.body.user).not.toHaveProperty('passwordHash');

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('champ_rt='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(1);
  });

  it('rejects a wrong password with 401 INVALID_CREDENTIALS', async () => {
    await createUser({ role: 'OM', email: 'om@intellicar.in' });
    const res = await login(testApi(), 'om@intellicar.in', 'wrong-password1');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(refreshCookie(res)).toBeUndefined();
  });

  it('rejects an unknown email with the same error', async () => {
    const res = await login(testApi(), 'nobody@intellicar.in');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('validates the body', async () => {
    const res = await testApi().post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fieldErrors).toHaveProperty('email');
    expect(res.body.error.details.fieldErrors).toHaveProperty('password');
  });

  it('rate limits after 10 attempts per IP + email', async () => {
    const api = testApi();
    for (let i = 0; i < 10; i++) {
      expect((await login(api, 'victim@intellicar.in', 'bad-pass1')).status).toBe(401);
    }
    const blocked = await login(api, 'victim@intellicar.in', 'bad-pass1');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    // A different email from the same IP is still allowed.
    expect((await login(api, 'other@intellicar.in', 'bad-pass1')).status).toBe(401);
  });
});

describe('inactive users', () => {
  it('cannot log in', async () => {
    await createUser({ role: 'OE', email: 'gone@intellicar.in', status: 'INACTIVE' });
    const res = await login(testApi(), 'gone@intellicar.in');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('cannot refresh, and their tokens are revoked', async () => {
    const api = testApi();
    const user = await createUser({ role: 'OE', email: 'soon-gone@intellicar.in' });
    const cookie = refreshCookie(await login(api, user.email));
    await prisma.user.update({ where: { id: user.id }, data: { status: 'INACTIVE' } });

    const res = await api.post('/api/auth/refresh').set('Cookie', `champ_rt=${cookie}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
  });

  it('cannot use an existing access token', async () => {
    const user = await createUser({ role: 'SUPER_ADMIN', status: 'INACTIVE' });
    const res = await testApi().get('/api/me').set(bearer(user));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token', async () => {
    const api = testApi();
    const user = await createUser({ role: 'OM' });
    const first = refreshCookie(await login(api, user.email))!;

    const res = await api.post('/api/auth/refresh').set('Cookie', `champ_rt=${first}`);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user.id).toBe(user.id);
    const second = refreshCookie(res)!;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);

    // The new token works again.
    const again = await api.post('/api/auth/refresh').set('Cookie', `champ_rt=${second}`);
    expect(again.status).toBe(200);
  });

  it('detects reuse of a rotated token and revokes every session of the user', async () => {
    const api = testApi();
    const user = await createUser({ role: 'OM' });
    const first = refreshCookie(await login(api, user.email))!;
    const otherSession = refreshCookie(await login(api, user.email))!;
    const second = refreshCookie(await api.post('/api/auth/refresh').set('Cookie', `champ_rt=${first}`))!;

    const reuse = await api.post('/api/auth/refresh').set('Cookie', `champ_rt=${first}`);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('REFRESH_REUSED');

    // Both the rotated token and the unrelated session are now dead.
    expect((await api.post('/api/auth/refresh').set('Cookie', `champ_rt=${second}`)).status).toBe(401);
    expect((await api.post('/api/auth/refresh').set('Cookie', `champ_rt=${otherSession}`)).status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
  });

  it('rejects a missing or unknown cookie', async () => {
    const api = testApi();
    expect((await api.post('/api/auth/refresh')).status).toBe(401);
    const res = await api.post('/api/auth/refresh').set('Cookie', 'champ_rt=garbage');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_INVALID');
  });

  it('rejects an expired refresh token', async () => {
    const api = testApi();
    const user = await createUser({ role: 'OM' });
    const cookie = refreshCookie(await login(api, user.email))!;
    await prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await api.post('/api/auth/refresh').set('Cookie', `champ_rt=${cookie}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_INVALID');
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the refresh token and clears the cookie', async () => {
    const api = testApi();
    const user = await createUser({ role: 'OM' });
    const cookie = refreshCookie(await login(api, user.email))!;

    const res = await api.post('/api/auth/logout').set('Cookie', `champ_rt=${cookie}`);
    expect(res.status).toBe(204);
    const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('champ_rt='))!;
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

    expect((await api.post('/api/auth/refresh').set('Cookie', `champ_rt=${cookie}`)).status).toBe(401);
  });

  it('succeeds without a cookie', async () => {
    expect((await testApi().post('/api/auth/logout')).status).toBe(204);
  });
});

describe('GET /api/me', () => {
  it('requires authentication', async () => {
    const res = await testApi().get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a tampered token', async () => {
    const res = await testApi().get('/api/me').set('Authorization', 'Bearer abc.def.ghi');
    expect(res.status).toBe(401);
  });

  it('returns the current user with the manager name and phone', async () => {
    const om = await createUser({ role: 'OM', name: 'Maya Manager' });
    await prisma.user.update({ where: { id: om.id }, data: { phone: '+91 90000 00000' } });
    const oe = await createUser({ role: 'OE', managerId: om.id });
    const res = await testApi().get('/api/me').set(bearer(oe));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: oe.id,
      role: 'OE',
      manager: { id: om.id, name: 'Maya Manager', phone: '+91 90000 00000' },
    });
  });
});

describe('POST /api/auth/google (verifier mocked)', () => {
  it('logs in an existing active user from the company domain', async () => {
    const google = fakeGoogle();
    const user = await createUser({ role: 'OE', email: 'oe@intellicar.in' });
    google.identity = { email: 'OE@intellicar.in', email_verified: true, hd: 'intellicar.in' };
    const res = await testApi(google).post('/api/auth/google').send({ idToken: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    expect(refreshCookie(res)).toBeDefined();
  });

  it('rejects accounts outside the company domain', async () => {
    const google = fakeGoogle();
    await createUser({ role: 'OE', email: 'someone@gmail.com' });
    google.identity = { email: 'someone@gmail.com', email_verified: true };
    const res = await testApi(google).post('/api/auth/google').send({ idToken: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GOOGLE_DOMAIN_NOT_ALLOWED');
  });

  it('rejects a different hosted domain', async () => {
    const google = fakeGoogle();
    google.identity = { email: 'a@other.com', email_verified: true, hd: 'other.com' };
    const res = await testApi(google).post('/api/auth/google').send({ idToken: 'x' });
    expect(res.body.error.code).toBe('GOOGLE_DOMAIN_NOT_ALLOWED');
  });

  it('rejects an unverified email', async () => {
    const google = fakeGoogle();
    google.identity = { email: 'oe@intellicar.in', email_verified: false, hd: 'intellicar.in' };
    const res = await testApi(google).post('/api/auth/google').send({ idToken: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GOOGLE_DOMAIN_NOT_ALLOWED');
  });

  it('rejects a company account with no Champ user', async () => {
    const google = fakeGoogle();
    google.identity = { email: 'new@intellicar.in', email_verified: true, hd: 'intellicar.in' };
    const res = await testApi(google).post('/api/auth/google').send({ idToken: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GOOGLE_USER_NOT_FOUND');
  });

  it('rejects an inactive user', async () => {
    const google = fakeGoogle();
    await createUser({ role: 'OE', email: 'off@intellicar.in', status: 'INACTIVE' });
    google.identity = { email: 'off@intellicar.in', email_verified: true, hd: 'intellicar.in' };
    const res = await testApi(google).post('/api/auth/google').send({ idToken: 'x' });
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('rejects an invalid ID token', async () => {
    const res = await testApi(fakeGoogle()).post('/api/auth/google').send({ idToken: 'bad' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('GOOGLE_TOKEN_INVALID');
  });

  it('is disabled when GOOGLE_CLIENT_ID is not set', async () => {
    const res = await testApi(fakeGoogle(null)).post('/api/auth/google').send({ idToken: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GOOGLE_NOT_CONFIGURED');
  });
});
