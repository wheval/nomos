// CSV for spreadsheets people actually open.
//
// Two hazards, both real for an export of merchant-supplied text:
//
// A field containing a comma, quote or newline has to be quoted and its
// quotes doubled, or the row silently gains columns.
//
// A field *beginning* `=`, `+`, `-`, `@`, tab or carriage return is treated
// as a formula by Excel, Sheets and LibreOffice. A payment note reading
// `=HYPERLINK("http://…","Click")` becomes a live link in an accountant's
// spreadsheet, and DDE payloads in that position have been used to run
// commands. Nomos lets merchants and payers write notes and references, so
// this export carries untrusted text by definition. Prefixing a single quote
// is the standard defence: the spreadsheet shows the original text and
// refuses to evaluate it.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const guarded = FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

/** CRLF line endings, because Excel still wants them. */
export function csvDocument(header: string[], rows: unknown[][]): string {
  return [csvRow(header), ...rows.map(csvRow)].join("\r\n") + "\r\n";
}

/**
 * Smallest-unit integer to a decimal string, without floating point.
 *
 * An accountant's export must not round: 1_000_001 micro-USDC is 1.000001,
 * and Number() would have started losing precision long before the amounts
 * a payment gateway handles.
 */
export function formatUnits(wei: bigint, decimals: number): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
