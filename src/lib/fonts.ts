/**
 * Static font files for the PDF export. The screen uses the variable fonts; the
 * PDF needs plain TrueType, so the WOFF files from Fontsource are
 * unpacked on the fly. Only fetched when the author exports.
 */
import textRegular from '@fontsource/literata/files/literata-latin-400-normal.woff?url';
import textItalic from '@fontsource/literata/files/literata-latin-400-italic.woff?url';
import textBold from '@fontsource/literata/files/literata-latin-700-normal.woff?url';
import textBoldItalic from '@fontsource/literata/files/literata-latin-700-italic.woff?url';
import textRegularExt from '@fontsource/literata/files/literata-latin-ext-400-normal.woff?url';
import textItalicExt from '@fontsource/literata/files/literata-latin-ext-400-italic.woff?url';
import textBoldExt from '@fontsource/literata/files/literata-latin-ext-700-normal.woff?url';
import textBoldItalicExt from '@fontsource/literata/files/literata-latin-ext-700-italic.woff?url';
import displayRegular from '@fontsource/newsreader/files/newsreader-latin-400-normal.woff?url';
import displayItalic from '@fontsource/newsreader/files/newsreader-latin-400-italic.woff?url';
import displayMedium from '@fontsource/newsreader/files/newsreader-latin-500-normal.woff?url';
import displayMediumItalic from '@fontsource/newsreader/files/newsreader-latin-500-italic.woff?url';
import displayRegularExt from '@fontsource/newsreader/files/newsreader-latin-ext-400-normal.woff?url';
import displayItalicExt from '@fontsource/newsreader/files/newsreader-latin-ext-400-italic.woff?url';
import displayMediumExt from '@fontsource/newsreader/files/newsreader-latin-ext-500-normal.woff?url';
import displayMediumItalicExt from '@fontsource/newsreader/files/newsreader-latin-ext-500-italic.woff?url';
import sansRegular from '@fontsource/instrument-sans/files/instrument-sans-latin-400-normal.woff?url';
import sansMedium from '@fontsource/instrument-sans/files/instrument-sans-latin-500-normal.woff?url';
import sansSemibold from '@fontsource/instrument-sans/files/instrument-sans-latin-600-normal.woff?url';

export type Family = 'text' | 'display' | 'sans';

const FILES: Record<string, [string, string?]> = {
  'text-400-normal': [textRegular, textRegularExt],
  'text-400-italic': [textItalic, textItalicExt],
  'text-700-normal': [textBold, textBoldExt],
  'text-700-italic': [textBoldItalic, textBoldItalicExt],
  'display-400-normal': [displayRegular, displayRegularExt],
  'display-400-italic': [displayItalic, displayItalicExt],
  'display-500-normal': [displayMedium, displayMediumExt],
  'display-500-italic': [displayMediumItalic, displayMediumItalicExt],
  'sans-400-normal': [sansRegular],
  'sans-500-normal': [sansMedium],
  'sans-600-normal': [sansSemibold],
};

const WEIGHTS: Record<Family, number[]> = { text: [400, 700], display: [400, 500], sans: [400, 500, 600] };

/** The closest face we ship for a family, weight and style. */
export function faceKey(family: Family, weight: number, italic: boolean) {
  const w = WEIGHTS[family].reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a));
  return `${family}-${w}-${italic && family !== 'sans' ? 'italic' : 'normal'}`;
}

export const hasExtension = (key: string) => !!FILES[key]?.[1];

const cache = new Map<string, Promise<Uint8Array>>();

/** TrueType bytes of a face; `ext` picks its Latin Extended subset. */
export function fontBytes(key: string, ext = false): Promise<Uint8Array> {
  const url = FILES[key]?.[ext ? 1 : 0];
  if (!url) return Promise.reject(new Error(`Fonte desconhecida: ${key}`));
  let bytes = cache.get(url);
  if (!bytes) {
    bytes = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => woffToSfnt(new Uint8Array(b)));
    cache.set(url, bytes);
  }
  return bytes;
}

async function inflate(data: Uint8Array) {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Unpacks a WOFF 1.0 file into the TrueType/OpenType font it wraps. */
async function woffToSfnt(woff: Uint8Array) {
  const v = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (v.getUint32(0) !== 0x774f4646) return woff; // not 'wOFF': already a plain font
  const n = v.getUint16(12);
  const tables = Array.from({ length: n }, (_, i) => {
    const o = 44 + i * 20;
    return { tag: v.getUint32(o), offset: v.getUint32(o + 4), comp: v.getUint32(o + 8), orig: v.getUint32(o + 12), sum: v.getUint32(o + 16) };
  });
  const data = await Promise.all(
    tables.map((t) => {
      const raw = woff.subarray(t.offset, t.offset + t.comp);
      return t.comp < t.orig ? inflate(raw) : raw;
    }),
  );

  const size = tables.reduce((s, t) => s + ((t.orig + 3) & ~3), 12 + 16 * n);
  const out = new Uint8Array(size);
  const w = new DataView(out.buffer);
  let exp = 0;
  while (1 << (exp + 1) <= n) exp++;
  const range = (1 << exp) * 16;
  w.setUint32(0, v.getUint32(4));
  w.setUint16(4, n);
  w.setUint16(6, range);
  w.setUint16(8, exp);
  w.setUint16(10, n * 16 - range);
  let pos = 12 + 16 * n;
  tables.forEach((t, i) => {
    const d = 12 + 16 * i;
    w.setUint32(d, t.tag);
    w.setUint32(d + 4, t.sum);
    w.setUint32(d + 8, pos);
    w.setUint32(d + 12, t.orig);
    out.set(data[i], pos);
    pos += (t.orig + 3) & ~3;
  });
  return out;
}
