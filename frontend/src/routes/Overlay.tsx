import { useEffect, useState } from 'react'
import { invoke, listen } from '@/lib/tauri'
import type { AppConfig, Notification, OverlayConfig } from '@/types'
import { ImmersiveOverlay } from '@/immersive/ImmersiveOverlay'
import { useModelImportStore } from '@/immersive/modelImportStore'

// The game overlay is the only application window. Keep install progress
// subscribed while its menu is closed so returning to the table is harmless.
export function Overlay() {
  const [cfg, setCfg] = useState<OverlayConfig | null>(null)
  useEffect(() => {
    let cancelled = false
    const unlistens: Array<() => void> = []
    const subscribe = <T,>(name: string, cb: (payload: T) => void) => {
      void listen<T>(name, value => { if (!cancelled) cb(value) })
        .then(u => cancelled ? u() : unlistens.push(u)).catch(() => {})
    }
    void invoke<AppConfig>('get_config').then(c => { if (!cancelled) setCfg(c.overlay) }).catch(() => {})
    subscribe<OverlayConfig>('overlay-config', setCfg)
    subscribe<Notification>('notify', notification => {
      if (useModelImportStore.getState().busy && notification.id?.match(/^bot-(install|sync)-/)) {
        const progress = notification.body || notification.title
        useModelImportStore.setState({ progress, ...(notification.level === 'warn' ? { warning: progress } : {}) })
      }
    })
    return () => { cancelled = true; unlistens.forEach(u => u()) }
  }, [])
  return cfg ? <ImmersiveOverlay cfg={cfg} /> : null
}
