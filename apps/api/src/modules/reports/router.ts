import { Router, type Response } from 'express';
import {
  REPORT_ROLES_ANALYTICS,
  REPORT_ROLES_BILLING,
  analyticsQuerySchema,
  billingQuerySchema,
  type AnalyticsQuery,
  type BillingQuery,
} from '@champ/shared';
import { authenticate, currentUser } from '../../middleware/auth';
import { requireRole } from '../../middleware/require-role';
import { validate } from '../../middleware/validate';
import type { ExportFile } from '../tasks/export';
import { analyticsFile, getAnalytics } from './analytics';
import { billingFile, getBillingReport } from './billing';

const sendFile = (res: Response, file: ExportFile) => {
  res.setHeader('Content-Type', file.contentType);
  res.attachment(file.filename);
  res.send(file.body);
};

/** `/reports` (F15): the billing report (SA, OM, RO) and the analytics (SA, OM, OE, RO; an OE is scoped). */
export function reportsRouter() {
  const router = Router();
  router.use(authenticate);

  router.get('/billing', requireRole(...REPORT_ROLES_BILLING), validate({ query: billingQuerySchema }), async (req, res) => {
    const query = req.query as unknown as BillingQuery;
    if (query.format === 'json') res.json(await getBillingReport(query));
    else sendFile(res, await billingFile(query));
  });

  router.get('/analytics', requireRole(...REPORT_ROLES_ANALYTICS), validate({ query: analyticsQuerySchema }), async (req, res) => {
    const query = req.query as unknown as AnalyticsQuery;
    if (query.format === 'json') res.json(await getAnalytics(currentUser(req), query));
    else sendFile(res, await analyticsFile(currentUser(req), query));
  });
  return router;
}
