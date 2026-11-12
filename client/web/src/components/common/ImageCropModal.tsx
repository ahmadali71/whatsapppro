import React, { useEffect, useRef, useState } from 'react';
import { RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react';

interface ImageCropModalProps {
  file: File | null;
  shape?: 'circle' | 'square';
  title?: string;
  onCancel: () => void;
  onConfirm: (croppedBlob: Blob) => void;
}

const VIEWPORT_SIZE = 280;
const OUTPUT_SIZE = 512;

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  file,
  shape = 'circle',
  title = 'Adjust & Crop Photo',
  onCancel,
  onConfirm,
}) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [natSize, setNatSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );

  useEffect(() => {
    if (!file) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setNatSize({ w: 0, h: 0 });
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    setSaving(false);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  if (!file || !imageUrl) return null;

  const rotatedW = rotation % 180 === 0 ? natSize.w : natSize.h;
  const rotatedH = rotation % 180 === 0 ? natSize.h : natSize.w;
  const baseScale =
    rotatedW > 0 && rotatedH > 0
      ? Math.max(VIEWPORT_SIZE / rotatedW, VIEWPORT_SIZE / rotatedH)
      : 1;
  const effectiveScale = baseScale * zoom;

  const clampOffset = (x: number, y: number, nextZoom = zoom, nextRot = rotation) => {
    const rW = nextRot % 180 === 0 ? natSize.w : natSize.h;
    const rH = nextRot % 180 === 0 ? natSize.h : natSize.w;
    if (!rW || !rH) return { x: 0, y: 0 };
    const bScale = Math.max(VIEWPORT_SIZE / rW, VIEWPORT_SIZE / rH);
    const maxX = Math.max(0, (rW * bScale * nextZoom - VIEWPORT_SIZE) / 2);
    const maxY = Math.max(0, (rH * bScale * nextZoom - VIEWPORT_SIZE) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: offset.x,
      origY: offset.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(clampOffset(dragRef.current.origX + dx, dragRef.current.origY + dy));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }
  };

  const handleZoomChange = (nextZoom: number) => {
    setZoom(nextZoom);
    setOffset((prev) => clampOffset(prev.x, prev.y, nextZoom, rotation));
  };

  const handleRotate = () => {
    const nextRot = (rotation + 90) % 360;
    setRotation(nextRot);
    setOffset((prev) => clampOffset(prev.x, prev.y, zoom, nextRot));
  };

  const handleConfirm = async () => {
    const imgEl = imgRef.current;
    if (!imgEl || !natSize.w || !natSize.h) return;
    setSaving(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const ratio = OUTPUT_SIZE / VIEWPORT_SIZE;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

      ctx.save();
      ctx.translate(OUTPUT_SIZE / 2 + offset.x * ratio, OUTPUT_SIZE / 2 + offset.y * ratio);
      ctx.scale(effectiveScale * ratio, effectiveScale * ratio);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(imgEl, -natSize.w / 2, -natSize.h / 2, natSize.w, natSize.h);
      ctx.restore();

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.88),
      );
      if (blob) {
        onConfirm(blob);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="bg-white dark:bg-[#202c33] rounded-2xl max-w-sm w-full shadow-2xl border border-gray-200 dark:border-[#2a3942] overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-[#2a3942] flex items-center justify-between">
          <h3 className="font-semibold text-sm">{title}</h3>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-[#2a3942]"
            aria-label="Cancel crop"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="p-5 flex flex-col items-center gap-4">
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ width: VIEWPORT_SIZE, height: VIEWPORT_SIZE }}
            className="relative overflow-hidden bg-[#111b21] rounded-xl cursor-grab active:cursor-grabbing select-none touch-none"
          >
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Crop preview"
              draggable={false}
              onLoad={(e) => {
                const target = e.currentTarget;
                setNatSize({ w: target.naturalWidth, h: target.naturalHeight });
              }}
              style={{
                width: natSize.w || 'auto',
                height: natSize.h || 'auto',
                maxWidth: 'none',
                position: 'absolute',
                left: '50%',
                top: '50%',
                marginLeft: natSize.w ? -natSize.w / 2 : 0,
                marginTop: natSize.h ? -natSize.h / 2 : 0,
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${effectiveScale}) rotate(${rotation}deg)`,
                transformOrigin: 'center center',
              }}
            />
            <div
              className={`pointer-events-none absolute inset-0 border-2 border-white/80 ${
                shape === 'circle' ? 'rounded-full' : 'rounded-2xl'
              }`}
              style={{ boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)' }}
            />
          </div>

          <p className="text-[11px] text-[#667781] dark:text-[#8696a0]">
            Drag image to reposition
          </p>

          <div className="w-full flex items-center gap-2.5">
            <ZoomOut className="w-4 h-4 text-[#667781] shrink-0" />
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
              className="flex-1 accent-[#00A884]"
              aria-label="Zoom"
            />
            <ZoomIn className="w-4 h-4 text-[#667781] shrink-0" />
            <button
              type="button"
              onClick={handleRotate}
              className="p-2 rounded-lg border border-gray-200 dark:border-[#2a3942] hover:bg-gray-100 dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#aebac1]"
              title="Rotate 90°"
            >
              <RotateCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-200 dark:border-[#2a3942] flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs font-semibold hover:bg-gray-100 dark:hover:bg-[#2a3942]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !natSize.w}
            onClick={() => void handleConfirm()}
            className="px-4 py-2 rounded-xl bg-[#00A884] hover:bg-[#008f6f] text-white text-xs font-semibold disabled:opacity-50"
          >
            {saving ? 'Processing...' : 'Apply & Save'}
          </button>
        </div>
      </div>
    </div>
  );
};
