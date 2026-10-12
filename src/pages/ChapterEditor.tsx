import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from '@tiptap/react';
import Placeholder from '@tiptap/extension-placeholder';
import { db, saveChapterContent, type Chapter } from '../db';
import { Pagination, type PageLayout } from '../editor/pagination';
import { contentExtensions, type Alignment } from '../editor/extensions';
import { Dashes } from '../editor/dashes';
import { bookPages } from '../editor/layout';
import { Icon } from '../components/Icon';
import { ReferencePanel } from '../components/ReferencePanel';
import { VersionsDialog } from '../components/VersionsDialog';
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
  const { story, chapters, focus, setFocus, openMenu, setBeforeExport } = useStory();
  const [title, setTitle] = useState(chapter.title);
  const [words, setWords] = useState(chapter.wordCount);
  const [layout, setLayout] = useState<PageLayout | null>(null);
  const [cursorPage, setCursorPage] = useState(1);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [toolsOpen, setToolsOpen] = useState(true);
  const [refsOpen, setRefsOpen] = useState(isWide);
  const [versionsOpen, setVersionsOpen] = useState(false);

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
      ...contentExtensions(),
      Dashes,
      Placeholder.configure({ placeholder: 'Comece a escrever…' }),
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
    selector: ({ editor: e }) => ({
      bold: !!e?.isActive('bold'),
      italic: !!e?.isActive('italic'),
      align: (ALIGN_OPTIONS.find((o) => e?.isActive({ textAlign: o.value }))?.value ?? 'justify') as Alignment,
    }),
  });

  flushRef.current = async () => {
    window.clearTimeout(pendingSave.current);
    pendingSave.current = 0;
    setSaveState('saving');
    const json = latest.current;
    const pages = editor && !editor.isDestroyed ? bookPages(editor.view.dom, editor.state.doc) : chapter.pageCount;
    chapter.pageCount = pages;
    await saveChapterContent(chapter, json, countWords(json), pages);
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

  // Keep the stored page count (in the book format) in sync so later chapters number correctly.
  useEffect(() => {
    if (!layout || !editor || editor.isDestroyed) return;
    updateCursorPage(editor);
    const pages = bookPages(editor.view.dom, editor.state.doc);
    if (pages !== chapter.pageCount) {
      chapter.pageCount = pages;
      db.chapters.update(chapter.id, { pageCount: pages });
    }
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

  // Exporting from the sidebar first saves what was just typed here.
  useEffect(() => {
    setBeforeExport(() => flushRef.current());
    return () => setBeforeExport(undefined);
  }, [setBeforeExport]);

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
          {!focus && (
            <button className="btn btn-ghost top-btn" aria-label="Versões" title="Versões" onClick={() => setVersionsOpen(true)}>
              <Icon name="history" size={16} />
              <span className="top-label">Versões</span>
            </button>
          )}
          {!refsOpen && !focus && (
            <button className="btn btn-ghost top-btn" aria-label="Referências" title="Referências" onClick={() => setRefsOpen(true)}>
              <Icon name="panel" size={16} />
              <span className="top-label">Referências</span>
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
            {editor && <AlignMenu editor={editor} current={marks?.align ?? 'justify'} />}
            <span className="toolbar-sep" />
            <span className="toolbar-count">{formatNumber(words)} palavras</span>
            <span className="toolbar-sep" />
            {/* Focus mode is for big screens; phones already show only the sheet. */}
            <button className="toolbar-btn wide focus-tool" aria-label={focus ? 'Sair do foco' : 'Modo foco'} title="Modo foco" aria-pressed={focus} onClick={() => setFocus(!focus)}>
              <Icon name="focus" size={16} />
              <span className="toolbar-label">{focus ? 'Sair do foco' : 'Modo foco'}</span>
            </button>
            <span className="toolbar-sep focus-tool" />
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

const ALIGN_OPTIONS: { value: Alignment; label: string; icon: 'alignJustify' | 'alignLeft' | 'alignCenter' | 'alignRight' }[] = [
  { value: 'justify', label: 'Justificado', icon: 'alignJustify' },
  { value: 'left', label: 'À esquerda', icon: 'alignLeft' },
  { value: 'center', label: 'Centralizado', icon: 'alignCenter' },
  { value: 'right', label: 'À direita', icon: 'alignRight' },
];

/** Alignment of the paragraphs under the cursor or selection. */
function AlignMenu({ editor, current }: { editor: Editor; current: Alignment }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = ALIGN_OPTIONS.find((o) => o.value === current)!;

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  function choose(value: Alignment) {
    // Justified is the book's default, so it is stored as no alignment at all.
    const chain = editor.chain().focus();
    (value === 'justify' ? chain.unsetTextAlign() : chain.setTextAlign(value)).run();
    setOpen(false);
  }

  return (
    <div className="toolbar-align" ref={ref}>
      <button
        className="toolbar-btn"
        aria-label={`Alinhamento: ${active.label}`}
        title="Alinhamento"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={active.icon} />
      </button>
      {open && (
        <div className="toolbar-menu" role="menu" aria-label="Alinhamento">
          {ALIGN_OPTIONS.map((o) => (
            <button
              key={o.value}
              role="menuitemradio"
              aria-checked={o.value === current}
              className={`toolbar-btn ${o.value === current ? 'is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o.value)}
            >
              <Icon name={o.icon} />
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
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
