// The ComfyUI list routes cap one request at 300 rows (videos / images / music playlist), so a
// gallery that asks once with limit=300 silently drops everything older. This walks the pages
// (offset += page length) until `total` rows are in. `fetchPage` returns one page + the server's total.
export const PAGE_SIZE = 300;

export async function fetchAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ rows: T[]; total: number }>,
  hardCap = 50000,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const { rows, total } = await fetchPage(offset, PAGE_SIZE);
    if (!rows.length) break;
    all.push(...rows);
    offset += rows.length;
    if (offset >= total || offset >= hardCap) break;
  }
  return all;
}

/** The first `want` rows (each request asks for at most PAGE_SIZE). Used to re-load whatever a
 * "Load more" gallery had already shown after a refresh, instead of snapping back to page one. */
export async function fetchRows<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ rows: T[]; total: number }>,
  want: number,
): Promise<{ rows: T[]; total: number }> {
  const all: T[] = [];
  let total = 0;
  while (all.length < want) {
    const r = await fetchPage(all.length, Math.min(PAGE_SIZE, want - all.length));
    total = r.total;
    if (!r.rows.length) break;
    all.push(...r.rows);
    if (all.length >= total) break;
  }
  return { rows: all, total };
}
