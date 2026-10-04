import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createMemoryRouter, NavLink, RouterProvider } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { pendingCalibration, saveCalibration } from './calibrationPersistence'
import type { OverlayConfig } from '@/types'
import type { ImmersiveFrame } from './types'
import { DEFAULT_CALIBRATION } from './HudSurface'
import { NativeSprite } from './NativeSprite'
import { NativeSlider } from './NativeSlider'
import { MenuFooter } from './MenuFooter'
import { useViewport } from './nativeAvatar'
import { LocalModels } from './LocalModels'
import { MenuContent } from './MenuContent'
import './menuLocal.css'

type PanelContext = { frame: ImmersiveFrame | null; cfg: OverlayConfig; close: () => void; scale: number }
const Context = createContext<PanelContext | null>(null)
const usePanel = () => useContext(Context)!
function ModelsRoute() { return <LocalModels /> }
function Layout() {
  const { close, scale } = usePanel()
  return <>
    <header className="hud-drawer-header">
      <img className="maka-menu-title-bg" src="/maka/lobby/img_return1_bg.png" alt="" />
      <span className="hud-brand">MAKA INGAME</span>
      <button className="maka-menu-back" data-native-press-scale type="button" onClick={close} aria-label="关闭牌桌菜单" title="返回牌桌 · Esc"><span className="maka-control-art"><img src="/maka/lobby/img_return1.png" alt="" /></span></button>
    </header>
    <div className="maka-menu-panel">
    <nav className="hud-drawer-tabs" aria-label="菜单页面">{[['/', '模型'], ['/calibration', '提示与校准']].map(([to, label]) => <NavLink key={to} to={to} end>{({isActive}) => <><img src={`/maka/character/${isActive ? 'tab_bright2' : 'tab_gray3'}.png`} alt="" /><span>{label}</span></>}</NavLink>)}</nav>
    <div className="maka-menu-body">
      <NativeSprite src="/maka/character/bg_bound.png" border={[65, 72, 63, 67]} pixelScale={scale} fill={{ color: 'rgba(0, 0, 0, 0.6666666865)', inset: 17.5 }} />
      <MenuContent />
    </div></div><Toaster nativeSkin />
  </>
}
function Calibration() {
  const { cfg } = usePanel()
  const [draft, setDraft] = useState(() => pendingCalibration(cfg))
  const [status, setStatus] = useState('')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const cal = draft.calibration ?? DEFAULT_CALIBRATION
  const change = (next: OverlayConfig) => {
    setDraft(next)
    setStatus('')
    void saveCalibration(next).catch(error => {
      if (mounted.current) setStatus(`保存失败：${String(error)}`)
    })
  }
  return <div className="hud-calibration-page"><h2>位置校准</h2>
    <div className="hud-settings-grid">
      <label className="hud-native-option"><span className="hud-option-name">不透明度</span><NativeSlider label="提示不透明度" min={0.3} max={1} step={0.05} value={draft.opacity} percent onChange={opacity => change({ ...draft, opacity })} /></label>
      {([['x', '水平位置', -2, 2, 0.01], ['y', '垂直位置', -2, 2, 0.01], ['scale', '整体缩放', 0.8, 1.2, 0.005], ['hand_y', '手牌高度', -1, 1, 0.01], ['button_y', '按钮高度', -1, 1, 0.01]] as const).map(([key, label, min, max, step]) => <label className="hud-native-option hud-calibration-option" key={key}><span className="hud-option-name">{label}</span><NativeSlider label={label} min={min} max={max} step={step} value={cal[key]} percent={key === 'scale'} onChange={value => change({ ...draft, calibration: { ...cal, [key]: value } })} /></label>)}
    </div>

    <section className="hud-hotkeys hud-native-option" aria-label="按键说明"><h3>按键说明</h3><p><span><kbd>Ctrl</kbd> + <kbd>Space</kbd></span><span>开关实时指导</span></p><p><span><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd></span><span>打开／关闭牌桌菜单</span></p></section>
    <MenuFooter><button className="hud-local-button" data-native-press-scale aria-label="恢复默认位置" title="恢复默认位置" onClick={() => change({ ...draft, calibration: DEFAULT_CALIBRATION })}>重置</button>{status && <span role="alert">{status}</span>}</MenuFooter>
  </div>
}
export function ControlPanel(props: Omit<PanelContext,'scale'>) {
  const viewport = useViewport()
  // Match the game's 1920 × 1080 canvas scale, including full-client anchors.
  const scale = Math.min(viewport.width/1920, viewport.height/1080)
  // Radix dropdowns/dialogs render outside the drawer. Keep their native skin
  // scoped to the lifetime of this menu, including when guidance is hidden.
  useEffect(() => {
    document.body.classList.add('maka-menu-open')
    document.body.style.setProperty('--skin-scale',String(scale))
    return () => { document.body.classList.remove('maka-menu-open'); document.body.style.removeProperty('--skin-scale') }
  }, [scale])
  const router = useMemo(() => createMemoryRouter([{ element: <Layout />, children: [
    { index: true, element: <ModelsRoute /> }, { path: '/calibration', element: <Calibration /> },
  ] }]), [])
  return <Context.Provider value={{...props,scale}}><div className="maka-menu-shade" /><div className="hud-drawer dark" style={{width:viewport.width/scale,height:viewport.height/scale,transform:`scale(${scale})`}} role="dialog" aria-modal="true" aria-label="MAKA INGAME 牌桌菜单"><RouterProvider router={router} /></div></Context.Provider>
}
