import { dateLabel, dateOptions, formatIstTime } from './format';
import { resolveApiOrigin } from './api-base-url';

describe('date picker options (D-029)', () => {
  it('offers today and the 7 IST days before it, newest first, with Today and Yesterday labels', () => {
    // 18:45Z on 11 Oct is 00:15 on 12 Oct in IST.
    const opts = dateOptions(new Date('2026-10-11T18:45:00Z'));
    expect(opts).toHaveLength(8);
    expect(opts[0]).toEqual({ value: '2026-10-12', label: 'Today' });
    expect(opts[1]).toEqual({ value: '2026-10-11', label: 'Yesterday' });
    expect(opts[7]?.value).toBe('2026-10-05');
    expect(opts[2]?.label).toMatch(/Sat.*10.*Oct/);
  });

  it('labels a date relative to now', () => {
    expect(dateLabel('2026-10-12', new Date('2026-10-12T06:00:00Z'))).toBe('Today');
  });

  it('shows times in IST', () => {
    expect(formatIstTime('2026-10-12T08:30:00.000Z')).toMatch(/02:00\s?pm/i);
  });
});

describe('API origin (D-133)', () => {
  it('prefers EXPO_PUBLIC_API_URL', () => {
    expect(resolveApiOrigin('http://192.168.1.20:4000/', '10.0.0.5:8081', 'ios')).toBe('http://192.168.1.20:4000');
  });
  it('uses the Metro host with port 4000', () => {
    expect(resolveApiOrigin(undefined, '192.168.1.7:8081', 'ios')).toBe('http://192.168.1.7:4000');
  });
  it('maps localhost to 10.0.2.2 on the Android emulator', () => {
    expect(resolveApiOrigin(undefined, 'localhost:8081', 'android')).toBe('http://10.0.2.2:4000');
    expect(resolveApiOrigin(undefined, undefined, 'ios')).toBe('http://localhost:4000');
  });
});
