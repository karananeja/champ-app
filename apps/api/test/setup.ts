import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prisma';

// Each test starts with empty tables.
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "RefreshToken", "Invite", "User", "Activity", "Location", "VehicleMakeModel", "LookupItem" CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
