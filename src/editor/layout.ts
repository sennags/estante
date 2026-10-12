import type { Node as PMNode } from '@tiptap/pm/model';
import { BOOK, HEADING_H, MARGIN_BOTTOM, MIN_SCALE, REF_SCALE, TEXT_H } from '../lib/book';

/**
 * Page layout shared by the editor and the PDF export.
 *
 * The text is laid out by the browser in a sheet whose sizes all derive from
 * BOOK, then cut into pages: paragraphs split between lines (never leaving a
 * single line alone at the bottom or top of a page), headings stay with the
 * text that follows them and other blocks move whole.
 */

export type Geometry = {
  /** Pixels per point for type sizes. */
  u: number;
  /** Phones: comfortable type, pages only approximate the book. */
  compact: boolean;
  width: number;
  padX: number;
  padTop: number;
  padBottom: number;
  /** Height available for text on a page. */
  avail: number;
  headingH: number;
};

const COMPACT_U = 16 / BOOK.fontSize;

export function sheetGeometry(width: number): Geometry {
  const u = width / BOOK.pageW;
  if (u >= MIN_SCALE) {
    return {
      u,
      compact: false,
      width,
      padX: BOOK.marginX * u,
      padTop: BOOK.marginTop * u,
      padBottom: MARGIN_BOTTOM * u,
      avail: TEXT_H * u,
      headingH: HEADING_H * u,
    };
  }
  const lh = BOOK.lineHeight * COMPACT_U;
  const padTop = 40;
  const padBottom = 52;
  const lines = Math.max(12, Math.floor((width * (BOOK.pageH / BOOK.pageW) - padTop - padBottom) / lh));
  return { u: COMPACT_U, compact: true, width, padX: 20, padTop, padBottom, avail: lines * lh, headingH: 7 * lh };
}

export const refGeometry = () => sheetGeometry(BOOK.pageW * REF_SCALE);

export function applyGeometry(el: HTMLElement, g: Geometry) {
  el.style.setProperty('--u', `${g.u}px`);
  el.style.setProperty('--pad-x', `${g.padX}px`);
  el.style.setProperty('--pad-top', `${g.padTop}px`);
  el.style.setProperty('--pad-bottom', `${g.padBottom}px`);
  el.style.setProperty('--heading-h', `${g.headingH}px`);
  el.classList.toggle('is-compact', g.compact);
}

export type Break = {
  /** Document position where the next page starts. */
  pos: number;
  /** Empty space left at the bottom of the page. */
  fill: number;
  /** True when the break falls between two lines of a paragraph. */
  inline: boolean;
};

export type Layout = {
  breaks: Break[];
  /** Where each page's text starts, in px from the top of the first page's text area. */
  starts: number[];
  endFill: number;
  pages: number;
};

const SKIP = 'br.ProseMirror-trailingBreak, img.ProseMirror-separator';

/** Document position of the first character drawn at or below `y` inside a paragraph. */
function posAtLine(el: HTMLElement, start: number, y: number): number | null {
  const units: { text: Text; i: number; pos: number }[] = [];
  let pos = start;
  const walk = (n: globalThis.Node) => {
    if (n.nodeType === 3) {
      const t = n as Text;
      for (let i = 0; i < t.data.length; i++) units.push({ text: t, i, pos: pos++ });
    } else if (n instanceof HTMLElement) {
      if (n.matches(SKIP)) return;
      if (n.tagName === 'BR') {
        pos++;
        return;
      }
      n.childNodes.forEach(walk);
    }
  };
  el.childNodes.forEach(walk);

  const range = document.createRange();
  const below = (k: number) => {
    const { text, i } = units[k];
    range.setStart(text, i);
    range.setEnd(text, i + 1);
    const rects = range.getClientRects();
    const r = rects[rects.length - 1];
    return !!r && r.height > 0 && (r.top + r.bottom) / 2 > y;
  };
  let lo = 0;
  let hi = units.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (below(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo < units.length && lo > 0 ? units[lo].pos : null;
}

/**
 * Cuts laid-out text into pages. `origin` is the viewport y of the top of the
 * first page's text area (the chapter heading sits inside it). `doc` maps
 * blocks to document positions; without it, breaks only carry page starts.
 */
export function layoutPages(origin: number, prose: HTMLElement, doc: PMNode | null, g: Geometry): Layout | null {
  const blocks = Array.from(prose.children) as HTMLElement[];
  const offsets: number[] = [];
  doc?.forEach((_, offset) => offsets.push(offset));
  if (doc && offsets.length !== blocks.length) return null;

  const lh = parseFloat(getComputedStyle(prose).lineHeight) || BOOK.lineHeight * g.u;
  const breaks: Break[] = [];
  const starts = [0];
  let start = 0;
  let end = g.avail;
  let lastBottom = prose.getBoundingClientRect().top - origin;

  const newPage = (pos: number, fill: number, inline: boolean, y: number) => {
    breaks.push({ pos, fill: Math.max(0, fill), inline });
    starts.push(y);
    start = y;
    end = y + g.avail;
  };

  for (let i = 0; i < blocks.length; i++) {
    const el = blocks[i];
    const off = offsets[i] ?? -1;
    const r = el.getBoundingClientRect();
    const top = r.top - origin;
    const bottom = r.bottom - origin;
    const mb = parseFloat(getComputedStyle(el).marginBottom) || 0;

    if (el.classList.contains('page-break')) {
      const next = blocks[i + 1];
      const y = next ? next.getBoundingClientRect().top - origin : bottom;
      newPage(off + 1, end - lastBottom, false, y);
      lastBottom = y;
      continue;
    }

    const splittable = el.tagName === 'P' && off >= 0;
    const heading = /^H[1-6]$/.test(el.tagName);
    for (let guard = 0; guard < 500; guard++) {
      const atTop = Math.max(top, start) <= start + 0.5 && lastBottom <= start + 0.5;
      if (heading && !atTop && bottom + lh * 2 > end + 0.5) {
        newPage(off, end - lastBottom, false, top);
        continue;
      }
      if (bottom <= end + 0.5) break;
      if (!splittable) {
        if (atTop) break;
        newPage(off, end - lastBottom, false, top);
        continue;
      }
      const n = Math.round((bottom - top) / lh);
      const first = Math.round((Math.max(top, start) - top) / lh);
      let k = Math.floor((end - top) / lh + 0.01);
      if (n - k < 2) k = n - 2;
      if (k - first < 2 && first === 0 && !atTop) {
        newPage(off, end - lastBottom, false, top);
        continue;
      }
      k = Math.max(k, first + 1);
      const y = top + k * lh;
      const pos = posAtLine(el, off + 1, y + origin);
      if (pos === null) {
        if (atTop) break;
        newPage(off, end - lastBottom, false, top);
        continue;
      }
      newPage(pos, end - y, true, y);
      lastBottom = y;
    }
    lastBottom = bottom + mb;
  }

  return { breaks, starts, endFill: Math.max(0, end - lastBottom), pages: starts.length };
}

let host: HTMLElement | null = null;

/** An invisible sheet used to lay out text away from the screen. */
export function measureSheet(g: Geometry) {
  if (!host) {
    host = document.createElement('div');
    host.className = 'sheet sheet-measure';
    host.setAttribute('aria-hidden', 'true');
    host.innerHTML = '<header class="sheet-heading"></header><div class="sheet-body"></div>';
    document.body.append(host);
  }
  host.style.width = `${g.width}px`;
  applyGeometry(host, g);
  const heading = host.firstElementChild as HTMLElement;
  const body = host.lastElementChild as HTMLElement;
  heading.replaceChildren();
  body.replaceChildren();
  return { sheet: host, heading, body };
}

/** Lays out a copy of the editor's DOM (without page widgets) at the given geometry. */
export function layoutCopy(dom: HTMLElement, doc: PMNode, g: Geometry): Layout | null {
  const copy = dom.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.page-gap, .page-end').forEach((w) => w.remove());
  copy.removeAttribute('contenteditable');
  const { heading, body } = measureSheet(g);
  body.append(copy);
  const layout = layoutPages(heading.getBoundingClientRect().top, copy, doc, g);
  body.replaceChildren();
  return layout;
}

/** The chapter's page count in the book format, whatever the screen size. */
export const bookPages = (dom: HTMLElement, doc: PMNode) => layoutCopy(dom, doc, refGeometry())?.pages ?? 1;
