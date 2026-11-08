const LABELS: Record<string, string> = { 'in-progress': 'In progress', finished: 'Finished', paused: 'Paused' };

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status in LABELS ? status : 'other'}`}>{LABELS[status] ?? status}</span>;
}
