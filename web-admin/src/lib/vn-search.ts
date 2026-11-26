/**
 * Vietnamese accent-insensitive & progressive search helper.
 * Supports typing unaccented characters progressively (e.g. "b" -> "ba" -> "ban" -> "banh" -> "Bánh ...")
 * and ranks start-of-name / start-of-word matches highest.
 */
export function normalizeVi(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function scoreViMatch(
  rawQuery: string,
  primaryText: string | null | undefined,
  secondaryTexts: Array<string | null | undefined> = [],
): number {
  const q = normalizeVi(rawQuery);
  if (!q) return 1;

  const primary = normalizeVi(primaryText);
  const secondary = secondaryTexts.map(normalizeVi).filter(Boolean);
  const haystack = [primary, ...secondary].join(' ');
  if (!haystack) return -1;

  const tokens = q.split(' ').filter(Boolean);
  for (const token of tokens) {
    if (!haystack.includes(token)) return -1;
  }

  // Exact barcode / code match
  if (secondary.some(s => s === q) || primary === q) return 1000;
  // Barcode / code prefix match
  if (secondary.some(s => s.startsWith(q))) return 700;
  // Product name starts directly with query (e.g. "ba" -> "Bánh ChocoPie", "Bánh Quy")
  if (primary.startsWith(q)) return 550;

  const primaryWords = primary.split(/[^a-z0-9]+/).filter(Boolean);
  // Single phrase starts a word inside product name (e.g. "choco" -> "Bánh ChocoPie")
  if (primaryWords.some(w => w.startsWith(q))) return 400;

  // Every typed token starts a word in product name (e.g. "ba qu" -> "Bánh Quy")
  if (tokens.length > 1 && tokens.every(t => primaryWords.some(w => w.startsWith(t)))) {
    return 320;
  }

  // Full phrase substring inside product name
  if (primary.includes(q)) return 220;

  // Token match across product name
  if (tokens.every(t => primary.includes(t))) return 150;

  // Matched via category / code / barcode substring
  return 80;
}
