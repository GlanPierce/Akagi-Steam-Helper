import { invoke } from '@/lib/tauri'
import { useConfigStore } from '@/stores/configStore'
import type { OverlayConfig } from '@/types'

type Write = { options: OverlayConfig; waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> }
let pending: Write | null = null
let current: Write | null = null

export function pendingCalibration(fallback: OverlayConfig) {
  return pending?.options ?? current?.options ?? fallback
}

// Keep writes alive across tab/menu unmounts. Coalesce rapid edits while the
// previous write is in flight, so older responses cannot overwrite newer edits.
export function saveCalibration(options: OverlayConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const waiters = [...(pending?.waiters ?? []), { resolve, reject }]
    pending = { options, waiters }
    if (!current) void drain()
  })
}

async function drain() {
  while (pending) {
    const write: Write = pending
    pending = null
    current = write
    try {
      await invoke('update_immersive_options', { overlay: write.options })
      const saved = pendingCalibration(write.options)
      const config = useConfigStore.getState()
      if (config.config) config.setOverlay({ ...config.config.overlay, opacity: saved.opacity, calibration: saved.calibration })
      write.waiters.forEach(waiter => waiter.resolve())
    } catch (error) {
      write.waiters.forEach(waiter => waiter.reject(error))
    } finally { current = null }
  }
}
