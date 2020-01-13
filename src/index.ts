import express from 'express'
import * as querystring from 'querystring'
import * as url from 'url'
import * as WebSocket from 'ws'
import { AddressInfo, CloseEvent, MessageEvent } from 'ws'
import { GameConfig, GameHandle } from './models/game'
import { createGameHandle } from './services/game/game'

interface DisassembledMessage {
    event: string
    data: string
}

const listSockets: WebSocket[] = []
const gameSockets: Record<string, WebSocket[]> = {}

const games: Record<string, GameHandle> = {}

const app = express()
const port = 8080 // default port to listen

// start the express server
const server = app.listen(port, () => {
    // tslint:disable-next-line:no-console
    console.log(`server started at http://localhost:${ port }`)
})

const wss = new WebSocket.Server({ server, path: '/ws' })
// init Websocket for games list
wss.on('connection', (ws: WebSocket, req) => {
    const addr = addressToString(req.connection.address())
    const params = querystring.parse(url.parse(req.url).query)
    console.log(`connection from ${ addr } with params`, params)
    let gameId = ''
    if (params.game) {
        gameId = params.game.toString()
        addGameSocket(params.game.toString(), ws)
    } else {
        addListSocket(ws)
    }
    ws.onmessage = (e: MessageEvent) => {
        console.log('gameID', gameId)
        console.log(e.data)
        const { event, data } = disassembleMessage(e.data)
        console.log('Event', event)
        switch (event) {
            case 'add_game':
                addGame(ws, data)
                break
            case 'quit_game':
                quitGame(gameId)
                break
            case 'config_game':
                configGame(ws, gameId, data)
                break
            case 'send_state':
                sendState(ws, gameId)
                break
            case 'send_games': {
                sendGames(ws)
                break
            }

        }
    }
    ws.onclose = (_: CloseEvent) => {
        removeSocket(ws)
        console.log('connection from ' + addr + ' closed')
    }
})

const quitGame = (gameId: string) => {
    if (games[ gameId ]) {
        games[ gameId ].stop()
        delete games[ gameId ]
    }
    broadcastToGame(wss, gameId, 'quit', null)
    if (gameSockets[ gameId ]) {
        gameSockets[ gameId ].forEach((ws: WebSocket) => ws.close())
        delete gameSockets[ gameId ]
    }
    broadcaseGames()
}

const broadcaseGames = () => {
    broadcast(wss, 'games_list', Object.values(games).map((g) => g.getState()))
}

const sendGames = (ws: WebSocket) => {
    ws.send(assembleMessage('games_list', Object.values(games).map((g) => g.getState())))
}

const addGame = (ws: WebSocket, data: string) => {
    const game = createGameHandle()
    storeGame(game)
    ws.send(assembleMessage('own_game_added', game.getState()))
}

const storeGame = (game: GameHandle) => {
    games[ game.getState().id ] = game
    broadcaseGames()
}

const sendState = (ws: WebSocket, gameId: string) => {
    if (gameId === '') {
        return
    }
    try {
        const game = loadGame(gameId)
        ws.send(assembleMessage('game_state', game))
    } catch (e) {
        broadcastToGame(wss, gameId, 'game_not_found', gameId)
        return
    }
}

const configGame = (ws: WebSocket, gameId: string, data: string) => {
    const config: GameConfig = JSON.parse(data)
    try {
        const game = loadGame(gameId)
        game.configure(config)
        storeGame(game)
        broadcastToGame(wss, gameId, 'config_changed', game.getState())
    } catch (e) {
        broadcastToGame(wss, gameId, 'game_not_found', config.id)
        return
    }
}

const addressToString = (addr: AddressInfo | string): string => {
    return typeof addr === 'string' ? addr : addr.address
}

// Message format is <event>@<data in json format>
const broadcast = (bwss: WebSocket.Server, event: string, msg: any) => {
    listSockets.forEach((client) => client.send(assembleMessage(event, msg)))
}

// Message format is <event>@<data in json format>
const broadcastToGame = (bwss: WebSocket.Server, id: string, event: string, msg: any) => {
    if (!gameSockets[ id ]) {
        throw new Error(`Game socket for id ${ id } not found`)
    }
    gameSockets[ id ].forEach((client) => client.send(assembleMessage(event, msg)))
}

const assembleMessage = (event: string, data: any) => {
    const serialized = JSON.stringify(data)
    return event + '@' + serialized
}

const disassembleMessage = (data: WebSocket.Data): DisassembledMessage => {
    const resolved = data.toString().split(/\@(.+)/)
    return { event: resolved[ 0 ], data: resolved[ 1 ] }
}

const addGameSocket = (gameId: string, ws: WebSocket) => {
    console.log('Add game socket for game ' + gameId)
    if (!gameSockets[ gameId ]) {
        gameSockets[ gameId ] = []
    }

    gameSockets[ gameId ].push(ws)
    console.log(gameSockets)
}

const addListSocket = (ws: WebSocket) => {
    console.log('Add list socket')
    listSockets.push(ws)
}

const loadGame = (gameId: string) => {
    console.log('Available games', Object.values(games).map((g) => g.getState().id))
    if (!games[ gameId ]) {
        throw Error(`Game for id ${ gameId } not found`)
    }

    return games[ gameId ]
}

const removeSocket = (ws: WebSocket) => {
    console.log('Remove socket')
    Object.values(gameSockets).forEach((game) => game.filter((existingWs) => existingWs !== ws))
    Object.values(listSockets).filter((existingWs) => existingWs !== ws)
}
