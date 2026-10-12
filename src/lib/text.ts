import type { JSONContent } from '@tiptap/react';

export function plainText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  const inline = node.type === 'paragraph' || node.type === 'heading';
  return (node.content ?? []).map(plainText).join(inline ? '' : '\n');
}

export function countWords(doc: JSONContent): number {
  const words = plainText(doc).match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu);
  return words ? words.length : 0;
}

const nf = new Intl.NumberFormat('pt-BR');
export const formatNumber = (n: number) => nf.format(n);

export function plural(n: number, one: string, many: string) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

const ORDINALS = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
  'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove', 'vinte'];

/** "Capítulo sete" for small numbers, "Capítulo 42" otherwise. */
export function chapterLabel(order: number) {
  return `Capítulo ${ORDINALS[order] ?? order}`;
}

export function chapterName(order: number, title: string) {
  return title.trim() || chapterLabel(order);
}

export function relativeTime(ts: number) {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} ${h === 1 ? 'hora' : 'horas'}`;
  const d = Math.round(h / 24);
  if (d < 30) return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
  return new Date(ts).toLocaleDateString('pt-BR');
}

export function fileSafe(name: string) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'historia';
}
