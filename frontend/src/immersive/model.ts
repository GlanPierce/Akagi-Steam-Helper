import type { ImmersiveFrame, Hint, ActionKind, LegalAction } from './types'
import { buttonRects, choiceRect, isKan, tileIndex, tileOrder, tileRects, uniqueChoices } from './geometry'

export const ACTION_NAMES: Record<ActionKind, string> = { discard: '打', chi: '吃', pon: '碰', daiminkan: '明杠', ankan: '暗杠', kakan: '加杠', reach: '立直', tsumo: '自摸', ron: '荣和', ryukyoku: '九种九牌', kita: '拔北', pass: '跳过' }
const tiles = [...'mps'].flatMap(s => Array.from({ length: 9 }, (_, i) => `${i + 1}${s}`)).concat(['E', 'S', 'W', 'N', 'P', 'F', 'C', '5mr', '5pr', '5sr'])
const validP = (p: unknown): p is number => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' ? v as Record<string, unknown> : {}
const baseTile = (tile: string) => tile.replace(/r$/, '')
const kanKey = (a: LegalAction) => `kan_tile:${baseTile(a.tile ?? a.consumed[0] ?? '')}`
function chiKey(a: LegalAction): string {
  const n = tileIndex(a.tile ?? '')
  const i = [...a.consumed.map(tileIndex), n].sort((a, b) => a - b).indexOf(n)
  return ['chi_low', 'chi_mid', 'chi_high'][i] ?? 'chi'
}

export function decodeDistribution(meta: Record<string, unknown>, players: number): Map<string, number> {
  const result = new Map<string, number>()
  const labels = [...tiles.map(t => `discard:${t}`), ...(players === 3 ? ['reach', 'pon', 'kan', 'kita', 'hora', 'ryukyoku', 'pass'] : ['reach', 'chi_low', 'chi_mid', 'chi_high', 'pon', 'kan', 'hora', 'ryukyoku', 'pass'])]
  if (meta.q_values !== undefined || meta.mask_bits !== undefined) {
    if (!Array.isArray(meta.q_values) || meta.q_values.some(q => typeof q !== 'number' || !Number.isFinite(q))) return result
    const bits = meta.mask_bits
    if (!(typeof bits === 'number' && Number.isSafeInteger(bits) && bits >= 0) && !(typeof bits === 'string' && /^\d+$/.test(bits))) return result
    const mask = BigInt(bits)
    const allowed = labels.filter((_, i) => (mask & (1n << BigInt(i))) !== 0n)
    if (mask >> BigInt(labels.length) || allowed.length !== meta.q_values.length || !allowed.length) return result
    const qs = meta.q_values as number[]
    const max = Math.max(...qs)
    const exp = qs.map(q => Math.exp((q - max) / 0.3))
    const sum = exp.reduce((a, b) => a + b, 0)
    allowed.forEach((key, i) => result.set(key, exp[i] / sum))
    return result
  }
  const policy = record(meta.akagi_policy)
  if (Array.isArray(policy.candidates)) {
    for (const raw of policy.candidates) {
      const c = record(raw)
      if (typeof c.action === 'string' && (labels.includes(c.action) || /^(discard_base|kan_tile):/.test(c.action) && tiles.includes(c.action.split(':')[1])) && validP(c.prob)) result.set(c.action, c.prob)
    }
    return result
  }
  const rows = record(meta.show).items
  if (!Array.isArray(rows)) return result
  for (const raw of rows) {
    const row = record(raw)
    // Native Akagi supplies raw `prob`; rounded display strings are not policy data.
    if (!validP(row.prob)) continue
    const pais = Array.isArray(row.pais) ? row.pais.filter((p): p is string => typeof p === 'string') : []
    const label = String(row.label ?? '').toLowerCase().split(' ')[0]
    const simple: Record<string, string> = { discard: `discard:${pais[0]}`, dahai: `discard:${pais[0]}`, riichi: 'reach', reach: 'reach', hora: 'hora', tsumo: 'hora', ron: 'hora', ryukyoku: 'ryukyoku', kita: 'kita', nukidora: 'kita', pass: 'pass', none: 'pass', pon: 'pon', chi: 'chi', kan: 'kan', ankan: 'kan', kakan: 'kan' }
    const key = simple[label]
    if (!key) continue
    const safeKey = key === 'kan' ? 'kan_legacy' : key
    result.set(safeKey, Math.min(1, (result.get(safeKey) ?? 0) + row.prob))
    // Display tiles identify a representative move, not a per-combination policy.
    // Chi may contain only some directions in a legacy top-N list.
    if (label === 'chi') result.delete('chi')
  }
  return result
}

export function preferenceColor(probability: number | null, max: number): string {
  if (probability === null || !Number.isFinite(probability)) return '#9ca3af'
  const t = max > 0 ? Math.max(0, Math.min(1, probability / max)) : 0
  const stops = [[242, 107, 107], [245, 206, 84], [57, 229, 140]]
  const a = t <= 0.5 ? stops[0] : stops[1], b = t <= 0.5 ? stops[1] : stops[2]
  const f = t <= 0.5 ? t * 2 : (t - 0.5) * 2
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * f).toString(16).padStart(2, '0')).join('')
}
export const probabilityText = (p: number | null) => p === null ? '—' : `${(p * 100).toFixed(2)}%`
export function tileName(tile: string): string {
  const honors: Record<string, string> = { E: '东', S: '南', W: '西', N: '北', P: '白', F: '发', C: '中' }
  return honors[tile] ?? `${tile.endsWith('r') ? '赤' : ''}${tile[0]}${({ m: '万', p: '筒', s: '索' } as Record<string, string>)[tile[1]] ?? ''}`
}

export function buildHints(frame: ImmersiveFrame, choice?: ActionKind): Hint[] {
  const { game, response, revision, legal_actions: legal } = frame
  if (!game || game.is_done || game.our_seat === null || !frame.can_act || frame.transport_connected === false || frame.capture.state !== 'running' || !response || response.meta?.akagi_revision !== revision) return []
  const p = decodeDistribution(response.meta, game.num_players)
  const analysis = frame.analysis?.revision === revision ? frame.analysis : null
  const out: Hint[] = []
  const add = (hint: Omit<Hint, 'color' | 'best'>, chosen = false) => out.push({ ...hint, color: '', best: chosen })
  if (choice && ['chi', 'pon', 'ankan', 'kakan', 'daiminkan'].includes(choice)) {
    const choices = uniqueChoices(legal, choice)
    for (const [i, a] of choices.entries()) {
      const rect = choiceRect(i, choices.length, isKan(choice)); if (!rect) continue
      const keyFor = (b: LegalAction) => b.kind === 'chi' ? chiKey(b) : isKan(b.kind) ? p.has(kanKey(b)) ? kanKey(b) : 'kan' : b.kind
      const coarse = keyFor(a)
      const count = choices.filter(b => keyFor(b) === coarse).length
      const probability = (count === 1 ? p.get(coarse) : null) ?? null
      const selected = response.type === a.kind && 'consumed' in response && [...response.consumed].sort(tileOrder).join() === a.consumed.join()
      add({ ...rect, id: `choice-${i}`, kind: a.kind, label: a.consumed.map(tileName).join(' '), probability, choice: a }, selected)
    }
  } else {
    for (const rect of tileRects(game)) {
      if (choice === 'reach' ? !frame.riichi_discards?.includes(rect.tile) : !legal.some(a => a.kind === 'discard' && a.tile === rect.tile)) continue
      const c = analysis?.hand14 && [...analysis.hand14.maintain, ...analysis.hand14.backwards].find(c => tileIndex(c.discard) === tileIndex(rect.tile))
      const riichi = response.type === 'reach' && response.pai === rect.tile
      const risk = analysis?.mixed_risk[tileIndex(rect.tile)]
      const coarse = p.has(`discard_base:${baseTile(rect.tile)}`) && legal.some(a => a.kind === 'discard' && a.tile !== rect.tile && baseTile(a.tile ?? '') === baseTile(rect.tile))
      add({ ...rect, id: `tile-${rect.index}`, kind: 'discard', label: riichi ? '立直切牌' : tileName(rect.tile), probability: choice === 'reach' ? null : p.get(`discard:${rect.tile}`) ?? p.get(`discard_base:${baseTile(rect.tile)}`) ?? null,
        probabilityNote: coarse && choice !== 'reach' ? '赤／普通合计' : undefined,
        detail: riichi ? '立直后切这张' : c ? `${c.result.shanten === 0 ? '听牌' : c.result.shanten + '向听'} · ${c.result.waits_total}枚` : undefined,
        risk: Number.isFinite(risk) ? risk : undefined }, riichi || response.type === 'dahai' && response.pai === rect.tile)
    }
    for (const rect of choice === 'reach' || choice === 'discard' ? [] : buttonRects(legal)) {
      let probability: number | null = null
      if (rect.kind === 'chi') {
        const values = [...new Set(legal.filter(a => a.kind === 'chi').map(chiKey))].map(k => p.get(k))
        probability = p.get('chi') ?? (values.length && values.every(v => v !== undefined) ? values.reduce((a, b) => a! + b!, 0)! : null)
      } else {
        const key = isKan(rect.kind) ? 'kan' : ['ron', 'tsumo'].includes(rect.kind) ? 'hora' : rect.kind
        probability = p.get(key) ?? null
        if (isKan(rect.kind) && probability === null) {
          const keys = [...new Set(legal.filter(a => isKan(a.kind)).map(kanKey))]
          if (keys.length && keys.every(k => p.has(k))) probability = keys.reduce((s, k) => s + p.get(k)!, 0)
          else if (keys.length === 1) probability = p.get('kan_legacy') ?? null
        }
        // On an own-draw prompt, cancel means continue with an ordinary discard.
        if (rect.kind === 'pass' && probability === null && game.phase === 'wait_act') {
          const discards = [...new Set(legal.filter(a => a.kind === 'discard').map(a => p.has(`discard_base:${baseTile(a.tile ?? '')}`) ? `discard_base:${baseTile(a.tile ?? '')}` : `discard:${a.tile}`))]
          if (discards.length && discards.every(k => p.has(k))) probability = discards.reduce((s, k) => s + p.get(k)!, 0)
        }
      }
      const selected = rect.kind === 'pass' ? response.type === 'none' : isKan(rect.kind) ? isKan(response.type as ActionKind) : ['ron', 'tsumo'].includes(rect.kind) ? response.type === 'hora' : response.type === rect.kind
      add({ ...rect, id: `button-${rect.kind}`, label: ACTION_NAMES[rect.kind], probability }, selected)
    }
  }
  const max = Math.max(0, ...out.map(h => h.probability ?? 0))
  return out.map(h => ({ ...h, color: preferenceColor(h.probability, max), best: h.best || h.probability !== null && max > 0 && h.probability === max }))
}
