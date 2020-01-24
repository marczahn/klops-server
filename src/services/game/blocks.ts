/*
Fields are described by 2d vectors. Example:

+---+
|   |
+---+---+---+
|   |   |   |
+---+---+---+

consists of 4 vectors (x/y) - one for each field: 0/0, 0/1, 1/1, 2/1

As you can see these vectors are relative to a create vector.

TODO - Add weights or simply add blockCount multiple times to increase their occurences
 */

import { Block, Vector } from '../../models/game'

const blockVectors: Vector[][] = [
    // Original blocks:
    // 1x4
    [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }],
    // half-t left
    [{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 1 }, { x: 1, y: 0 }],
    // half-t right
    [{ x: 1, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 1 }, { x: 0, y: 0 }],
    // square
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
    // T
    [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 2, y: 1 }],
    // first one of the strange ones
    [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    // second one of the strange ones
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],

    // custom blocks
    // corner
    [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    // 1x3
    [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }],
]

export const blockVectorFactory = () => {
    let bucket: number[] = generateBucket(blockVectors)
    return ( (zero: Vector): Block => {
        if (bucket.length === 0) {
            bucket = generateBucket(blockVectors)
        }
        console.log(bucket)
        const k: number | undefined = bucket.pop()
        if (k === undefined) {
            // T Typescript transpiler does not realize that it is impossible that bucket cannot be empty at this place
            throw Error('No elements in bucket left')
        }
        return { zero, vectors: blockVectors[ k ], degrees: 0 }
    } )
}

const generateBucket = (vectors: Vector[][]): number[] => {
    const keys: number[] = []
    vectors.forEach((v: Vector[], key: number) => {
        keys.push(key)
    })
    return shuffle(keys)
}

const shuffle = (a: number[]) => {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * ( i + 1 ));
        [a[ i ], a[ j ]] = [a[ j ], a[ i ]]
    }
    return a
}
