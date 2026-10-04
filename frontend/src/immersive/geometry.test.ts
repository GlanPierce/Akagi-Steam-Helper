import { expect, it } from 'vitest'
import { tileRects, buttonRects, uniqueChoices } from './geometry'
import { action, game } from './fixtures'

it('lays out sorted duplicates, red before plain and the separate drawn tile', () => {
  const r = tileRects(game())
  expect(r.map(t => t.tile)).toEqual(['1m', '1m', '5mr', '5m', '9m', '1p', '2p', '3p', '4s', '5s', '6s', 'E', 'E', '9p'])
  expect(r[0].x).toBeCloseTo(2.23125)
  expect(r[13].x).toBeCloseTo(12.75625)
  expect(r[13].drawn).toBe(true)
})
it.each([3, 4])('keeps all fourteen dealer opening tiles in sorted order without a draw gap (%i players)', numPlayers => {
  const g = game(); g.oya = 0; g.turn_count = 0; g.num_players = numPlayers
  g.players = g.players.slice(0, numPlayers)
  const rects = tileRects(g)
  expect(rects.map(t => t.tile)).toEqual(['1m', '1m', '5mr', '5m', '9m', '1p', '2p', '3p', '9p', '4s', '5s', '6s', 'E', 'E'])
  expect(rects[8].x).toBeCloseTo(8.55625)
  expect(rects[13].x).toBeCloseTo(12.509375)
  expect(rects.some(t => t.drawn)).toBe(false)
})
it('returns the dealer to the separated draw after the first discard or an opening kita', () => {
  const g = game(); g.oya = 0
  g.players[0].river = [{ tile: '1s', tedashi: true, is_riichi: false }]
  expect(tileRects(g).at(-1)?.tile).toBe('9p')
  expect(tileRects(g).at(-1)?.x).toBeCloseTo(12.75625)
  g.players[0].river = []
  g.players[0].kita_tiles = ['N']
  g.num_players = 3; g.players = g.players.slice(0, 3)
  expect(tileRects(g).at(-1)?.drawn).toBe(true)
  expect(tileRects(g).at(-1)?.tile).toBe('9p')
  expect(tileRects(g).at(-1)?.x).toBeCloseTo(12.75625)
})
it('moves the separate draw left after a call', () => {
  const afterPon = game(['1m', '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', 'E'], 'E')
  const r = tileRects(afterPon)
  expect(r).toHaveLength(11)
  expect(r[10].x).toBeCloseTo(10.384375)
})
it('uses only actual operations, combines the kan button, and adds cancel only for a prompt', () => {
  expect(buttonRects([action('discard', '1m')])).toEqual([])
  expect(buttonRects([action('pass')])).toEqual([])
  const r = buttonRects([action('pon'), action('chi'), action('ron'), action('pass')])
  expect(r.map(x => x.kind)).toEqual(['pass', 'ron', 'pon', 'chi'])
  expect(r.map(x => [x.x, x.y])).toEqual([[10.875, 7], [8.46, 7], [6.045, 7], [10.875, 5.9]])
  expect(buttonRects([action('ankan'), action('kakan')]).filter(x => x.kind !== 'pass')).toHaveLength(1)
})
it('lists kakan before ankan even when the ankan tile sorts earlier', () => {
  const choices = uniqueChoices([action('ankan', null, ['1m', '1m', '1m', '1m']), action('kakan', '9p', ['9p', '9p', '9p'])], 'ankan')
  expect(choices.map(a => a.kind)).toEqual(['kakan', 'ankan'])
})
it('searches the full Steam ribbons, including the two-character skip button', () => {
  const rects = buttonRects([action('pon'), action('pass')])
  for (const r of rects) {
    expect(r.w).toBeGreaterThanOrEqual(2.25)
    expect(r.h).toBeGreaterThanOrEqual(.9)
  }
})
