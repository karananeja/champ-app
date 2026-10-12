import { textCandidates } from './text-candidates';

describe('textCandidates', () => {
  it('keeps alphanumeric runs of 6+ characters, longest first, in reading order on ties', () => {
    const lines = ['IMEI: 861234567890123', 'S/N AB12-CD34EF', 'Model ICX200 v2', 'DEVICE ABC123'];
    expect(textCandidates(lines)).toEqual(['861234567890123', 'CD34EF', 'ICX200', 'DEVICE', 'ABC123']);
  });

  it('drops short runs and case-insensitive duplicates', () => {
    expect(textCandidates(['abc12', 'Dev12345', 'DEV12345 dev12345', ''])).toEqual(['Dev12345']);
  });

  it('caps the list', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `ID${String(i).padStart(6, '0')}`);
    expect(textCandidates(lines, 3)).toHaveLength(3);
    expect(textCandidates(lines)).toHaveLength(8);
  });
});
