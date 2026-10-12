import type { BulkFillFitmentDto, BulkFillPreviewResponse, BulkFillTaskDto, MyFitmentDto, RequiredPhotoKind } from '@champ/shared';
import { makeFitment } from './route-fixtures';

export function makeBulkRow(fitment: Partial<MyFitmentDto>, missing: string[] = [], missingPhotos: RequiredPhotoKind[] = []): BulkFillFitmentDto {
  return { fitment: makeFitment({ taskFitmentCount: 3, ...fitment }), missing, missingPhotos };
}

/** Task t1 (OM-00012): f1 ready to submit, f2 In progress missing a photo and the device id, f3 not started. */
export function makeBulkTask(over: Partial<BulkFillTaskDto> = {}): BulkFillTaskDto {
  return {
    taskId: 't1',
    omId: 'OM-00012',
    customer: 'Acme Logistics',
    site: { name: 'Peenya depot', address: '12 Industrial Rd, Bengaluru', lat: 13.03, lng: 77.52 },
    fitmentAt: '2026-10-12T04:30:00.000Z',
    fitments: [
      makeBulkRow({ id: 'f1', tkId: 'TK-00012', status: 'IN_PROGRESS', vehicleRegNo: 'KA01AB1234' }),
      makeBulkRow({ id: 'f2', tkId: 'TK-00013', status: 'IN_PROGRESS', vehicleRegNo: 'KA01AB5678' }, ['Before photo', 'Device id'], ['BEFORE']),
      makeBulkRow(
        { id: 'f3', tkId: 'TK-00014', status: 'ASSIGNED', vehicleRegNo: 'KA01AB9999' },
        ['Before photo', 'Asset photo', 'Cluster reading photo', 'Device id', 'After photo'],
        ['BEFORE', 'ASSET', 'CLUSTER', 'AFTER'],
      ),
    ],
    ...over,
  };
}

/** Two valid rows (one will be started) and one invalid row. */
export function makePreview(over: Partial<BulkFillPreviewResponse> = {}): BulkFillPreviewResponse {
  return {
    rows: [
      { rowNumber: 2, tkId: 'TK-00012', fitmentId: 'f1', form: { deviceId: 'DEV-1', checks: { assetCondition: 'NOT_OK' } }, willStart: false, errors: [], valid: true },
      { rowNumber: 3, tkId: 'TK-00014', fitmentId: 'f3', form: { clusterReadingKm: 120500 }, willStart: true, errors: [], valid: true },
      {
        rowNumber: 4,
        tkId: 'TK-00099',
        fitmentId: null,
        form: {},
        willStart: false,
        errors: [
          { column: 'tk_id', message: 'Unknown TK id' },
          { column: 'can_voltage', message: 'Use OK, Not OK or NA' },
        ],
        valid: false,
      },
    ],
    validCount: 2,
    invalidCount: 1,
    startCount: 1,
    ...over,
  };
}
