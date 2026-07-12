/** Case-insensitive match if query is empty or any value contains the query. */
export function matchesTextSearch(
  query: string,
  ...values: (string | number | null | undefined)[]
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return values.some((v) => v != null && String(v).toLowerCase().includes(q));
}
