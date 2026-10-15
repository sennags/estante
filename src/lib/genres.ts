/**
 * The genres a story can have: a fixed list, so the community's filter has
 * one "Fantasia" and not five spellings of it. The same list is checked by
 * the server (publications.genre in supabase/schema.sql): change both.
 */
export const GENRES = [
  'Aventura',
  'Conto',
  'Distopia',
  'Drama',
  'Fanfic',
  'Fantasia',
  'Ficção científica',
  'Ficção histórica',
  'Humor',
  'Infantil',
  'Jovem adulto',
  'Mistério',
  'Não ficção',
  'Poesia',
  'Policial',
  'Romance',
  'Suspense',
  'Terror',
  'Outro',
] as const;

export type Genre = (typeof GENRES)[number];

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const BY_PLAIN = new Map<string, Genre>(GENRES.map((g) => [plain(g), g]));

/**
 * The genre of the list a stored genre stands for, or '' when it matches
 * none. Stories from before the list had free text: "romance" and
 * "Ficcao cientifica" still find theirs.
 */
export const toGenre = (text: string): Genre | '' => BY_PLAIN.get(plain(text)) ?? '';

/** The genres whose name has the text in it, ignoring accents and case; starting with it comes first. */
export function searchGenres(text: string): Genre[] {
  const q = plain(text);
  if (!q) return [...GENRES];
  const found = GENRES.filter((g) => plain(g).includes(q));
  return [...found.filter((g) => plain(g).startsWith(q)), ...found.filter((g) => !plain(g).startsWith(q))];
}
