-- F06 / D-098–D-102: OE verification fields on Fitment, fitment photos and accessories.
-- Additive only: new enums, nullable columns, new tables, indexes and foreign keys. No existing data changes.

-- CreateEnum
CREATE TYPE "PhotoKind" AS ENUM ('BEFORE', 'AFTER', 'ASSET', 'CLUSTER', 'PLACEMENT', 'DEBUG');

-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('ACTIVE', 'REPLACED', 'REMOVED');

-- CreateEnum
CREATE TYPE "PhotoSource" AS ENUM ('OT', 'OE', 'OM', 'SIMULATOR');

-- AlterTable
ALTER TABLE "Fitment" ADD COLUMN     "actionTakenId" TEXT,
ADD COLUMN     "billable" BOOLEAN,
ADD COLUMN     "finalIssueId" TEXT,
ADD COLUMN     "issueObservedId" TEXT,
ADD COLUMN     "oeRemarks" TEXT,
ADD COLUMN     "otRemarks" TEXT,
ADD COLUMN     "verificationUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "verificationUpdatedById" TEXT;

-- CreateTable
CREATE TABLE "FitmentPhoto" (
    "id" TEXT NOT NULL,
    "fitmentId" TEXT NOT NULL,
    "kind" "PhotoKind" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "originalName" TEXT,
    "takenAt" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "uploadedById" TEXT NOT NULL,
    "source" "PhotoSource" NOT NULL,
    "status" "PhotoStatus" NOT NULL DEFAULT 'ACTIVE',
    "replacedById" TEXT,
    "changeReason" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FitmentPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FitmentAccessory" (
    "fitmentId" TEXT NOT NULL,
    "accessoryId" TEXT NOT NULL,

    CONSTRAINT "FitmentAccessory_pkey" PRIMARY KEY ("fitmentId","accessoryId")
);

-- CreateIndex
CREATE UNIQUE INDEX "FitmentPhoto_objectKey_key" ON "FitmentPhoto"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "FitmentPhoto_replacedById_key" ON "FitmentPhoto"("replacedById");

-- CreateIndex
CREATE INDEX "FitmentPhoto_fitmentId_status_idx" ON "FitmentPhoto"("fitmentId", "status");

-- AddForeignKey
ALTER TABLE "Fitment" ADD CONSTRAINT "Fitment_issueObservedId_fkey" FOREIGN KEY ("issueObservedId") REFERENCES "LookupItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fitment" ADD CONSTRAINT "Fitment_actionTakenId_fkey" FOREIGN KEY ("actionTakenId") REFERENCES "LookupItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fitment" ADD CONSTRAINT "Fitment_finalIssueId_fkey" FOREIGN KEY ("finalIssueId") REFERENCES "LookupItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fitment" ADD CONSTRAINT "Fitment_verificationUpdatedById_fkey" FOREIGN KEY ("verificationUpdatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitmentPhoto" ADD CONSTRAINT "FitmentPhoto_fitmentId_fkey" FOREIGN KEY ("fitmentId") REFERENCES "Fitment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitmentPhoto" ADD CONSTRAINT "FitmentPhoto_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitmentPhoto" ADD CONSTRAINT "FitmentPhoto_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "FitmentPhoto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitmentPhoto" ADD CONSTRAINT "FitmentPhoto_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitmentAccessory" ADD CONSTRAINT "FitmentAccessory_fitmentId_fkey" FOREIGN KEY ("fitmentId") REFERENCES "Fitment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitmentAccessory" ADD CONSTRAINT "FitmentAccessory_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "LookupItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

