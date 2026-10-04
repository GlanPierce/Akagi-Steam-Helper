import type { AnalysisResult, GameStateSnapshot, OpponentRisk } from '@/types'
import { tileIndex, tileOrder } from './geometry'
import { tileName } from './model'
import { MakaTile } from './MakaBadge'
import { NativeSprite } from './NativeSprite'
import { opponentDiscardRisk, riskPercent } from './maka'
import { nativeRiskAnchor, type Viewport } from './nativeAvatar'
import { useState, type CSSProperties } from 'react'

export function MakaHandSummary({ analysis, style, pixelScale }: { analysis: AnalysisResult | null; style: CSSProperties; pixelScale: number }) {
  const hand = analysis?.hand13
  const shanten = analysis?.shanten
  if (!hand?.waits.length) return null
  return <div className="hud-hand-summary" style={style} aria-label="牌效与进张">
    <NativeSprite src="/maka/replay/replaybox.png" border={[13, 22, 13, 22]} pixelScale={pixelScale*.9} />
    <div className="maka-hand-heading">
      <strong>{shanten === undefined ? '向听 —' : shanten < 0 ? '和牌形' : shanten === 0 ? '听牌' : `${shanten} 向听`}</strong>
      {hand?.is_furiten && <b className="hud-furiten">振听</b>}
      {hand && <span>{hand.shanten === 0 ? '待牌' : '进张'} <strong>{hand.waits_total}</strong> 张</span>}
    </div>
    {hand && <><div className="hud-waits">{hand.waits.map(w => <span key={w.tile}><MakaTile tile={w.tile} /><small>{w.left}张</small></span>)}</div>
      </>}
  </div>
}

export function MakaOpponent({ opponent: o, game, pending, viewport }: { opponent: OpponentRisk; game: GameStateSnapshot; pending?: boolean; viewport: Viewport }) {
  const [expanded,setExpanded] = useState(false)
  const relative = (o.seat - (game.our_seat ?? 0) + game.num_players) % game.num_players
  const position = relative === 1 ? 'right' : game.num_players === 4 && relative === 2 ? 'across' : 'left'
  const tiles = [...new Set(game.players.find(p => p.seat === game.our_seat)?.tehai ?? [])].filter(t => tileIndex(t) >= 0).sort(tileOrder)
  const riichi = o.is_riichi || game.players.some(p => p.seat === o.seat && p.riichi_declared)
  // A cached pre-riichi vector is not the new riichi risk model. Update the
  // heading immediately, but wait for its matching analysis before showing risk.
  const riskReady = !riichi || o.is_riichi
  const sorted = [...tiles].sort((a,b) => (riskReady ? (opponentDiscardRisk(o,b) ?? -1) - (opponentDiscardRisk(o,a) ?? -1) : 0) || tileOrder(a,b))
  const visible = expanded ? sorted : sorted.slice(0,4)
  return <div data-testid={`opponent-${o.seat}`} className={`hud-opponent hud-opponent-${position}${expanded ? ' is-expanded' : ''}`} style={nativeRiskAnchor(position, viewport)} aria-busy={pending}>
    <NativeSprite src="/maka/common/maka_text_bottom.png" border={[0, 6, 6, 6]} pixelScale={Math.min(viewport.width/1920,viewport.height/1080)} />
    <div className={`maka-opponent-heading${riichi ? ' is-riichi' : ''}`}>{riichi ? <b>立直</b> : <>
      {position === 'left' && <span>听牌</span>}
      <strong>{Number.isFinite(o.tenpai_rate) ? `${o.tenpai_rate.toFixed(0)}%` : '—'}</strong>
      {position !== 'left' && <span>听牌</span>}
    </>}</div>
    <div className="maka-risk-tools"><small className="maka-risk-caption">放铳</small>{tiles.length>4 && <button data-hud-interactive type="button" aria-expanded={expanded} aria-label={expanded ? '收起放铳牌' : '展开全部放铳牌'} onClick={() => setExpanded(v=>!v)}><img src="/maka/replay/expand_button.png" alt="" /></button>}</div>
    <div className="maka-risk-tiles">{visible.map(tile => {
      const value = riskPercent(riskReady ? opponentDiscardRisk(o, tile) : null)
      return <span key={tile} aria-label={`打${tileName(tile)}，对其放铳估计${value}`}><MakaTile tile={tile} /><strong>{value}</strong></span>
    })}</div>
  </div>
}
