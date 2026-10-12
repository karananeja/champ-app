import { Router } from 'express';
import {
  BOARD_ROLES,
  boardColumnParamsSchema,
  boardColumnQuerySchema,
  boardQuerySchema,
  type BoardColumnQuery,
  type BoardQuery,
  type FitmentStatus,
} from '@champ/shared';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/require-role';
import { validate } from '../../middleware/validate';
import { getBoard, getBoardColumn } from './service';

/**
 * `/board` (F07): the OM kanban board, SA and OM only (OE, RO and OT get 403). Read-only: moves reuse the
 * assign, approve and transition endpoints (D-113).
 */
export function boardRouter() {
  const router = Router();
  router.use(authenticate, requireRole(...BOARD_ROLES));

  router.get('/', validate({ query: boardQuerySchema }), async (req, res) => {
    res.json(await getBoard(req.query as unknown as BoardQuery));
  });

  router.get('/:status', validate({ params: boardColumnParamsSchema, query: boardColumnQuerySchema }), async (req, res) => {
    res.json(await getBoardColumn(req.params.status as FitmentStatus, req.query as unknown as BoardColumnQuery));
  });

  return router;
}
