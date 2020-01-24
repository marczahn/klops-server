// Those interfaces are only used for external usage. For internal usage there is another one.
export type Listener = (state: GameState, event: string) => void

export interface GameState {
    id: string
    owner: string
    cols: number
    name: string
    rows: number
    status: string
    matrix: Matrix
    blockCount: number
    nextBlock?: Block
    activeBlock?: Block
    lineCount?: number
    players: Record<string, PlayerState>
    currentPlayer: string
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
    points: number
}

export interface GameConfig {
    cols: number,
    rows: number,
    name: string
}
