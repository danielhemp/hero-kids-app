/**
 * One mini on the board.
 *
 * Drawn the way the paper ones look on a printed map: a base sitting inside its
 * square with the figure standing up out of it, overlapping the squares behind.
 * That overlap is deliberate — a token scaled to fit entirely inside one cell is
 * too small for a six-year-old to pick out across a table.
 */
import { memo } from 'react';
import type { Health, Token } from '../types.ts';
import type { CellSize } from './geometry.ts';

interface Props {
  token: Token;
  art?: string;
  cell: CellSize;
  x: number;
  y: number;
  selected: boolean;
  dragging: boolean;
  onPointerDown: (event: React.PointerEvent) => void;
}

const HEALTH_PIPS: Record<Health, number> = { 0: 0, 1: 1, 2: 2, 3: 3 };

function StandeeImpl({ token, art, cell, x, y, selected, dragging, onPointerDown }: Props) {
  const figureHeight = cell.height * 1.75;
  const baseHeight = cell.height * 0.32;
  const ko = token.health === 3;

  return (
    <div
      className={[
        'standee',
        `standee--${token.side}`,
        selected ? 'is-selected' : '',
        dragging ? 'is-dragging' : '',
        ko ? 'is-ko' : '',
        token.hidden ? 'is-hidden' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        left: x,
        top: y,
        width: cell.width,
        height: cell.height,
        // Tokens further down the map overlap the ones behind them, as physical
        // standees do.
        zIndex: dragging ? 10_000 : Math.round(y),
      }}
      onPointerDown={onPointerDown}
    >
      <div className="standee__base" style={{ height: baseHeight }} />

      <div
        className="standee__figure"
        style={{ height: figureHeight, bottom: baseHeight * 0.42 }}
      >
        {art ? (
          <img src={art} alt="" draggable={false} />
        ) : (
          <span className="standee__initials">{initials(token.name)}</span>
        )}
      </div>

      {token.health > 0 && (
        <div className="standee__health" title={ko ? "KO'd" : `${token.health} damage`}>
          {ko ? (
            <span className="standee__ko">✕</span>
          ) : (
            Array.from({ length: HEALTH_PIPS[token.health] }, (_, i) => (
              <i key={i} className="standee__pip" />
            ))
          )}
        </div>
      )}

      {token.hidden && <div className="standee__hiddenMark" title="Not shown to the players">👁</div>}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export const Standee = memo(StandeeImpl);
