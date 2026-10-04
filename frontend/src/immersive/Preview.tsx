// Development-only visual QA. This module is not imported by production builds.
import { useState } from 'react'
import { frame, game, action } from './fixtures'
import { ImmersiveOverlay } from './ImmersiveOverlay'
import { buttonRects, tileRects } from './geometry'
import { buildHints } from './model'
import { rectStyle } from './HudSurface'
import { MakaTile } from './MakaBadge'
import type { ActionKind } from './types'
import type { Hand13Result } from '@/types'

export function Preview() {
  const [mode, setMode] = useState<ActionKind | 'multi' | 'wait13'>('discard')
  const [lifted, setLifted] = useState(false)
  const [reference, setReference] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const f = frame()
  f.game = game(['1m', '3m', '4m', '5m', '7m', '7m', '2p', '5pr', '6p', '7p', '1s', '2s', '7s', 'N'], 'N')
  f.legal_actions = [...new Set(f.game.players[0].tehai)].map(t => action('discard', t))
  f.response = { type: 'dahai', actor: 0, pai: 'N', tsumogiri: true, meta: { akagi_revision: 12, akagi_policy: { complete: true, candidates: [['discard:N', .4532], ['discard:1m', .3245], ['discard:7s', .1105], ['discard:5pr', .072], ['discard:7p', .035], ['discard:7m', .0048]].map(([action, prob]) => ({ action, prob })) } } }
  const hand: Hand13Result = { shanten: 2, waits: ['2m', '3m', '6m', '7m', '2p', '3p', '4p', '6p', '2s', '3s', '5s', '6s', '8s', '9s'].map(tile => ({ tile, left: 4, agari_rate: null })), waits_total: 56, next_shanten_waits_count: {}, avg_next_shanten_waits: 0, mixed_waits_score: 0, avg_agari_rate: 0, is_furiten: false, furiten_rate: 0, improves: [], improve_way_count: 0, avg_improve_waits_count: 0, dama_point: 0, riichi_point: 0, mixed_round_point: 0, yaku_ids: [] }
  f.analysis = { revision: 12, seat: 0, turn: 4, shanten: 2, state: 'discard14', hand13: null, hand14: { shanten: 2, maintain: [{ discard: 'N', result: hand }], backwards: [] }, opponents: [1, 2, 3].map(seat => ({ seat, is_riichi: seat === 1, tenpai_rate: seat === 1 ? 99 : 12, risk: Array.from({length:34}, (_,i) => i % 7 * 2) })), mixed_risk: [], best_attack_discard: 'N', best_defence_discard: 'N' }
  if (mode === 'wait13') {
    f.game.players[0].tehai.pop(); f.game.players[0].drawn_tile = null
    f.can_act = false; f.legal_actions = []; f.response = null
    f.analysis = {...f.analysis, state:'wait13', hand13:hand, hand14:null}
  } else if (mode !== 'discard') {
    f.game.phase = 'wait_response'
    f.game.num_players = mode === 'kita' ? 3 : 4
    f.legal_actions = mode === 'multi' ? [action('chi','3p',['4p','5p']),action('pon','3p',['3p','3p']),action('daiminkan','3p',['3p','3p','3p']),action('ron'),action('pass')] : [action('pass'), mode === 'chi' ? action('chi','3p',['4p','5p']) : action(mode)]
    const key = mode === 'ron' || mode === 'tsumo' ? 'hora' : ['ankan', 'kakan', 'daiminkan'].includes(mode) ? 'kan' : mode === 'chi' ? 'chi_low' : mode
    f.response = { type: 'none', meta: { akagi_revision: 12, akagi_policy: { complete: true, candidates: [{ action: key, prob: .9234 }, { action: 'pass', prob: .0766 }] } } }
  }
  if (refreshing) { f.analysis = null; f.response = null }
  const shapes = buildHints(f).map(h => ({ id: h.id, bounds: [h.x - h.w / 2, h.y - h.h / 2 - (lifted && h.id === 'tile-13' ? .4 : 0), h.w, h.h] as [number, number, number, number], paths: [] }))
  const nativeOps: Partial<Record<ActionKind, string>> = { pon: 'op_peng', chi: 'op_chi', ron: 'op_hu', tsumo: 'op_zimo', reach: 'op_lizhi', ankan: 'op_gang', kakan: 'op_gang', daiminkan: 'op_gang', kita: 'op_babei', ryukyoku: 'op_liuju', pass: 'op_x' }
  return <div style={{ position: 'fixed', inset: 0, background: reference ? 'url(/src/immersive/previewAssets/reference-table.png) top center / 100% auto no-repeat' : 'radial-gradient(ellipse at 50% 25%, #385a71, #102737)', color: '#d9e8e7' }}>
    {!reference && <div className="hud-table-area">
      <div style={{ position: 'absolute', left: '43%', top: '39%', padding: '2%', border: '3px solid #7f959799', background: '#223747', borderRadius: 15, textAlign: 'center' }}>东 1 局<br />25000</div>
      {tileRects(f.game).map((r, i) => <div key={i} style={{ ...rectStyle({ ...r, y: r.y - (lifted && i === 13 ? .4 : 0) }), position: 'absolute', transform: 'translate(-50%,-50%)' }}><MakaTile tile={r.tile} className="maka-preview-hand-tile" /></div>)}
      {buttonRects(f.legal_actions).map(r => <img key={r.kind} alt={`原版按钮 ${r.kind}`} src={`/src/immersive/previewAssets/${nativeOps[r.kind]}.png`} style={{ ...rectStyle(r), position: 'absolute', transform: 'translate(-50%,-50%)', objectFit: 'contain' }} />)}
    </div>}
    <ImmersiveOverlay cfg={{ enabled: true, immersive: true, top_n: 5, opacity: 1, always_on_top: true }} preview={f} previewShapes={shapes} />
    <div style={{ position: 'fixed', left: 16, top: 10, padding: 10, background: '#274a57', display: 'flex', gap: 12, zIndex:100 }}>
      <select aria-label="预览情景" value={mode} onChange={e => setMode(e.target.value as typeof mode)}>{[['discard', '手牌'], ['wait13', '进张'], ['multi', '多组按钮'], ['ron', '和'], ['pon', '碰'], ['chi', '吃'], ['ankan', '杠'], ['tsumo', '自摸'], ['reach', '立直'], ['ryukyoku', '九种九牌'], ['kita', '拔北']].map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select>
      <button onClick={() => setLifted(v => !v)}>抬起摸牌</button>
      <label><input type="checkbox" checked={reference} onChange={e=>setReference(e.target.checked)} />参考牌桌</label>
      <label><input type="checkbox" checked={refreshing} onChange={e=>setRefreshing(e.target.checked)} />模拟刷新</label>
    </div>
  </div>
}
