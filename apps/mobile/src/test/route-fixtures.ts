import type { DayRouteDto, MyFitmentDto, RouteStopDto } from '@champ/shared';

export function makeFitment(over: Partial<MyFitmentDto> = {}): MyFitmentDto {
  return {
    id: 'f1',
    tkId: 'TK-00012',
    status: 'ASSIGNED',
    fitmentAt: '2026-10-12T04:30:00.000Z',
    customer: 'Acme Logistics',
    site: { name: 'Peenya depot', address: '12 Industrial Rd, Bengaluru', lat: 13.03, lng: 77.52 },
    vehicleRegNo: 'KA01AB1234',
    activity: 'New installation',
    taskId: 't1',
    oe: { name: 'Asha Rao', phone: '+91 98450 00002' },
    chassisNo: 'MA1CH4551',
    assetNumber: 'AS-77',
    assetType: 'Truck',
    installationType: 'Hidden',
    availableActions: ['START', 'CLOSE_NOT_DONE', 'MARK_FAULTY'],
    ...over,
  };
}

export function makeStop(over: Partial<Omit<RouteStopDto, 'fitment'>> & { fitment?: Partial<MyFitmentDto> } = {}): RouteStopDto {
  const { fitment, ...rest } = over;
  return {
    order: 1,
    done: false,
    isNext: false,
    blockedBy: null,
    legFromPrevious: { distanceM: 3400, durationS: 720 },
    ...rest,
    fitment: makeFitment(fitment),
  };
}

export function makeRoute(over: Partial<DayRouteDto> = {}): DayRouteDto {
  return {
    date: '2026-10-12',
    origin: { lat: 12.97, lng: 77.59, source: 'GPS' },
    engine: 'OSRM',
    totalDistanceM: 12_300,
    geometry: { type: 'LineString', coordinates: [[77.59, 12.97], [77.52, 13.03]] },
    stops: [],
    computedAt: '2026-10-12T03:00:00.000Z',
    ...over,
  };
}
