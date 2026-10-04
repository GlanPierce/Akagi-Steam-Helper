import type { GameStateSnapshot } from '@/types'
import type { ActionKind, LegalAction, TileRect, ButtonRect, Rect } from './types'

// Search anchors only. Maka badges follow measured game objects.
export const FIRST_TILE_X = 2.23125
export const TILE_PITCH = 0.790625
const DRAW_GAP = 0.246875
export const isKan = (kind: ActionKind) => ['ankan', 'kakan', 'daiminkan'].includes(kind)
export function tileIndex(tile: string): number {
  const honor = ['E', 'S', 'W', 'N', 'P', 'F', 'C'].indexOf(tile)
  if (honor >= 0) return 27 + honor
  const suit = 'mps'.indexOf(tile[1])
  return suit < 0 ? -1 : suit * 9 + Number(tile[0]) - 1
}
export const tileOrder = (a: string, b: string) => tileIndex(a) - tileIndex(b) || Number(b.endsWith('r')) - Number(a.endsWith('r'))

export function tileRects(game: GameStateSnapshot): TileRect[] {
  const p = game.players.find(p => p.seat === game.our_seat)
  if (!p || p.tehai.some(t => tileIndex(t) < 0) || p.tehai.length > 14) return []
  const hand = [...p.tehai].sort(tileOrder)
  // The dealer's initial 14 tiles are sorted together. The protocol still
  // supplies drawn_tile, but it is not a separate visual slot until a later
  // draw (including an opening kita replacement).
  const openingDeal = game.oya === p.seat && hand.length === 14 && !p.river.length && !p.melds.length && !p.kita_tiles.length
  const drawn = !openingDeal && hand.length % 3 === 2 ? p.drawn_tile : null
  const idx = drawn ? hand.lastIndexOf(drawn) : -1
  if (idx >= 0) hand.splice(idx, 1)
  const rects = hand.map((tile, index) => ({ tile, drawn: false, index, x: FIRST_TILE_X + index * TILE_PITCH, y: 8.3625, w: 0.762, h: 1.19 }))
  if (idx >= 0 && drawn) rects.push({ tile: drawn, drawn: true, index: hand.length, x: FIRST_TILE_X + hand.length * TILE_PITCH + DRAW_GAP, y: 8.3625, w: 0.762, h: 1.19 })
  return rects
}

const priority: Record<ActionKind, number> = { pass: 0, discard: 99, tsumo: 1, ron: 1, reach: 2, daiminkan: 2, pon: 3, ankan: 3, kakan: 3, chi: 4, kita: 4, ryukyoku: 5 }
export function buttonRects(legal: LegalAction[]): ButtonRect[] {
  const kinds = [...new Set(legal.map(a => a.kind).filter(k => k !== 'discard' && k !== 'pass'))]
  if (!kinds.length) return []
  // Majsoul uses one kan button, with its type choices on the next screen.
  const kan = kinds.find(isKan)
  const buttons = [...kinds.filter(k => !isKan(k) || k === kan), 'pass' as const]
  buttons.sort((a, b) => priority[a] - priority[b] || a.localeCompare(b))
  // Steam's settled control centers are 2.415 table units apart. Keep a
  // constant offset over every ribbon instead of compressing the hint row.
  return buttons.slice(0, 9).map((kind, i) => ({ kind, x: [10.875, 8.46, 6.045][i % 3], y: 7 - Math.floor(i / 3) * 1.1, w: 2.25, h: 0.9 }))
}

export function uniqueChoices(legal: LegalAction[], kind: ActionKind): LegalAction[] {
  const unique = new Map<string, LegalAction>()
  for (const a of legal.filter(a => isKan(kind) ? isKan(a.kind) : a.kind === kind)) {
    const normalized = { ...a, consumed: [...a.consumed].sort(tileOrder) }
    unique.set(`${a.kind}:${normalized.consumed.join(',')}:${a.tile ?? ''}`, normalized)
  }
  return [...unique.values()].sort((a, b) => {
    // The native client's selector lists added kans before concealed kans.
    if (isKan(kind) && a.kind !== b.kind) return Number(a.kind === 'ankan') - Number(b.kind === 'ankan')
    for (let i = 0; i < Math.min(a.consumed.length, b.consumed.length); i++) {
      const d = tileOrder(a.consumed[i], b.consumed[i]); if (d) return d
    }
    return a.kind.localeCompare(b.kind)
  })
}

export function choiceRect(index: number, count: number, kan: boolean): Rect | null {
  const slot = -count + index * 2 + 1 + (kan ? 3 : 5)
  const xs = kan ? [4.325, 5.4915, 6.6583, 7.825, 8.9917, 10.1583, 11.325] : Array.from({ length: 11 }, (_, i) => 3.6625 + i * 0.83375)
  if (slot < 0 || slot >= xs.length) return null
  return { x: xs[slot], y: 6.3, w: kan ? 1.98 : 1.48, h: 0.86 }
}
