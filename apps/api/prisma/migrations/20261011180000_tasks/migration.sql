-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "FitmentStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'OE_VERIFIED', 'OM_APPROVED', 'CLOSED_NOT_DONE', 'MOVED_TO_FT', 'REOPENED');

-- CreateEnum
CREATE TYPE "VehicleEntry" AS ENUM ('COUNT', 'CSV');

-- CreateTable
CREATE TABLE "Counter" (
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "omNo" INTEGER NOT NULL,
    "oeNo" INTEGER NOT NULL,
    "taskTypeId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "pocName" TEXT NOT NULL,
    "pocPhone" TEXT NOT NULL,
    "pocEmail" TEXT,
    "oeId" TEXT NOT NULL,
    "technicianType" "TechnicianType",
    "assetTypeId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "deviceTypeId" TEXT NOT NULL,
    "makeModelId" TEXT,
    "installationTypeId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "fitmentAt" TIMESTAMP(3) NOT NULL,
    "shiftTypeId" TEXT NOT NULL,
    "issueReportedId" TEXT NOT NULL,
    "gpsAddress" TEXT,
    "comments" TEXT,
    "vehicleEntry" "VehicleEntry" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fitment" (
    "id" TEXT NOT NULL,
    "tkNo" INTEGER NOT NULL,
    "taskId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "status" "FitmentStatus" NOT NULL DEFAULT 'OPEN',
    "technicianId" TEXT,
    "vehicleRegNo" TEXT,
    "chassisNo" TEXT,
    "assetNumber" TEXT,
    "oldDeviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fitmentId" TEXT,
    "actorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Task_omNo_key" ON "Task"("omNo");

-- CreateIndex
CREATE UNIQUE INDEX "Task_oeNo_key" ON "Task"("oeNo");

-- CreateIndex
CREATE INDEX "Task_status_deletedAt_idx" ON "Task"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "Task_oeId_idx" ON "Task"("oeId");

-- CreateIndex
CREATE INDEX "Task_clientId_idx" ON "Task"("clientId");

-- CreateIndex
CREATE INDEX "Task_fitmentAt_idx" ON "Task"("fitmentAt");

-- CreateIndex
CREATE UNIQUE INDEX "Fitment_tkNo_key" ON "Fitment"("tkNo");

-- CreateIndex
CREATE INDEX "Fitment_technicianId_status_idx" ON "Fitment"("technicianId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Fitment_taskId_seq_key" ON "Fitment"("taskId", "seq");

-- CreateIndex
CREATE INDEX "TaskEvent_taskId_createdAt_idx" ON "TaskEvent"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "LookupItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ClientSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_oeId_fkey" FOREIGN KEY ("oeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assetTypeId_fkey" FOREIGN KEY ("assetTypeId") REFERENCES "LookupItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_deviceTypeId_fkey" FOREIGN KEY ("deviceTypeId") REFERENCES "LookupItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_makeModelId_fkey" FOREIGN KEY ("makeModelId") REFERENCES "VehicleMakeModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_installationTypeId_fkey" FOREIGN KEY ("installationTypeId") REFERENCES "LookupItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_shiftTypeId_fkey" FOREIGN KEY ("shiftTypeId") REFERENCES "LookupItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_issueReportedId_fkey" FOREIGN KEY ("issueReportedId") REFERENCES "LookupItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fitment" ADD CONSTRAINT "Fitment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fitment" ADD CONSTRAINT "Fitment_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_fitmentId_fkey" FOREIGN KEY ("fitmentId") REFERENCES "Fitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
