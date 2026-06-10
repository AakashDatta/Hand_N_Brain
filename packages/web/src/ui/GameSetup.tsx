import { useState } from 'react';
import type { Color } from '@hnb/core';
import {
  GAME_MODES,
  buildConfig,
  type GameConfig,
  type GameMode,
} from '../game/seats';
import { MAX_DIFFICULTY, MIN_DIFFICULTY } from '../ai/uci';

/**
 * Pre-game setup: pick a local mode (a preset over the seat model), your
 * color, and the AI difficulty — or head to online play. Hot-seat needs
 * neither color nor difficulty.
 */
export function GameSetup({
  onStart,
  onPlayOnline,
}: {
  onStart: (config: GameConfig) => void;
  onPlayOnline: () => void;
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

      <div className="setup__online">
        <h2 className="setup__heading">Play online</h2>
        <p className="panel__hint">
          Queue as Hand, Brain, or either; the server forms 2v2 teams.
        </p>
        <button type="button" className="primary-button" onClick={onPlayOnline}>
          Go online
        </button>
      </div>
    </div>
  );
}
