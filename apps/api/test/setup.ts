import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prisma';

// Each test starts with empty tables.
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "RefreshToken", "Invite", "User", "Activity", "Location", "VehicleMakeModel", "LookupItem", "Client", "ClientSite", "Task", "Fitment", "TaskEvent", "ReopenAttribution", "FitmentPhoto", "FitmentAccessory", "TravelTask", "TravelTaskEvent", "TravelAttachment", "Counter" CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
