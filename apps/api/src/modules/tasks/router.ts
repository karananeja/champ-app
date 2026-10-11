import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import {
  BULK_MAX_FILE_BYTES,
  HISTORY_ROLES,
  TASK_CREATE_ROLES,
  TASK_DELETE_ROLES,
  TASK_VIEW_ROLES,
  assignFitmentsSchema,
  bulkImportSchema,
  createTaskSchema,
  exportTasksQuerySchema,
  listTasksQuerySchema,
  taskEventsQuerySchema,
  updateFitmentSchema,
  updateTaskSchema,
  type AssignFitmentsInput,
  type BulkImportInput,
  type CreateTaskInput,
  type ExportTasksQuery,
  type ListTasksQuery,
  type TaskEventsQuery,
  type UpdateFitmentInput,
  type UpdateTaskInput,
} from '@champ/shared';
import { badRequest } from '../../lib/errors';
import { authenticate, currentUser } from '../../middleware/auth';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { bulkSampleCsv, importBulk, previewBulk } from './bulk';
import { exportTaskEvents, getTaskHistory, listTaskEvents } from '../workflow/history';
import { exportTasks } from './export';
import * as tasks from './service';

const id = (req: Request) => req.params.id as string;
const fileError = (message: string) => badRequest('VALIDATION_ERROR', message, { fieldErrors: { file: [message] } });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: BULK_MAX_FILE_BYTES, files: 1 } }).single(
  'file',
);

/** Multipart `file` (CSV, ≤ 2 MB) into memory, with friendly 400s. */
function uploadCsv(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      return next(fileError(err.code === 'LIMIT_FILE_SIZE' ? 'The file must be 2 MB or smaller' : err.message));
    }
    if (err) return next(err);
    if (!req.file) return next(fileError('Choose a CSV file to upload'));
    if (!/\.csv$/i.test(req.file.originalname)) return next(fileError('Upload a .csv file'));
    next();
  });
}

/**
 * `/tasks` (F04, F05 history). Every route needs a task viewer (OT gets 403); creation and bulk upload need a
 * creator; history and raw events need SA/OM.
 * Edit, assign and delete rules that depend on the task (canManageTask, untouched) are checked in the
 * service. Fixed paths come before `/:id`.
 */
export function tasksRouter() {
  const router = Router();
  router.use(authenticate, requireRole(...TASK_VIEW_ROLES));
  const canCreate = requireRole(...TASK_CREATE_ROLES);

  router.get('/options', async (req, res) => {
    res.json(await tasks.getTaskOptions(currentUser(req)));
  });

  router.get('/export', validate({ query: exportTasksQuerySchema }), async (req, res) => {
    const file = await exportTasks(currentUser(req), req.query as unknown as ExportTasksQuery);
    res.setHeader('Content-Type', file.contentType);
    res.attachment(file.filename);
    res.send(file.body);
  });

  router.get('/bulk/sample', canCreate, async (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.attachment('champ-bulk-tasks-sample.csv');
    res.send(await bulkSampleCsv(currentUser(req)));
  });
  router.post('/bulk/preview', canCreate, uploadCsv, async (req, res) => {
    res.json(await previewBulk(currentUser(req), req.file!.buffer));
  });
  router.post('/bulk/import', canCreate, validate({ body: bulkImportSchema }), async (req, res) => {
    res.json(await importBulk(currentUser(req), req.body as BulkImportInput));
  });

  router.get('/', validate({ query: listTasksQuerySchema }), async (req, res) => {
    res.json(await tasks.listTasks(currentUser(req), req.query as unknown as ListTasksQuery));
  });
  router.post('/', canCreate, validate({ body: createTaskSchema }), async (req, res) => {
    res.status(201).json(await tasks.createTask(currentUser(req), req.body as CreateTaskInput));
  });
  router.get('/:id', async (req, res) => {
    res.json(await tasks.getTask(currentUser(req), id(req)));
  });
  router.patch('/:id', canCreate, validate({ body: updateTaskSchema }), async (req, res) => {
    res.json(await tasks.updateTask(currentUser(req), id(req), req.body as UpdateTaskInput));
  });
  router.delete('/:id', requireRole(...TASK_DELETE_ROLES), async (req, res) => {
    await tasks.deleteTask(currentUser(req), id(req));
    res.status(204).end();
  });
  router.patch('/:id/fitments/:fid', canCreate, validate({ body: updateFitmentSchema }), async (req, res) => {
    res.json(
      await tasks.updateFitment(currentUser(req), id(req), req.params.fid as string, req.body as UpdateFitmentInput),
    );
  });
  // F05: History tab and raw data (SA/OM, D-033).
  const canViewHistory = requireRole(...HISTORY_ROLES);
  router.get('/:id/history', canViewHistory, async (req, res) => {
    res.json(await getTaskHistory(id(req)));
  });
  router.get('/:id/events', canViewHistory, validate({ query: taskEventsQuerySchema }), async (req, res) => {
    if ((req.query as unknown as TaskEventsQuery).format === 'csv') {
      const file = await exportTaskEvents(id(req));
      res.setHeader('Content-Type', file.contentType);
      res.attachment(file.filename);
      res.send(file.body);
      return;
    }
    res.json(await listTaskEvents(id(req)));
  });
  router.post('/:id/assign', canCreate, validate({ body: assignFitmentsSchema }), async (req, res) => {
    res.json(await tasks.assignFitments(currentUser(req), id(req), req.body as AssignFitmentsInput));
  });

  return router;
}
