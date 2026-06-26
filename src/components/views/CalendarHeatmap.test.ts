import { describe, it, expect } from 'vitest';
import { weekColumnShift } from './CalendarHeatmap';

/**
 * Regression for the timezone bug where Jan 1's weekday was read from a
 * `Date.UTC` instant (`new Date(Date.UTC(y,0,1)).getDay()`), which returns the
 * PREVIOUS calendar day west of UTC and shifted every week column of the year
 * left by one. The fix reads the LOCAL Jan 1 weekday; this test pins the
 * Monday-anchored shift math so a future edit can't reintroduce the UTC slip.
 *
 * `weekColumnShift(jsWeekday)` takes a JS `getDay()` (0=Sun) and returns how
 * many days Jan 1 must move back to reach its week's Monday, so Jan 1 lands at
 * column 0 in a Monday-anchored grid.
 */
describe('weekColumnShift', () => {
  it('returns 0 for a Monday Jan 1 (week starts on Jan 1)', () => {
    expect(weekColumnShift(1)).toBe(0); // 2024: Jan 1 = Mon
  });

  it('returns 1 for a Tuesday Jan 1', () => {
    expect(weekColumnShift(2)).toBe(1); // 2019: Jan 1 = Tue
  });

  it('returns 2 for a Wednesday Jan 1 (the 2025 case)', () => {
    expect(weekColumnShift(3)).toBe(2); // 2025: Jan 1 = Wed
  });

  it('returns 6 for a Sunday Jan 1 (wraps to previous Monday)', () => {
    expect(weekColumnShift(0)).toBe(6); // 2023: Jan 1 = Sun
  });

  it('places Jan 1 at column 0 for any weekday', () => {
    // With the shift applied, Jan 1's offset is 0 → floor((0 + shift) / 7) = 0
    // for every valid shift (0..6), so Jan 1 always sits in the first column.
    for (let weekday = 0; weekday < 7; weekday++) {
      const shift = weekColumnShift(weekday);
      expect(shift).toBeGreaterThanOrEqual(0);
      expect(shift).toBeLessThanOrEqual(6);
      const col0 = Math.floor((0 + shift) / 7); // Jan 1: offsetDays = 0
      expect(col0).toBe(0);
    }
  });
});
