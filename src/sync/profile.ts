import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { cutJpeg, type Crop } from '../lib/image';
import { supabase } from './supabase';

/*
 * The author's name, photo and cover, kept with the account (Supabase user
 * metadata, under lirismo_* keys so a Google sign-in does not overwrite
 * them). The images go to Storage, in the covers bucket at
 * {user_id}/perfil and {user_id}/capa-perfil: no new rules, and deleting the
 * account removes them with the book covers. Each takes one of the
 * account's 50 cover slots.
 */

/** An image the author saved; `v` changes with every new one. */
export type StoredImage = { path: string; v: number };

export type Profile = {
  userId: string;
  /** The name the author chose, or the one from Google. */
  name: string;
  /** Their own photo in Storage; `false` when they took the photo out. */
  photo?: StoredImage | false;
  /** The Google account photo, shown until they choose one. */
  googlePhoto?: string;
  /** The image on the cover of the account card; unset shows the green cover. */
  banner?: StoredImage;
};

/** The part of the image the author chose, in the image's own pixels. */
export type { Crop };

/** The two images of a profile: what they are cut to and where they live. */
const IMAGES = {
  photo: { file: 'perfil', meta: 'lirismo_photo', cache: 'lirismo:foto', width: 256, height: 256, quality: 0.86 },
  banner: { file: 'capa-perfil', meta: 'lirismo_banner', cache: 'lirismo:capa-perfil', width: 960, height: 320, quality: 0.82 },
} as const;
export type ImageKind = keyof typeof IMAGES;

/** Width over height of each kind, for the editor's frame. */
export const IMAGE_ASPECT: Record<ImageKind, number> = {
  photo: IMAGES.photo.width / IMAGES.photo.height,
  banner: IMAGES.banner.width / IMAGES.banner.height,
};

export const NAME_MAX = 60;

const stored = (v: unknown): StoredImage | undefined =>
  v && typeof v === 'object' && typeof (v as StoredImage).path === 'string' ? (v as StoredImage) : undefined;

export function profileFrom(user: User): Profile {
  const m = (user.user_metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return {
    userId: user.id,
    name: str(m.lirismo_name) || str(m.full_name) || str(m.name),
    photo: m.lirismo_photo === false ? false : stored(m.lirismo_photo),
    googlePhoto: str(m.avatar_url) || str(m.picture) || undefined,
    banner: stored(m.lirismo_banner),
  };
}

/** One letter, or two for a name with more than one word, for when there is no photo. */
export function initials(name: string, email: string) {
  const words = (name || email.split('@')[0]).split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?')[0];
  return letters.toUpperCase();
}

/** A JPEG of the chosen part of the image, at the kind's size. */
function cutImage(file: Blob, kind: ImageKind, crop: Crop): Promise<Blob> {
  const { width, height, quality } = IMAGES[kind];
  return cutJpeg(file, crop, width, height, quality);
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const versionKey = (image: StoredImage) => `${image.path}?${image.v}`;

/** Which kind an image is, from its path. */
const kindOf = (image: StoredImage): ImageKind => (image.path.endsWith(`/${IMAGES.banner.file}`) ? 'banner' : 'photo');

function readCache(image: StoredImage): string | null {
  try {
    const cached = JSON.parse(localStorage.getItem(IMAGES[kindOf(image)].cache) ?? 'null') as { key: string; url: string } | null;
    return cached?.key === versionKey(image) ? cached.url : null;
  } catch {
    return null;
  }
}

function writeCache(image: StoredImage, url: string) {
  try {
    localStorage.setItem(IMAGES[kindOf(image)].cache, JSON.stringify({ key: versionKey(image), url }));
  } catch {
    // Full or blocked: it is downloaded again next time.
  }
}

/** Forgets the downloaded photo and cover (when leaving the account). */
export function forgetPhoto() {
  try {
    for (const kind of Object.values(IMAGES)) localStorage.removeItem(kind.cache);
  } catch {
    // Nothing to forget.
  }
}

/** Saves the chosen part of an image as the photo or the cover. */
export async function saveImage(userId: string, kind: ImageKind, file: Blob, crop: Crop) {
  const blob = await cutImage(file, kind, crop);
  const path = `${userId}/${IMAGES[kind].file}`;
  const { error } = await supabase!.storage.from('covers').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  if (error) throw error;
  const image = { path, v: Date.now() };
  writeCache(image, await toDataUrl(blob));
  const { error: metaError } = await supabase!.auth.updateUser({ data: { [IMAGES[kind].meta]: image } });
  if (metaError) throw metaError;
}

/** Takes the photo or the cover out (the Google photo does not come back). */
export async function removeImage(userId: string, kind: ImageKind) {
  await supabase!.storage.from('covers').remove([`${userId}/${IMAGES[kind].file}`]);
  try {
    localStorage.removeItem(IMAGES[kind].cache);
  } catch {
    // Nothing to forget.
  }
  // Without a photo the initials show; without a cover, the green one.
  const { error } = await supabase!.auth.updateUser({ data: { [IMAGES[kind].meta]: kind === 'photo' ? false : null } });
  if (error) throw error;
}

export async function saveName(name: string) {
  const { error } = await supabase!.auth.updateUser({ data: { lirismo_name: name.trim().slice(0, NAME_MAX) } });
  if (error) throw error;
}

const downloads = new Map<string, Promise<string | null>>();

function download(image: StoredImage) {
  const key = versionKey(image);
  if (!downloads.has(key)) {
    downloads.set(
      key,
      (async () => {
        const { data, error } = await supabase!.storage.from('covers').download(image.path);
        if (error || !data) {
          downloads.delete(key);
          return null;
        }
        const url = await toDataUrl(data);
        writeCache(image, url);
        return url;
      })(),
    );
  }
  return downloads.get(key)!;
}

/** A saved image as a URL to show: from this device's cache, or downloaded once. */
function useStoredImage(image: StoredImage | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (image ? readCache(image) : null));

  useEffect(() => {
    if (!image) return setUrl(null);
    const cached = readCache(image);
    if (cached) return setUrl(cached);
    let alive = true;
    download(image).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [image?.path, image?.v]); // eslint-disable-line react-hooks/exhaustive-deps

  return image ? url : null;
}

/** The photo to show: the author's own, Google's, or null for the initials. */
export function usePhotoUrl(profile: Profile | undefined): string | null {
  const own = useStoredImage(profile?.photo || undefined);
  if (!profile || profile.photo === false) return null;
  return profile.photo ? own : profile.googlePhoto ?? null;
}

/** The cover image of the account card, or null for the green cover. */
export const useBannerUrl = (profile: Profile | undefined) => useStoredImage(profile?.banner);

/*
 * The @: unique per account, in the `profiles` table (supabase/schema.sql),
 * with the rules of X's usernames: 4 to 15 letters without accents, numbers
 * or "_", never "lirismo" or "admin". Case does not make it another @.
 */

export const HANDLE_MAX = 15;

/** What is wrong with a @ the author typed, or null when it is fine to ask the server. */
export function handleProblem(handle: string): string | null {
  if (handle.length < 4) return 'O @ precisa de pelo menos 4 caracteres.';
  if (handle.length > HANDLE_MAX) return `O @ pode ter até ${HANDLE_MAX} caracteres.`;
  if (!/^[A-Za-z0-9_]+$/.test(handle)) return 'Use só letras sem acento, números e “_”.';
  if (/lirismo|admin/i.test(handle)) return 'O @ não pode ter “Lirismo” nem “Admin”.';
  return null;
}

/** The account's @, or null when it has none yet. */
export async function loadHandle(userId: string): Promise<string | null> {
  const { data, error } = await supabase!.from('profiles').select('handle').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return (data?.handle as string | undefined) ?? null;
}

export async function handleAvailable(handle: string): Promise<boolean> {
  const { data, error } = await supabase!.rpc('handle_available', { candidate: handle });
  if (error) throw error;
  return data === true;
}

export class HandleTaken extends Error {}

export async function saveHandle(userId: string, handle: string) {
  const { error } = await supabase!.from('profiles').upsert({ user_id: userId, handle }, { onConflict: 'user_id' });
  if (error?.code === '23505') throw new HandleTaken();
  if (error) throw error;
}
