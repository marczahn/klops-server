import v4 from 'uuid/v4'
import { Block, GameConfig, GameHandle, GameState, Listener, Matrix, Vector } from '../../models/game'
import { cloneDeep } from '../clone'
import { blockVectorFactory } from './blocks'

type getStateFn = () => InternalGameState
type setStateFn = (state: InternalGameState) => void

const emptyField = 0

const DOWN = 'down'
const LEFT = 'left'
const RIGHT = 'right'
const ROTATE = 'rotate'
const LEVEL_THRESHOLD = 10

export const statusWaiting = 'waiting'
export const statusRunning = 'running'
export const statusEnded = 'ended'
export const statusPaused = 'paused'

export const looped = 'looped'
export const blockCreated = 'blockCreated'
export const linesCompleted = 'linesCompleted'
export const statusChanged = 'statusChanged'

interface InternalGameState {
    state: GameState
    userQueue: string[]
    loopInterval?: NodeJS.Timeout
    listeners: Listener[]
    blockFactory: (zero: Vector) => Block
    lastMoveTime: number
}

export const createGameHandle = (owner: string): GameHandle => {
    let state: InternalGameState = {
        state: createGameState(owner),
        listeners: [],
        userQueue: [],
        blockFactory: blockVectorFactory(),
        lastMoveTime: new Date().getTime()
    }
    const setState = (newState: InternalGameState) => {
        state = newState
    }
    const getState = (): InternalGameState => state

    const handle: GameHandle = {
        getState: () => state.state,
        moveDown: () => {
            state.userQueue.push(DOWN)
        },
        moveLeft: () => {
            state.userQueue.push(LEFT)
        },
        moveRight: () => {
            state.userQueue.push(RIGHT)
        },
        rotate: () => {
            state.userQueue.push(ROTATE)
        },
        start: () => {
            state = start(getState, setState)
            publish(state, 'started')
        },
        stop: () => {
            state = stop(state)
            publish(state, 'stopped')
        },
        addListener: (l: Listener) => {
            state.listeners.push(l)
        },
        addPlayer: (p: string) => {
            if (state.state.status !== statusWaiting) {
                return
            }
            if (state.state.players[ p ]) {
                return
            }
            state.state.players[ p ] = { points: 0 }
            publish(state, 'player_added')
        },
        removePlayer: (p: string) => {
            if (state.state.players[ p ]) {
                delete state.state.players[ p ]
                publish(state, 'player_removed')
            }
        },
        configure: (c: GameConfig) => {
            if (state.state.status !== statusWaiting) {
                return
            }
            state.state.cols = c.cols
            state.state.rows = c.rows
            state.state.name = c.name
            publish(state, 'config_updated')
        }
    }
    return handle
}

const createGameState = (owner: string): GameState => {
    return {
        owner,
        cols: 10,
        id: v4(),
        name: 'New Game',
        rows: 20,
        status: statusWaiting,
        blockCount: 0,
        level: 0,
        lineCount: 0,
        stepCount: 0,
        matrix: [],
        players: {},
        currentPlayer: '',
    }
}

const start = (getState: getStateFn, setState: setStateFn): InternalGameState => {
    const out = cloneDeep<InternalGameState>(getState())
    out.state.matrix = createMatrix(out.state.cols, out.state.rows)
    out.loopInterval = setInterval(loop, 10, getState, setState)
    out.state.status = statusRunning
    out.state.activeBlock = createBlock(out.state.cols, out.blockFactory)
    out.state.nextBlock = createBlock(out.state.cols, out.blockFactory)
    return out
}

const loop = (getState: getStateFn, setState: setStateFn) => {
    let out = cloneDeep(getState())
    if (out.userQueue.length > 0) {
        while (true) {
            const action = out.userQueue.shift()
            if (!action) {
                break
            }
            switch (action) {
                case ROTATE:
                    out = rotate(out)
                    break
                case LEFT:
                case RIGHT:
                case DOWN:
                    out = move(out, action)
                    break
            }
        }
        publish(out, looped)
        setState(out)
        return
    }
    // Go on after level dependent delay
    const now = ( new Date() ).getTime()
    if (now > out.lastMoveTime + 200) {
        out.lastMoveTime = now
        setState(move(out, DOWN))
        publish(out, looped)
    }
}

const stop = (state: InternalGameState): InternalGameState => {
    clearInterval(state.loopInterval)
    console.log('Game stopped')
    const out = cloneDeep<InternalGameState>(state)
    out.state = Object.assign(out.state, { status: statusEnded })
    publish(out, statusChanged)
    return out
}

const move = (state: InternalGameState, direction: string): InternalGameState => {
    if (state.state.status !== statusRunning) {
        return state
    }
    const out = cloneDeep<InternalGameState>(state)
    out.state.stepCount++
    if (out.state.activeBlock === undefined) {
        return initNextBlock(out)
    }
    const checkBlock = cloneDeep<Block>(out.state.activeBlock)
    // Erase the active block so that we can reliably check if the new place is free
    out.state.matrix = eraseBlock(out.state.matrix, out.state.activeBlock)
    switch (direction) {
        case DOWN:
            checkBlock.zero.y++
            // TODO - check additionally to isBlocke if lowest point of block reached
            //  the last line to skip the "invisible" step
            if (isBlocked(out.state.matrix, checkBlock)) {
                out.state.matrix = drawBlock(out.state.matrix, out.state.activeBlock)
                out.state.activeBlock = undefined

                return updateLines(out)
            }
            out.state.activeBlock.zero.y++
            break
        case RIGHT:
        case LEFT:
            checkBlock.zero.x += ( direction === LEFT ? -1 : 1 )
            if (isBlocked(out.state.matrix, checkBlock)) {
                out.state.matrix = drawBlock(out.state.matrix, out.state.activeBlock)

                return out
            }
            out.state.matrix = eraseBlock(out.state.matrix, out.state.activeBlock)
            out.state.activeBlock.zero.x += ( direction === LEFT ? -1 : 1 )
            break
    }
    out.state.matrix = drawBlock(out.state.matrix, out.state.activeBlock)

    return out
}

const initNextBlock = (state: InternalGameState): InternalGameState => {
    const out = cloneDeep<InternalGameState>(state)
    out.state.activeBlock = out.state.nextBlock
    out.state.nextBlock = createBlock(out.state.cols, state.blockFactory)
    out.state.blockCount++
    const blocked = isBlocked(out.state.matrix, out.state.activeBlock)
    out.state.matrix = drawBlock(out.state.matrix, out.state.activeBlock)
    publish(out, blockCreated)
    if (blocked) {
        return stop(out)
    }

    return out
}

const publish = (state: InternalGameState, event: string) => {
    state.listeners.forEach((l) => l(state.state, event))
}

const updateLines = (state: InternalGameState): InternalGameState => {
    const foundLines: number[] = state.state.matrix.reduce(
        ( (acc: number[], row: number[], i: number) => {
            const lineComplete: boolean = row.reduce((accL: boolean, cell: number) => accL && cell !== emptyField, true)
            if (lineComplete) {
                acc.push(i)
            }
            return acc
        } ),
        [],
    )
    if (foundLines.length === 0) {
        return state
    }
    const out = cloneDeep<InternalGameState>(state)
    out.state.lineCount += foundLines.length
    out.state.level = Math.floor(out.state.lineCount / LEVEL_THRESHOLD)
    out.state.players[ out.state.currentPlayer ].points += calculatePoints(foundLines.length, out.state.level)
    publish(out, linesCompleted)

    out.state.matrix = dropLinesFromMatrix(out.state.matrix, foundLines)
    return out
}

const dropLinesFromMatrix = (matrix: Matrix, foundLines: number[]): number[][] => {
    const newMatrix = createMatrix(matrix[ 0 ].length, foundLines.length)
    for (const row in matrix) {
        if (foundLines.includes(parseInt(row, 10))) {
            continue
        }
        newMatrix.push(matrix[ row ])
    }
    return newMatrix
}

const calculatePoints = (foundLines: number, level: number): number => {
    let basePoints = 0
    switch (foundLines) {
        case 1:
            basePoints = 40
            break
        case 2:
            basePoints = 100
            break
        case 3:
            basePoints = 300
            break
        case 4:
            basePoints = 1200
            break
        default:
            // Not more points for now
            basePoints = 1500
            break
    }
    return basePoints * ( level + 1 )
}

const rotate = (state: InternalGameState): InternalGameState => {
    if (!state.state.activeBlock || state.state.status !== statusRunning) {
        return state
    }
    const out = cloneDeep(state)
    out.state.stepCount++
    const rotatedBlock = rotateBlockClockwise(state.state.activeBlock)
    eraseBlock(out.state.matrix, out.state.activeBlock)
    if (isBlocked(out.state.matrix, rotatedBlock)) {
        drawBlock(out.state.matrix, state.state.activeBlock)
        return state
    }
    out.state.activeBlock = rotatedBlock
    drawBlock(out.state.matrix, rotatedBlock)

    return out
}

export const rotateBlockClockwise = (block: Block): Block => {
    const maxYIndex = block.vectors.reduce((acc: number, v: Vector): number => v.y > acc ? v.y : acc, 0)
    const maxXIndex = block.vectors.reduce((acc: number, v: Vector): number => v.x > acc ? v.x : acc, 0)
    const vectors = block.vectors.map((v: Vector): Vector => ( { x: maxYIndex - v.y, y: v.x } ))

    const maxNewYIndex = vectors.reduce((acc: number, v: Vector): number => v.y > acc ? v.y : acc, 0)
    const maxNewXIndex = vectors.reduce((acc: number, v: Vector): number => v.x > acc ? v.x : acc, 0)

    // If we would use either floor or ceil only all the time
    // elements with a even number of fields would "move" to the left.
    // That way we use floor/ceil each 50/50
    const roundFn = block.degrees % 180 === 0 ? Math.ceil : Math.floor
    const xDistance = roundFn(( maxNewXIndex - maxXIndex ) / 2)
    const yDistance = roundFn(( maxNewYIndex - maxYIndex ) / 2)

    // We need to reposition zero because blockCount are rotated around
    // there upper right corner and not around their center
    const zero = {
        x: block.zero.x - xDistance,
        y: block.zero.y - yDistance,
    }

    return { degrees: block.degrees + 90, zero, vectors }
}

const isBlocked = (matrix: Matrix, block: Block): boolean => {
    const lastRowIndex = matrix.length - 1
    const lastColIndex = matrix[ 0 ].length - 1

    return toAbsVectors(block).reduce(
        (acc: boolean, v: Vector): boolean => {
            return acc ||
                v.x < 0 ||
                v.y > lastRowIndex ||
                v.x > lastColIndex ||
                ( v.y >= 0 && matrix[ v.y ][ v.x ] !== emptyField )
        },
        false
    )
}

const eraseBlock = (matrix: number[][], block?: Block): number[][] => {
    if (!block) {
        return matrix
    }
    toAbsVectors(block).forEach((v: Vector) => {
        if (v.y >= 0 && v.x >= 0) {
            matrix[ v.y ][ v.x ] = emptyField
        }
    })

    return matrix
}

const drawBlock = (matrix: Matrix, block: Block): number[][] => {
    toAbsVectors(block).forEach((v: Vector) => {
        if (v.y >= 0 && v.x >= 0) {
            matrix[ v.y ][ v.x ] = 1
        }
    })

    return matrix
}

const createBlock = (cols: number, blockFactory: (zero: Vector) => Block): Block => {
    return blockFactory({ x: Math.floor(cols / 2), y: 0 })
}

export const createMatrix = (cols: number, rows: number): number[][] => {
    const out: number[][] = []
    for (let y = 0; y < rows; y++) {
        const row: number[] = []
        for (let x = 0; x < cols; x++) {
            row.push(emptyField)
        }
        out.push(row)
    }

    return out
}

const toAbsVectors = (block: Block): Vector[] => {
    return block.vectors.map((v: Vector): Vector => {
        return { x: block.zero.x + v.x, y: block.zero.y + v.y }
    })
}
