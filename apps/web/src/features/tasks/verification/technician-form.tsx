import type { ReactNode } from 'react';
import {
  CHECK_LABELS,
  CHECK_VALUE_LABELS,
  DEVICE_REPLACEMENT_LABELS,
  FITMENT_CHECKS,
  FITMENT_FORM_FIELD_LABELS,
  type FitmentDto,
} from '@champ/shared';
import { formatIst } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The technician's answers from the app (F10B), shown read-only on the verification sheet above the OE fields:
 * start and submit times, the five checks (Not OK highlighted), readings, device replacement, device ids and
 * comments.
 */
export function TechnicianForm({ fitment }: { fitment: FitmentDto }) {
  const f = fitment.technicianForm;
  const text = (v: string | number | null) => (v === null || v === '' ? '—' : String(v));
  return (
    <div className="grid gap-3" data-testid="technician-form">
      <h4 className="text-sm font-semibold">Technician&apos;s form</h4>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Item label="Technician">{fitment.technician?.name ?? '—'}</Item>
        <Item label="Started (IST)">{fitment.startedAt ? formatIst(fitment.startedAt) : '—'}</Item>
        <Item label="Submitted (IST)">{fitment.submittedAt ? formatIst(fitment.submittedAt) : '—'}</Item>
      </dl>
      <ul className="grid gap-1 text-sm" aria-label="Checks">
        {FITMENT_CHECKS.map((c) => {
          const value = f.checks[c];
          return (
            <li key={c} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1" data-testid={`check-${c}`}>
              <span>{CHECK_LABELS[c]}</span>
              <span
                className={cn(value === 'NOT_OK' ? 'font-semibold text-destructive' : value ? '' : 'text-muted-foreground')}
                data-not-ok={value === 'NOT_OK' || undefined}
              >
                {value ? CHECK_VALUE_LABELS[value] : 'Not answered'}
              </span>
            </li>
          );
        })}
      </ul>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Item label={FITMENT_FORM_FIELD_LABELS.vehicleRegNo}>{text(f.vehicleRegNo)}</Item>
        <Item label={FITMENT_FORM_FIELD_LABELS.chassisNo}>{text(f.chassisNo)}</Item>
        <Item label={FITMENT_FORM_FIELD_LABELS.clusterReadingKm}>
          {f.clusterReadingKm === null ? '—' : `${f.clusterReadingKm.toLocaleString('en-IN')} km`}
        </Item>
        <Item label={FITMENT_FORM_FIELD_LABELS.deviceReplacement}>
          {f.deviceReplacement ? DEVICE_REPLACEMENT_LABELS[f.deviceReplacement] : '—'}
        </Item>
        <Item label={FITMENT_FORM_FIELD_LABELS.deviceId}>
          <span className="font-mono">{text(f.deviceId)}</span>
        </Item>
        <Item label={FITMENT_FORM_FIELD_LABELS.secondaryDeviceId}>
          <span className="font-mono">{text(f.secondaryDeviceId)}</span>
        </Item>
      </dl>
      <div className="grid gap-1 text-sm">
        <div className="text-xs text-muted-foreground">Comments from the technician</div>
        <p className="rounded-md bg-muted/50 p-2 whitespace-pre-wrap" data-testid="ot-remarks">
          {fitment.verification.otRemarks ?? 'No comments from the technician.'}
        </p>
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 break-words">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
