import { describe, expect, it } from 'vitest';
import {
  TRAVEL_ACTIONS,
  TRAVEL_STATUSES,
  availableTravelActions,
  canEditTravel,
  canManageTravelAttachments,
  canPerformTravel,
  canRaiseTravel,
  canTransitionTravel,
  canVerifyTravel,
  createTravelSchema,
  formatTtId,
  isInTravelScope,
  istTodayDay,
  parseTravelId,
  travelScope,
  travelSourceFor,
  travelTransitionRefusal,
  travelTransitionSchema,
  updateTravelSchema,
  type Role,
  type TravelAction,
  type TravelStatus,
} from '../src';

// F08: the travel rules (spec §2) as matrices.
const actor = (role: Role, id = `${role}-1`) => ({ id, role });
/** techA reports to OE-1 (OE-2 is another OE); OT-1 is techA. */
const techA = { id: 'OT-1', managerId: 'OE-1' };
const ACTORS = {
  SA: actor('SUPER_ADMIN'),
  OM: actor('OM'),
  'OE of the technician': actor('OE', 'OE-1'),
  'other OE': actor('OE', 'OE-2'),
  'the technician': actor('OT', 'OT-1'),
  'another OT': actor('OT', 'OT-2'),
  RO: actor('RO'),
} as const;
type Who = keyof typeof ACTORS;
const WHO = Object.keys(ACTORS) as Who[];

describe('ids', () => {
  it('formats and parses TT ids', () => {
    expect(formatTtId(1)).toBe('TT-00001');
    expect(formatTtId(123456)).toBe('TT-123456');
    for (const text of ['TT-00012', 'tt-12', 'TT12', 'tt 12', ' 12 ']) expect(parseTravelId(text), text).toBe(12);
    for (const text of ['TK-12', 'TT-', 'abc', '0', 'TT-0']) expect(parseTravelId(text), text).toBeNull();
  });
});

describe('canRaiseTravel', () => {
  const RAISE: Record<Who, boolean> = {
    SA: true,
    OM: true,
    'OE of the technician': true,
    'other OE': false,
    'the technician': true,
    'another OT': false,
    RO: false,
  };
  for (const who of WHO) {
    it(`${who}: ${RAISE[who] ? 'may' : 'may not'} raise for techA`, () => expect(canRaiseTravel(ACTORS[who], techA)).toBe(RAISE[who]));
  }
  it('an OE never raises for a technician without a manager; the source is MOBILE only for an OT', () => {
    expect(canRaiseTravel(ACTORS['OE of the technician'], { id: 'OT-9', managerId: null })).toBe(false);
    expect(travelSourceFor(ACTORS['the technician'])).toBe('MOBILE');
    for (const who of ['SA', 'OM', 'OE of the technician'] as const) expect(travelSourceFor(ACTORS[who])).toBe('WEB');
  });
});

describe('canVerifyTravel (D-121)', () => {
  const VERIFY: Record<Who, boolean> = {
    SA: false,
    OM: true,
    'OE of the technician': true,
    'other OE': false,
    'the technician': false,
    'another OT': false,
    RO: false,
  };
  for (const who of WHO) it(`${who}: ${VERIFY[who]}`, () => expect(canVerifyTravel(ACTORS[who], techA)).toBe(VERIFY[who]));
});

describe('transition table (D-120)', () => {
  const EXPECTED: Record<TravelAction, TravelStatus> = { VERIFY: 'RAISED', REJECT: 'RAISED', RESUBMIT: 'REJECTED', REOPEN: 'VERIFIED' };
  for (const action of TRAVEL_ACTIONS) {
    it(`${action} only from ${EXPECTED[action]}`, () => {
      for (const status of TRAVEL_STATUSES) expect(canTransitionTravel(action, status), status).toBe(status === EXPECTED[action]);
    });
  }
  it('refuses in the F05 style', () => {
    expect(travelTransitionRefusal('TT-00001', 'VERIFY', 'VERIFIED')).toBe('TT-00001 is Verified; only Raised travel tasks can be verified');
    expect(travelTransitionRefusal('TT-00002', 'REOPEN', 'RAISED')).toBe('TT-00002 is Raised; only Verified travel tasks can be reopened');
  });
});

describe('who performs each action (raised by the OE of the technician)', () => {
  const tt = { status: 'RAISED' as TravelStatus, raisedById: 'OE-1' };
  const MATRIX: Record<TravelAction, Who[]> = {
    VERIFY: ['OM', 'OE of the technician'],
    REJECT: ['OM', 'OE of the technician'],
    RESUBMIT: ['OM', 'OE of the technician'],
    REOPEN: ['OM'],
  };
  for (const action of TRAVEL_ACTIONS) {
    it(`${action}: ${MATRIX[action].join(', ')}`, () => {
      for (const who of WHO) expect(canPerformTravel(action, ACTORS[who], tt, techA), who).toBe(MATRIX[action].includes(who));
    });
  }
  it('RESUBMIT: the raiser even when they are the technician', () => {
    expect(canPerformTravel('RESUBMIT', ACTORS['the technician'], { status: 'REJECTED', raisedById: 'OT-1' }, techA)).toBe(true);
  });
});

describe('canEditTravel and canManageTravelAttachments', () => {
  const raisedBy = 'OE-1';
  const EDIT: Record<TravelStatus, Who[]> = {
    RAISED: ['OM', 'OE of the technician'],
    REJECTED: ['OM', 'OE of the technician'],
    VERIFIED: [],
  };
  for (const status of TRAVEL_STATUSES) {
    it(`edit while ${status}: ${EDIT[status].join(', ') || 'nobody'}`, () => {
      for (const who of WHO) expect(canEditTravel(ACTORS[who], { status, raisedById: raisedBy }), who).toBe(EDIT[status].includes(who));
    });
  }
  it('receipts: editors, plus the verifier while Raised', () => {
    const raisedByOm = (status: TravelStatus) => ({ status, raisedById: 'OM-1' });
    // Raised by the OM: the technician's OE is not the raiser but verifies, so manages receipts while Raised only.
    expect(canManageTravelAttachments(ACTORS['OE of the technician'], raisedByOm('RAISED'), techA)).toBe(true);
    expect(canManageTravelAttachments(ACTORS['OE of the technician'], raisedByOm('REJECTED'), techA)).toBe(false);
    expect(canManageTravelAttachments(ACTORS.OM, raisedByOm('REJECTED'), techA)).toBe(true);
    for (const who of ['SA', 'other OE', 'the technician', 'RO'] as const) {
      expect(canManageTravelAttachments(ACTORS[who], raisedByOm('RAISED'), techA), who).toBe(false);
    }
    for (const who of WHO) expect(canManageTravelAttachments(ACTORS[who], raisedByOm('VERIFIED'), techA), who).toBe(false);
  });
});

describe('travelScope', () => {
  it('SA, OM and RO see all; an OE their technicians; an OT their own', () => {
    expect(travelScope(ACTORS.SA)).toEqual({ kind: 'all' });
    expect(travelScope(ACTORS.RO)).toEqual({ kind: 'all' });
    expect(travelScope(ACTORS['OE of the technician'])).toEqual({ kind: 'team', managerId: 'OE-1' });
    expect(travelScope(ACTORS['the technician'])).toEqual({ kind: 'own', technicianId: 'OT-1' });
    const SEES: Record<Who, boolean> = {
      SA: true,
      OM: true,
      'OE of the technician': true,
      'other OE': false,
      'the technician': true,
      'another OT': false,
      RO: true,
    };
    for (const who of WHO) expect(isInTravelScope(ACTORS[who], techA), who).toBe(SEES[who]);
  });
});

describe('availableTravelActions', () => {
  const cases: [TravelStatus, Who, TravelAction[]][] = [
    ['RAISED', 'OE of the technician', ['VERIFY', 'REJECT']],
    ['RAISED', 'OM', ['VERIFY', 'REJECT']],
    ['RAISED', 'SA', []],
    ['RAISED', 'RO', []],
    ['RAISED', 'the technician', []],
    ['REJECTED', 'OE of the technician', ['RESUBMIT']],
    ['REJECTED', 'OM', ['RESUBMIT']],
    ['REJECTED', 'other OE', []],
    ['VERIFIED', 'OM', ['REOPEN']],
    ['VERIFIED', 'OE of the technician', []],
  ];
  for (const [status, who, actions] of cases) {
    it(`${status}, ${who}: ${actions.join(', ') || 'none'}`, () =>
      expect(availableTravelActions(ACTORS[who], { status, raisedById: 'OE-1' }, techA)).toEqual(actions));
  }
});

describe('schemas', () => {
  const today = istTodayDay();
  const valid = { technicianId: 't', locationId: 'l', purpose: 'Pick up a device', travelDate: today };
  it('create: travel date not in the future, purpose 3–1000, optional customer/related/distance', () => {
    expect(createTravelSchema.parse({ ...valid, clientId: '', relatedFitmentId: null, distanceKm: 12.34 })).toMatchObject({
      clientId: null,
      relatedFitmentId: null,
      distanceKm: 12.3,
    });
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const issue = (body: object) => createTravelSchema.safeParse(body).error?.issues[0]?.message;
    expect(issue({ ...valid, travelDate: tomorrow })).toBe("The travel date can't be in the future");
    expect(issue({ ...valid, purpose: 'ab' })).toBe('Describe the purpose of travel (at least 3 characters)');
    expect(issue({ ...valid, purpose: 'x'.repeat(1001) })).toBe('The purpose must be at most 1000 characters');
    expect(issue({ ...valid, distanceKm: -1 })).toBe('The distance must be more than 0 km');
    expect(issue({ ...valid, distanceKm: 5001 })).toBe('The distance must be at most 5,000 km');
    expect(issue({ ...valid, locationId: '' })).toBe('Choose a location');
  });
  it('update needs a change; transitions need a reason for reject and reopen', () => {
    expect(updateTravelSchema.safeParse({}).success).toBe(false);
    expect(updateTravelSchema.parse({ clientId: null })).toEqual({ clientId: null });
    expect(travelTransitionSchema.safeParse({ action: 'REJECT' }).success).toBe(false);
    expect(travelTransitionSchema.safeParse({ action: 'REOPEN', reason: 'ok' }).success).toBe(false);
    expect(travelTransitionSchema.parse({ action: 'REOPEN', reason: ' Wrong km ' })).toEqual({ action: 'REOPEN', reason: 'Wrong km' });
    expect(travelTransitionSchema.parse({ action: 'RESUBMIT', changes: { distanceKm: 10 } })).toEqual({ action: 'RESUBMIT', changes: { distanceKm: 10 } });
    expect(travelTransitionSchema.safeParse({ action: 'APPROVE' }).success).toBe(false);
  });
});
