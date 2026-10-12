import type { JSONContent } from '@tiptap/react';
import type { Chapter, Story } from '../db';
import { chapterLabel, fileSafe } from './text';

/**
 * Exports a whole story. Each chapter starts on a new page, scene breaks
 * become a centred "*   *   *" (the editor's ⁂ is missing from most fonts)
 * and manual page breaks are kept.
 */

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

function save(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const heading = (c: Chapter) => ({ label: chapterLabel(c.order), title: c.title.trim() });

export async function exportDocx(story: Story, chapters: Chapter[]) {
  const d = await import('docx');
  const font = 'Georgia';

  const toRuns = (rs: Run[]) =>
    rs.map((r) =>
      r.br
        ? new d.TextRun({ break: 1 })
        : new d.TextRun({ text: r.text, bold: r.bold, italics: r.italics, strike: r.strike, underline: r.underline ? {} : undefined }),
    );

  const sections = chapters.map((chapter, ci) => {
    const { label, title } = heading(chapter);
    const children = [
      new d.Paragraph({
        alignment: d.AlignmentType.CENTER,
        spacing: { before: 1800, after: 120 },
        children: [new d.TextRun({ text: label.toUpperCase(), size: 18, characterSpacing: 40, color: '8A8374' })],
      }),
      new d.Paragraph({
        alignment: d.AlignmentType.CENTER,
        spacing: { after: 720 },
        children: [new d.TextRun({ text: title || label, italics: true, size: 44 })],
      }),
    ];
    let first = true;
    for (const b of blocks(chapter.content)) {
      if (b.kind === 'pagebreak') {
        children.push(new d.Paragraph({ children: [new d.PageBreak()] }));
        first = true;
      } else if (b.kind === 'scene') {
        children.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { before: 240, after: 240 }, children: [new d.TextRun('*   *   *')] }));
        first = true;
      } else if (b.heading) {
        children.push(new d.Paragraph({ spacing: { before: 240, after: 120 }, children: toRuns(b.runs).map((r) => r), heading: d.HeadingLevel.HEADING_2 }));
        first = true;
      } else {
        children.push(
          new d.Paragraph({
            children: b.bullet ? [new d.TextRun(`${b.bullet} `), ...toRuns(b.runs)] : toRuns(b.runs),
            indent: b.quote ? { left: 720 } : first || b.bullet ? undefined : { firstLine: 400 },
            spacing: { after: 120, line: 360 },
          }),
        );
        first = false;
      }
    }
    return {
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1300, right: 1300 } } },
      footers: {
        default: new d.Footer({
          children: [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ children: [d.PageNumber.CURRENT], size: 20, color: '8A8374' })] })],
        }),
      },
      children: ci === 0 ? [...titlePage(d, story), ...children] : children,
    };
  });

  const doc = new d.Document({
    creator: 'Estante',
    title: story.title,
    styles: { default: { document: { run: { font, size: 24 } } } },
    sections,
  });
  save(await d.Packer.toBlob(doc), `${fileSafe(story.title)}.docx`);
}

function titlePage(d: typeof import('docx'), story: Story) {
  return [
    new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { before: 4000, after: 240 }, children: [new d.TextRun({ text: story.title, size: 56 })] }),
    ...(story.genre ? [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: story.genre, italics: true, color: '6B6559' })] })] : []),
    new d.Paragraph({ children: [new d.PageBreak()] }),
  ];
}

export async function exportPdf(story: Story, chapters: Chapter[]) {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  pdfMake.addVirtualFileSystem(vfs);

  type Content = import('pdfmake/interfaces').Content;
  const text = (rs: Run[]) =>
    rs.map((r) => (r.br ? '\n' : { text: r.text, bold: r.bold, italics: r.italics, decoration: r.underline ? 'underline' : r.strike ? 'lineThrough' : undefined }));

  const content: Content[] = [
    { text: story.title, fontSize: 30, alignment: 'center', margin: [0, 220, 0, 10] },
    ...(story.genre ? [{ text: story.genre, italics: true, alignment: 'center', color: '#6B6559' } as Content] : []),
  ];

  for (const chapter of chapters) {
    const { label, title } = heading(chapter);
    content.push(
      { text: label.toUpperCase(), fontSize: 9, characterSpacing: 2, color: '#8A8374', alignment: 'center', margin: [0, 90, 0, 6], pageBreak: 'before' },
      { text: title || label, italics: true, fontSize: 24, alignment: 'center', margin: [0, 0, 0, 36] },
    );
    let first = true;
    for (const b of blocks(chapter.content)) {
      if (b.kind === 'pagebreak') {
        content.push({ text: '', pageBreak: 'after' });
        first = true;
      } else if (b.kind === 'scene') {
        content.push({ text: '*   *   *', alignment: 'center', margin: [0, 10, 0, 10] });
        first = true;
      } else {
        const indent = !first && !b.bullet && !b.quote && !b.heading;
        content.push({
          text: [indent ? ' ' : '', ...(b.bullet ? [`${b.bullet} `] : []), ...text(b.runs)],
          bold: !!b.heading,
          fontSize: b.heading ? 14 : 11.5,
          lineHeight: 1.45,
          margin: [b.quote ? 28 : 0, b.heading ? 10 : 0, 0, 6],
        } as Content);
        first = !!b.heading;
      }
    }
  }

  const blob = await pdfMake
    .createPdf({
      info: { title: story.title, creator: 'Estante' },
      pageSize: 'A4',
      pageMargins: [72, 72, 72, 72],
      content,
      footer: (current) => (current > 1 ? { text: String(current - 1), alignment: 'center', fontSize: 9, color: '#8A8374' } : ''),
    })
    .getBlob();
  save(blob, `${fileSafe(story.title)}.pdf`);
}
