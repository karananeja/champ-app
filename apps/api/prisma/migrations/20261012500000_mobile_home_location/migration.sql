-- F09 / D-129: a user's home location (OT and OE). Additive only: nullable columns, no backfill.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "homeAddress" TEXT,
ADD COLUMN     "homeLat" DOUBLE PRECISION,
ADD COLUMN     "homeLng" DOUBLE PRECISION,
ADD COLUMN     "homeUpdatedAt" TIMESTAMP(3);
