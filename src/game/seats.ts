/**
 * The seat model: every game has four seats — a Brain and a Hand per color —
 * and each seat is controlled by a human or by the AI. All game modes are
 * just seat configurations, so a single orchestrator covers "hot-seat",
 * "vs AI", "AI Brain teammate", and "AI Hand teammate".
 */
import { Phase, Role, type Color, type GameSnapshot } from '../engine';

export type SeatController = 'human' | 'ai';

export interface TeamSeats {
  brain: SeatController;
  hand: SeatController;
}

export interface GameConfig {
  seats: Record<Color, TeamSeats>;
  /** Difficulty (1–8) applied to every AI seat. */
  difficulty: number;
}

/** The selectable game modes, each a preset over the seat model. */
export type GameMode = 'hotseat' | 'vs-ai' | 'ai-brain' | 'ai-hand';

export const GAME_MODES: { id: GameMode; label: string; description: string }[] = [
  {
    id: 'hotseat',
    label: 'Hot-seat',
    description: 'All four roles played by humans passing the device.',
  },
  {
    id: 'vs-ai',
    label: 'You vs AI',
    description: 'You play both Brain and Hand against a Stockfish team.',
  },
  {
    id: 'ai-brain',
    label: 'AI Brain teammate',
    description:
      'Stockfish announces a piece type; you choose which piece and where. You may diverge from its exact idea.',
  },
  {
    id: 'ai-hand',
    label: 'AI Hand teammate',
    description:
      'You name the piece type; Stockfish plays the best move of that type.',
  },
];

const HUMAN_TEAM: TeamSeats = { brain: 'human', hand: 'human' };
const AI_TEAM: TeamSeats = { brain: 'ai', hand: 'ai' };

/** Build the seat configuration for a mode preset. */
export function buildConfig(
  mode: GameMode,
  humanColor: Color,
  difficulty: number,
): GameConfig {
  const opponent: Color = humanColor === 'w' ? 'b' : 'w';
  const seats = { w: HUMAN_TEAM, b: HUMAN_TEAM } as Record<Color, TeamSeats>;

  switch (mode) {
    case 'hotseat':
      break;
    case 'vs-ai':
      seats[humanColor] = HUMAN_TEAM;
      seats[opponent] = AI_TEAM;
      break;
    case 'ai-brain':
      seats[humanColor] = { brain: 'ai', hand: 'human' };
      seats[opponent] = AI_TEAM;
      break;
    case 'ai-hand':
      seats[humanColor] = { brain: 'human', hand: 'ai' };
      seats[opponent] = AI_TEAM;
      break;
  }

  return { seats, difficulty };
}

export interface Actor {
  color: Color;
  role: Role;
  controller: SeatController;
}

/**
 * Who must act next, given the protocol state: the side to move's Brain in
 * AWAITING_BRAIN, its Hand in AWAITING_HAND, nobody once the game is over.
 */
export function actorFor(snapshot: GameSnapshot, config: GameConfig): Actor | null {
  if (snapshot.phase === Phase.GameOver) return null;

  const team = config.seats[snapshot.turn];
  if (snapshot.phase === Phase.AwaitingBrain) {
    return { color: snapshot.turn, role: Role.Brain, controller: team.brain };
  }
  return { color: snapshot.turn, role: Role.Hand, controller: team.hand };
}

/** True if any seat in the game is AI-controlled. */
export function hasAiSeat(config: GameConfig): boolean {
  const seats = [config.seats.w, config.seats.b];
  return seats.some((team) => team.brain === 'ai' || team.hand === 'ai');
}

/**
 * The color the board should orient toward. With AI in the game, orient to
 * the team with a human; in all-human hot-seat there is no fixed perspective,
 * so the caller should orient to the side to move instead (signalled by null).
 */
export function humanPerspective(config: GameConfig): Color | null {
  if (!hasAiSeat(config)) return null;

  const colors: Color[] = ['w', 'b'];
  for (const color of colors) {
    const team = config.seats[color];
    if (team.brain === 'human' || team.hand === 'human') {
      return color;
    }
  }
  // Fully AI vs AI (not reachable from the mode presets): default to white.
  return 'w';
}
