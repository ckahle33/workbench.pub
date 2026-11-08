const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Every date the site shows goes through here. Format: MM.DD.YYYY (US, month first, zero padded,
 * dots). Dates are shown in the VIEWER'S LOCAL timezone, so a post made in the evening stays on
 * the day the author saw; the machine-readable ISO value stays in `<time dateTime>`.
 * Unparseable input is returned as is.
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${pad(d.getMonth() + 1)}.${pad(d.getDate())}.${d.getFullYear()}`;
}

/** Local time on a US 12-hour clock: `3:42 pm`. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const h = d.getHours();
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`;
}

/** `10.21.2026 · 3:42 pm` */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${formatDate(iso)} · ${formatTime(iso)}`;
}
