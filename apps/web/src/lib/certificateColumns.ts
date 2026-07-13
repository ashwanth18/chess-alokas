/** Human-readable labels for certificate data columns. */
const COLUMN_LABELS: Record<string, string> = {
  name: 'Full name',
  place: 'Place (1st, 2nd…)',
  rank: 'Rank',
  score: 'Score',
  rating: 'Rating',
  club: 'Club',
  email: 'Email',
  age: 'Age',
  gender: 'Gender',
  category: 'Category',
  tournament: 'Tournament',
  date: 'Date',
  title: 'Title',
};

export function certificateColumnLabel(key: string): string {
  if (COLUMN_LABELS[key]) return COLUMN_LABELS[key]!;
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function certificateColumnSample(
  key: string,
  sampleRow: Record<string, string | number | null | undefined> | undefined,
): string | null {
  if (!sampleRow) return null;
  const raw = sampleRow[key];
  if (raw == null || String(raw).trim() === '') return null;
  const text = String(raw).trim();
  return text.length > 42 ? `${text.slice(0, 40)}…` : text;
}
