import { Router } from 'express';
import type { ConfigResponse, HealthResponse } from '@champ/shared';
import type { GoogleAuth } from '../../lib/google';
import { checkDatabase } from './service';

export function healthRouter(google: GoogleAuth, devSimulator = false) {
  const router = Router();

  router.get('/health', async (_req, res) => {
    const dbUp = await checkDatabase();
    const body: HealthResponse = { ok: dbUp, db: dbUp ? 'up' : 'down' };
    res.status(dbUp ? 200 : 503).json(body);
  });

  router.get('/config', (_req, res) => {
    const body: ConfigResponse = { googleClientId: google.clientId, devSimulator };
    res.json(body);
  });

  return router;
}
