/**
 * Grid maths.
 *
 * Everything on the board is stored in grid squares, never pixels — a token is
 * at column 3, row 5, the way a cardboard mini sits on a printed square. Pixels
 * only appear when drawing, so recalibrating a map's grid moves every token to
 * the right place automatically instead of leaving them scattered.
 */
import type { Grid, MapAsset } from '../types.ts';

export interface CellSize {
  width: number;
  height: number;
}

/**
 * The grid spans the map minus its decorative border, so the cell size falls
 * out of the inset rather than being stored — that way nudging the inset in
 * calibration keeps the columns and rows exactly spanning the play area.
 */
export function cellSize(map: { width: number; height: number; grid: Grid }): CellSize {
  const { grid } = map;
  return {
    width: (map.width - grid.inset.left - grid.inset.right) / grid.cols,
    height: (map.height - grid.inset.top - grid.inset.bottom) / grid.rows,
  };
}

/** Top-left corner of a cell, in map pixels. */
export function cellOrigin(map: MapAsset, col: number, row: number): { x: number; y: number } {
  const cell = cellSize(map);
  return {
    x: map.grid.inset.left + col * cell.width,
    y: map.grid.inset.top + row * cell.height,
  };
}

/** Centre of a cell, in map pixels. */
export function cellCentre(map: MapAsset, col: number, row: number): { x: number; y: number } {
  const cell = cellSize(map);
  const origin = cellOrigin(map, col, row);
  return { x: origin.x + cell.width / 2, y: origin.y + cell.height / 2 };
}

/** Which cell a map-pixel point falls in, clamped to the board. */
export function cellAt(map: MapAsset, x: number, y: number): { col: number; row: number } {
  const cell = cellSize(map);
  const col = Math.floor((x - map.grid.inset.left) / cell.width);
  const row = Math.floor((y - map.grid.inset.top) / cell.height);
  return {
    col: clamp(col, 0, map.grid.cols - 1),
    row: clamp(row, 0, map.grid.rows - 1),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface Viewport {
  x: number;
  y: number;
  k: number;
}

/** Scale and centre so the whole map is visible with a little breathing room. */
export function fitToView(
  map: { width: number; height: number },
  container: { width: number; height: number },
  padding = 16,
): Viewport {
  const available = {
    width: Math.max(1, container.width - padding * 2),
    height: Math.max(1, container.height - padding * 2),
  };
  const k = Math.min(available.width / map.width, available.height / map.height);
  return {
    k,
    x: (container.width - map.width * k) / 2,
    y: (container.height - map.height * k) / 2,
  };
}

/** Screen point -> map pixel. */
export function toMapPoint(view: Viewport, screenX: number, screenY: number) {
  return { x: (screenX - view.x) / view.k, y: (screenY - view.y) / view.k };
}

/**
 * Zoom about a fixed screen point, so pinching keeps the spot between the
 * fingers under the fingers.
 */
export function zoomAbout(view: Viewport, screenX: number, screenY: number, factor: number, limits: [number, number]): Viewport {
  const k = clamp(view.k * factor, limits[0], limits[1]);
  const applied = k / view.k;
  return {
    k,
    x: screenX - (screenX - view.x) * applied,
    y: screenY - (screenY - view.y) * applied,
  };
}

/**
 * The first free cell at or after (col,row), walking left to right and wrapping
 * down a row. Used when staging a roster onto the map and when a token is added
 * mid-fight — two minis never start stacked on the same square.
 */
export function firstFreeCell(
  map: MapAsset,
  taken: Set<string>,
  start: { col: number; row: number },
  direction: 1 | -1 = 1,
): { col: number; row: number } {
  const { cols, rows } = map.grid;
  let { col, row } = start;
  for (let i = 0; i < cols * rows; i++) {
    if (row >= 0 && row < rows && col >= 0 && col < cols && !taken.has(`${col},${row}`)) {
      return { col, row };
    }
    col += 1;
    if (col >= cols) {
      col = 0;
      row += direction;
    }
    if (row < 0) row = rows - 1;
    if (row >= rows) row = 0;
  }
  return start;
}
