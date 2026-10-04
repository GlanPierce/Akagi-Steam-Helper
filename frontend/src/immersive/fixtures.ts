import type { GameStateSnapshot } from '@/types'
import type { ImmersiveFrame, LegalAction } from './types'

export function game(hand = ['1m', '1m', '5mr', '5m', '9m', '1p', '2p', '3p', '4s', '5s', '6s', 'E', 'E', '9p'], drawn: string | null = '9p'): GameStateSnapshot {
  return {
    bakaze: 'E', kyoku: 1, honba: 0, kyotaku: 0, oya: 1, current_player: 0,
    turn_count: 3, phase: 'wait_act', is_done: false, num_players: 4, our_seat: 0, dora_markers: ['3m'],
    players: Array.from({ length: 4 }, (_, seat) => ({ seat, tehai: seat === 0 ? hand : Array(13).fill('?'),
      drawn_tile: seat === 0 ? drawn : null, melds: [], river: [], score: 25000, riichi_declared: false,
      riichi_stage: false, double_riichi: false, riichi_declaration_index: null, kita_tiles: [] })),
  }
}
export const action = (kind: LegalAction['kind'], tile: string | null = null, consumed: string[] = []): LegalAction => ({ kind, tile, consumed })
export function frame(): ImmersiveFrame {
  const snapshot = game()
  return { revision: 12, game: snapshot, can_act: true, legal_actions: [...new Set(snapshot.players[0].tehai)].map(t => action('discard', t)),
    response: { type: 'dahai', actor: 0, pai: '1m', tsumogiri: false, meta: { akagi_revision: 12, q_values: [0, 0], mask_bits: 17 } },
    analysis: null, capture: { state: 'running', kind: 'mitm', descriptor: '' }, bot_status: { state: 'ready', bot: 'S42', actor_id: 0 } }
}
