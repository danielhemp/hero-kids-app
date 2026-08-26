/**
 * The battle map: pan, pinch-zoom, and drag minis onto squares.
 *
 * All gestures run through Pointer Events on one container. Touch, trackpad and
 * mouse then behave identically, and pointer capture means a finger that slides
 * off a token — or off the screen — still finishes its drag on the right token
 * instead of dropping it somewhere random.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MapAsset, Token } from '../types.ts';
import { Standee } from './Standee.tsx';
import {
  cellAt,
  cellOrigin,
  cellSize,
  clamp,
  fitToView,
  toMapPoint,
  zoomAbout,
  type Viewport,
} from './geometry.ts';

const ZOOM_LIMITS: [number, number] = [0.1, 4];
/** Movement under this many screen pixels counts as a tap, not a drag. */
const TAP_SLOP = 8;

interface Props {
  map: MapAsset;
  mapUrl?: string;
  tokens: Token[];
  artUrls: Record<string, string | undefined>;
  selectedId?: string;
  showGrid: boolean;
  onSelect: (tokenId: string | undefined) => void;
  onMove: (tokenId: string, col: number, row: number) => void;
}

interface DragState {
  pointerId: number;
  tokenId: string;
  startClientX: number;
  startClientY: number;
  dx: number;
  dy: number;
  moved: boolean;
}

export function Board({
  map,
  mapUrl,
  tokens,
  artUrls,
  selectedId,
  showGrid,
  onSelect,
  onMove,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, k: 0.2 });
  const [drag, setDrag] = useState<DragState | null>(null);

  // Pointers currently down for panning/pinching, keyed by pointerId.
  const pan = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; midX: number; midY: number } | null>(null);

  const cell = cellSize(map);

  // Fit whenever the map changes or the container resizes.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const apply = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setView(fitToView(map, rect));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  // Trackpad and mouse wheel zoom, for working on the Mac.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY / 400);
      setView((current) =>
        zoomAbout(current, event.clientX - rect.left, event.clientY - rect.top, factor, ZOOM_LIMITS),
      );
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  const startTokenDrag = useCallback((tokenId: string, event: React.PointerEvent) => {
    event.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    // Capture on the container, not the token: the token re-renders as it moves
    // and a capture held by a replaced element is lost mid-drag.
    container.setPointerCapture(event.pointerId);
    setDrag({
      pointerId: event.pointerId,
      tokenId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      dx: 0,
      dy: 0,
      moved: false,
    });
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    const container = containerRef.current;
    if (!container) return;
    container.setPointerCapture(event.pointerId);
    pan.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pan.current.size === 2) pinch.current = measurePinch();
  };

  function measurePinch() {
    const [a, b] = [...pan.current.values()];
    if (!a || !b) return null;
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (drag && event.pointerId === drag.pointerId) {
      const dx = event.clientX - drag.startClientX;
      const dy = event.clientY - drag.startClientY;
      const moved = drag.moved || Math.hypot(dx, dy) > TAP_SLOP;
      setDrag({ ...drag, dx: dx / view.k, dy: dy / view.k, moved });
      return;
    }

    if (!pan.current.has(event.pointerId)) return;
    const previous = pan.current.get(event.pointerId)!;
    pan.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pan.current.size >= 2) {
      const now = measurePinch();
      const before = pinch.current;
      if (now && before && before.distance > 0) {
        const container = containerRef.current!;
        const rect = container.getBoundingClientRect();
        setView((current) => {
          const zoomed = zoomAbout(
            current,
            now.midX - rect.left,
            now.midY - rect.top,
            now.distance / before.distance,
            ZOOM_LIMITS,
          );
          // Two fingers also drag the map, not just scale it.
          return { ...zoomed, x: zoomed.x + (now.midX - before.midX), y: zoomed.y + (now.midY - before.midY) };
        });
        pinch.current = now;
      }
      return;
    }

    setView((current) => ({
      ...current,
      x: current.x + (event.clientX - previous.x),
      y: current.y + (event.clientY - previous.y),
    }));
  };

  const endPointer = (event: React.PointerEvent) => {
    if (drag && event.pointerId === drag.pointerId) {
      if (drag.moved) {
        const token = tokens.find((t) => t.id === drag.tokenId);
        if (token) {
          // Snap by where the token's own centre landed, which is what the eye
          // is tracking — not where the finger happens to be on it.
          const origin = cellOrigin(map, token.col, token.row);
          const centre = {
            x: origin.x + cell.width / 2 + drag.dx,
            y: origin.y + cell.height / 2 + drag.dy,
          };
          const target = cellAt(map, centre.x, centre.y);
          if (target.col !== token.col || target.row !== token.row) {
            onMove(token.id, target.col, target.row);
          }
        }
      } else {
        onSelect(drag.tokenId === selectedId ? undefined : drag.tokenId);
      }
      setDrag(null);
    }

    pan.current.delete(event.pointerId);
    if (pan.current.size < 2) pinch.current = null;
  };

  const dropTarget = (() => {
    if (!drag?.moved) return null;
    const token = tokens.find((t) => t.id === drag.tokenId);
    if (!token) return null;
    const origin = cellOrigin(map, token.col, token.row);
    return cellAt(map, origin.x + cell.width / 2 + drag.dx, origin.y + cell.height / 2 + drag.dy);
  })();

  return (
    <div
      ref={containerRef}
      className="board"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    >
      <div
        className="board__layer"
        style={{
          width: map.width,
          height: map.height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
        }}
      >
        {mapUrl && <img className="board__map" src={mapUrl} width={map.width} height={map.height} alt="" draggable={false} />}

        {showGrid && (
          <svg className="board__grid" viewBox={`0 0 ${map.width} ${map.height}`} preserveAspectRatio="none">
            {Array.from({ length: map.grid.cols + 1 }, (_, c) => {
              const x = map.grid.inset.left + c * cell.width;
              return <line key={`c${c}`} x1={x} y1={map.grid.inset.top} x2={x} y2={map.height - map.grid.inset.bottom} />;
            })}
            {Array.from({ length: map.grid.rows + 1 }, (_, r) => {
              const y = map.grid.inset.top + r * cell.height;
              return <line key={`r${r}`} x1={map.grid.inset.left} y1={y} x2={map.width - map.grid.inset.right} y2={y} />;
            })}

            {/* The book's own numbered circles, so the GM can see where the
                page put things and check the app agreed. They are drawn rather
                than photographed: the printable map has no numbers on it, which
                is the whole reason they had to be read off the GM's copy. */}
            {(map.markers ?? []).map((marker) => {
              const origin = cellOrigin(map, marker.col, marker.row);
              const cx = origin.x + cell.width / 2;
              const cy = origin.y + cell.height / 2;
              const r = Math.min(cell.width, cell.height) * 0.42;
              return (
                <g key={`${marker.label}-${marker.col}-${marker.row}`} className="board__marker">
                  <circle cx={cx} cy={cy} r={r} />
                  <text x={cx} y={cy} fontSize={r * 1.1}>
                    {marker.label === 'entry' ? '\u2691' : marker.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}

        {dropTarget && (
          <div
            className="board__drop"
            style={{
              left: cellOrigin(map, dropTarget.col, dropTarget.row).x,
              top: cellOrigin(map, dropTarget.col, dropTarget.row).y,
              width: cell.width,
              height: cell.height,
            }}
          />
        )}

        {tokens.map((token) => {
          const origin = cellOrigin(map, token.col, token.row);
          const isDragging = drag?.tokenId === token.id && drag.moved;
          return (
            <Standee
              key={token.id}
              token={token}
              art={token.art ? artUrls[`${token.packId}/${token.art}`] : undefined}
              cell={cell}
              x={origin.x + (isDragging ? drag.dx : 0)}
              y={origin.y + (isDragging ? drag.dy : 0)}
              selected={token.id === selectedId}
              dragging={Boolean(isDragging)}
              onPointerDown={(event) => startTokenDrag(token.id, event)}
            />
          );
        })}
      </div>

      <div className="board__zoom">
        <button type="button" onClick={() => setView((v) => zoomStep(v, containerRef.current, 1.25))} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => setView((v) => zoomStep(v, containerRef.current, 0.8))} aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          onClick={() => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect) setView(fitToView(map, rect));
          }}
        >
          Fit
        </button>
      </div>
    </div>
  );
}

function zoomStep(view: Viewport, container: HTMLDivElement | null, factor: number): Viewport {
  if (!container) return view;
  const rect = container.getBoundingClientRect();
  return zoomAbout(view, rect.width / 2, rect.height / 2, factor, ZOOM_LIMITS);
}

export { toMapPoint, clamp };
