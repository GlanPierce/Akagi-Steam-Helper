import { useLayoutEffect, useRef } from 'react'

const images = new Map<string, Promise<HTMLImageElement>>()
function loadSprite(src: string) {
  if (!images.has(src)) images.set(src, new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  }))
  return images.get(src)!
}

/** Paint Unity's sliced sprite in one backing store. Integer destination edges
 * prevent WebView's separately composited border-image strips from cracking. */
export function NativeSprite({ src, border = [0, 0, 0, 0], pixelScale = 1, fill }: { src: string; border?: readonly [number, number, number, number]; pixelScale?: number; fill?: { color: string; inset: number } }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [left, bottom, right, top] = border
  const fillColor = fill?.color, fillInset = fill?.inset
  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    let disposed = false
    let sprite: HTMLImageElement | undefined
    const draw = () => {
      if (!sprite || disposed) return
      const box = canvas.getBoundingClientRect()
      if (!box.width || !box.height) return
      const dpr = window.devicePixelRatio || 1
      const width = Math.round(box.width * dpr), height = Math.round(box.height * dpr)
      canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      // Corner labels scale with the tile, while panel borders retain UI scale.
      const scale = top + bottom === 0 ? height / sprite.height : Math.min(dpr * pixelScale, width / (left + right || 1), height / (top + bottom))
      if (fillColor && fillInset !== undefined) {
        const inset = fillInset * dpr * pixelScale
        ctx.fillStyle = fillColor
        ctx.fillRect(inset, inset, width - 2 * inset, height - 2 * inset)
      }
      const sx = [0, left, sprite.width - right, sprite.width]
      const sy = [0, top, sprite.height - bottom, sprite.height]
      const dx = [0, Math.round(left * scale), width - Math.round(right * scale), width]
      const dy = [0, Math.round(top * scale), height - Math.round(bottom * scale), height]
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
        const sw = sx[x + 1] - sx[x], sh = sy[y + 1] - sy[y]
        const dw = dx[x + 1] - dx[x], dh = dy[y + 1] - dy[y]
        if (sw > 0 && sh > 0 && dw > 0 && dh > 0) ctx.drawImage(sprite, sx[x], sy[y], sw, sh, dx[x], dy[y], dw, dh)
      }
    }
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    window.addEventListener('resize', draw)
    void loadSprite(src).then(img => { sprite = img; draw() }).catch(() => { /* retain readable labels if a bundled sprite is unavailable */ })
    return () => { disposed = true; observer.disconnect(); window.removeEventListener('resize', draw) }
  }, [src, left, bottom, right, top, pixelScale, fillColor, fillInset])
  return <canvas ref={ref} className="maka-native-sprite" aria-hidden="true" />
}
