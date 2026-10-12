import { Editor } from '@tiptap/react';
import { db, type Chapter } from '../db';
import { contentExtensions } from './extensions';
import { layoutPages, measureSheet, refGeometry } from './layout';

/** Page count of a chapter's text in the book format, laid out off screen. */
export function bookPagesOf(content: Chapter['content']) {
  const g = refGeometry();
  const { heading, body } = measureSheet(g);
  const editor = new Editor({ element: body, extensions: contentExtensions(), content, editable: false, editorProps: { attributes: { class: 'prose' } } });
  try {
    return layoutPages(heading.getBoundingClientRect().top, editor.view.dom, editor.state.doc, g)?.pages ?? 1;
  } finally {
    editor.destroy();
    body.replaceChildren();
  }
}

/**
 * Recounts the pages of every chapter, one at a time between frames, so page
 * numbers stay right for chapters not opened since the format changed.
 * A chapter edited meanwhile is left to the editor, which counts it itself.
 */
export async function refreshPageCounts(chapters: Chapter[]) {
  await document.fonts.ready;
  for (const c of chapters) {
    await new Promise((r) => setTimeout(r, 0));
    const pages = bookPagesOf(c.content);
    if (pages === c.pageCount) continue;
    await db.transaction('rw', db.chapters, async () => {
      const fresh = await db.chapters.get(c.id);
      if (fresh && fresh.updatedAt === c.updatedAt) await db.chapters.update(c.id, { pageCount: pages });
    });
  }
}
