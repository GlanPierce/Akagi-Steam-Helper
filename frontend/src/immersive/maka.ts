import { buildHints } from './model'
import type { OpponentRisk } from '@/types'
import type { ActionKind, Hint, ImmersiveFrame } from './types'
import { tileIndex, uniqueChoices } from './geometry'

/** Opponent vectors are conditional on tenpai; both inputs use percentages. */
export function opponentDiscardRisk(opponent: OpponentRisk, tile: string): number | null {
  const conditional = opponent.risk[tileIndex(tile)]
  return Number.isFinite(conditional) && Number.isFinite(opponent.tenpai_rate)
    ? Math.max(0, Math.min(100, conditional)) * Math.max(0, Math.min(100, opponent.tenpai_rate)) / 100 : null
}
export const riskPercent = (risk: number | null | undefined) => risk === null || risk === undefined || !Number.isFinite(risk) ? '—' : `${risk.toFixed(1)}%`

export const MAKA_ACTIONS: Record<ActionKind, string> = {
  discard: 'small_da', reach: 'small_lizhi', chi: 'big_chi', pon: 'big_peng',
  daiminkan: 'big_gang', ankan: 'big_gang', kakan: 'big_gang', ron: 'big_hu',
  tsumo: 'big_zimo', kita: 'big_babei', ryukyoku: 'big_liuju', pass: 'big_skip',
}
export const makaAction = (kind: ActionKind, best: boolean) => `/maka/actions/${MAKA_ACTIONS[kind]}${best ? '_recommend' : ''}.png`
export function makaTile(tile: string): string | null {
  const honor = ['E', 'S', 'W', 'N', 'P', 'F', 'C'].indexOf(tile)
  const name = honor >= 0 ? `${honor + 1}z` : /^[1-9][mps]$/.test(tile) ? tile : /^5[mps]r$/.test(tile) ? `0${tile[1]}` : null
  return name ? `/maka/tiles/${name}.png` : null
}
export const makaPercent = (p: number | null) => p === null ? '—' : p > 0 && p < .005 ? '<1' : String(Math.round(p * 100))

/** Rank model decisions, not physical copies. Keep probabilities unnormalised. */
export function makaRecommendations(frame: ImmersiveFrame, choice?: ActionKind, onlyDiscards = false): Hint[] {
  const unique = new Map<string, Hint>()
  const response = frame.response
  for (const hint of buildHints(frame, choice)) {
    if (onlyDiscards && hint.kind !== 'discard') continue
    // Missing policy entries are not low-ranked recommendations. Only retain
    // an unscored move when the model explicitly chose it (e.g. a kan selector).
    if (hint.probability === null && !hint.best) continue
    if (hint.probability === null && hint.kind === 'discard' && response?.type === 'reach' && choice !== 'reach') continue
    // The own-turn cancel button is navigation back to discards, not an extra
    // policy candidate whose aggregate should outrank each individual discard.
    if (hint.kind === 'pass' && !frame.legal_actions.some(a => a.kind === 'pass') && frame.legal_actions.some(a => a.kind === 'discard')) continue
    const key = hint.kind === 'discard' ? `discard:${hint.probabilityNote ? hint.tile?.replace(/r$/, '') : hint.tile}` : hint.choice ? hint.id : hint.kind
    const previous = unique.get(key)
    const chosenTile = response && 'pai' in response ? response.pai : null
    const drawn = response?.type === 'dahai' && response.tsumogiri && hint.tile === response.pai
    if (!previous || hint.tile === chosenTile && previous.tile !== chosenTile || drawn && hint.x > previous.x) unique.set(key, hint)
  }
  return [...unique.values()].sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1) || Number(b.best) - Number(a.best)).slice(0, 5)
}

/** All visible button decisions sit above their native control, including unscored
 * legal choices (shown as —). They do not spend the hand's five ranking slots. */
export function makaButtonEvents(frame: ImmersiveFrame, choice?: ActionKind): Hint[] {
  return buildHints(frame, choice).filter(h => h.kind !== 'discard')
    .map(h => {
      if (h.choice || !['chi', 'pon', 'daiminkan', 'ankan', 'kakan'].includes(h.kind)) return h
      const choices = uniqueChoices(frame.legal_actions, h.kind)
      return choices.length === 1 ? { ...h, choice: choices[0] } : h
    })
    .sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1) || Number(b.best) - Number(a.best))
}
