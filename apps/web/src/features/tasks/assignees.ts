import type { TaskOptionsResponse } from '@champ/shared';
import type { SelectOption } from '@/components/searchable-select';

/**
 * Who a fitment can be assigned to (F10, D-158): the active OTs (hint: base location), then the OEs the
 * caller may assign to, labelled "(OE)" (SA/OM: any active OE; an OE: themselves).
 */
export function assigneeOptions(options: TaskOptionsResponse | undefined): SelectOption[] {
  if (!options) return [];
  return [
    ...options.technicians.map((t) => ({ value: t.id, label: t.name, hint: t.baseLocation ?? undefined })),
    ...(options.assignableOes ?? []).map((o) => ({ value: o.id, label: `${o.name} (OE)` })),
  ];
}

/** The assignee's name (without the "(OE)" label), or undefined. */
export function assigneeName(options: TaskOptionsResponse | undefined, id: string | null): string | undefined {
  if (!options || !id) return undefined;
  return options.technicians.find((t) => t.id === id)?.name ?? options.assignableOes?.find((o) => o.id === id)?.name;
}
