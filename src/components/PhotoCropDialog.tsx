import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { Modal } from './Modal';
import { Icon } from './Icon';
import type { Crop } from '../sync/profile';

/** Side of the square the author frames the photo in, in CSS pixels. */
const VIEW = 280;
const MAX_ZOOM = 4;

type Props = {
  file: File;
  onCancel: () => void;
  onDone: (crop: Crop) => void;
};

/**
 * Lets the author choose the part of the photo that shows: drag to move,
 * the slider or the mouse wheel to zoom, arrows and +/- on the keyboard.
 */
export function PhotoCropDialog({ file, onCancel, onDone }: Props) {
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
      const s = VIEW / Math.min(w, h);
      setImg({ url, w, h });
      // Starts centred, filling the square.
      setPos({ x: (VIEW - w * s) / 2, y: (VIEW - h * s) / 2 });
    };
    // Ignores a load that was already cancelled (React runs effects twice while developing).
    probe.onerror = () => alive && setFailed(true);
    probe.src = url;
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const scale = (z: number) => (img ? (VIEW / Math.min(img.w, img.h)) * z : 1);

  /** Keeps the photo covering the whole square. */
  const clamp = (p: { x: number; y: number }, z: number) => {
    if (!img) return p;
    const s = scale(z);
    return {
      x: Math.min(0, Math.max(VIEW - img.w * s, p.x)),
      y: Math.min(0, Math.max(VIEW - img.h * s, p.y)),
    };
  };

  /** Zooms around the middle of the square. */
  function zoomTo(next: number) {
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    const s1 = scale(zoom);
    const s2 = scale(z);
    const cx = (VIEW / 2 - pos.x) / s1;
    const cy = (VIEW / 2 - pos.y) / s1;
    setZoom(z);
    setPos(clamp({ x: VIEW / 2 - cx * s2, y: VIEW / 2 - cy * s2 }, z));
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
    onDone({ x: -pos.x / s, y: -pos.y / s, size: VIEW / s });
  }

  const s = scale(zoom);
  return (
    <Modal title="Ajustar a foto" onClose={onCancel}>
      {failed ? (
        <p className="ask-message" style={{ margin: 0 }}>Não deu para abrir esta imagem. Tente outra, em JPG, PNG ou WebP.</p>
      ) : (
        <div className="crop">
          <p className="settings-note" style={{ margin: 0 }}>Arraste para escolher a parte que aparece. Use a barra para aproximar.</p>
          <div
            className="crop-view"
            style={{ width: VIEW, height: VIEW }}
            tabIndex={0}
            role="application"
            aria-label="Área da foto. Setas movem, mais e menos aproximam."
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
            <span className="crop-ring" aria-hidden="true" />
          </div>
          <label className="crop-zoom">
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
            Usar esta foto
          </button>
        )}
      </div>
    </Modal>
  );
}
