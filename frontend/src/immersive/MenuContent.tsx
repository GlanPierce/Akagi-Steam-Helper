import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useLocation, useOutlet } from 'react-router-dom'
import { menuMotionStyle, pageMotionTiming } from './menuMotion'

function PageContent({ children, phase, timing, fillHeight }: { children: ReactNode; phase: string; timing: { outMs: number; inMs: number }; fillHeight: boolean }) {
  const reserve = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    // Models and calibration fill the viewport and own their inner scrolling.
    // Measuring its percentage height back into its parent creates a resize loop.
    if (fillHeight) return
    const page = content.current!
    let height = 0
    const measure = () => {
      // Pending analysis briefly removes tables. Reserve the largest height in
      // this tab visit so the browser cannot clamp the user's scroll to zero.
      // offsetHeight is unscaled; the drawer is scaled as a whole for the HUD.
      height = Math.max(height, page.offsetHeight)
      reserve.current!.style.minHeight = `${height}px`
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(page)
    return () => observer.disconnect()
  }, [fillHeight])
  const style = { ...menuMotionStyle, '--page-exit-time': `${timing.outMs}ms`, '--page-enter-time': `${timing.inMs}ms` } as CSSProperties
  return <div className="hud-drawer-content" style={style} aria-hidden={phase === 'out'} inert={phase === 'out'}><div ref={reserve}><div ref={content} className="hud-menu-page" data-menu-phase={phase}>{children}</div></div></div>
}

export function MenuContent() {
  const path = useLocation().pathname
  const outlet = useOutlet()
  const latestOutlet = useRef(outlet)
  const shownPath = useRef(path)
  const [shown, setShown] = useState({ path, outlet })
  const [phase, setPhase] = useState('idle')
  const [timing, setTiming] = useState(() => pageMotionTiming(path))
  useLayoutEffect(() => { latestOutlet.current = outlet })
  useLayoutEffect(() => {
    if (path === shownPath.current) { setPhase('idle'); return }
    const nextTiming = pageMotionTiming(path)
    setTiming(nextTiming)
    let enterTimer: number | undefined
    const show = () => {
      shownPath.current = path
      setShown({ path, outlet: latestOutlet.current })
      setPhase(nextTiming.inMs ? 'in' : 'idle')
      if (nextTiming.inMs) enterTimer = window.setTimeout(() => setPhase('idle'), nextTiming.inMs)
    }
    if (!nextTiming.outMs) { show(); return }
    setPhase('out')
    const exitTimer = window.setTimeout(show, nextTiming.outMs)
    return () => { window.clearTimeout(exitTimer); window.clearTimeout(enterTimer) }
  }, [path])
  // The departing page retains its scroll until it leaves; the arriving page
  // gets a new scrolling surface after the native page fade finishes.
  return <PageContent key={shown.path} phase={phase} timing={timing} fillHeight={shown.path === '/' || shown.path === '/calibration'}>{shown.outlet}</PageContent>
}
