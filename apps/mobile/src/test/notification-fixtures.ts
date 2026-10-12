import type { NotificationDto } from '@champ/shared';

/** F13: one notification for the bell, provider and screen tests. */
export function makeNotification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: 'n1',
    type: 'FITMENT_ASSIGNED',
    title: 'TK-00012 assigned to you',
    body: 'Zoomcar · Bengaluru depot · 14 Oct, 10:00 am',
    target: { kind: 'FITMENT', taskId: 't1', fitmentId: 'f1' },
    // The technician gets assignments, approvals and reopens; a submission goes to the task's OE.
    forTechnician: overrides.type !== 'FITMENT_SUBMITTED',
    count: 1,
    actor: { id: 'm1', name: 'Asha Rao' },
    read: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}
