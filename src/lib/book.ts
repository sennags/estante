/**
 * The book format, in PDF points (1/72 in). The editor sheet, the PDF and the
 * .docx all derive their geometry from these numbers, so a page on screen is
 * the same page in the exported file.
 */

const CM = 72 / 2.54;

export const BOOK = {
  /** 14 × 21 cm, the most common trade format in Brazil. */
  pageW: 14 * CM,
  pageH: 21 * CM,
  marginX: 1.8 * CM,
  marginTop: 54,
  fontSize: 11,
  lineHeight: 16,
  /** Lines of text that fit on a page; the bottom margin is what is left. */
  lines: 30,
  /** Chapter openings sink the text by this many lines (label + title). */
  headingLines: 9,
  /** First-line indent of a paragraph. */
  indent: 16.5,
  /** Baseline of the page number, measured from the bottom edge. */
  folioBottom: 30,
} as const;

export const TEXT_H = BOOK.lines * BOOK.lineHeight;
export const MARGIN_BOTTOM = BOOK.pageH - BOOK.marginTop - TEXT_H;
export const HEADING_H = BOOK.headingLines * BOOK.lineHeight;

/** Screen pixels per point when laying out pages for export and page counts. */
export const REF_SCALE = 1.6;
/** Below this scale the text gets too small to write, so phones use a reflowed sheet. */
export const MIN_SCALE = 1.3;
