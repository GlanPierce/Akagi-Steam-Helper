import { useLayoutEffect, useState } from 'react'

export type Viewport = { width: number; height: number }
export type OpponentPosition = 'left' | 'right' | 'across'

export function useViewport(): Viewport {
  const [size, setSize] = useState(() => ({width:window.innerWidth, height:window.innerHeight}))
  useLayoutEffect(() => {
    const resize = () => setSize({width:window.innerWidth, height:window.innerHeight})
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  return size
}

/** UI_DesktopInfo/container_players stretches to the full client, whereas our
 * table is a centred 16:9 rectangle. Preserve the prefab's viewport anchors and
 * 153 * .675 face size, then convert into the table's local coordinates. */
export function nativeRiskAnchor(position: OpponentPosition, {width, height}: Viewport) {
  const scale = Math.min(width / 1920, height / 1080)
  const originX = (width - 1920 * scale) / 2
  const originY = (height - 1080 * scale) / 2
  const face = 103.275 * scale
  const x = position === 'left' ? 60.13794 * scale + face : position === 'right' ? width - 214.892 * scale : width / 2 + 409.825 * scale
  const y = position === 'across' ? height * .4 - 385.171 * scale : height * .1 + (position === 'left' ? 177.555 : 180.425) * scale
  // The 6 px sliced cap has four fully transparent columns at its waist.
  // Align that visible edge with the face; the tips fit its rounded corners.
  const capInset = 4 * scale
  return {left:x - originX + (position === 'left' ? -capInset : capInset), top:y - originY, height:face}
}
