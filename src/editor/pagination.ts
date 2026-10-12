import { Extension, Node } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { applyGeometry, layoutCopy, sheetGeometry, type Break, type Geometry } from './layout';

/**
 * Paper pagination for a single ProseMirror document.
 *
 * The editor lives inside one tall `.sheet`. After each render a copy of the
 * text is laid out off screen (see layout.ts) and, wherever a page ends, a
 * widget fills the rest of the page, draws the page number and the gap to the
 * next sheet. Breaks inside a paragraph fall exactly between two lines, so the
 * text on screen keeps the same lines as the exported book.
 */

export const PAGE_GAP = 28;

export type PageLayout = {
  breaks: Break[];
  endFill: number;
  pages: number;
  firstPage: number;
  padTop: number;
  padBottom: number;
  compact: boolean;
};

type PaginationOptions = {
  getFirstPage: () => number;
  onLayout: (layout: PageLayout) => void;
};

type PluginState = { deco: DecorationSet; layout: PageLayout | null };

const key = new PluginKey<PluginState>('pagination');

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: () => ['div', { 'data-page-break': '', class: 'page-break' }],
});

function part(cls: string, height: number) {
  const el = document.createElement('span');
  el.className = cls;
  el.style.height = `${height}px`;
  return el;
}

function pageFoot(height: number, pageNo: number) {
  const foot = part('page-foot', height);
  const n = document.createElement('span');
  n.className = 'page-number';
  n.textContent = String(pageNo);
  foot.append(n);
  return foot;
}

function gapWidget(b: Break, l: PageLayout, pageNo: number) {
  const el = document.createElement(b.inline ? 'span' : 'div');
  el.className = b.inline ? 'page-gap is-inline' : 'page-gap';
  el.contentEditable = 'false';
  el.append(pageFoot(b.fill + l.padBottom, pageNo), part('page-sep', PAGE_GAP), part('page-head', l.padTop));
  return el;
}

function endWidget(l: PageLayout, pageNo: number) {
  const el = document.createElement('div');
  el.className = 'page-end';
  el.contentEditable = 'false';
  el.append(pageFoot(l.endFill + l.padBottom, pageNo));
  return el;
}

function buildDecorations(doc: import('@tiptap/pm/model').Node, l: PageLayout) {
  const sizes = `${l.padTop}-${l.padBottom}`;
  const decos = l.breaks.map((b, i) =>
    Decoration.widget(b.pos, () => gapWidget(b, l, l.firstPage + i), {
      side: -1,
      key: `gap-${i}-${b.inline}-${b.fill}-${sizes}-${l.firstPage}`,
      ignoreSelection: true,
    }),
  );
  decos.push(
    Decoration.widget(doc.content.size, () => endWidget(l, l.firstPage + l.breaks.length), {
      side: 1,
      key: `end-${l.endFill}-${sizes}-${l.firstPage + l.breaks.length}`,
      ignoreSelection: true,
    }),
  );
  return DecorationSet.create(doc, decos);
}

const round = (b: Break): Break => ({ ...b, fill: Math.round(b.fill * 100) / 100 });

function measure(view: EditorView, firstPage: number): PageLayout | null {
  const sheet = view.dom.closest('.sheet') as HTMLElement | null;
  const width = sheet?.getBoundingClientRect().width;
  if (!sheet || !width) return null;
  const g: Geometry = sheetGeometry(width);
  applyGeometry(sheet, g);
  const layout = layoutCopy(view.dom, view.state.doc, g);
  if (!layout) return null;
  return {
    breaks: layout.breaks.map(round),
    endFill: Math.round(layout.endFill * 100) / 100,
    pages: layout.pages,
    firstPage,
    padTop: g.padTop,
    padBottom: g.padBottom,
    compact: g.compact,
  };
}

const same = (a: PageLayout | null, b: PageLayout | null) => JSON.stringify(a) === JSON.stringify(b);

export const Pagination = Extension.create<PaginationOptions>({
  name: 'pagination',

  addOptions() {
    return { getFirstPage: () => 1, onLayout: () => {} };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<PluginState>({
        key,
        state: {
          init: (): PluginState => ({ deco: DecorationSet.empty, layout: null }),
          apply(tr, value, _old, newState) {
            const layout = tr.getMeta(key) as PageLayout | undefined;
            if (layout) return { deco: buildDecorations(newState.doc, layout), layout };
            return { deco: value.deco.map(tr.mapping, tr.doc), layout: value.layout };
          },
        },
        props: {
          decorations: (state) => key.getState(state)?.deco,
        },
        view(view) {
          let frame = 0;
          let destroyed = false;
          let observed: Element | null = null;
          const ro = new ResizeObserver(() => schedule());
          const run = () => {
            frame = 0;
            if (destroyed) return;
            // React mounts the editor into the sheet after the view exists: wait for it.
            const sheet = view.dom.closest('.sheet');
            if (!sheet) return schedule();
            if (sheet !== observed) {
              ro.disconnect();
              ro.observe(sheet);
              observed = sheet;
            }
            const next = measure(view, options.getFirstPage());
            if (!next) return;
            const current = key.getState(view.state)?.layout ?? null;
            if (!same(current, next)) {
              view.dispatch(view.state.tr.setMeta(key, next).setMeta('addToHistory', false));
            }
            options.onLayout(next);
          };
          function schedule() {
            if (!frame && !destroyed) frame = requestAnimationFrame(run);
          }
          document.fonts?.ready.then(schedule);
          schedule();
          return {
            update: schedule,
            destroy() {
              destroyed = true;
              cancelAnimationFrame(frame);
              ro.disconnect();
            },
          };
        },
      }),
    ];
  },
});
