-- F08 / D-119–D-122: travel tasks, their history and receipts.
-- Additive only: new enums, new tables, indexes and foreign keys. No existing data changes.

-- CreateEnum
CREATE TYPE "TravelStatus" AS ENUM ('RAISED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TravelSource" AS ENUM ('WEB', 'MOBILE');

-- CreateTable
CREATE TABLE "TravelTask" (
    "id" TEXT NOT NULL,
    "ttNo" INTEGER NOT NULL,
    "technicianId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "clientId" TEXT,
    "purpose" TEXT NOT NULL,
    "travelDate" DATE NOT NULL,
    "relatedFitmentId" TEXT,
    "distanceKm" DECIMAL(7,1),
    "status" "TravelStatus" NOT NULL DEFAULT 'RAISED',
    "source" "TravelSource" NOT NULL,
    "raisedById" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectionReason" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelTaskEvent" (
    "id" TEXT NOT NULL,
    "travelTaskId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravelTaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelAttachment" (
    "id" TEXT NOT NULL,
    "travelTaskId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "originalName" TEXT,
    "uploadedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "removedById" TEXT,
    "removedAt" TIMESTAMP(3),
    "removeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravelAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TravelTask_ttNo_key" ON "TravelTask"("ttNo");

-- CreateIndex
CREATE INDEX "TravelTask_technicianId_status_idx" ON "TravelTask"("technicianId", "status");

-- CreateIndex
CREATE INDEX "TravelTask_travelDate_idx" ON "TravelTask"("travelDate");

-- CreateIndex
CREATE INDEX "TravelTask_status_idx" ON "TravelTask"("status");

-- CreateIndex
CREATE INDEX "TravelTaskEvent_travelTaskId_createdAt_idx" ON "TravelTaskEvent"("travelTaskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TravelAttachment_objectKey_key" ON "TravelAttachment"("objectKey");

-- CreateIndex
CREATE INDEX "TravelAttachment_travelTaskId_status_idx" ON "TravelAttachment"("travelTaskId", "status");

-- AddForeignKey
ALTER TABLE "TravelTask" ADD CONSTRAINT "TravelTask_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelTask" ADD CONSTRAINT "TravelTask_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelTask" ADD CONSTRAINT "TravelTask_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelTask" ADD CONSTRAINT "TravelTask_relatedFitmentId_fkey" FOREIGN KEY ("relatedFitmentId") REFERENCES "Fitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelTask" ADD CONSTRAINT "TravelTask_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelTask" ADD CONSTRAINT "TravelTask_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelTask" ADD CONSTRAINT "TravelTask_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelTask" ADD CONSTRAINT "TravelTask_reopenedById_fkey" FOREIGN KEY ("reopenedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelTaskEvent" ADD CONSTRAINT "TravelTaskEvent_travelTaskId_fkey" FOREIGN KEY ("travelTaskId") REFERENCES "TravelTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelTaskEvent" ADD CONSTRAINT "TravelTaskEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelAttachment" ADD CONSTRAINT "TravelAttachment_travelTaskId_fkey" FOREIGN KEY ("travelTaskId") REFERENCES "TravelTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelAttachment" ADD CONSTRAINT "TravelAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelAttachment" ADD CONSTRAINT "TravelAttachment_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

