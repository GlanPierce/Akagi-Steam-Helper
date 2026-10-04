import { ACTION_NAMES, probabilityText, tileName } from './model'
import { makaAction, makaPercent, makaTile } from './maka'
import type { ActionKind, Hint } from './types'
import { NativeSprite } from './NativeSprite'
import type { OverlayConfig } from '@/types'
import { eventSlots } from './nativeLayout'

export function MakaTile({ tile, className = '' }: { tile: string; className?: string }) {
  const src = makaTile(tile)
  return src ? <span className={`maka-tile ${className}`}><img src={src} alt={tileName(tile)} draggable={false} /></span> : null
}
export function MakaAction({ kind, best }: { kind: ActionKind; best: boolean }) {
  return <img className="maka-action-picture" src={makaAction(kind, best)} alt={ACTION_NAMES[kind]} draggable={false} />
}
export function MakaBadge({ hint, first, kind = hint.kind }: { hint: Hint; first: boolean; kind?: ActionKind }) {
  return <div className={`maka-badge maka-corner ${first ? 'maka-gold' : 'maka-blue'}`} aria-label={`${hint.label}，模型偏好 ${probabilityText(hint.probability)}`}>
    <NativeSprite src={`/maka/common/maka_corner_label_${first ? 1 : 2}.png`} border={[20, 0, 45, 0]} />
    <div className="maka-badge-body"><MakaAction kind={kind} best={first} /><span className="maka-number">{makaPercent(hint.probability)}</span></div>
    {hint.probabilityNote && <small className="maka-shared">{hint.probabilityNote}</small>}
  </div>
}
export function MakaEvents({ hints, calibration }: { hints: Hint[]; calibration?: OverlayConfig['calibration'] }) {
  if (!hints.length) return null
  // The native controls slide in from the right. Use their final docking slots;
  // alternating animated silhouettes and a fallback creates visible jumping.
  const slots = eventSlots(hints,calibration)
  return <aside className="maka-events" aria-label="按钮动作概率">
    {hints.map((hint, i) => {
      const {x,w,bottom} = slots[i]
      return <div key={hint.id} data-testid={`event-${hint.id}`} className={`maka-event ${i === 0 && hint.probability !== null ? 'maka-gold' : 'maka-blue'}`}
        aria-label={`${hint.label}，模型偏好 ${probabilityText(hint.probability)}`}
        style={{left:`${x/16*100}%`,top:`${bottom/9*100}%`,width:`${w/16*100}%`}}>
      <MakaAction kind={hint.kind} best={i === 0 && hint.probability !== null} />
      {!!hint.choice?.consumed.length && <span className="maka-event-tiles">{hint.choice.consumed.map((tile, n) => <MakaTile key={n} tile={tile} />)}</span>}
      <strong>{makaPercent(hint.probability)}</strong>
    </div>})}
  </aside>
}
