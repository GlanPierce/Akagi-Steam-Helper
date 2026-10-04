import { useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { menuMotionDuration, menuMotionStyle } from './menuMotion'

export function MenuPresence({ open, children, onExited }: { open: boolean; children: ReactNode; onExited?: () => void }) {
  const [present, setPresent] = useState(open)
  const wasOpen = useRef(open)
  const exited = useEffectEvent(() => onExited?.())
  useLayoutEffect(() => {
    if (open) { wasOpen.current = true; setPresent(true); return }
    if (!wasOpen.current) return
    const finish = () => { wasOpen.current = false; setPresent(false); exited() }
    const duration = menuMotionDuration('out')
    if (!duration) { finish(); return }
    const timer = window.setTimeout(finish, duration)
    return () => window.clearTimeout(timer)
  }, [open])
  if (!open && !present) return null
  return <div className={`maka-menu-transition${open ? '' : ' is-closing'}`} style={menuMotionStyle} aria-hidden={!open} inert={!open}>{children}</div>
}
