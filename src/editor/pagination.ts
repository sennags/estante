import { Extension, Node } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/**
 * Paper pagination for a single ProseMirror document.
 *
 * The editor lives inside one tall `.sheet`. After each render we measure the
 * top-level blocks and, wherever the next block would overflow the page, insert
 * a widget that fills the rest of the page, draws the page number and the gap
 * to the next sheet. Blocks are never split, so a paragraph that doesn't fit
 * moves whole to the next page (like "keep lines together" in Word).
 */

export const PAGE_GAP = 28;
/** A4 proportions. */
const PAGE_RATIO = 1.414;

export type Geometry = { padX: number; padY: number; avail: number };

export function geometry(width: number): Geometry {
  const padX = Math.round(Math.min(112, Math.max(22, width * 0.11)));
  const padY = Math.round(Math.min(112, Math.max(40, width * 0.12)));
  const pageH = Math.round(width * PAGE_RATIO);
  return { padX, padY, avail: pageH - padY * 2 };
}

type Break = { pos: number; fill: number };

export type PageLayout = {
  breaks: Break[];
  endFill: number;
  pages: number;
  firstPage: number;
  padY: number;
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

function pageFoot(height: number, pageNo: number) {
  const foot = document.createElement('div');
  foot.className = 'page-foot';
  foot.style.height = `${height}px`;
  const n = document.createElement('span');
  n.className = 'page-number';
  n.textContent = String(pageNo);
  foot.append(n);
  return foot;
}

function gapWidget(fill: number, padY: number, pageNo: number) {
  const el = document.createElement('div');
  el.className = 'page-gap';
  el.contentEditable = 'false';
  const sep = document.createElement('div');
  sep.className = 'page-sep';
  sep.style.height = `${PAGE_GAP}px`;
  const head = document.createElement('div');
  head.style.height = `${padY}px`;
  el.append(pageFoot(fill + padY, pageNo), sep, head);
  return el;
}

function endWidget(fill: number, padY: number, pageNo: number) {
  const el = document.createElement('div');
  el.className = 'page-end';
  el.contentEditable = 'false';
  el.append(pageFoot(fill + padY, pageNo));
  return el;
}

function buildDecorations(doc: import('@tiptap/pm/model').Node, layout: PageLayout) {
  const { breaks, padY, firstPage } = layout;
  const decos = breaks.map((b, i) =>
    Decoration.widget(b.pos, () => gapWidget(b.fill, padY, firstPage + i), {
      side: -1,
      key: `gap-${i}-${b.fill}-${padY}-${firstPage}`,
      ignoreSelection: true,
    }),
  );
  decos.push(
    Decoration.widget(doc.content.size, () => endWidget(layout.endFill, padY, firstPage + breaks.length), {
      side: 1,
      key: `end-${layout.endFill}-${padY}-${firstPage + breaks.length}`,
      ignoreSelection: true,
    }),
  );
  return DecorationSet.create(doc, decos);
}

function outerHeight(el: HTMLElement) {
  const cs = getComputedStyle(el);
  return { h: el.offsetHeight + parseFloat(cs.marginTop), mb: parseFloat(cs.marginBottom) };
}

function measure(view: EditorView, firstPage: number): PageLayout | null {
  const sheet = view.dom.closest('.sheet') as HTMLElement | null;
  if (!sheet || !sheet.clientWidth) return null;
  const { padX, padY, avail } = geometry(sheet.clientWidth);
  sheet.style.setProperty('--pad-x', `${padX}px`);
  sheet.style.setProperty('--pad-y', `${padY}px`);

  // Whatever sits above the editor on the first page (chapter heading).
  let y = view.dom.getBoundingClientRect().top - sheet.getBoundingClientRect().top - padY;
  const breaks: Break[] = [];

  view.state.doc.forEach((node, offset) => {
    if (node.type.name === 'pageBreak') {
      breaks.push({ pos: offset + node.nodeSize, fill: Math.max(0, Math.round(avail - y)) });
      y = 0;
      return;
    }
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) return;
    const { h, mb } = outerHeight(dom);
    if (y > 0 && y + h > avail) {
      breaks.push({ pos: offset, fill: Math.max(0, Math.round(avail - y)) });
      y = 0;
    }
    y += h + mb;
  });

  return { breaks, endFill: Math.max(0, Math.round(avail - y)), pages: breaks.length + 1, firstPage, padY };
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
          const run = () => {
            frame = 0;
            if (destroyed) return;
            const next = measure(view, options.getFirstPage());
            if (!next) return;
            const current = key.getState(view.state)?.layout ?? null;
            if (!same(current, next)) {
              view.dispatch(view.state.tr.setMeta(key, next).setMeta('addToHistory', false));
            }
            options.onLayout(next);
          };
          const schedule = () => {
            if (!frame) frame = requestAnimationFrame(run);
          };
          const sheet = view.dom.closest('.sheet');
          const ro = new ResizeObserver(schedule);
          if (sheet) ro.observe(sheet);
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
