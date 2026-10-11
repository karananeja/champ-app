-- CreateEnum
CREATE TYPE "LookupKind" AS ENUM ('ASSET_TYPE', 'DEVICE_TYPE', 'INSTALLATION_TYPE', 'STATE', 'REGION', 'ISSUE_REPORTED', 'ISSUE_OBSERVED', 'ACTION_TAKEN', 'FINAL_ISSUE', 'ACCESSORY', 'CLOSE_REASON', 'SHIFT_TYPE', 'TASK_TYPE');

-- CreateEnum
CREATE TYPE "TechnicianType" AS ENUM ('PAYROLL', 'THIRD_PARTY', 'CONTRACTUAL');

-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "baseLocationId" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "technicianType" "TechnicianType";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "baseLocationId" TEXT,
ADD COLUMN     "technicianType" "TechnicianType";

-- CreateTable
CREATE TABLE "LookupItem" (
    "id" TEXT NOT NULL,
    "kind" "LookupKind" NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "code" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "billable" BOOLEAN,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LookupItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "assetTypeId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleMakeModel" (
    "id" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleMakeModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "cityKey" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LookupItem_kind_nameKey_key" ON "LookupItem"("kind", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "LookupItem_kind_code_key" ON "LookupItem"("kind", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_assetTypeId_nameKey_key" ON "Activity"("assetTypeId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleMakeModel_key_key" ON "VehicleMakeModel"("key");

-- CreateIndex
CREATE INDEX "Location_regionId_idx" ON "Location"("regionId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_stateId_cityKey_key" ON "Location"("stateId", "cityKey");

-- CreateIndex
CREATE INDEX "User_role_baseLocationId_idx" ON "User"("role", "baseLocationId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_baseLocationId_fkey" FOREIGN KEY ("baseLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_baseLocationId_fkey" FOREIGN KEY ("baseLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_assetTypeId_fkey" FOREIGN KEY ("assetTypeId") REFERENCES "LookupItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "LookupItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "LookupItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
