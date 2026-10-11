import Papa from 'papaparse';
import { VEHICLE_CSV_COLUMNS, normalizeCsvHeader, toCsv, vehicleRowsFromCsv, type VehicleRowInput } from '@champ/shared';
import { saveText } from '@/lib/download';

export interface VehicleCsvResult {
  rows: VehicleRowInput[];
  errors: string[];
}

/** Parses the vehicle CSV of the create form in the browser (D-062): one row per vehicle. */
export async function parseVehicleCsv(file: File): Promise<VehicleCsvResult> {
  if (!/\.csv$/i.test(file.name)) return { rows: [], errors: ['Upload a .csv file'] };
  const parsed = Papa.parse<Record<string, string>>(await file.text(), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: normalizeCsvHeader,
    transform: (value) => value.trim(),
  });
  return vehicleRowsFromCsv(parsed.meta.fields ?? [], parsed.data);
}

/** The sample vehicle CSV offered next to the upload. */
export function downloadVehicleSample() {
  const columns = Object.keys(VEHICLE_CSV_COLUMNS);
  saveText(
    toCsv(columns, [
      ['KA01AB1234', 'MA3EWDE1S00123456', 'FLEET-001', ''],
      ['KA01AB5678', '', 'FLEET-002', 'LAF5-0099'],
    ]),
    'champ-vehicles-sample.csv',
  );
}
