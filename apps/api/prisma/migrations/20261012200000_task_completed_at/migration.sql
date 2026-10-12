-- CR-04 / D-087: when a task became Completed, for the Completed tasks view (latest first).
-- Additive only: a nullable column, an index and a backfill. No existing data changes.

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "completedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Task_completedAt_idx" ON "Task"("completedAt");

-- Backfill: a task is Completed once its last fitment reaches a final status (OM approved, Closed - not done or
-- Moved to FT), so its completion time is the latest such transition in the audit log. Tasks without one
-- (none expected) fall back to their last update.
UPDATE "Task" t
SET "completedAt" = COALESCE(
  (
    SELECT MAX(e."createdAt")
    FROM "TaskEvent" e
    WHERE e."taskId" = t."id"
      AND e."fitmentId" IS NOT NULL
      AND e."toStatus" IN ('OM_APPROVED', 'CLOSED_NOT_DONE', 'MOVED_TO_FT')
  ),
  t."updatedAt"
)
WHERE t."status" = 'COMPLETED';
