-- CR-11 (D-257): the built-in close reason given to a replacement closed by "Undo faulty". Idempotent: skipped
-- when the built-in exists; a same-named entry added by hand becomes the built-in one.
INSERT INTO "LookupItem" ("id", "kind", "name", "nameKey", "code", "isSystem", "active", "sortOrder", "createdAt", "updatedAt")
SELECT 'lookup_close_reason_fault_undone', 'CLOSE_REASON', 'Faulty marked by mistake', 'faulty marked by mistake', 'FAULT_UNDONE', true, true, 1000, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "LookupItem" WHERE "kind" = 'CLOSE_REASON' AND "code" = 'FAULT_UNDONE')
ON CONFLICT ("kind", "nameKey") DO UPDATE
SET "name" = EXCLUDED."name", "code" = EXCLUDED."code", "isSystem" = true, "active" = true, "updatedAt" = NOW();
