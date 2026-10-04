import type { CSSProperties } from 'react'
import type { OverlayConfig } from '@/types'
import type { ActionKind, ImmersiveFrame, Rect } from './types'
import { buttonRects, choiceRect, isKan, uniqueChoices } from './geometry'
import { nativeRiskAnchor, type Viewport } from './nativeAvatar'

type Slot = Rect & { id: string }
export function eventSlots(hints: Slot[], calibration?: OverlayConfig['calibration']) {
  const c = calibration ?? {x:0,y:0,scale:1,button_y:0,hand_y:0}
  const rows = [...new Set(hints.map(h => h.y))].sort((a,b) => b-a)
  const nativeTop = Math.min(...hints.map(h => 4.5 + (h.y+c.button_y-h.h/2-4.5)*c.scale+c.y))
  return hints.map(h => {
    const w = (h.id.startsWith('choice-') ? Math.min(260/120,h.w) : 260/120)*c.scale
    // Combination selectors include raised tiles above their nominal slot.
    const gap = h.id.startsWith('choice-') ? .3 : .08
    return {id:h.id,x:8+(h.x-8)*c.scale+c.x, bottom:nativeTop-(gap+rows.indexOf(h.y)*1.12)*c.scale,w,h:w*126/260}
  })
}

/** Reserve the dock before inference arrives so the strip never jumps with a
 * response refresh. Only a different legal action screen changes this layout. */
export function actionSlots(frame: ImmersiveFrame | null, choice?: ActionKind): Slot[] {
  if (!frame?.game || frame.game.is_done || !frame.can_act || frame.transport_connected === false || frame.capture.state !== 'running' || choice === 'reach' || choice === 'discard') return []
  if (choice) {
    const choices = uniqueChoices(frame.legal_actions,choice)
    return choices.flatMap((_,i) => { const r=choiceRect(i,choices.length,isKan(choice)); return r ? [{...r,id:`choice-${i}`}] : [] })
  }
  return buttonRects(frame.legal_actions).map(r => ({...r,id:`button-${r.kind}`}))
}
export function replayStripStyle(slots: Slot[], calibration?: OverlayConfig['calibration'], showActions = true, opponents?: Viewport): CSSProperties {
  // UI_Replay/root: native dimensions and .9 scale. Move as a whole; never
  // squeeze its height when waits or action rows change.
  const height = 124*.9/120
  const c = calibration ?? {x:0,y:0,scale:1,button_y:0,hand_y:0}
  const events = eventSlots(slots,calibration)
  const controls = events.map((s,i) => showActions ? s.bottom-s.h : 4.5+(slots[i].y+c.button_y-slots[i].h/2-4.5)*c.scale+c.y)
  const bottom = events.length ? Math.min(...controls)-.1 : 765/120+height
  let top = Math.min(765/120,bottom-height)
  if (opponents) {
    const unit = Math.min(opponents.width/16,opponents.height/9)
    const bands = ['left','right'].map(p=>nativeRiskAnchor(p as 'left'|'right',opponents))
    const riskTop = Math.min(...bands.map(b=>b.top/unit))
    const riskBottom = Math.max(...bands.map(b=>(b.top+b.height)/unit))
    if (top < riskBottom && top+height > riskTop) top = Math.min(top,riskTop-.1-height)
  }
  return {left:`${567.1/1920*100}%`,top:`${top/9*100}%`,maxWidth:`${1211*.9/1920*100}%`,height:`${height/9*100}%`}
}
