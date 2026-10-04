import { useEffect, useRef } from 'react'
import type { AnalysisResult } from '@/types'
import type { ImmersiveFrame } from './types'

/** Briefly retain non-actionable estimates during analysis handoff. Decisions
 * still use only the strict current frame; changed hands never inherit waits. */
export function useHudAnalysis(frame: ImmersiveFrame | null) {
  const game = frame?.game
  const active = !!game && game.our_seat !== null && !game.is_done && frame?.capture.state === 'running' && frame.transport_connected !== false
  const round = active ? JSON.stringify([game.bakaze, game.kyoku, game.honba, game.oya, game.our_seat, game.num_players]) : ''
  const player = game?.players.find(p => p.seat === game.our_seat)
  const hand = JSON.stringify([player?.tehai.slice().sort(), player?.melds, player?.kita_tiles, player?.riichi_declared])
  const shape = JSON.stringify([player?.melds, player?.kita_tiles, player?.riichi_declared])
  const fresh = active && frame?.analysis?.revision === frame.revision ? frame.analysis : null
  const cache = useRef<{ round: string; hand: string; analysis: AnalysisResult; at: number } | null>(null)
  const waiting = useRef<{ round: string; tiles: string; shape: string; analysis: AnalysisResult } | null>(null)
  useEffect(() => {
    if (!active) { cache.current = null; waiting.current = null }
    else if (fresh) {
      cache.current = { round, hand, analysis: fresh, at: Date.now() }
      if (fresh.hand13 && player) waiting.current = { round, tiles: JSON.stringify(player.tehai.slice().sort()), shape, analysis: fresh }
    }
  }, [active, fresh, round, hand, shape, player])
  const previous = cache.current
  const retained = active && previous?.round === round && Date.now() - previous.at <= 1200 ? previous : null
  // Drawing the fourteenth tile does not invalidate the waiting-hand strip.
  // Keep that strip through this decision, including a fresh discard14 result,
  // but never carry it across a discard, call, replacement hand or round.
  const beforeDraw = waiting.current
  const tilesBeforeDraw = player?.tehai.slice() ?? []
  const drawnIndex = player?.drawn_tile ? tilesBeforeDraw.indexOf(player.drawn_tile) : -1
  if (drawnIndex >= 0) tilesBeforeDraw.splice(drawnIndex,1)
  const drawnHand = active && drawnIndex >= 0 && beforeDraw?.round === round && beforeDraw.shape === shape && beforeDraw.tiles === JSON.stringify(tilesBeforeDraw.sort()) ? beforeDraw.analysis : null
  const summary = fresh?.hand13 ? fresh : drawnHand ?? fresh ?? (retained?.hand === hand ? retained.analysis : null)
  return { active, hand: summary, opponents: fresh?.opponents ?? retained?.analysis.opponents ?? [], pending: !fresh }
}
