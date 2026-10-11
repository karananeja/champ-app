import { Router, type Request } from 'express';
import {
  type Role,
  APPROVER_ROLES,
  WORKFLOW_VIEW_ROLES,
  approveFitmentsSchema,
  transitionSchema,
  workflowListQuerySchema,
  type ApproveFitmentsInput,
  type TransitionInput,
  type WorkflowListQuery,
} from '@champ/shared';
import { authenticate, currentUser } from '../../middleware/auth';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { approveMany, transitionFitment } from './engine';
import { listWorkflowFitments, type WorkflowList } from './lists';

const query = (req: Request) => req.query as unknown as WorkflowListQuery;

/**
 * `/fitments` (F05), outside the `/tasks` router so that OTs can act on their own fitments (D-077). Who may
 * do what is decided by the shared state machine in the engine; the lists have role guards.
 */
export function fitmentsRouter() {
  const router = Router();
  router.use(authenticate);

  const list = (name: WorkflowList, roles: readonly Role[]) =>
    router.get(`/${name}`, requireRole(...roles), validate({ query: workflowListQuerySchema }), async (req, res) => {
      res.json(await listWorkflowFitments(currentUser(req), name, query(req)));
    });
  list('awaiting-approval', APPROVER_ROLES);
  list('reopened', WORKFLOW_VIEW_ROLES);
  list('faulty', WORKFLOW_VIEW_ROLES);

  router.post('/approve', requireRole(...APPROVER_ROLES), validate({ body: approveFitmentsSchema }), async (req, res) => {
    res.json(await approveMany(currentUser(req), (req.body as ApproveFitmentsInput).fitmentIds));
  });

  router.post('/:fid/transitions', validate({ body: transitionSchema }), async (req, res) => {
    const { action, payload } = req.body as TransitionInput;
    res.json(await transitionFitment(currentUser(req), req.params.fid as string, action, payload ?? {}));
  });

  return router;
}
