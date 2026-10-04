import type { Hint, ImmersiveFrame, Rect } from './types'
import type { OverlayConfig } from '@/types'
import { tileRects } from './geometry'

export type Silhouette = { id: string; paths: Array<Array<[number, number]>>; bounds: [number, number, number, number] }
export type ContourFrame = { key: string; generation?: number; shapes: Silhouette[] }
export type ContourRequest = { key: string; targets: Array<Rect & { id: string; kind: 'tile' | 'action' | 'choice' }> }
export function contourRequest(frame: ImmersiveFrame | null, hints: Hint[], calibration: OverlayConfig['calibration']): ContourRequest {
  const cal = calibration ?? { x: 0, y: 0, scale: 1, hand_y: 0, button_y: 0 }
  const hand = hints.some(h => h.kind === 'discard') && frame?.game ? tileRects(frame.game).map(t => ({ ...t, id: `tile-${t.index}`, kind: 'tile' as const })) : []
  const controls = hints.filter(h => h.kind !== 'discard').map(h => ({ ...h, kind: h.choice ? 'choice' as const : 'action' as const }))
  const targets = [...hand, ...controls].map(t => ({ id: t.id, kind: t.kind, x: 8 + (t.x - 8) * cal.scale + cal.x, y: 4.5 + (t.y + (t.kind === 'tile' ? cal.hand_y : cal.button_y) - 4.5) * cal.scale + cal.y, w: t.w * cal.scale, h: t.h * cal.scale }))
  return { key: JSON.stringify([frame?.revision ?? null, targets]), targets }
}
export function freshShapes(value: (ContourFrame & { received: number }) | null, key: string, now: number): Silhouette[] {
  return value?.key === key && now - value.received <= 250 ? value.shapes : []
}
export const shapeRect = (s: Silhouette): Rect => ({ x: s.bounds[0] + s.bounds[2] / 2, y: s.bounds[1] + s.bounds[3] / 2, w: s.bounds[2], h: s.bounds[3] })
type Point = [number, number]
const pointText = ([x, y]: Point) => `${x.toFixed(4)},${y.toFixed(4)}`
function curvedPath(points: Point[]): string {
  if (points.length < 3) return ''
  // Short, bounded handles soften alpha-pixel stair steps. Real acute corners
  // retain zero tangents, and each cubic stays within its control-point hull.
  const tangent = (i: number): Point => {
    const before = points[(i + points.length - 1) % points.length], p = points[i], after = points[(i + 1) % points.length]
    const a: Point = [p[0] - before[0], p[1] - before[1]], b: Point = [after[0] - p[0], after[1] - p[1]]
    const la = Math.hypot(...a), lb = Math.hypot(...b)
    if (la < 1e-8 || lb < 1e-8 || (a[0] * b[0] + a[1] * b[1]) / (la * lb) < .5) return [0, 0]
    const direction: Point = [a[0] / la + b[0] / lb, a[1] / la + b[1] / lb]
    const length = Math.min(la / 3, lb / 3, .012) / Math.hypot(...direction)
    return [direction[0] * length, direction[1] * length]
  }
  const tangents = points.map((_, i) => tangent(i))
  let result = `M${pointText(points[0])}`
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length, a = points[i], b = points[j], ta = tangents[i], tb = tangents[j]
    result += ta.every(v => v === 0) && tb.every(v => v === 0) ? `L${pointText(b)}` :
      `C${pointText([a[0] + ta[0], a[1] + ta[1]])} ${pointText([b[0] - tb[0], b[1] - tb[1]])} ${pointText(b)}`
  }
  return `${result}Z`
}
export function shapePath(s: Silhouette): string {
  if (s.id.startsWith('tile-') && s.paths.length) {
    const [x, y, w, h] = s.bounds, r = Math.min(.045, w / 8, h / 8), arc = `A${r.toFixed(4)},${r.toFixed(4)} 0 0 1 `
    return `M${pointText([x + r, y])}H${(x + w - r).toFixed(4)}${arc}${pointText([x + w, y + r])}V${(y + h - r).toFixed(4)}${arc}${pointText([x + w - r, y + h])}H${(x + r).toFixed(4)}${arc}${pointText([x, y + h - r])}V${(y + r).toFixed(4)}${arc}${pointText([x + r, y])}Z`
  }
  return s.paths.map(p => s.id.startsWith('button-') ? curvedPath(p) : p.length ? `M${p.map(pointText).join('L')}Z` : '').join('')
}
export function hitsShape(shape: Silhouette, x: number, y: number): boolean {
  const [left, top, width, height] = shape.bounds
  if (x < left || x > left + width || y < top || y > top + height) return false
  let inside = false
  for (const path of shape.paths) for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    const [xi, yi] = path[i], [xj, yj] = path[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
