import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import type { OverlayConfig } from '@/types'
import { listen, invoke } from '@/lib/tauri'
import { ControlPanel } from './ControlPanel'
import { MenuPresence } from './MenuPresence'
import { HudSurface, DEFAULT_CALIBRATION } from './HudSurface'
import { useImmersiveFrame } from './useImmersiveFrame'
import { buttonRects, uniqueChoices, tileRects, choiceRect, isKan } from './geometry'
import type { GameClick, ImmersiveFrame, Rect } from './types'
import { act, cancel, isPending, type Presentation } from './presentation'
import { buildHints } from './model'
import { contourRequest, hitsShape, type Silhouette } from './contours'
import { useContours } from './useContours'
import { useViewport } from './nativeAvatar'
import { useHudHotspots } from './useHudHotspots'
import { MakaControls } from './MakaControls'
import { useMakaFeedback } from './useMakaFeedback'
import './immersive.css'

export function ImmersiveOverlay({ cfg, preview, previewShapes }: { cfg: OverlayConfig; preview?: ImmersiveFrame; previewShapes?: Silhouette[] }) {
  useMakaFeedback()
  const live = useImmersiveFrame()
  const viewport = useViewport()
  const frame = preview ?? live.frame
  const [selection, setSelection] = useState<(Presentation & { revision: number }) | null>(null)
  const [now, setNow] = useState(Date.now())
  const [previewPanel, setPreviewPanel] = useState(false)
  const [closingPanel, setClosingPanel] = useState(false)
  const [previewHints, setPreviewHints] = useState(true)
  const [previewAutoplay,setPreviewAutoplay] = useState(false)
  const [previewCfg,setPreviewCfg] = useState(cfg)
  const effectiveCfg = preview ? previewCfg : cfg
  const root = useRef<HTMLDivElement>(null)
  const current = selection && selection.revision === frame?.revision ? selection : undefined
  const choice = current?.choice
  const foreground = preview ? true : live.host.foreground
  const panel = preview ? previewPanel : live.host.panel
  const hintsFrame = frame && (current?.declined || isPending(current, now)) ? { ...frame, response: null } : frame
  const guiding = preview ? previewHints : live.host.hints
  const toggleGuidance = useCallback(async () => {
    if (preview) setPreviewHints(h => !h)
    else await invoke('toggle_immersive_hints')
  },[preview])
  useHudHotspots(root,!preview && foreground && !panel)
  const request = contourRequest(hintsFrame, hintsFrame ? buildHints(hintsFrame, choice) : [], cfg.calibration)
  const liveShapes = useContours(request, !preview && foreground && !panel && live.host.hints)
  const shapes = preview ? previewShapes ?? [] : liveShapes
  const close = useCallback(() => {
    if (panel) setClosingPanel(true)
  }, [panel])
  const finishClose = () => {
    if (!closingPanel || !panel) return
    // Keep native input capture and focus until the original out clip ends.
    if (preview) setPreviewPanel(false)
    else void invoke('set_immersive_panel', { open: false }).catch(() => setClosingPanel(false))
  }
  useEffect(() => {
    if (!panel || !foreground) setClosingPanel(false)
  }, [panel, foreground])
  const togglePreviewPanel = useCallback(() => {
    if (panel && !closingPanel) close()
    else { setClosingPanel(false); setPreviewPanel(true) }
  }, [panel, closingPanel, close])
  const onCancel = useEffectEvent(() => {
    if (frame) setSelection({ ...cancel(current), revision: frame.revision })
  })
  const onClick = useEffectEvent((point: GameClick) => {
    if (!frame?.game || !frame.can_act || current?.declined) return
    if (point.button === 'right') { onCancel(); return }
    const c = cfg.calibration ?? DEFAULT_CALIBRATION
    const x = (point.x - 8 - c.x) / c.scale + 8, y = (point.y - 4.5 - c.y) / c.scale + 4.5
    const hits = (r: Rect, offset: number, id: string) => {
      const measured = shapes.find(s => s.id === id)
      return measured ? hitsShape(measured, point.x, point.y) : !!preview && Math.abs(x - r.x) < r.w / 2 && Math.abs(y - r.y - offset) < r.h / 2
    }
    const update = (next: Presentation) => { setNow(Date.now()); setSelection({ ...next, revision: frame.revision }) }
    const ownTurn = frame.game.phase === 'wait_act'
    if (choice && !['reach', 'discard'].includes(choice)) {
      const choices = uniqueChoices(frame.legal_actions, choice)
      if (choices.some((_, i) => { const r = choiceRect(i, choices.length, isKan(choice)); return r && hits(r, c.button_y, `choice-${i}`) })) update(act(current, 'discard', ownTurn, Date.now()))
      else if (buttonRects(frame.legal_actions).some(r => r.kind === 'pass' && hits(r, c.button_y, 'button-pass'))) onCancel()
      return
    }
    if (!choice) {
      const clicked = buttonRects(frame.legal_actions).find(r => hits(r, c.button_y, `button-${r.kind}`))
      if (clicked) {
        if (uniqueChoices(frame.legal_actions, clicked.kind).length > 1 && ['chi', 'pon', 'ankan', 'kakan', 'daiminkan'].includes(clicked.kind)) update({ choice: clicked.kind })
        else update(act(current, clicked.kind, ownTurn, Date.now()))
        return
      }
    }
    if (tileRects(frame.game).some(r => hits(r, c.hand_y, `tile-${r.index}`))) update(act(current, 'discard', ownTurn, Date.now()))
    else if (choice === 'reach' && buttonRects(frame.legal_actions).some(r => r.kind === 'pass' && hits(r, c.button_y, 'button-pass'))) onCancel()
  })
  useEffect(() => {
    let disposed = false
    const unlisteners: Array<() => void> = []
    const subscribe = <T,>(name: string, fn: (value: T) => void) => void listen<T>(name, fn).then(u => disposed ? u() : unlisteners.push(u))
    subscribe('immersive-cancel', () => onCancel())
    subscribe<GameClick>('immersive-click', point => onClick(point))
    return () => { disposed = true; unlisteners.forEach(u => u()) }
  }, [])
  useEffect(() => {
    if (!selection?.pendingUntil) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, selection.pendingUntil - Date.now()))
    return () => window.clearTimeout(timer)
  }, [selection])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (preview && e.ctrlKey && !e.altKey && !e.repeat && e.code === 'Space') {
        e.preventDefault()
        if (e.shiftKey) togglePreviewPanel()
        else void toggleGuidance()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [close, preview, toggleGuidance, togglePreviewPanel])
  if (!foreground) return null
  const activeGame = !!frame?.game && !frame.game.is_done
  const ready = !!frame && (preview || !live.error) && frame.capture.state === 'running' && frame.transport_connected !== false && frame.bot_status.state === 'ready'
  const uiScale = Math.min(viewport.width / 1920, viewport.height / 1080)
  return <div className="immersive-root" ref={root}>
    <div className="hud-table-area">
      <HudSurface frame={hintsFrame} cfg={effectiveCfg} guiding={guiding} choice={choice} shapes={shapes} />
    </div>
    {activeGame && !panel && <MakaControls cfg={effectiveCfg} ready={ready} guiding={guiding} scale={uiScale} autoplay={preview ? previewAutoplay : !!live.host.autoplay}
      onAutoplay={async enabled=>{if(preview) setPreviewAutoplay(enabled); else await invoke('set_immersive_autoplay',{enabled})}}
      onToggle={toggleGuidance}
      onChange={async (feature,enabled) => { if(preview) setPreviewCfg(current=>({...current,[feature]:enabled})); else await invoke('update_immersive_options',{feature,enabled}) }} />}
    <MenuPresence open={panel && !closingPanel} onExited={finishClose}><ControlPanel frame={frame} cfg={effectiveCfg} close={close} /></MenuPresence>
    {preview && <button className="hud-preview-menu" onClick={togglePreviewPanel}>查看游戏内菜单</button>}
  </div>
}
