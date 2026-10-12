-- CreateTable
CREATE TABLE "DayDistance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "signature" TEXT NOT NULL,
    "distanceM" INTEGER NOT NULL,
    "approx" BOOLEAN NOT NULL,
    "legs" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayDistance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DayDistance_userId_date_key" ON "DayDistance"("userId", "date");

-- AddForeignKey
ALTER TABLE "DayDistance" ADD CONSTRAINT "DayDistance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
