import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { createGeocoder, type Geocoder } from './lib/geocoder';
import { createGoogleAuth, type GoogleAuth } from './lib/google';
import { logger } from './lib/logger';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './modules/auth/router';
import { clientsRouter } from './modules/clients/router';
import { geoRouter } from './modules/geo/router';
import { healthRouter } from './modules/health/router';
import { invitesRouter } from './modules/invites/router';
import { lookupsRouter, mastersRouter } from './modules/masters/router';
import { tasksRouter } from './modules/tasks/router';
import { techniciansRouter } from './modules/technicians/router';
import { usersRouter } from './modules/users/router';

export interface AppDeps {
  /** Injected in tests to mock Google ID-token verification. */
  google?: GoogleAuth;
  /** Injected in tests: a fake geocoder (tests must never call the real Nominatim). */
  geocoder?: Geocoder;
}

export function createApp(deps: AppDeps = {}) {
  const google = deps.google ?? createGoogleAuth();
  const geocoder = deps.geocoder ?? createGeocoder();
  const app = express();

  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.WEB_URL, credentials: true }));
  // The bulk task import sends back up to 1,000 preview rows; every other body stays small.
  const largeJson = express.json({ limit: '3mb' });
  const smallJson = express.json({ limit: '100kb' });
  app.use((req, res, next) => (req.path === '/api/tasks/bulk/import' ? largeJson : smallJson)(req, res, next));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      // Keep request logs to one compact line.
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  const api = express.Router();
  api.use(healthRouter(google));
  api.use('/auth', authRouter(google));
  api.use('/invites', invitesRouter(google));
  api.use(usersRouter());
  api.use('/lookups', lookupsRouter());
  api.use('/masters', mastersRouter());
  api.use('/technicians', techniciansRouter());
  api.use('/clients', clientsRouter());
  api.use('/geo', geoRouter(geocoder));
  api.use('/tasks', tasksRouter());
  api.use(notFoundHandler);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
