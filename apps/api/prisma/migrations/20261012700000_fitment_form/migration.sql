-- F10B: the technician's fitment form (additive).
CREATE TYPE "DeviceReplacement" AS ENUM ('DEVICE', 'SIM', 'NONE');

ALTER TABLE "Fitment"
  ADD COLUMN "deviceId" TEXT,
  ADD COLUMN "secondaryDeviceId" TEXT,
  ADD COLUMN "clusterReadingKm" INTEGER,
  ADD COLUMN "deviceReplacement" "DeviceReplacement",
  ADD COLUMN "checks" JSONB,
  ADD COLUMN "formUpdatedAt" TIMESTAMP(3);
