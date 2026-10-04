import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useOutlet } from 'react-router-dom'
import { menuMotionDuration, menuMotionStyle } from './menuMotion'

function PageContent({ children, phase, fillHeight }: { children: ReactNode; phase: string; fillHeight: boolean }) {
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
  return <div className="hud-drawer-content" style={menuMotionStyle} aria-hidden={phase === 'out'} inert={phase === 'out'}><div ref={reserve}><div ref={content} className="hud-menu-page" data-menu-phase={phase}>{children}</div></div></div>
}

export function MenuContent() {
  const path = useLocation().pathname
  const outlet = useOutlet()
  const latestOutlet = useRef(outlet)
  const shownPath = useRef(path)
  const [shown, setShown] = useState({ path, outlet })
  const [phase, setPhase] = useState('idle')
  useLayoutEffect(() => { latestOutlet.current = outlet })
  useLayoutEffect(() => {
    if (path === shownPath.current) { setPhase('idle'); return }
    const show = () => {
      shownPath.current = path
      setShown({ path, outlet: latestOutlet.current })
      setPhase('in')
    }
    const duration = menuMotionDuration('out')
    if (!duration) { show(); return }
    setPhase('out')
    const timer = window.setTimeout(show, duration)
    return () => window.clearTimeout(timer)
  }, [path])
  // The departing page retains its scroll until it leaves; the arriving page
  // gets a new scrolling surface after the original exit clip finishes.
  return <PageContent key={shown.path} phase={phase} fillHeight={shown.path === '/' || shown.path === '/calibration'}>{shown.outlet}</PageContent>
}
