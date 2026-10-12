import {
  SEARCH_IDENTIFIERS,
  SEARCH_IDENTIFIER_LABELS,
  type SearchIdentifier,
  type SearchIdentifierSettingDto,
  type UpdateSearchIdentifiersInput,
} from '@champ/shared';
import { prisma } from '../../lib/prisma';

const isIdentifier = (value: string): value is SearchIdentifier => (SEARCH_IDENTIFIERS as readonly string[]).includes(value);

/**
 * The identifier list in ranking order (D-243). Rows are seeded by the migration; an identifier without a row
 * (or a database without them) falls back to on, after the stored ones, in the `SEARCH_IDENTIFIERS` order.
 */
export async function getSearchIdentifiers(): Promise<SearchIdentifierSettingDto[]> {
  const rows = await prisma.searchIdentifierSetting.findMany({ orderBy: [{ sortOrder: 'asc' }, { identifier: 'asc' }] });
  const stored = rows.filter((r) => isIdentifier(r.identifier));
  const missing = SEARCH_IDENTIFIERS.filter((id) => !stored.some((r) => r.identifier === id));
  return [
    ...stored.map((r) => ({ identifier: r.identifier as SearchIdentifier, enabled: r.enabled })),
    ...missing.map((identifier) => ({ identifier, enabled: true })),
  ].map((s, sortOrder) => ({ ...s, label: SEARCH_IDENTIFIER_LABELS[s.identifier], sortOrder }));
}

/** `PUT /search/identifiers`: the body's order is the ranking order (the schema checks each once, one on). */
export async function updateSearchIdentifiers(input: UpdateSearchIdentifiersInput): Promise<SearchIdentifierSettingDto[]> {
  await prisma.$transaction(
    input.items.map(({ identifier, enabled }, sortOrder) =>
      prisma.searchIdentifierSetting.upsert({
        where: { identifier },
        create: { identifier, enabled, sortOrder },
        update: { enabled, sortOrder },
      }),
    ),
  );
  return getSearchIdentifiers();
}
