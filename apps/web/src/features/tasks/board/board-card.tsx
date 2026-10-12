import type { KeyboardEvent, MouseEvent } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { ArrowRightLeft, RotateCcw } from 'lucide-react';
import { FITMENT_STATUS_LABELS, boardTargets, type BoardCard, type FitmentStatus } from '@champ/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatIst } from '@/lib/format';
import { TONES } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { BillableBadge } from '../verification/billable-badge';

/** The card's content: TK id, OM id, customer, city, activity, technician, fitment date and badges. */
export function BoardCardBody({ card }: { card: BoardCard }) {
  return (
    <div className="grid min-w-0 gap-0.5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="font-mono font-semibold">{card.tkId}</span>
        <span className="font-mono text-xs text-muted-foreground">{card.task.omId}</span>
      </div>
      <div className="truncate">
        {card.client.name} · {card.city}
      </div>
      <div className="truncate text-muted-foreground">{card.activity.name}</div>
      <div className={cn('truncate', !card.technician && 'text-muted-foreground italic')} data-testid="board-card-technician">
        {card.technician?.name ?? 'Unassigned'}
      </div>
      <div className="text-xs text-muted-foreground">{formatIst(card.fitmentAt)}</div>
      {(card.reopenCount > 0 || card.billable !== null || card.replacementOf) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {card.reopenCount > 0 && (
            <Badge variant="outline" className={cn('gap-1', TONES.orange)} data-testid="reopen-chip">
              <RotateCcw className="size-3" /> Reopened ×{card.reopenCount}
            </Badge>
          )}
          <BillableBadge billable={card.billable} />
          {card.replacementOf && (
            <Badge variant="outline" className={TONES.red}>
              Replacement of {card.replacementOf.tkId}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  card: BoardCard;
  selected: boolean;
  /** Shift-click selects a range in the same column. */
  onToggleSelect: (card: BoardCard, range: boolean) => void;
  onOpen: (card: BoardCard) => void;
  /** Phones: the "Move to…" menu instead of dragging. */
  onMoveTo: (card: BoardCard, to: FitmentStatus) => void;
  /** Desktop: the card can be dragged (pointer or keyboard). */
  draggable: boolean;
}

/**
 * A board card (F07). On desktop the card body is the drag handle (pointer: drag after a few pixels, so a click
 * opens the quick view; keyboard: Space picks it up, arrows move between columns, Space drops, Escape cancels;
 * Enter opens the quick view). The checkbox selects it for multi-card moves. On phones a "Move to…" menu lists
 * only the allowed targets.
 */
export function BoardCardItem({ card, selected, onToggleSelect, onOpen, onMoveTo, draggable }: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: card.id,
    data: { card },
    disabled: !draggable,
  });
  const targets = boardTargets(card.status);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    listeners?.onKeyDown?.(event);
    if (event.key === 'Enter' && !event.defaultPrevented) {
      event.preventDefault();
      onOpen(card);
    }
  };

  return (
    <li
      ref={setNodeRef}
      data-testid="board-card"
      data-tk={card.tkId}
      data-status={card.status}
      data-selected={selected || undefined}
      className={cn(
        'flex items-start gap-2 rounded-md border bg-card p-2 shadow-xs transition-colors',
        selected && 'border-primary ring-1 ring-primary',
        isDragging && 'opacity-40',
      )}
    >
      <Checkbox
        className="mt-0.5"
        aria-label={`Select ${card.tkId}`}
        checked={selected}
        onClick={(e: MouseEvent) => {
          e.preventDefault();
          onToggleSelect(card, e.shiftKey);
        }}
      />
      <div
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        // A card that can't be dragged (phones) still opens its quick view.
        aria-disabled={undefined}
        onKeyDown={onKeyDown}
        role="button"
        tabIndex={0}
        aria-roledescription={draggable ? 'draggable fitment' : 'fitment'}
        aria-label={`${card.tkId}, ${card.client.name}, ${card.technician?.name ?? 'unassigned'}`}
        className={cn(
          'min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
          draggable ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-pointer',
        )}
        onClick={() => onOpen(card)}
      >
        <BoardCardBody card={card} />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label={`Move ${card.tkId} to…`}>
            <ArrowRightLeft />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Move to…</DropdownMenuLabel>
          {targets.map((to) => (
            <DropdownMenuItem key={to} onSelect={() => onMoveTo(card, to)}>
              {FITMENT_STATUS_LABELS[to]}
            </DropdownMenuItem>
          ))}
          {targets.length === 0 && (
            <DropdownMenuItem disabled>Nothing from the board; open the card for details</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
