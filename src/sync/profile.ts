import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

/*
 * The author's name and photo, kept with the account (Supabase user
 * metadata, under lirismo_* keys so a Google sign-in does not overwrite
 * them). The photo itself goes to Storage, in the covers bucket at
 * {user_id}/perfil: no new rules, and deleting the account removes it with
 * the covers. It takes one of the account's 50 cover slots.
 */

export type Profile = {
  userId: string;
  /** The name the author chose, or the one from Google. */
  name: string;
  /** Their own photo in Storage; `false` when they took the photo out. */
  photo?: { path: string; v: number } | false;
  /** The Google account photo, shown until they choose one. */
  googlePhoto?: string;
};

export const NAME_MAX = 60;
const PHOTO_SIZE = 256;
const CACHE_KEY = 'lirismo:foto';

export function profileFrom(user: User): Profile {
  const m = (user.user_metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const photo = m.lirismo_photo;
  return {
    userId: user.id,
    name: str(m.lirismo_name) || str(m.full_name) || str(m.name),
    photo: photo === false ? false : photo && typeof photo === 'object' ? (photo as { path: string; v: number }) : undefined,
    googlePhoto: str(m.avatar_url) || str(m.picture) || undefined,
  };
}

/** Up to two letters for when there is no photo. */
export function initials(name: string, email: string) {
  const words = (name || email.split('@')[0]).split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/** A square JPEG of the middle of the image. */
async function squarePhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob) throw new Error('canvas');
  return blob;
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const cacheKey = (photo: { path: string; v: number }) => `${photo.path}?${photo.v}`;

function readCache(photo: { path: string; v: number }): string | null {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as { key: string; url: string } | null;
    return cached?.key === cacheKey(photo) ? cached.url : null;
  } catch {
    return null;
  }
}

function writeCache(photo: { path: string; v: number }, url: string) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ key: cacheKey(photo), url }));
  } catch {
    // Full or blocked: it is downloaded again next time.
  }
}

export function forgetPhoto() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** Saves a new photo; the image is cut to a 256 px square first. */
export async function savePhoto(userId: string, file: Blob) {
  const blob = await squarePhoto(file);
  const path = `${userId}/perfil`;
  const { error } = await supabase!.storage.from('covers').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  if (error) throw error;
  const photo = { path, v: Date.now() };
  writeCache(photo, await toDataUrl(blob));
  const { error: metaError } = await supabase!.auth.updateUser({ data: { lirismo_photo: photo } });
  if (metaError) throw metaError;
}

/** Takes the photo out (the Google one does not come back). */
export async function removePhoto(userId: string) {
  await supabase!.storage.from('covers').remove([`${userId}/perfil`]);
  forgetPhoto();
  const { error } = await supabase!.auth.updateUser({ data: { lirismo_photo: false } });
  if (error) throw error;
}

export async function saveName(name: string) {
  const { error } = await supabase!.auth.updateUser({ data: { lirismo_name: name.trim().slice(0, NAME_MAX) } });
  if (error) throw error;
}

const downloads = new Map<string, Promise<string | null>>();

function download(photo: { path: string; v: number }) {
  const key = cacheKey(photo);
  if (!downloads.has(key)) {
    downloads.set(
      key,
      (async () => {
        const { data, error } = await supabase!.storage.from('covers').download(photo.path);
        if (error || !data) {
          downloads.delete(key);
          return null;
        }
        const url = await toDataUrl(data);
        writeCache(photo, url);
        return url;
      })(),
    );
  }
  return downloads.get(key)!;
}

/** The photo to show: the author's own, Google's, or null for the initials. */
export function usePhotoUrl(profile: Profile | undefined): string | null {
  const own = profile?.photo || undefined;
  const [url, setUrl] = useState<string | null>(() => (own ? readCache(own) : null));

  useEffect(() => {
    if (!own) return setUrl(null);
    const cached = readCache(own);
    if (cached) return setUrl(cached);
    let alive = true;
    download(own).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [own?.path, own?.v]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!profile || profile.photo === false) return null;
  return own ? url : profile.googlePhoto ?? null;
}
