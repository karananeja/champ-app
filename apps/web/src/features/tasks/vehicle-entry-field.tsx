import { useState } from 'react';
import { useWatch, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form';
import { Download, Loader2 } from 'lucide-react';
import { MAX_VEHICLES_PER_TASK, type VehicleRowInput } from '@champ/shared';
import { FieldError } from '@/components/field-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ResolverContext, TaskFormValues, VehicleEntry } from './task-form-page';
import { downloadVehicleSample, parseVehicleCsv } from './vehicle-csv';

const PREVIEW_ROWS = 10;

const vehicleSummary = (row: VehicleRowInput) =>
  [
    row.vehicleRegNo,
    row.chassisNo && `Chassis ${row.chassisNo}`,
    row.assetNumber && `Asset ${row.assetNumber}`,
    row.oldDeviceId && `Old device ${row.oldDeviceId}`,
  ]
    .filter(Boolean)
    .join(' · ') || '—';

/** Vehicles of a new task: a count, or a CSV (parsed in the browser) with a preview and its errors. */
export function VehicleEntryField({
  control,
  register,
  set,
  errors,
}: {
  control: Control<TaskFormValues, ResolverContext>;
  register: UseFormRegister<TaskFormValues>;
  set: <K extends keyof TaskFormValues>(name: K, value: TaskFormValues[K]) => void;
  errors: FieldErrors<TaskFormValues>;
}) {
  const [entry, rows, fileName, fileErrors] = useWatch({
    control,
    name: ['vehicleEntry', 'vehicleRows', 'vehicleFile', 'vehicleFileErrors'],
  });
  const [parsing, setParsing] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setParsing(true);
    try {
      const result = await parseVehicleCsv(file);
      set('vehicleFile', file.name);
      set('vehicleFileErrors', result.errors);
      set('vehicleRows', result.errors.length ? [] : result.rows);
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-1 gap-2">
        <Label id="vehicle-entry-label">Vehicle list</Label>
        <RadioGroup
          aria-labelledby="vehicle-entry-label"
          value={entry}
          onValueChange={(v) => set('vehicleEntry', v as VehicleEntry)}
          className="flex flex-wrap gap-x-4 gap-y-2"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="COUNT" id="vehicle-entry-count" />
            <Label htmlFor="vehicle-entry-count" className="font-normal">
              Enter number of vehicles
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="CSV" id="vehicle-entry-csv" />
            <Label htmlFor="vehicle-entry-csv" className="font-normal">
              Upload CSV
            </Label>
          </div>
        </RadioGroup>
      </div>

      {entry === 'COUNT' ? (
        <div className="grid max-w-xs grid-cols-1 gap-2">
          <Label htmlFor="task-vehicle-count">Number of vehicles</Label>
          <Input
            id="task-vehicle-count"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_VEHICLES_PER_TASK}
            aria-invalid={!!errors.vehicleCount}
            {...register('vehicleCount')}
          />
          <FieldError id="task-vehicle-count-error" message={errors.vehicleCount?.message} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          <p className="text-sm text-muted-foreground">
            One row per vehicle with the columns registration_number, chassis_number, asset_number and old_device_id
            (all optional; up to {MAX_VEHICLES_PER_TASK} rows).
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:max-w-sm">
              <Label htmlFor="task-vehicle-csv">Vehicle CSV</Label>
              <Input
                id="task-vehicle-csv"
                type="file"
                accept=".csv,text/csv"
                aria-invalid={!!errors.vehicleRows}
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </div>
            <Button type="button" variant="outline" onClick={downloadVehicleSample}>
              <Download /> Download sample CSV
            </Button>
          </div>
          {parsing && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Reading the file…
            </p>
          )}
          {fileErrors.length > 0 && (
            <ul className="grid grid-cols-1 gap-1 text-sm text-destructive" data-testid="vehicle-csv-errors">
              {fileErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
          {rows.length > 0 && (
            <div className="grid grid-cols-1 gap-2">
              <p className="text-sm" data-testid="vehicle-csv-summary">
                {fileName}: {rows.length} vehicle(s)
                {rows.length > PREVIEW_ROWS && `, showing the first ${PREVIEW_ROWS}`}
              </p>
              <div className="hidden rounded-md border md:block">
                <Table aria-label="Vehicles from the CSV">
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Registration no.</TableHead>
                      <TableHead>Chassis no.</TableHead>
                      <TableHead>Asset no.</TableHead>
                      <TableHead>Old device id</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                      <TableRow key={i} data-testid="vehicle-csv-row">
                        <TableCell>{i + 1}</TableCell>
                        <TableCell>{row.vehicleRegNo ?? '—'}</TableCell>
                        <TableCell>{row.chassisNo ?? '—'}</TableCell>
                        <TableCell>{row.assetNumber ?? '—'}</TableCell>
                        <TableCell>{row.oldDeviceId ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ol className="grid grid-cols-1 gap-1 md:hidden" aria-label="Vehicles from the CSV">
                {rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                  <li key={i} className="rounded-md border px-3 py-2 text-sm break-words">
                    <span className="font-medium">{i + 1}.</span> {vehicleSummary(row)}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <FieldError id="task-vehicle-csv-error" message={errors.vehicleRows?.message} />
        </div>
      )}
    </div>
  );
}
