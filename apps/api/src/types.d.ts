import type { User } from './generated/prisma/client';

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware. */
      user?: User;
    }
  }
}

export {};
