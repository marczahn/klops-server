// Those interfaces are only used for external usage. For internal usage there is another one.
export type Listener = (state: GameState, event: string) => void

export interface GameState {
  id: string
  owner: string
  cols: number
  name: string
  rows: number
  status: GameStatus
  matrix: Matrix
  blockCount: number
  nextBlock?: Block
  activeBlock?: Block
  lineCount?: number
  players: PlayerState[]
  currentPlayer: number // Index of players
  level: number
  stepCount: number // is the amount of steps that have been done so far (movements, rotates, etc.)
}

export interface GameParticipant {
  id: string
  name: string
  points: number
}

export interface GameHandle {
  getState: () => GameState
  moveLeft: () => void
  moveRight: () => void
  moveDown: () => void
  rotate: () => void
  start: () => void
  stop: () => void
  addListener: (l: Listener) => void
  addPlayer: (p: string) => void
  removePlayer: (p: string) => void
  configure: (c: GameConfig) => void
  isCurrentPlayer: (playerId: string) => boolean
}

export type Matrix = number[][]

export interface Vector {
  x: number
  y: number
}

export interface Block {
  zero: Vector
  vectors: Vector[]
  degrees: number
}

export interface PlayerState {
  playerId: string
  points: number
}

export interface GameConfig {
  cols: number,
  rows: number,
  name: string
}

export const emptyField = 0
export const emptyId = '00000000-0000-0000-0000-000000000000'

export enum Action {
  down = 'down',
  left = 'left',
  right = 'right',
  rotate = 'rotate',
}

export const levelThreshold = 10

export enum GameStatus {
  statusWaiting = 'waiting',
  statusRunning = 'running',
  statusEnded = 'ended',
  statusStopping = 'stopping',
  statusPaused = 'paused',
}

export enum GameEvents {
  started = 'started',
  looped = 'looped',
  blockCreated = 'blockCreated',
  linesCompleted = 'linesCompleted',
  statusChanged = 'statusChanged',
  roundDone = 'roundDone',
  stopped = 'stopped',
  nextBlockCreated = 'nextBlockCreated',
  playerAdded = 'playerAdded',
  playerRemoved = 'playerRemoved',
  configUpdated = 'configUpdated',
}
