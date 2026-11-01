import { expect, it } from 'vitest';
import { parseTrackTime, formatTrackTime } from './track-time';
it('parses seconds and timestamps, rejecting malformed times', () => {
  expect(parseTrackTime('7:03')).toBe(423);
  expect(parseTrackTime('1:07:03')).toBe(4023);
  expect(parseTrackTime('')).toBeUndefined();
  expect(parseTrackTime('7:99')).toBeNaN();
  expect(parseTrackTime('-1')).toBeNaN();
  expect(formatTrackTime(423)).toBe('7:03');
});
