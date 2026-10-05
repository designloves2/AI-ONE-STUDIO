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
