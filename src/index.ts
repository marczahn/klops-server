import bodyParser = require('body-parser')
import cors from 'cors'
import express from 'express'
import * as _ from 'lodash'
import * as querystring from 'querystring'
import * as url from 'url'
import v4 from 'uuid/v4'
import * as WebSocket from 'ws'
import { AddressInfo, MessageEvent } from 'ws'
import { GameConfig, GameHandle, GameParticipant, GameState } from './models/game'
import { names } from './models/names'
import { error, ok, wsNotFound, wsUnauthorized } from './models/ws'
import { createGameHandle, looped } from './services/game/game'

interface DisassembledMessage {
    command: string
    id: string
    data: string
}

const app = express()
const port = 8080 // default port to listen

// start the express server
const server = app.listen(port, () => {
    // tslint:disable-next-line:no-console
    console.log(`server started at http://localhost:${ port }`)
})

const options: cors.CorsOptions = {
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'X-Access-Token'],
    credentials: true,
    methods: 'GET,HEAD,OPTIONS,PUT,PATCH,POST,DELETE',
    origin: '*',

    preflightContinue: false
}
app.use(cors(options))
app.use(bodyParser.json())
const listSockets: WebSocket[] = []
const gameSockets: Record<string, WebSocket[]> = {}
const games: Record<string, GameHandle> = {}
const players: Record<string, string> = {}

app.post('/auth', (req, res) => {
    const { token } = req.body
    if (token && players[ token ]) {
        res.send({ id: token, username: players[ token ] })
        return
    }
    const newToken = v4()
    players[ newToken ] = _.sample<string>(names)
    res.send({ id: newToken, username: players[ newToken ] })
})

const wss = new WebSocket.Server({ server, path: '/ws' })
// init Websocket for games list
wss.on('connection', (ws: WebSocket, req) => {
    const addr = addressToString(req.connection.address())
    const params = querystring.parse(url.parse(req.url).query)
    console.log(`connection from ${ addr } with params`, params)
    let gameId = ''
    if (!params.player) {
        ws.send(assembleMessage('unauthenticated', null))
        ws.close(wsUnauthorized)
        return
    }
    const playerId = params.player.toString()

    ws.onmessage = (e: MessageEvent) => {
        let command: string
        let commandId: string = '00000000-0000-0000-0000-000000000000'
        let data: string
        try {
            const disassembled = disassembleMessage(e.data)
            command = disassembled.command
            commandId = disassembled.id
            data = disassembled.data
        } catch (e) {
            respond(ws, `response_${ commandId }`, error, null, [e])
            // To signal that something severe happened
            ws.close()
            return
        }
        console.log('Incomming command on game ' + gameId + ': ' + command)
        switch (command) {
            case 'create_game':
                createGame(ws, commandId, playerId)
                break
            case 'move_left':
                handleInput(playerId, gameId, 'left')
                break
            case 'move_right':
                handleInput(playerId, gameId, 'right')
                break
            case 'move_down':
                handleInput(playerId, gameId, 'down')
                break
            case 'rotate':
                handleInput(playerId, gameId, 'rotate')
                break
            case 'start_game':
                startGame(ws, commandId, playerId, gameId)
                break
            case 'enter_game':
                gameId = enterGame(ws, commandId, playerId, data)
                break
            case 'cancel_game':
                cancelGame(ws, commandId, playerId, gameId)
                break
            case 'leave_game':
                leaveGame(ws, commandId, playerId, gameId)
                break
            case 'change_config':
                configGame(ws, commandId, playerId, gameId, data)
                break
            case 'send_state':
                sendState(ws, commandId, gameId)
                break
            case 'send_games':
                sendGames(ws, commandId)
                break
            case 'signup':
                signup(ws, commandId, data)
                break
            case 'load_user':
                loadUser(ws, commandId, data)
                break
            case 'send_participants':
                sendParticipants(ws, commandId, gameId)
                break
            default:
                respond(ws, commandId, error, null, [`command ${ command } for command id ${ commandId } not found`])
        }
    }
    ws.onclose = () => {
        console.log('connection from ' + addr + ' closed')
        const game = loadGame(gameId)
        if (!game) {
            return
        }
        releaseGameSocket(ws)
        game.removePlayer(playerId)
    }
})

const broadcastParticipants = (gameId: string) => {
    try {
        broadcastToGame(gameId, 'participant_list', getParticipants(gameId))
    } catch (e) {
        broadcastToGame(gameId, 'game_not_found', gameId)
        return
    }
}

const sendParticipants = (ws: WebSocket, commandId: string, gameId: string) => {
    try {
        respond(ws, commandId, ok, getParticipants(gameId))
    } catch (e) {
        broadcastToGame(gameId, 'game_not_found', gameId)
        return
    }
}

const handleInput = (playerId: string, gameId: string, dir: string) => {
    const game = loadGame(gameId)
    if (!game) {
        console.log('Game not found')
        return
    }
    if (game.getState().currentPlayer !== playerId) {
        console.log(`It is not play ${playerId}'s turn`)
    }
    switch (dir) {
        case 'left':
            game.moveLeft()
            break
        case 'right':
            game.moveRight()
            break
        case 'down':
            game.moveDown()
            break
        case 'rotate':
            game.rotate()
            break
    }
}

const enterGame = (ws: WebSocket, commandId: string, playerId: string, data: string): string => {
    const gameId: string = JSON.parse(data)
    console.log('Enter game ' + gameId)
    const game = loadGame(gameId)
    if (!game) {
        console.log('Game not found')
        respond(ws, commandId, error, gameId)
        return
    }

    releaseGameSocket(ws)
    addGameSocket(gameId, ws)
    game.addPlayer(playerId)
    respond(ws, commandId, ok, gameId)
    return gameId
}

const getParticipants = (gameId: string): GameParticipant[] => {
    const state = loadGame(gameId).getState()
    const out: GameParticipant[] = []
    for (const id of Object.keys(state.players)) {
        out.push({ id, name: players[ id ], points: state.players[ id ].points })
    }
    return out
}

const loadUser = (ws: WebSocket, commandId: string, data: string) => {
    const pid = parseData<string>(data).trim()
    if (!players[ pid ]) {
        respond(ws, commandId, error, null, ['User not found'])
        return
    }
    respond(ws, commandId, ok, { id: pid, name })
}

const signup = (ws: WebSocket, commandId: string, data: string) => {
    const name = parseData<string>(data).trim()
    if (name === '') {
        respond(ws, commandId, error, null, ['name may not be empty'])
        return
    }
    const lowerCased = name.toLowerCase()
    if (Object.values(players).find((p) => p.toLowerCase() === lowerCased)) {
        respond(ws, commandId, error, null, ['name already in use'])
        return
    }
    const pid = v4()
    players[ pid ] = name
    respond(ws, commandId, ok, { id: pid, name }, null)
}

const parseData = <T>(data: string): T => JSON.parse(data)

const leaveGame = (ws: WebSocket, commandId: string, playerId: string, gameId: string) => {
    const game = loadGame(gameId)
    if (!game) {
        respond(ws, commandId, error, null, ['Game not found'])
        return
    }
    releaseGameSocket(ws)
    game.removePlayer(playerId)
    respond(ws, commandId, ok)
}

const cancelGame = (ws: WebSocket, commandId: string, playerId: string, gameId: string) => {
    const game = loadGame(gameId)
    if (!game) {
        respond(ws, commandId, error, null, ['Game not found'])
        return
    }
    if (playerId !== game.getState().owner) {
        return
    }
    game.stop()
    respond(ws, commandId, ok)
}

const startGame = (ws: WebSocket, commandId: string, playerId: string, gameId: string) => {
    const game = loadGame(gameId)
    if (!game) {
        respond(ws, commandId, error, null, ['Game not found'])
        return
    }
    if (playerId !== game.getState().owner) {
        return
    }
    game.start()
    respond(ws, commandId, ok)
}

const broadcaseGames = () => {
    broadcast(wss, 'games_list', Object.values(games).map((g) => g.getState()))
}

const sendGames = (ws: WebSocket, commandId: string) => {
    respond(ws, commandId, ok, Object.values(games).map((g) => g.getState()))
}

const createGame = (ws: WebSocket, commandId: string, playerId: string) => {
    const game = createGameHandle(playerId)
    game.addListener(gameListener(ws, playerId))
    storeGame(game)
    respond(ws, commandId, ok, game.getState())
    broadcaseGames()
}

const gameListener = (ws: WebSocket, playerId: string): ( (state: GameState, event: string) => void ) => {
    return (state: GameState, event: string) => {
        console.log('Incoming event from game ' + state.id + ': ' + event)
        switch (event) {
            case 'config_updated':
                broadcastToGame(state.id, 'config_updated', state)
                broadcaseGames()
                break
            case 'player_added':
                broadcastToGame(state.id, 'participant_added', state)
                broadcastParticipants(state.id)
                broadcaseGames()
                break
            case 'player_removed':
                broadcastToGame(state.id, 'participant_left', state)
                broadcaseGames()
                break
            case 'stopped':
                broadcastToGame(state.id, 'game_canceled', null)
                if (games[ state.id ]) {
                    delete games[ state.id ]
                }
                if (gameSockets[ state.id ]) {
                    gameSockets[ state.id ].forEach((webSocket: WebSocket) => releaseGameSocket(webSocket))
                    delete gameSockets[ state.id ]
                }
                broadcaseGames()
                break
            case 'started':
                broadcastToGame(state.id, 'game_started', state)
                broadcaseGames()
                break
            case looped:
                broadcastToGame(state.id, 'game_looped', state)
                break
        }
    }
}

const storeGame = (game: GameHandle) => {
    games[ game.getState().id ] = game
}

const sendState = (ws: WebSocket, commandId: string, gameId: string) => {
    if (gameId === '') {
        return
    }
    const game = loadGame(gameId)
    if (game) {
        respond(ws, commandId, ok, game.getState())
    }
}

const configGame = (ws: WebSocket, commandId: string, playerId: string, gameId: string, data: string) => {
    const config = parseData<GameConfig>(data)
    const game = loadGame(gameId)
    if (!game) {
        return
    }
    if (playerId !== game.getState().owner) {
        respond(ws, commandId, error, null, ['config_changes_are_only_allowed_to_the_owner'])
        return
    }
    game.configure(config)
    storeGame(game)
    respond(ws, commandId, ok)
}

const addressToString = (addr: AddressInfo | string): string => {
    return typeof addr === 'string' ? addr : addr.address
}

// Message format is <event>@<data in json format>
const broadcast = (bwss: WebSocket.Server, event: string, msg: any) => {
    bwss.clients.forEach((client) => client.send(assembleMessage(event, msg)))
}

const respond = (ws: WebSocket, commandId: string, status: 'ok' | 'error', data?: any, errors?: string[]) => {
    ws.send(assembleResponse(commandId, status, data, errors))
}

// Message format is <event>@<data in json format>
const broadcastToGame = (id: string, event: string, msg: any) => {
    if (gameSockets[ id ]) {
        gameSockets[ id ].forEach((client) => client.send(assembleMessage(event, msg)))
    }
}

const assembleResponse = (commandId: string, status: 'ok' | 'error', data?: any, errors?: string[]): string => {
    const serialized = JSON.stringify({ status, data, errors })

    return `response_${ commandId }@${ serialized }`
}

const assembleMessage = (event: string, data: any) => {
    const serialized = JSON.stringify(data)
    return event + '@' + serialized
}

const disassembleMessage = (data: WebSocket.Data): DisassembledMessage => {
    const resolved = data.toString().split(/\@(.+)/)
    if (resolved.length < 2) {
        throw Error('Invalid message format')
    }
    const cmd = resolved[ 0 ].split(':')
    if (cmd.length < 2) {
        throw Error('Invalid message command prefix')
    }
    const [command, id] = cmd
    return { command, id, data: resolved[ 1 ] }
}

const addGameSocket = (gameId: string, ws: WebSocket) => {
    if (!gameSockets[ gameId ]) {
        gameSockets[ gameId ] = []
    }

    gameSockets[ gameId ].push(ws)
}

const loadGame = (gameId: string): GameHandle | null => {
    return games[ gameId ] || null
}

const releaseGameSocket = (ws: WebSocket) => {
    Object.values(gameSockets).forEach((game) => game.filter((existingWs) => existingWs !== ws))
}
