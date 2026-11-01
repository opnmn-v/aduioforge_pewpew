export function parseTrackTime(value: string): number | undefined {
  if (!value.trim()) return undefined;
  if (!/^\d+(?::[0-5]\d){0,2}$/.test(value.trim())) return NaN;
  return value.trim().split(':').reduce((total, part) => total * 60 + Number(part), 0);
}
export function formatTrackTime(value?: number): string {
  return value === undefined ? '' : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
