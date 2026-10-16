import { useEffect, useState } from 'react';
import { coverInk, type Story } from '../db';

/** Object URL for a stored cover image, revoked when it changes. */
export function useCoverUrl(blob?: Blob) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return setUrl(undefined);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

type CoverProps = {
  story: Pick<Story, 'title' | 'genre' | 'coverColor' | 'coverImage'>;
  /** `fill` takes the size of the box around it (the Home's mosaic). */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'fill';
};

export function Cover({ story, size = 'md' }: CoverProps) {
  const url = useCoverUrl(story.coverImage);
  const ink = coverInk(story.coverColor);
  return (
    <span
      className={`cover cover-${size}`}
      style={{
        background: url ? `center / cover no-repeat url("${url}")` : story.coverColor,
        color: ink,
      }}
    >
      {!url && (
        <>
          <span className="cover-title">{story.title || 'Sem título'}</span>
          {story.genre && <span className="cover-genre">{story.genre}</span>}
        </>
      )}
    </span>
  );
}
