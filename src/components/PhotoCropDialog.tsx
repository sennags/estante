import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { IMAGE_ASPECT, type Crop, type ImageKind } from '../sync/profile';

const MAX_ZOOM = 4;

/** The frame the author fits the image in, in CSS pixels: a circle for the photo, a wide strip for the cover. */
function frameSize(kind: ImageKind) {
  const width = kind === 'photo' ? 280 : Math.min(480, window.innerWidth - 80);
  return { VW: width, VH: Math.round(width / IMAGE_ASPECT[kind]) };
}

const TEXT: Record<ImageKind, { title: string; done: string; area: string }> = {
  photo: { title: 'Ajustar a foto', done: 'Usar esta foto', area: 'Área da foto' },
  banner: { title: 'Ajustar a capa', done: 'Usar esta capa', area: 'Área da capa' },
};

type Props = {
  file: File;
  /** Photo (round, square) or the card's cover (wide). */
  kind?: ImageKind;
  onCancel: () => void;
  onDone: (crop: Crop) => void;
};

/**
 * Lets the author choose the part of the photo that shows: drag to move,
 * the slider or the mouse wheel to zoom, arrows and +/- on the keyboard.
 */
export function PhotoCropDialog({ file, kind = 'photo', onCancel, onDone }: Props) {
  const [{ VW, VH }] = useState(() => frameSize(kind));
  const [img, setImg] = useState<{ url: string; w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const probe = new Image();
    let alive = true;
    setFailed(false);
    setZoom(1);
    probe.onload = () => {
      if (!alive) return;
      const w = probe.naturalWidth;
      const h = probe.naturalHeight;
      const s = Math.max(VW / w, VH / h);
      setImg({ url, w, h });
      // Starts centred, filling the frame.
      setPos({ x: (VW - w * s) / 2, y: (VH - h * s) / 2 });
    };
    // Ignores a load that was already cancelled (React runs effects twice while developing).
    probe.onerror = () => alive && setFailed(true);
    probe.src = url;
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Pixels on screen per pixel of the image: at zoom 1 the image just covers the frame. */
  const scale = (z: number) => (img ? Math.max(VW / img.w, VH / img.h) * z : 1);

  /** Keeps the image covering the whole frame. */
  const clamp = (p: { x: number; y: number }, z: number) => {
    if (!img) return p;
    const s = scale(z);
    return {
      x: Math.min(0, Math.max(VW - img.w * s, p.x)),
      y: Math.min(0, Math.max(VH - img.h * s, p.y)),
    };
  };

  /** Zooms around the middle of the frame. */
  function zoomTo(next: number) {
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    const s1 = scale(zoom);
    const s2 = scale(z);
    const cx = (VW / 2 - pos.x) / s1;
    const cy = (VH / 2 - pos.y) / s1;
    setZoom(z);
    setPos(clamp({ x: VW / 2 - cx * s2, y: VH / 2 - cy * s2 }, z));
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }, zoom));
  }
  function onPointerUp() {
    drag.current = null;
  }
  function onWheel(e: WheelEvent<HTMLDivElement>) {
    zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) {
      e.preventDefault();
      setPos(clamp({ x: pos.x + moves[e.key][0], y: pos.y + moves[e.key][1] }, zoom));
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomTo(zoom + 0.2);
    } else if (e.key === '-') {
      e.preventDefault();
      zoomTo(zoom - 0.2);
    }
  }

  function done() {
    const s = scale(zoom);
    onDone({ x: -pos.x / s, y: -pos.y / s, width: VW / s, height: VH / s });
  }

  const s = scale(zoom);
  return (
    <Modal title={TEXT[kind].title} onClose={onCancel}>
      {failed ? (
        <p className="ask-message" style={{ margin: 0 }}>Não deu para abrir esta imagem. Tente outra, em JPG, PNG ou WebP.</p>
      ) : (
        <div className="crop">
          <p className="settings-note" style={{ margin: 0 }}>Arraste para escolher a parte que aparece. Use a barra para aproximar.</p>
          <div
            className="crop-view"
            style={{ width: VW, height: VH }}
            tabIndex={0}
            role="application"
            aria-label={`${TEXT[kind].area}. Setas movem, mais e menos aproximam.`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            onKeyDown={onKeyDown}
          >
            {img && (
              <img
                src={img.url}
                alt=""
                draggable={false}
                style={{ width: img.w * s, height: img.h * s, transform: `translate(${pos.x}px, ${pos.y}px)` }}
              />
            )}
            <span className={kind === 'photo' ? 'crop-ring' : 'crop-frame'} aria-hidden="true" />
          </div>
          <label className="crop-zoom" style={{ width: Math.min(VW, 320) }}>
            <Icon name="zoomOut" size={18} />
            <span className="sr-only">Aproximar</span>
            <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} />
            <Icon name="zoomIn" size={18} />
          </label>
        </div>
      )}
      <div className="dialog-actions">
        <button className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        {!failed && (
          <button className="btn btn-primary" data-autofocus disabled={!img} onClick={done}>
            {TEXT[kind].done}
          </button>
        )}
      </div>
    </Modal>
  );
}
