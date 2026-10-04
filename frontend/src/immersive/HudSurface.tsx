import { useEffect, useRef, type CSSProperties } from 'react'
import type { ImmersiveFrame, ActionKind, Rect } from './types'
import type { OverlayConfig } from '@/types'
import type { Silhouette } from './contours'
import { makaRecommendations, makaButtonEvents } from './maka'
import { MakaBadge, MakaEvents } from './MakaBadge'
import { MakaHandSummary, MakaOpponent } from './MakaAnalysis'
import { useHudAnalysis } from './useHudAnalysis'
import { useViewport } from './nativeAvatar'
import { actionSlots, replayStripStyle } from './nativeLayout'
import { useActionEntrance } from './useActionEntrance'
export const DEFAULT_CALIBRATION = { x: 0, y: 0, scale: 1, hand_y: 0, button_y: 0 }
export function rectStyle(rect: Rect): CSSProperties {
  return { left: `${rect.x / 16 * 100}%`, top: `${rect.y / 9 * 100}%`, width: `${rect.w / 16 * 100}%`, height: `${rect.h / 9 * 100}%` }
}
export function HudSurface({ frame, cfg, guiding = true, choice, shapes = [] }: { frame: ImmersiveFrame | null; cfg: OverlayConfig; guiding?: boolean; choice?: ActionKind; shapes?: Silhouette[] }) {
  const handHints = guiding && frame && cfg.show_discards !== false ? makaRecommendations(frame, choice, true) : []
  const events = guiding && frame && cfg.show_actions !== false ? makaButtonEvents(frame, choice) : []
  const analysis = useHudAnalysis(frame)
  const viewport = useViewport()
  const slots = actionSlots(frame,choice)
  const entered = useActionEntrance(guiding && slots.length && cfg.show_actions !== false ? `${frame?.revision}:${choice ?? ''}:${slots.map(s=>s.id).join(',')}` : '')
  const measured = new Map(shapes.map(s => [s.id, s]))
  const cleanSize = useRef<[number, number] | null>(null)
  const tiles = shapes.filter(s => s.id.startsWith('tile-'))
  const uncovered = tiles.filter(s => !handHints.some(h => h.id === s.id))
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
  const samples = uncovered.length ? uncovered : cleanSize.current ? [] : tiles
  const size: [number, number] | null = samples.length ? [median(samples.map(s => s.bounds[2])), median(samples.map(s => s.bounds[3]))] : cleanSize.current
  useEffect(() => { if (size) cleanSize.current = size }, [size?.[0], size?.[1]])
  return <div className="hud-surface" style={{ opacity: cfg.opacity }}>
    {handHints.map((hint, rank) => {
      const shape = measured.get(hint.id)
      if (!shape) return null
      const [x, y, measuredWidth, measuredHeight] = shape.bounds
      const [w, h] = size ?? [measuredWidth, measuredHeight]
      // The extracted sprite includes transparent glow padding. Compensate its
      // width so the painted badge, rather than its canvas, fits the tile face.
      return <div key={hint.id} data-testid={`hint-${hint.id}`} data-recommendation={hint.id} className="maka-anchor"
        // Only the bottom edge remains outside the badge. Reconstruct the crown
        // from clean neighbouring tiles, so captured gold/blue labels cannot
        // recursively move their own anchor. A real hover moves the bottom too.
        style={{ left: `${(x + measuredWidth / 2) / 16 * 100}%`, top: `${(y + measuredHeight - h + h * 22 / 167) / 9 * 100}%`, width: `${w * 1.16 / 16 * 100}%` }}>
        <MakaBadge hint={hint} first={rank === 0} kind={choice === 'reach' ? 'reach' : 'discard'} />
      </div>
    })}
    <MakaEvents hints={entered ? events : []} calibration={cfg.calibration} />
    {guiding && cfg.show_analysis !== false && analysis.active && <MakaHandSummary analysis={analysis.hand} style={replayStripStyle(slots,cfg.calibration,cfg.show_actions !== false,cfg.show_risk !== false ? viewport : undefined)} pixelScale={Math.min(viewport.width/1920,viewport.height/1080)} />}
    {cfg.show_risk !== false && analysis.active && frame!.game!.players.filter(p => p.seat !== frame!.game!.our_seat).map(p => <MakaOpponent key={p.seat} opponent={analysis.opponents.find(o => o.seat === p.seat) ?? {seat:p.seat,tenpai_rate:NaN,risk:[],is_riichi:p.riichi_declared}} game={frame!.game!} pending={analysis.pending} viewport={viewport} />)}
  </div>
}
