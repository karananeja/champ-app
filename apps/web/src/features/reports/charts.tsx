import { useId, useState, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';

/*
 * Small hand-rolled charts for the reports (F15), following the dataviz method: one series hue (`--viz-series`,
 * stepped separately for light and dark), 2px lines, 4px rounded bar ends square at the baseline, hairline
 * recessive grid, text in text tokens (never the series colour), a hover read-out, and the numbers also available
 * as text (tiles and tables), so nothing depends on the chart alone.
 */

export interface SparkPoint {
  /** X label, e.g. the week start "6 Oct". */
  label: string;
  value: number;
}

interface SparklineProps {
  points: SparkPoint[];
  /** What is plotted, for the accessible name ("Submitted per week"). */
  label: string;
  format?: (value: number) => string;
  className?: string;
}

const W = 120;
const H = 32;

/** A weekly trend line with an end dot and a hover crosshair + read-out. Fewer than 2 points draws nothing. */
export function Sparkline({ points, label, format = String, className }: SparklineProps) {
  const [active, setActive] = useState<number | null>(null);
  if (points.length < 2) return null;

  const max = Math.max(...points.map((p) => p.value), 0);
  const x = (i: number) => (i / (points.length - 1)) * W;
  // 2px headroom so the stroke isn't clipped at the top or on the baseline.
  const y = (v: number) => (max === 0 ? H - 2 : H - 2 - (v / max) * (H - 4));
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ');
  const last = points.length - 1;
  const shown = active ?? last;
  const pct = (i: number) => `${(x(i) / W) * 100}%`;

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setActive(Math.round(ratio * last));
  };

  return (
    <figure className={cn('grid gap-1', className)} aria-label={`${label}: ${points.map((p) => `${p.label} ${format(p.value)}`).join(', ')}`}>
      <div className="relative h-8 w-full touch-none" onPointerMove={onMove} onPointerLeave={() => setActive(null)} aria-hidden="true">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          <line x1="0" x2={W} y1={H - 1} y2={H - 1} className="stroke-viz-grid" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {active !== null && (
            <line x1={x(active)} x2={x(active)} y1="0" y2={H} className="stroke-muted-foreground/40" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          )}
          <path d={d} fill="none" className="stroke-viz-series" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {/* Dots are HTML so they stay round while the SVG stretches; 2px card-coloured ring (surface ring). */}
        <span
          className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-viz-series ring-2 ring-card"
          style={{ left: pct(shown), top: `${(y(points[shown]!.value) / H) * 100}%` }}
        />
      </div>
      <figcaption className="flex justify-between gap-2 text-xs text-muted-foreground tabular-nums">
        <span>{points[shown]!.label}</span>
        <span className="font-medium text-foreground">{format(points[shown]!.value)}</span>
      </figcaption>
    </figure>
  );
}

export interface BarDatum {
  key: string;
  label: string;
  value: number;
}

/** Horizontal bars from one baseline, label on the left and value at the tip (status counts). */
export function BarList({ data, label, className }: { data: BarDatum[]; label: string; className?: string }) {
  const id = useId();
  const max = Math.max(...data.map((d) => d.value), 0);
  return (
    <figure className={cn('grid gap-1.5', className)} aria-labelledby={id}>
      <figcaption id={id} className="sr-only">
        {label}
      </figcaption>
      <ul className="grid gap-1.5">
        {data.map((d) => (
          <li key={d.key} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-2 text-xs" data-testid={`status-${d.key}`} title={`${d.label}: ${d.value}`}>
            <span className="truncate text-muted-foreground">{d.label}</span>
            <span className="flex min-w-0 items-center gap-1.5">
              {d.value > 0 && (
                <span
                  className="h-2.5 min-w-1 rounded-r-[4px] bg-viz-series"
                  style={{ width: `calc((100% - 3rem) * ${max ? d.value / max : 0})` }}
                  aria-hidden="true"
                />
              )}
              <span className="font-medium tabular-nums">{d.value}</span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
