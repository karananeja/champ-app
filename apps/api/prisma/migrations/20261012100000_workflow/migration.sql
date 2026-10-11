-- AlterTable
ALTER TABLE "Fitment" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "closeComments" TEXT,
ADD COLUMN     "closeReasonId" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "faultReason" TEXT,
ADD COLUMN     "faultyAt" TIMESTAMP(3),
ADD COLUMN     "lastReopenReason" TEXT,
ADD COLUMN     "lastReopenedAt" TIMESTAMP(3),
ADD COLUMN     "lastReopenedById" TEXT,
ADD COLUMN     "reopenCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "replacementOfId" TEXT,
ADD COLUMN     "startLat" DOUBLE PRECISION,
ADD COLUMN     "startLng" DOUBLE PRECISION,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- CreateTable
CREATE TABLE "ReopenAttribution" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "fitmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReopenAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReopenAttribution_userId_idx" ON "ReopenAttribution"("userId");

-- CreateIndex
CREATE INDEX "ReopenAttribution_fitmentId_idx" ON "ReopenAttribution"("fitmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Fitment_replacementOfId_key" ON "Fitment"("replacementOfId");

-- CreateIndex
CREATE INDEX "Fitment_status_idx" ON "Fitment"("status");

-- CreateIndex
CREATE INDEX "Fitment_reopenCount_idx" ON "Fitment"("reopenCount");

-- AddForeignKey
ALTER TABLE "Fitment" ADD CONSTRAINT "Fitment_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fitment" ADD CONSTRAINT "Fitment_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fitment" ADD CONSTRAINT "Fitment_closeReasonId_fkey" FOREIGN KEY ("closeReasonId") REFERENCES "LookupItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fitment" ADD CONSTRAINT "Fitment_replacementOfId_fkey" FOREIGN KEY ("replacementOfId") REFERENCES "Fitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fitment" ADD CONSTRAINT "Fitment_lastReopenedById_fkey" FOREIGN KEY ("lastReopenedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReopenAttribution" ADD CONSTRAINT "ReopenAttribution_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "TaskEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReopenAttribution" ADD CONSTRAINT "ReopenAttribution_fitmentId_fkey" FOREIGN KEY ("fitmentId") REFERENCES "Fitment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReopenAttribution" ADD CONSTRAINT "ReopenAttribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
