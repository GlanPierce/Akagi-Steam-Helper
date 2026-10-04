import { useEffect, useRef, useState } from 'react'
import { invoke, listen } from '@/lib/tauri'
import type { HostState, ImmersiveFrame } from './types'
import { FrameGate } from './frameGate'

export function useImmersiveFrame() {
  const [frame, setFrame] = useState<ImmersiveFrame | null>(null)
  const [error, setError] = useState(false)
  const [host, setHost] = useState<HostState>({ foreground: false, panel: false, hints: true })
  const gate = useRef(new FrameGate())
  useEffect(() => {
    let cancelled = false, busy = false
    const unlisteners: Array<() => void> = []
    const subscribe = <T,>(name: string, fn: (payload: T) => void) => {
      void listen<T>(name, fn).then(unlisten => cancelled ? unlisten() : unlisteners.push(unlisten))
    }
    const refresh = async () => {
      if (busy || cancelled) return
      busy = true
      const timeout = window.setTimeout(() => { if (!cancelled) { setFrame(null); setError(true) } }, 1500)
      try {
        const next = await invoke<ImmersiveFrame>('get_immersive_frame')
        if (!cancelled) {
          const accepted = gate.current.accept(next)
          // An older in-flight reply is not a reason to erase the current table.
          if (accepted) setFrame(accepted)
          setError(false)
        }
      } catch { if (!cancelled) { setFrame(null); setError(true) } }
      finally { window.clearTimeout(timeout); busy = false }
    }
    // Only the post-tracker event knows which revision must be visible.
    // A notification may arrive after polling has already accepted that frame.
    subscribe<{ revision: number; event: { type: string } }>('immersive-event', e => {
      if (gate.current.invalidate(e.revision)) {
        const boundary = ['start_game', 'start_kyoku', 'end_kyoku', 'end_game'].includes(e.event.type)
        // Retire actionable data immediately. Keep the table identity mounted
        // while IPC and analysis catch up, except at actual round boundaries.
        setFrame(previous => boundary || !previous ? null : { ...previous, response: null, analysis: null, can_act: false, legal_actions: [] })
      }
      void refresh()
    })
    subscribe('bot-response', () => void refresh())
    subscribe('analysis-result', () => void refresh())
    subscribe<{ state: string }>('capture-status', status => { if (status.state !== 'running') setFrame(null); void refresh() })
    subscribe<HostState>('immersive-host', setHost)
    void invoke<HostState>('get_immersive_host').then(s => { if (!cancelled) setHost(s) }).catch(() => {})
    void refresh()
    const timer = window.setInterval(() => void refresh(), 100)
    return () => { cancelled = true; window.clearInterval(timer); unlisteners.forEach(f => f()) }
  }, [])
  return { frame, error, host }
}
