import { expect, it } from 'vitest'
import { contourRequest, freshShapes, hitsShape, shapePath, type Silhouette } from './contours'
import { frame } from './fixtures'
import { buildHints } from './model'
const shape: Silhouette = { id: 'tile-0', bounds: [1.85, 7.28, .77, 1.3], paths: [[[1.85, 7.3], [1.88, 7.28], [2.59, 7.28], [2.62, 7.32], [2.62, 8.58], [1.85, 8.58]]] }
it('follows a lifted shape for input instead of the old hand-row rectangle', () => {
  expect(hitsShape(shape, 2.2, 7.35)).toBe(true)
  expect(hitsShape(shape, 2.2, 8.94)).toBe(false)
  expect(shapePath(shape)).toContain('A')
})
it('renders tile corners as exact arcs and curves control edges without rounding real sharp corners', () => {
  const tile = shapePath(shape)
  expect(tile.match(/A/g)).toHaveLength(4)
  const control: Silhouette = { id: 'button-pass', bounds: [0, 0, 2, 2], paths: [[[0,0],[1,0],[1.5,.15],[1.8,.5],[2,1],[2,2],[0,2]]] }
  const path = shapePath(control)
  expect(path).toContain('C')
  expect(path).toContain('L0.0000,0.0000')
  expect(path).not.toMatch(/NaN|Infinity/)
  expect(shapePath({ ...control, paths: [control.paths[0], [[3,3],[4,3],[4,4],[3,4]]] }).match(/M/g)).toHaveLength(2)
})
it('does not activate a button through a hole or a cut-off corner', () => {
  const ring: Silhouette = { id: 'pon', bounds: [0, 0, 3, 3], paths: [[[0, 0], [2, 0], [3, 1], [3, 3], [0, 3]], [[1, 1], [2, 1], [2, 2], [1, 2]]] }
  expect(hitsShape(ring, 2.8, .1)).toBe(false)
  expect(hitsShape(ring, 1.5, 1.5)).toBe(false)
  expect(hitsShape(ring, .5, 1.5)).toBe(true)
})
it('drops late selection contours and expired measurements immediately', () => {
  const f = { key: '1:pon', shapes: [shape], received: 100 }
  expect(freshShapes(f, '1:chi', 120)).toEqual([])
  expect(freshShapes(f, '1:pon', 400)).toEqual([])
  expect(freshShapes(f, '1:pon', 120)).toEqual([shape])
})
it('requests the whole hand so a restricted riichi recommendation cannot shift onto its neighbour', () => {
  const f = frame(), hints = buildHints(f).filter(h => h.id === 'tile-4')
  const request = contourRequest(f, hints, undefined)
  expect(request.targets).toHaveLength(14)
  expect(request.targets[13].x).toBeCloseTo(12.75625)
  expect(contourRequest(f, [], undefined).targets).toEqual([])
})
