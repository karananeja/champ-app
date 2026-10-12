import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { ChevronDown, Info, Search, SquareKanban, X } from 'lucide-react';
import {
  BOARD_COLUMNS,
  BOARD_LANES,
  BOARD_STATUSES,
  FITMENT_STATUS_LABELS,
  boardMove,
  boardMoveRefusal,
  parseTaskId,
  type BoardCard,
  type BoardMoveKind,
  type BoardResponse,
  type FitmentStatus,
} from '@champ/shared';
import { DateRangePicker } from '@/components/date-picker';
import { ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SearchableSelect } from '@/components/searchable-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDebounced } from '@/hooks/use-debounced';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useCurrentUser } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { useLookups } from '../../masters/queries';
import { useTaskOptions } from '../queries';
import { BoardCardBody, BoardCardItem } from './board-card';
import { BoardColumn, CollapsedLane } from './board-column';
import { columnId, statusOfColumn, useColumnCards } from './column-state';
import { BoardMoveDialog, type PendingMove } from './board-move-dialogs';
import { boardQuery, filtersFromParams, hasBoardFilters, withFilters, type BoardFilters } from './board-query';
import { BoardQuickView } from './board-quick-view';
import { useBoard } from './queries';
import { useBoardMoves } from './use-board-moves';

/** Selected cards: always in one column. */
interface Selection {
  status: FitmentStatus;
  cards: BoardCard[];
  anchor: string;
}

interface DragState {
  card: BoardCard;
  cards: BoardCard[];
}

const label = (s: FitmentStatus) => FITMENT_STATUS_LABELS[s];
const what = (cards: BoardCard[]) => (cards.length === 1 ? cards[0]!.tkId : `${cards.length} fitments`);

/** Keyboard dragging moves a card one column at a time (main columns, then the side lanes). */
const ARROWS_NEXT: string[] = [KeyboardCode.Right, KeyboardCode.Down];
const ARROWS_PREV: string[] = [KeyboardCode.Left, KeyboardCode.Up];

/** Props of one column: its cards (first page plus "Load more") and the drag state. */
interface ColumnSlotProps {
  status: FitmentStatus;
  board: BoardResponse | undefined;
  loading: boolean;
  query: Record<string, string>;
  paused: boolean;
  dragFrom: FitmentStatus | null;
  /** The keyboard drag's current column. */
  keyboardOver: boolean;
  className?: string;
  renderCard: (card: BoardCard, items: BoardCard[]) => ReactNode;
}

/** A column with its own "Load more" pages. */
function ColumnSlot({ status, board, loading, query, paused, dragFrom, keyboardOver, className, renderCard }: ColumnSlotProps) {
  const column = board?.columns[status];
  const { items, hasMore, fetchMore, loadingMore } = useColumnCards(status, column, query, paused);
  return (
    <BoardColumn
      status={status}
      count={column?.count}
      items={items}
      loading={loading}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={fetchMore}
      disabled={!!dragFrom && dragFrom !== status && !boardMove(dragFrom, status)}
      highlighted={keyboardOver}
      renderCard={renderCard}
      className={className}
    />
  );
}

/**
 * Filters (F07): customer, OE, technician, activity, fitment date range and id search, all in the URL. Every
 * control is placeholder-only with an `aria-label` (CR-04 / D-089).
 */
function BoardFilterBar({ filters, onChange }: { filters: BoardFilters; onChange: (patch: Partial<BoardFilters>) => void }) {
  const lookups = useLookups();
  const options = useTaskOptions();
  const [q, setQ] = useState(filters.q);
  const debouncedQ = useDebounced(q);
  const assetName = (id: string) => lookups.data?.assetTypes.find((a) => a.id === id)?.name;

  // The id search writes to the URL once typing pauses; a URL change (e.g. Clear filters) resets the box.
  useEffect(() => {
    if (debouncedQ.trim() !== filters.q) onChange({ q: debouncedQ });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the typed value settles
  }, [debouncedQ]);
  const [lastUrlQ, setLastUrlQ] = useState(filters.q);
  if (filters.q !== lastUrlQ) {
    setLastUrlQ(filters.q);
    if (filters.q !== q.trim()) setQ(filters.q);
  }

  const notAnId = !!q.trim() && !parseTaskId(q);
  return (
    <div className="grid grid-cols-1 gap-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="relative col-span-2 lg:col-span-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="TK, OM or OE id"
            aria-label="Search by TK, OM or OE id"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
        </div>
        <SearchableSelect
          aria-label="Filter by customer"
          className="col-span-2 lg:col-span-1"
          value={filters.clientId || null}
          onChange={(v) => onChange({ clientId: v ?? '' })}
          options={(lookups.data?.clients ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code ?? undefined }))}
          clearLabel="All customers"
          searchPlaceholder="Search customer"
        />
        <SearchableSelect
          aria-label="Filter by OE"
          className="col-span-2 lg:col-span-1"
          value={filters.oeId || null}
          onChange={(v) => onChange({ oeId: v ?? '' })}
          options={(options.data?.oes ?? []).map((o) => ({ value: o.id, label: o.name }))}
          clearLabel="All OEs"
          searchPlaceholder="Search OE"
        />
        <SearchableSelect
          aria-label="Filter by technician"
          className="col-span-2 lg:col-span-1"
          value={filters.technicianId || null}
          onChange={(v) => onChange({ technicianId: v ?? '' })}
          options={(options.data?.technicians ?? []).map((t) => ({ value: t.id, label: t.name, hint: t.baseLocation ?? undefined }))}
          clearLabel="All technicians"
          searchPlaceholder="Search technician"
        />
        <SearchableSelect
          aria-label="Filter by activity"
          className="col-span-2 lg:col-span-1"
          value={filters.activityId || null}
          onChange={(v) => onChange({ activityId: v ?? '' })}
          options={(lookups.data?.activities ?? []).map((a) => ({ value: a.id, label: a.name, hint: assetName(a.assetTypeId) }))}
          clearLabel="All activities"
          searchPlaceholder="Search activity"
        />
        <DateRangePicker
          aria-label="Filter by fitment date"
          className="col-span-2 lg:col-span-1"
          placeholder="Any fitment date"
          value={{ from: filters.from, to: filters.to }}
          onChange={({ from, to }) => onChange({ from, to })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {!filters.from && !filters.to && (
          <span className="flex items-center gap-1" data-testid="finished-note">
            <Info className="size-3.5" /> Finished columns show the last 7 days
          </span>
        )}
        {notAnId && <span className="text-destructive">Search by a TK, OM or OE id, e.g. TK-00012</span>}
        {hasBoardFilters(filters) && (
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onChange({ clientId: '', oeId: '', technicianId: '', activityId: '', from: '', to: '', q: '' })}>
            <X /> Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * `/tasks/board` (F07, SA/OM): the kanban board of fitments. Six main columns and three side lanes (D-109),
 * drag and drop (pointer and keyboard) through `boardMove` (D-113): each allowed drop opens its dialog, a
 * refused one shows the reason and the card snaps back. Multi-select with checkboxes (Shift-click for a range).
 * Optimistic moves, refetch every 30 s and on focus (paused while dragging or in a dialog), filters in the URL,
 * a quick view per card, and on phones one column at a time with a "Move to…" menu.
 */
export function BoardPage() {
  const actor = useCurrentUser();
  const isDesktop = useIsDesktop();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = filtersFromParams(searchParams);
  const query = boardQuery(filters);

  const [selection, setSelection] = useState<Selection | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [quickView, setQuickView] = useState<BoardCard | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [mobileColumn, setMobileColumn] = useState<FitmentStatus>('OPEN');
  const scroller = useRef<HTMLDivElement>(null);
  const keyboardTarget = useRef<FitmentStatus | null>(null);
  // The column chosen with the arrow keys during a keyboard drag (highlighted and announced).
  const [keyboardOver, setKeyboardOver] = useState<FitmentStatus | null>(null);

  const moves = useBoardMoves(query);
  const paused = !!drag || !!pending || !!quickView || moves.isPending;
  const board = useBoard(query, paused);
  const data = board.data;
  const loading = board.isPending;

  const updateFilters = (patch: Partial<BoardFilters>) => {
    setSearchParams(withFilters(searchParams, patch), { replace: true });
    setSelection(null);
  };

  const isSelected = (card: BoardCard) => !!selection && selection.status === card.status && selection.cards.some((c) => c.id === card.id);

  /** The cards a move of `card` takes along: the selection when the card is part of it, else just the card. */
  const movingCards = (card: BoardCard): BoardCard[] => (isSelected(card) ? selection!.cards : [card]);

  /** Checkbox: toggles a card; Shift adds the range from the last toggled card (same column only). */
  const toggleSelect = (card: BoardCard, range: boolean, items: BoardCard[]) =>
    setSelection((prev) => {
      if (!prev || prev.status !== card.status) return { status: card.status, cards: [card], anchor: card.id };
      if (range) {
        const a = items.findIndex((c) => c.id === prev.anchor);
        const b = items.findIndex((c) => c.id === card.id);
        if (a >= 0 && b >= 0) {
          const span = items.slice(Math.min(a, b), Math.max(a, b) + 1).filter((c) => !prev.cards.some((p) => p.id === c.id));
          return { ...prev, cards: [...prev.cards, ...span], anchor: card.id };
        }
      }
      const cards = prev.cards.some((c) => c.id === card.id) ? prev.cards.filter((c) => c.id !== card.id) : [...prev.cards, card];
      return cards.length ? { ...prev, cards, anchor: card.id } : null;
    });

  /** A drop or "Move to…": the dialog of an allowed move, or the reason it is refused. */
  const requestMove = (cards: BoardCard[], to: FitmentStatus) => {
    const from = cards[0]!.status;
    if (from === to) return;
    const move = boardMove(from, to);
    if (!move) {
      toast.error(boardMoveRefusal(from, to));
      return;
    }
    setPending({ kind: move.kind, cards });
  };

  const startFromQuickView = (kind: BoardMoveKind, card: BoardCard, currentTechnicianId: string | null) => {
    setQuickView(null);
    setPending({ kind, cards: [card], reassign: kind === 'ASSIGN' && card.status !== 'OPEN', currentTechnicianId });
  };

  // --- Drag and drop ---
  const order: FitmentStatus[] = BOARD_STATUSES as FitmentStatus[];
  const coordinateGetter: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
    const step = ARROWS_NEXT.includes(event.code) ? 1 : ARROWS_PREV.includes(event.code) ? -1 : 0;
    if (!step) return undefined;
    event.preventDefault();
    const at = order.indexOf(keyboardTarget.current ?? order[0]!);
    const next = order[Math.min(order.length - 1, Math.max(0, at + step))]!;
    keyboardTarget.current = next;
    setKeyboardOver(next);
    const rect = context.droppableRects.get(columnId(next));
    const own = context.collisionRect;
    const target = rect && own ? { x: rect.left + rect.width / 2 - own.width / 2, y: rect.top + 48 } : currentCoordinates;
    // Always report a change so the collision (the keyboard target) is recomputed.
    return target.x === currentCoordinates.x && target.y === currentCoordinates.y ? { x: target.x + step, y: target.y } : target;
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: [KeyboardCode.Space], cancel: [KeyboardCode.Esc], end: [KeyboardCode.Space, KeyboardCode.Enter] },
      coordinateGetter,
    }),
  );
  /** Pointer: the column under the pointer (else the most overlapped); keyboard: the column chosen with the arrows. */
  const collisionDetection: CollisionDetection = (args) => {
    if (keyboardTarget.current) return [{ id: columnId(keyboardTarget.current) }];
    const hits = pointerWithin(args);
    return hits.length ? hits : rectIntersection(args);
  };

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const card = (active.data.current as { card: BoardCard }).card;
    keyboardTarget.current = activatorEvent instanceof KeyboardEvent ? card.status : null;
    setDrag({ card, cards: movingCards(card) });
  };
  const endDrag = () => {
    keyboardTarget.current = null;
    setKeyboardOver(null);
    setDrag(null);
  };
  const onDragEnd = ({ over }: DragEndEvent) => {
    const cards = drag?.cards;
    // Keyboard: the column chosen with the arrows (the sensor may scroll instead of moving, so `over` can lag).
    const to = keyboardTarget.current ?? (over ? statusOfColumn(over.id) : null);
    endDrag();
    if (cards && to) requestMove(cards, to);
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${what(movingCards((active.data.current as { card: BoardCard }).card))}. Use the arrow keys to move between columns, Space to drop, Escape to cancel.`,
    onDragOver: ({ over }) => {
      const to = over ? statusOfColumn(over.id) : null;
      if (!drag || !to) return undefined;
      const refusal = drag.card.status === to ? null : boardMoveRefusal(drag.card.status, to);
      return `Over ${label(to)}${refusal ? `: not allowed. ${refusal}` : ''}.`;
    },
    onDragEnd: ({ over }) => {
      const to = keyboardTarget.current ?? (over ? statusOfColumn(over.id) : null);
      return to ? `Dropped on ${label(to)}.` : 'Dropped outside the board; nothing changed.';
    },
    onDragCancel: () => 'Move cancelled; the fitment stays where it was.',
  };

  const dragFrom = drag?.card.status ?? null;
  const renderCard = (card: BoardCard, items: BoardCard[]) => (
    <BoardCardItem
      key={card.id}
      card={card}
      selected={isSelected(card)}
      onToggleSelect={(c, range) => toggleSelect(c, range, items)}
      onOpen={setQuickView}
      onMoveTo={(c, to) => requestMove(movingCards(c), to)}
      draggable={isDesktop}
    />
  );
  const slot = (status: FitmentStatus, className?: string) => (
    <ColumnSlot
      key={status}
      status={status}
      board={data}
      loading={loading}
      query={query}
      paused={paused}
      dragFrom={dragFrom}
      keyboardOver={keyboardOver === status}
      className={className}
      renderCard={renderCard}
    />
  );

  // Phones: keep the picker and the swiped column in sync.
  const showColumn = (status: FitmentStatus) => {
    setMobileColumn(status);
    const el = scroller.current;
    if (el) el.scrollTo?.({ left: BOARD_STATUSES.indexOf(status) * el.clientWidth, behavior: 'smooth' });
  };
  const onSwipe = () => {
    const el = scroller.current;
    if (!el || !el.clientWidth) return;
    const status = BOARD_STATUSES[Math.round(el.scrollLeft / el.clientWidth)];
    if (status && status !== mobileColumn) setMobileColumn(status);
  };

  const quickViewCard = quickView && (BOARD_STATUSES.flatMap((s) => data?.columns[s].items ?? []).find((c) => c.id === quickView.id) ?? quickView);
  const laneCounts = BOARD_LANES.map((s) => `${label(s)} ${data?.columns[s].count ?? 0}`).join(' · ');

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <PageHeader icon={SquareKanban} title="Board" description="Every fitment by status. Drag a card to assign, approve or reopen it." level={2} />
      <BoardFilterBar filters={filters} onChange={updateFilters} />

      {selection && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="board-selection">
          <span>
            {selection.cards.length} selected in {label(selection.status)}
          </span>
          <span className="hidden text-muted-foreground md:inline">· drag one of them to move them all</span>
          <Button variant="ghost" size="sm" className="ml-auto h-7 px-2" onClick={() => setSelection(null)}>
            <X /> Clear selection
          </Button>
        </div>
      )}

      {board.isError ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={endDrag}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                'To move a fitment, press Space to pick it up, use the arrow keys to choose a column, then press Space to drop it or Escape to cancel. Press Enter to open its quick view.',
            },
          }}
        >
          {isDesktop ? (
            <div className="grid min-w-0 gap-3">
              <div className="overflow-x-auto pb-2" data-testid="board-scroll">
                <div className="flex min-w-max items-start gap-3">{BOARD_COLUMNS.map((s) => slot(s, 'w-64 shrink-0'))}</div>
              </div>
              <section className="grid gap-2 rounded-lg border p-2" aria-label="Other">
                <Button
                  variant="ghost"
                  className="justify-start"
                  aria-expanded={otherOpen}
                  onClick={() => setOtherOpen((v) => !v)}
                >
                  <ChevronDown className={cn('transition-transform', !otherOpen && '-rotate-90')} /> Other
                  <span className="font-normal text-muted-foreground">{laneCounts}</span>
                </Button>
                {otherOpen ? (
                  <div className="overflow-x-auto">
                    <div className="flex min-w-max items-start gap-3">{BOARD_LANES.map((s) => slot(s, 'w-64 shrink-0'))}</div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {BOARD_LANES.map((s) => (
                      <CollapsedLane
                        key={s}
                        status={s}
                        count={data?.columns[s].count}
                        disabled={!!dragFrom && dragFrom !== s && !boardMove(dragFrom, s)}
                        highlighted={keyboardOver === s}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="grid min-w-0 gap-2">
              <Select value={mobileColumn} onValueChange={(v) => showColumn(v as FitmentStatus)}>
                <SelectTrigger aria-label="Column" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BOARD_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {label(s)} ({data?.columns[s].count ?? 0})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div
                ref={scroller}
                onScroll={onSwipe}
                className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
                data-testid="board-swipe"
              >
                {BOARD_STATUSES.map((s) => (
                  <div key={s} className="w-full shrink-0 snap-start px-0.5" data-active={s === mobileColumn || undefined}>
                    {slot(s)}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div aria-live="assertive" className="sr-only" data-testid="keyboard-announcement">
            {drag && keyboardOver && keyboardOver !== drag.card.status
              ? `Over ${label(keyboardOver)}${boardMove(drag.card.status, keyboardOver) ? '' : `: not allowed. ${boardMoveRefusal(drag.card.status, keyboardOver)}`}.`
              : ''}
          </div>
          <DragOverlay dropAnimation={null}>
            {drag && (
              <div className="w-72 cursor-grabbing rounded-md border bg-card p-2 shadow-lg" data-testid="drag-overlay">
                {drag.cards.length > 1 ? <div className="py-2 text-center font-medium">{drag.cards.length} fitments</div> : <BoardCardBody card={drag.card} />}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {pending && (
        <BoardMoveDialog
          pending={pending}
          actor={actor}
          onConfirm={(move) => {
            moves.mutate(move);
            setSelection(null);
          }}
          onClose={() => setPending(null)}
        />
      )}
      {quickViewCard && <BoardQuickView card={quickViewCard} onClose={() => setQuickView(null)} onAction={startFromQuickView} />}
    </div>
  );
}
