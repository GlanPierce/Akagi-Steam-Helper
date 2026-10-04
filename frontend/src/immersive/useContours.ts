import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { invoke, listen } from '@/lib/tauri'
import { freshShapes, type ContourFrame, type ContourRequest } from './contours'
// A webview reload starts after the previous epoch; StrictMode and out-of-order
// IPC completions cannot let an older close/empty request replace a newer one.
let generation = Date.now() * 1000
const nextGeneration = () => ++generation

export function useContours(request: ContourRequest, enabled: boolean) {
  const [latest, setLatest] = useState<(ContourFrame & { received: number }) | null>(null)
  const [now, setNow] = useState(Date.now())
  const expectedGeneration = useRef(0)
  const receive = useEffectEvent((frame: ContourFrame) => {
    if (enabled && frame.key === request.key && frame.generation === expectedGeneration.current) { const received = Date.now(); setNow(received); setLatest({ ...frame, received }) }
  })
  useEffect(() => {
    let disposed = false, unlisten: (() => void) | undefined
    void listen<ContourFrame>('immersive-contours', frame => receive(frame)).then(u => { if (disposed) u(); else unlisten = u })
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => { disposed = true; unlisten?.(); window.clearInterval(timer); expectedGeneration.current = nextGeneration(); void invoke('set_immersive_targets', { generation: expectedGeneration.current, request: { key: 'closed', targets: [] } }).catch(() => {}) }
  }, [])
  // A stable serialized key avoids retransmitting identical targets for each analysis tick.
  useEffect(() => {
    const [, targets] = JSON.parse(request.key) as [number | null, ContourRequest['targets']]
    expectedGeneration.current = nextGeneration()
    const sent = expectedGeneration.current
    void invoke('set_immersive_targets', { generation: sent, request: { key: request.key, targets: enabled ? targets : [] } }).catch(() => { if (sent === expectedGeneration.current) setLatest(null) })
  }, [request.key, enabled])
  return enabled && latest?.generation === expectedGeneration.current ? freshShapes(latest, request.key, now) : []
}
