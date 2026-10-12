import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { db, saveChapterContent, type Chapter } from '../db';
import { PageBreak, Pagination, type PageLayout } from '../editor/pagination';
import { Icon } from '../components/Icon';
import { ReferencePanel } from '../components/ReferencePanel';
import { VersionsDialog } from '../components/VersionsDialog';
import { exportDocx, exportPdf } from '../lib/export';
import { chapterLabel, countWords, formatNumber } from '../lib/text';
import { useStory } from './StoryLayout';
import './ChapterEditor.css';

const SAVE_DELAY = 700;
const isWide = () => window.matchMedia('(min-width: 1101px)').matches;

export function ChapterEditor() {
  const { chapterId = '' } = useParams();
  const [chapter, setChapter] = useState<Chapter | null>(null);

  useEffect(() => {
    let alive = true;
    setChapter(null);
    db.chapters.get(chapterId).then((c) => alive && setChapter(c ?? null));
    return () => {
      alive = false;
    };
  }, [chapterId]);

  if (!chapter || chapter.id !== chapterId) return null;
  return <ChapterSheet key={chapter.id} chapter={chapter} />;
}

type SaveState = 'saved' | 'pending' | 'saving';

function ChapterSheet({ chapter }: { chapter: Chapter }) {
  const { story, chapters, focus, setFocus, openMenu } = useStory();
  const [title, setTitle] = useState(chapter.title);
  const [words, setWords] = useState(chapter.wordCount);
  const [layout, setLayout] = useState<PageLayout | null>(null);
  const [cursorPage, setCursorPage] = useState(1);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [toolsOpen, setToolsOpen] = useState(true);
  const [refsOpen, setRefsOpen] = useState(isWide);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Pages of the chapters before this one, so numbering runs through the book.
  const firstPage = useMemo(
    () => 1 + chapters.filter((c) => c.order < chapter.order).reduce((n, c) => n + (c.pageCount || 1), 0),
    [chapters, chapter.order],
  );
  const firstPageRef = useRef(firstPage);
  firstPageRef.current = firstPage;
  const layoutRef = useRef<PageLayout | null>(null);
  const pendingSave = useRef<number>(0);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const latest = useRef<JSONContent>(chapter.content);

  const updateCursorPage = useCallback((ed: Editor) => {
    const breaks = layoutRef.current?.breaks ?? [];
    const from = ed.state.selection.from;
    setCursorPage(1 + breaks.filter((b) => b.pos <= from).length);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, code: false }),
      Placeholder.configure({ placeholder: 'Comece a escrever…' }),
      PageBreak,
      Pagination.configure({
        getFirstPage: () => firstPageRef.current,
        onLayout: (l) => {
          layoutRef.current = l;
          setLayout((prev) => (prev && JSON.stringify(prev) === JSON.stringify(l) ? prev : l));
        },
      }),
    ],
    content: chapter.content,
    editorProps: { attributes: { class: 'prose', spellcheck: 'true', 'aria-label': 'Texto do capítulo' } },
    onUpdate: ({ editor }) => {
      latest.current = editor.getJSON();
      setWords(countWords(latest.current));
      setSaveState('pending');
      window.clearTimeout(pendingSave.current);
      pendingSave.current = window.setTimeout(() => flushRef.current(), SAVE_DELAY);
    },
    onSelectionUpdate: ({ editor }) => updateCursorPage(editor),
  });

  const marks = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ bold: !!e?.isActive('bold'), italic: !!e?.isActive('italic') }),
  });

  flushRef.current = async () => {
    window.clearTimeout(pendingSave.current);
    pendingSave.current = 0;
    setSaveState('saving');
    const json = latest.current;
    await saveChapterContent(chapter, json, countWords(json), layoutRef.current?.pages ?? 1);
    setSaveState((s) => (s === 'saving' ? 'saved' : s));
  };

  // Save whatever is pending when leaving the chapter or closing the tab.
  useEffect(() => {
    const onHide = () => pendingSave.current && flushRef.current();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      onHide();
    };
  }, []);

  // Keep the stored page count in sync so later chapters number correctly.
  useEffect(() => {
    if (layout && layout.pages !== chapter.pageCount) {
      db.chapters.update(chapter.id, { pageCount: layout.pages });
      chapter.pageCount = layout.pages;
    }
    if (editor) updateCursorPage(editor);
  }, [layout, chapter, editor, updateCursorPage]);

  // Renumber pages when an earlier chapter grows or shrinks.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
  }, [firstPage, editor]);

  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFocus(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, setFocus]);

  useEffect(() => () => setFocus(false), [setFocus]);

  function saveTitle(value: string) {
    setTitle(value);
    db.chapters.update(chapter.id, { title: value, updatedAt: Date.now() });
  }

  function addBlankPage() {
    if (!editor) return;
    editor
      .chain()
      .insertContentAt(editor.state.doc.content.size, [{ type: 'pageBreak' }, { type: 'paragraph' }])
      .focus('end')
      .run();
    requestAnimationFrame(() => {
      document.querySelector('.ProseMirror .is-empty:last-child, .ProseMirror > p:last-child')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  async function runExport(kind: 'docx' | 'pdf') {
    setExportOpen(false);
    setExporting(true);
    try {
      await flushRef.current();
      const all = await db.chapters.where('storyId').equals(story.id).sortBy('order');
      await (kind === 'docx' ? exportDocx(story, all) : exportPdf(story, all));
    } catch (err) {
      console.error(err);
      alert('Não foi possível exportar. Tente de novo.');
    } finally {
      setExporting(false);
    }
  }

  const pages = layout?.pages ?? chapter.pageCount ?? 1;
  const totalPages = chapters.reduce((n, c) => n + (c.id === chapter.id ? pages : c.pageCount || 1), 0);
  const saveLabel = saveState === 'saved' ? 'Salvo' : 'Salvando…';

  return (
    <>
      <main className={`editor-main ${focus ? 'is-focus' : ''}`}>
        <div className="editor-top">
          <button className="icon-btn menu-btn" aria-label="Abrir menu da história" onClick={openMenu}>
            <Icon name="menu" />
          </button>
          <span className="editor-page" aria-live="polite">
            Página {firstPage + cursorPage - 1} de {totalPages}
          </span>
          <span className="editor-save">
            {saveState === 'saved' && <Icon name="check" size={14} />}
            {saveLabel}
          </span>
          {!refsOpen && !focus && (
            <button className="btn btn-ghost refs-toggle" onClick={() => setRefsOpen(true)}>
              <Icon name="panel" size={16} />
              Referências
            </button>
          )}
        </div>

        <article className="sheet">
          <header className="sheet-heading">
            <p className="sheet-eyebrow">{chapterLabel(chapter.order)}</p>
            <label className="sr-only" htmlFor="chapter-title">Título do capítulo</label>
            <input
              id="chapter-title"
              className="sheet-title"
              value={title}
              placeholder="Título do capítulo"
              onChange={(e) => saveTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  editor?.commands.focus('start');
                }
              }}
            />
          </header>
          <EditorContent editor={editor} />
        </article>

        <button className="btn btn-dashed new-page" onClick={addBlankPage}>
          <Icon name="plus" size={18} />
          Nova página em branco
        </button>

        {toolsOpen ? (
          <div role="toolbar" aria-label="Ferramentas de escrita" className="toolbar">
            <ToolButton label="Negrito" active={marks?.bold} onClick={() => editor?.chain().focus().toggleBold().run()}>
              <b style={{ fontFamily: 'var(--serif-display)', fontSize: 18 }}>B</b>
            </ToolButton>
            <ToolButton label="Itálico" active={marks?.italic} onClick={() => editor?.chain().focus().toggleItalic().run()}>
              <i style={{ fontFamily: 'var(--serif-display)', fontSize: 18 }}>I</i>
            </ToolButton>
            <ToolButton label="Nova cena" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>
              <span style={{ fontSize: 18 }}>⁂</span>
            </ToolButton>
            <span className="toolbar-sep" />
            <span className="toolbar-count">{formatNumber(words)} palavras</span>
            <span className="toolbar-sep" />
            <button className="toolbar-btn wide" aria-label={focus ? 'Sair do foco' : 'Modo foco'} title="Modo foco" aria-pressed={focus} onClick={() => setFocus(!focus)}>
              <Icon name="focus" size={16} />
              <span className="toolbar-label">{focus ? 'Sair do foco' : 'Modo foco'}</span>
            </button>
            <button className="toolbar-btn wide" aria-label="Versões" title="Versões" onClick={() => setVersionsOpen(true)}>
              <Icon name="history" size={16} />
              <span className="toolbar-label">Versões</span>
            </button>
            <div className="export">
              <button className="toolbar-btn wide" aria-label="Exportar" title="Exportar" aria-expanded={exportOpen} aria-haspopup="menu" disabled={exporting} onClick={() => setExportOpen((o) => !o)}>
                <Icon name="download" size={16} />
                <span className="toolbar-label">{exporting ? 'Exportando…' : 'Exportar'}</span>
              </button>
              {exportOpen && (
                <div role="menu" className="export-menu">
                  <button role="menuitem" onClick={() => runExport('docx')}>
                    <Icon name="file" size={16} />
                    Word (.docx)
                  </button>
                  <button role="menuitem" onClick={() => runExport('pdf')}>
                    <Icon name="file" size={16} />
                    PDF
                  </button>
                </div>
              )}
            </div>
            <span className="toolbar-sep" />
            <ToolButton label="Recolher ferramentas" onClick={() => setToolsOpen(false)}>
              <Icon name="chevronDown" />
            </ToolButton>
          </div>
        ) : (
          <button className="toolbar-pill" aria-label="Mostrar ferramentas" onClick={() => setToolsOpen(true)}>
            <Icon name="chevronUp" size={16} />
            Ferramentas
          </button>
        )}
      </main>

      {refsOpen && !focus && <ReferencePanel storyId={story.id} chapterId={chapter.id} onClose={() => setRefsOpen(false)} />}
      {versionsOpen && editor && <VersionsDialog chapterId={chapter.id} editor={editor} onClose={() => setVersionsOpen(false)} />}
    </>
  );
}

function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className={`toolbar-btn ${active ? 'is-active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
