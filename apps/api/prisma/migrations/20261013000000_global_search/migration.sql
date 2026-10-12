-- Global search (F14): trigram "contains" on normalized identifiers, and the SA-managed identifier list.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "SearchIdentifierSetting" (
    "identifier" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "SearchIdentifierSetting_pkey" PRIMARY KEY ("identifier")
);

INSERT INTO "SearchIdentifierSetting" ("identifier", "enabled", "sortOrder") VALUES
    ('OM_ID', true, 0),
    ('OE_TASK_ID', true, 1),
    ('TK_ID', true, 2),
    ('TT_ID', true, 3),
    ('DEVICE_ID', true, 4),
    ('SECONDARY_DEVICE_ID', true, 5),
    ('OLD_DEVICE_ID', true, 6),
    ('CHASSIS_NO', true, 7),
    ('ASSET_NO', true, 8),
    ('VEHICLE_REG_NO', true, 9);

-- Trigram expression indexes on the normalized form (lower-case, spaces and hyphens removed; D-245)
CREATE INDEX "Fitment_deviceId_search_idx" ON "Fitment" USING GIN (regexp_replace(lower("deviceId"), '[\s-]', '', 'g') gin_trgm_ops);
CREATE INDEX "Fitment_secondaryDeviceId_search_idx" ON "Fitment" USING GIN (regexp_replace(lower("secondaryDeviceId"), '[\s-]', '', 'g') gin_trgm_ops);
CREATE INDEX "Fitment_oldDeviceId_search_idx" ON "Fitment" USING GIN (regexp_replace(lower("oldDeviceId"), '[\s-]', '', 'g') gin_trgm_ops);
CREATE INDEX "Fitment_chassisNo_search_idx" ON "Fitment" USING GIN (regexp_replace(lower("chassisNo"), '[\s-]', '', 'g') gin_trgm_ops);
CREATE INDEX "Fitment_assetNumber_search_idx" ON "Fitment" USING GIN (regexp_replace(lower("assetNumber"), '[\s-]', '', 'g') gin_trgm_ops);
CREATE INDEX "Fitment_vehicleRegNo_search_idx" ON "Fitment" USING GIN (regexp_replace(lower("vehicleRegNo"), '[\s-]', '', 'g') gin_trgm_ops);
