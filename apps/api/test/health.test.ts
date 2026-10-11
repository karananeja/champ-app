import { describe, expect, it } from 'vitest';
import { fakeGoogle, testApi } from './helpers';

describe('health and config', () => {
  it('GET /api/health reports ok with a database check', async () => {
    const res = await testApi().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: 'up' });
  });

  it('GET /api/config returns null googleClientId when Google is not configured', async () => {
    const res = await testApi(fakeGoogle(null)).get('/api/config');
    expect(res.body).toEqual({ googleClientId: null });
  });

  it('GET /api/config returns the client id when configured', async () => {
    const res = await testApi(fakeGoogle('abc.apps.googleusercontent.com')).get('/api/config');
    expect(res.body).toEqual({ googleClientId: 'abc.apps.googleusercontent.com' });
  });

  it('unknown routes return the standard error format', async () => {
    const res = await testApi().get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('malformed JSON returns 400', async () => {
    const res = await testApi().post('/api/auth/login').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
