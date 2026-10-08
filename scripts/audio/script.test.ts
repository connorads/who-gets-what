import { describe, expect, it } from 'vitest'
import { heardBeside, type Beat } from './script.ts'

const beat = (id: string, swappable = false, standalone = false): Beat => ({
  id,
  chapter: 'c',
  text: id,
  swappable,
  standalone,
})
const ids = (side: { previous?: Beat; next?: Beat }) => [side.previous?.id, side.next?.id]

describe('heardBeside', () => {
  const beats = [beat('intro'), beat('a', true), beat('b', true), beat('outro')]

  it('gives a fixed beat its neighbours', () => {
    expect(ids(heardBeside([beat('x'), beat('y'), beat('z')], 1))).toEqual(['x', 'z'])
  })

  it('stitches each swappable beat to the fixed beats around the pair', () => {
    expect(ids(heardBeside(beats, 1))).toEqual(['intro', 'outro'])
    expect(ids(heardBeside(beats, 2))).toEqual(['intro', 'outro'])
  })

  it('gives a fixed beat no context on the side where either partner may play', () => {
    expect(ids(heardBeside(beats, 0))).toEqual([undefined, undefined])
    expect(ids(heardBeside(beats, 3))).toEqual([undefined, undefined])
  })

  it('reads a standalone beat alone and stitches its neighbours past it', () => {
    const around = [beat('ask'), beat('wait', false, true), beat('answer')]
    expect(ids(heardBeside(around, 1))).toEqual([undefined, undefined])
    expect(ids(heardBeside(around, 0))).toEqual([undefined, 'answer'])
    expect(ids(heardBeside(around, 2))).toEqual(['ask', undefined])
  })
})
