import { useState } from 'react';
import type { Color } from '../engine';
import {
  GAME_MODES,
  buildConfig,
  type GameConfig,
  type GameMode,
} from '../game/seats';
import { MAX_DIFFICULTY, MIN_DIFFICULTY } from '../ai/uci';

/**
 * Pre-game setup: pick a mode (a preset over the seat model), your color,
 * and the AI difficulty. Hot-seat needs neither color nor difficulty.
 */
export function GameSetup({
  onStart,
}: {
  onStart: (config: GameConfig) => void;
}) {
  const [mode, setMode] = useState<GameMode>('hotseat');
  const [color, setColor] = useState<Color>('w');
  const [difficulty, setDifficulty] = useState(3);

  const involvesAi = mode !== 'hotseat';

  return (
    <div className="setup">
      <h2 className="setup__heading">New game</h2>

      <div className="mode-grid">
        {GAME_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`mode-card${mode === m.id ? ' mode-card--active' : ''}`}
            onClick={() => setMode(m.id)}
          >
            <span className="mode-card__label">{m.label}</span>
            <span className="mode-card__description">{m.description}</span>
          </button>
        ))}
      </div>

      {involvesAi && (
        <div className="setup__options">
          <fieldset className="setup__field">
            <legend>Your team plays</legend>
            <label>
              <input
                type="radio"
                name="color"
                checked={color === 'w'}
                onChange={() => setColor('w')}
              />
              White
            </label>
            <label>
              <input
                type="radio"
                name="color"
                checked={color === 'b'}
                onChange={() => setColor('b')}
              />
              Black
            </label>
          </fieldset>

          <label className="setup__field setup__slider">
            AI difficulty: <strong>{difficulty}</strong> / {MAX_DIFFICULTY}
            <input
              type="range"
              min={MIN_DIFFICULTY}
              max={MAX_DIFFICULTY}
              value={difficulty}
              onChange={(e) => setDifficulty(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      <button
        type="button"
        className="primary-button"
        onClick={() => onStart(buildConfig(mode, color, difficulty))}
      >
        Start game
      </button>
    </div>
  );
}
