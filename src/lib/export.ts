import { Editor, type JSONContent } from '@tiptap/react';
import type { PDFFont, PDFPage } from 'pdf-lib';
import type { Chapter, Story } from '../db';
import { contentExtensions } from '../editor/extensions';
import { layoutPages, measureSheet, refGeometry } from '../editor/layout';
import { BOOK, HEADING_H, MARGIN_BOTTOM } from './book';
import { faceKey, fontBytes, hasExtension, type Family } from './fonts';
import { chapterLabel, fileSafe } from './text';

/**
 * Exports a whole story in the book format (see book.ts).
 *
 * The PDF is drawn from the browser's own layout of each chapter, the same one
 * the editor shows, so lines and pages match the screen word for word. The
 * .docx uses the same page, margins, fonts and paragraph rules, but Word lays
 * out the text itself, so its page breaks may differ slightly.
 */

function save(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const heading = (c: Chapter) => ({ label: chapterLabel(c.order), title: c.title.trim() });

/* ------------------------------------------------------------------ PDF -- */

type Color = [number, number, number];
type Piece = { page: number; x: number; baseline: number; size: number; width?: number; text: string; face: string; color: Color; underline: boolean; strike: boolean };
type Rule = { page: number; x: number; y1: number; y2: number; width: number; color: Color };
type ChapterLayout = { pages: number; pieces: Piece[]; rules: Rule[] };

function parseColor(css: string): Color {
  const m = css.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  return [m[0] / 255, m[1] / 255, m[2] / 255];
}

function familyOf(cs: CSSStyleDeclaration): Family {
  if (cs.fontFamily.includes('Newsreader')) return 'display';
  if (cs.fontFamily.includes('Instrument')) return 'sans';
  return 'text';
}

/** Lays out one chapter off screen and turns it into positioned words, in points. */
async function layoutChapter(chapter: Chapter): Promise<ChapterLayout> {
  const g = refGeometry();
  const u = g.u;
  const { sheet, heading: head, body } = measureSheet(g);
  const { label, title } = heading(chapter);
  const eyebrow = document.createElement('p');
  eyebrow.className = 'sheet-eyebrow';
  eyebrow.textContent = label;
  head.append(eyebrow);
  if (title) {
    const t = document.createElement('p');
    t.className = 'sheet-title';
    t.textContent = title;
    head.append(t);
  }

  // Fonts first: nothing else may use the measuring sheet between mounting and measuring.
  await document.fonts.ready;
  const editor = new Editor({
    element: body,
    extensions: contentExtensions(),
    content: chapter.content as JSONContent,
    editable: false,
    editorProps: { attributes: { class: 'prose' } },
  });
  try {
    const origin = head.getBoundingClientRect().top;
    const left = sheet.getBoundingClientRect().left;
    const layout = layoutPages(origin, editor.view.dom, editor.state.doc, g);
    if (!layout) throw new Error('Layout failed');
    const { starts } = layout;

    const place = (top: number, bottom: number) => {
      const mid = (top + bottom) / 2 - origin;
      let page = 0;
      while (page + 1 < starts.length && starts[page + 1] <= mid + 0.5) page++;
      return { page, y: BOOK.marginTop + (top - origin - starts[page]) / u };
    };

    // Distance from the top of a text box to its baseline, per font.
    const baselines = new Map<string, number>();
    const baselineOf = (cs: CSSStyleDeclaration) => {
      const k = `${cs.fontFamily}|${cs.fontWeight}|${cs.fontStyle}|${cs.fontSize}`;
      let off = baselines.get(k);
      if (off === undefined) {
        const probe = document.createElement('span');
        probe.style.cssText = `font-family:${cs.fontFamily};font-weight:${cs.fontWeight};font-style:${cs.fontStyle};font-size:${cs.fontSize};font-optical-sizing:none;line-height:normal;white-space:nowrap`;
        probe.textContent = 'Hg';
        const mark = document.createElement('span');
        mark.style.cssText = 'display:inline-block;width:0;height:0';
        probe.append(mark);
        sheet.append(probe);
        const r = document.createRange();
        r.selectNodeContents(probe.firstChild!);
        off = mark.getBoundingClientRect().top - r.getBoundingClientRect().top;
        probe.remove();
        baselines.set(k, off);
      }
      return off;
    };

    const pieces: Piece[] = [];
    const rules: Rule[] = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (!/\S/.test(node.data)) continue;
      const el = node.parentElement!;
      const cs = getComputedStyle(el);
      const face = faceKey(familyOf(cs), parseInt(cs.fontWeight, 10) || 400, cs.fontStyle !== 'normal');
      const size = parseFloat(cs.fontSize) / u;
      const base = baselineOf(cs) / u;
      const color = parseColor(cs.color);
      const underline = !!el.closest('u');
      const strike = !!el.closest('s, del, strike');
      const upper = cs.textTransform === 'uppercase';
      const spaced = cs.letterSpacing !== 'normal' && parseFloat(cs.letterSpacing) > 0.01;

      const emit = (from: number, to: number) => {
        range.setStart(node!, from);
        range.setEnd(node!, to);
        const rects = range.getClientRects();
        if (rects.length > 1 && to - from > 1) {
          for (let i = from; i < to; i++) emit(i, i + 1);
          return;
        }
        const r = rects[0];
        if (!r || !r.width) return;
        const { page, y } = place(r.top, r.bottom);
        const text = node!.data.slice(from, to);
        pieces.push({ page, x: (r.left - left) / u, baseline: y + base, size, width: spaced ? undefined : r.width / u, text: upper ? text.toUpperCase() : text, face, color, underline, strike });
      };
      const re = spaced ? /\S/g : /\S+/g;
      for (const m of node.data.matchAll(re)) emit(m.index, m.index + m[0].length);
    }

    const ink = parseColor(getComputedStyle(sheet).color);
    for (const hr of editor.view.dom.querySelectorAll('hr')) {
      const r = hr.getBoundingClientRect();
      const { page, y } = place(r.top, r.bottom);
      const cx = (r.left + r.width / 2 - left) / u;
      const cy = y + r.height / u / 2;
      // An asterism (⁂) built from three asterisks; the glyph itself is missing from the font.
      const star = (x: number, b: number) => pieces.push({ page, x, baseline: b, size: BOOK.fontSize, text: '*', face: 'text-400-normal', color: ink, underline: false, strike: false });
      star(cx - 2.6, cy + 1.5);
      star(cx - 6.2, cy + 7);
      star(cx + 1, cy + 7);
    }
    for (const li of editor.view.dom.querySelectorAll('li')) {
      const list = li.parentElement!;
      const marker = list.tagName === 'OL' ? `${(Number(list.getAttribute('start')) || 1) + Array.from(list.children).indexOf(li)}.` : '•';
      const first = Array.from(li.querySelectorAll('p')).find((p) => p.textContent);
      const r = (first ?? li).getBoundingClientRect();
      const cs = getComputedStyle(first ?? li);
      const { page, y } = place(r.top, r.top + parseFloat(cs.lineHeight));
      const size = parseFloat(cs.fontSize) / u;
      const leading = (parseFloat(cs.lineHeight) - parseFloat(cs.fontSize) * 1.485) / 2;
      pieces.push({ page, x: (r.left - left) / u - size * (marker.length * 0.55 + 0.6), baseline: y + (leading + baselineOf(cs)) / u, size, text: marker, face: faceKey(familyOf(cs), 400, false), color: parseColor(cs.color), underline: false, strike: false });
    }
    for (const q of editor.view.dom.querySelectorAll('blockquote')) {
      const r = q.getBoundingClientRect();
      const cs = getComputedStyle(q);
      const { page, y } = place(r.top, r.top + 1);
      rules.push({ page, x: (r.left - left) / u + 0.75, y1: y, y2: y + r.height / u, width: parseFloat(cs.borderLeftWidth) / u, color: parseColor(cs.borderLeftColor) });
    }

    return { pages: layout.pages, pieces, rules };
  } finally {
    editor.destroy();
    body.replaceChildren();
    head.replaceChildren();
  }
}

export async function exportPdf(story: Story, chapters: Chapter[]) {
  const [{ PDFDocument, rgb, pushGraphicsState, popGraphicsState, setCharacterSqueeze }, { default: fontkit }] = await Promise.all([
    import('pdf-lib'),
    import('@pdf-lib/fontkit'),
  ]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(story.title);
  pdf.setCreator('Trama');
  pdf.setProducer('Trama');
  pdf.setLanguage('pt-BR');

  const fonts = new Map<string, Promise<{ font: PDFFont; chars: Set<number> }>>();
  const font = (key: string, ext = false) => {
    const id = `${key}${ext ? '+ext' : ''}`;
    let f = fonts.get(id);
    if (!f) {
      f = fontBytes(key, ext)
        .then((bytes) => pdf.embedFont(bytes, { subset: true }))
        .then((font) => ({ font, chars: new Set(font.getCharacterSet()) }));
      fonts.set(id, f);
    }
    return f;
  };

  /**
   * Draws text, falling back to the Latin Extended face for rarer letters.
   * With `width`, the text is squeezed or stretched (by a hair: the PDF has no
   * kerning) to cover exactly the width the browser gave it.
   */
  async function draw(page: PDFPage, text: string, x: number, baseline: number, size: number, face: string, color: Color, width?: number) {
    const main = await font(face);
    let ext: Awaited<ReturnType<typeof font>> | null = null;
    const runs: { text: string; font: PDFFont }[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      let f = main;
      if (!main.chars.has(cp) && hasExtension(face)) {
        ext ??= await font(face, true);
        if (ext.chars.has(cp)) f = ext;
      }
      const glyph = f.chars.has(cp) ? ch : '?';
      const last = runs[runs.length - 1];
      if (last?.font === f.font) last.text += glyph;
      else runs.push({ text: glyph, font: f.font });
    }
    const natural = runs.reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);
    const scale = width && natural ? width / natural : 1;
    const squeeze = Math.abs(scale - 1) > 0.001 && Math.abs(scale - 1) < 0.15;
    if (squeeze) page.pushOperators(pushGraphicsState(), setCharacterSqueeze(scale * 100));
    for (const r of runs) {
      page.drawText(r.text, { x, y: BOOK.pageH - baseline, size, font: r.font, color: rgb(...color) });
      x += r.font.widthOfTextAtSize(r.text, size) * (squeeze ? scale : 1);
    }
    if (squeeze) page.pushOperators(popGraphicsState());
    return x;
  }

  const newPage = () => pdf.addPage([BOOK.pageW, BOOK.pageH]);

  // Title page.
  const titlePage = newPage();
  const titleFont = (await font('display-400-normal')).font;
  const width = BOOK.pageW - BOOK.marginX * 2;
  const titleSize = Math.min(24, (24 * width) / titleFont.widthOfTextAtSize(story.title, 24));
  const ink: Color = [0.14, 0.13, 0.12];
  await draw(titlePage, story.title, (BOOK.pageW - titleFont.widthOfTextAtSize(story.title, titleSize)) / 2, BOOK.pageH * 0.4, titleSize, 'display-400-normal', ink);
  if (story.genre) {
    const genreFont = (await font('text-400-italic')).font;
    await draw(titlePage, story.genre, (BOOK.pageW - genreFont.widthOfTextAtSize(story.genre, 10)) / 2, BOOK.pageH * 0.4 + 26, 10, 'text-400-italic', [0.42, 0.4, 0.35]);
  }

  const folioFont = (await font('display-400-normal')).font;
  let folio = 1;
  for (const chapter of chapters) {
    const layout = await layoutChapter(chapter);
    const pages = Array.from({ length: layout.pages }, newPage);
    for (const p of layout.pieces) {
      const page = pages[p.page];
      const end = await draw(page, p.text, p.x, p.baseline, p.size, p.face, p.color, p.width);
      const line = (offset: number) =>
        page.drawLine({ start: { x: p.x, y: BOOK.pageH - p.baseline + offset }, end: { x: end, y: BOOK.pageH - p.baseline + offset }, thickness: p.size * 0.05, color: rgb(...p.color) });
      if (p.underline) line(-p.size * 0.12);
      if (p.strike) line(p.size * 0.28);
    }
    for (const r of layout.rules) {
      pages[r.page].drawLine({ start: { x: r.x, y: BOOK.pageH - r.y1 }, end: { x: r.x, y: BOOK.pageH - r.y2 }, thickness: r.width, color: rgb(...r.color) });
    }
    for (const page of pages) {
      const n = String(folio++);
      page.drawText(n, { x: (BOOK.pageW - folioFont.widthOfTextAtSize(n, 8.5)) / 2, y: BOOK.folioBottom, size: 8.5, font: folioFont, color: rgb(0.54, 0.51, 0.45) });
    }
  }

  const bytes = await pdf.save();
  save(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${fileSafe(story.title)}.pdf`);
}

/* ----------------------------------------------------------------- DOCX -- */

type Run = { text: string; bold?: boolean; italics?: boolean; underline?: boolean; strike?: boolean; br?: boolean };

function runs(node: JSONContent): Run[] {
  return (node.content ?? []).flatMap((child): Run[] => {
    if (child.type === 'hardBreak') return [{ text: '', br: true }];
    if (child.type !== 'text') return runs(child);
    const marks = new Set((child.marks ?? []).map((m) => m.type));
    return [{
      text: child.text ?? '',
      bold: marks.has('bold'),
      italics: marks.has('italic'),
      underline: marks.has('underline'),
      strike: marks.has('strike'),
    }];
  });
}

type Block =
  | { kind: 'p'; runs: Run[]; quote?: boolean; bullet?: string; heading?: number }
  | { kind: 'scene' }
  | { kind: 'pagebreak' };

function blocks(node: JSONContent, ctx: { quote?: boolean; bullet?: string } = {}): Block[] {
  return (node.content ?? []).flatMap((child): Block[] => {
    switch (child.type) {
      case 'paragraph':
        return [{ kind: 'p', runs: runs(child), quote: ctx.quote, bullet: ctx.bullet }];
      case 'heading':
        return [{ kind: 'p', runs: runs(child), heading: child.attrs?.level ?? 2 }];
      case 'horizontalRule':
        return [{ kind: 'scene' }];
      case 'pageBreak':
        return [{ kind: 'pagebreak' }];
      case 'blockquote':
        return blocks(child, { ...ctx, quote: true });
      case 'bulletList':
        return (child.content ?? []).flatMap((li) => blocks(li, { ...ctx, bullet: '•' }));
      case 'orderedList':
        return (child.content ?? []).flatMap((li, i) => blocks(li, { ...ctx, bullet: `${(child.attrs?.start ?? 1) + i}.` }));
      default:
        return blocks(child, ctx);
    }
  });
}

/** Points to twentieths of a point (twips), Word's unit for layout. */
const tw = (pt: number) => Math.round(pt * 20);

export async function exportDocx(story: Story, chapters: Chapter[]) {
  const d = await import('docx');
  const [text, textItalic, textBold, textBoldItalic, display, displayItalic, displayMedium, sans] = await Promise.all(
    ['text-400-normal', 'text-400-italic', 'text-700-normal', 'text-700-italic', 'display-400-normal', 'display-400-italic', 'display-500-normal', 'sans-400-normal'].map((k) => fontBytes(k)),
  );
  type FontData = import('docx').IPropertiesOptions['fonts'] extends readonly (infer F)[] | undefined ? F : never;
  const buf = (b: Uint8Array) => b as unknown as FontData['data'];
  const fonts: FontData[] = [
    { name: 'Literata', data: buf(text), italic: buf(textItalic), bold: buf(textBold), boldItalic: buf(textBoldItalic) },
    { name: 'Newsreader', data: buf(display), italic: buf(displayItalic), bold: buf(displayMedium) },
    { name: 'Instrument Sans', data: buf(sans) },
  ];

  const line = { line: tw(BOOK.lineHeight), lineRule: d.LineRuleType.EXACT, before: 0, after: 0 };
  const toRuns = (rs: Run[]) =>
    rs.map((r) =>
      r.br
        ? new d.TextRun({ break: 1 })
        : new d.TextRun({ text: r.text, bold: r.bold, italics: r.italics, strike: r.strike, underline: r.underline ? {} : undefined }),
    );

  const sinkTop = HEADING_H * 0.36;
  const labelLine = 12 + 8;
  const titleLine = 22 * 1.2;

  const sections = chapters.map((chapter, ci) => {
    const { label, title } = heading(chapter);
    const children = [
      new d.Paragraph({
        alignment: d.AlignmentType.CENTER,
        spacing: { before: tw(sinkTop), after: tw(8), line: tw(12), lineRule: d.LineRuleType.EXACT },
        children: [new d.TextRun({ text: label.toUpperCase(), font: 'Instrument Sans', size: 15, characterSpacing: tw(7.5 * 0.22), color: '8A8374' })],
      }),
      new d.Paragraph({
        alignment: d.AlignmentType.CENTER,
        spacing: { after: tw(HEADING_H - sinkTop - labelLine - titleLine), line: tw(titleLine), lineRule: d.LineRuleType.EXACT },
        children: title ? [new d.TextRun({ text: title, font: 'Newsreader', italics: true, size: 44 })] : [],
      }),
    ];
    let first = true;
    for (const b of blocks(chapter.content)) {
      if (b.kind === 'pagebreak') {
        children.push(new d.Paragraph({ spacing: line, children: [new d.PageBreak()] }));
        first = true;
      } else if (b.kind === 'scene') {
        children.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { ...line, before: tw(8), after: tw(8) }, children: [new d.TextRun({ text: '*   *   *', color: '6B6559' })] }));
        first = true;
      } else if (b.heading) {
        children.push(
          new d.Paragraph({
            keepNext: true,
            spacing: { ...line, before: tw(16), after: tw(8) },
            children: b.runs.map((r) => new d.TextRun({ text: r.text, font: 'Newsreader', bold: true, size: b.heading === 2 ? 28 : 24 })),
          }),
        );
        first = true;
      } else {
        children.push(
          new d.Paragraph({
            alignment: b.bullet ? d.AlignmentType.LEFT : d.AlignmentType.JUSTIFIED,
            children: b.bullet ? [new d.TextRun(`${b.bullet}\t`), ...toRuns(b.runs)] : toRuns(b.runs),
            indent: b.quote ? { left: tw(14) } : b.bullet ? { left: tw(20), hanging: tw(14) } : first ? undefined : { firstLine: tw(BOOK.indent) },
            border: b.quote ? { left: { style: d.BorderStyle.SINGLE, size: 12, color: 'C3B8A2', space: 6 } } : undefined,
            spacing: line,
            widowControl: true,
          }),
        );
        first = false;
      }
    }
    return {
      properties: {
        page: {
          size: { width: tw(BOOK.pageW), height: tw(BOOK.pageH) },
          margin: { top: tw(BOOK.marginTop), bottom: tw(MARGIN_BOTTOM), left: tw(BOOK.marginX), right: tw(BOOK.marginX), footer: tw(BOOK.folioBottom - 6), header: 0 },
          pageNumbers: ci === 0 ? { start: 1 } : undefined,
        },
      },
      footers: {
        default: new d.Footer({
          children: [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ children: [d.PageNumber.CURRENT], font: 'Newsreader', size: 17, color: '8A8374' })] })],
        }),
      },
      children,
    };
  });

  const doc = new d.Document({
    creator: 'Trama',
    title: story.title,
    fonts,
    styles: { default: { document: { run: { font: 'Literata', size: BOOK.fontSize * 2, color: '24221E' }, paragraph: { spacing: line } } } },
    sections: [titleSection(d, story), ...sections],
  });
  save(await d.Packer.toBlob(doc), `${fileSafe(story.title)}.docx`);
}

function titleSection(d: typeof import('docx'), story: Story) {
  return {
    properties: {
      page: {
        size: { width: tw(BOOK.pageW), height: tw(BOOK.pageH) },
        margin: { top: tw(BOOK.marginTop), bottom: tw(MARGIN_BOTTOM), left: tw(BOOK.marginX), right: tw(BOOK.marginX) },
      },
    },
    children: [
      new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { before: tw(BOOK.pageH * 0.4 - BOOK.marginTop - 24), after: tw(10) }, children: [new d.TextRun({ text: story.title, font: 'Newsreader', size: 48 })] }),
      ...(story.genre ? [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: story.genre, italics: true, size: 20, color: '6B6559' })] })] : []),
    ],
  };
}
