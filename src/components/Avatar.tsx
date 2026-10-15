import { initials, usePhotoUrl, type Profile } from '../sync/profile';

/** The author's photo, or their initials on the accent color. */
export function Avatar({ profile, email, size }: { profile?: Profile; email: string; size: number }) {
  const url = usePhotoUrl(profile);
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {url ? <img src={url} alt="" referrerPolicy="no-referrer" /> : initials(profile?.name ?? '', email)}
    </span>
  );
}
