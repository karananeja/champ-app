-- CreateEnum
CREATE TYPE "RouteOrigin" AS ENUM ('GPS', 'HOME');

-- CreateEnum
CREATE TYPE "RouteEngine" AS ENUM ('OSRM', 'STRAIGHT_LINE');

-- CreateTable
CREATE TABLE "DayRoute" (
    "id" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "originLat" DOUBLE PRECISION,
    "originLng" DOUBLE PRECISION,
    "originSource" "RouteOrigin",
    "fitmentIds" TEXT[],
    "legs" JSONB NOT NULL,
    "geometry" JSONB,
    "engine" "RouteEngine" NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayRoute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DayRoute_technicianId_date_key" ON "DayRoute"("technicianId", "date");

-- AddForeignKey
ALTER TABLE "DayRoute" ADD CONSTRAINT "DayRoute_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

