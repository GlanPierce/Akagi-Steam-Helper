import { expect, it } from 'vitest'
import { FrameGate } from './frameGate'
import { frame } from './fixtures'
it('retires the current decision immediately and rejects an in-flight old frame', () => {
  const gate = new FrameGate(), f = frame()
  expect(gate.accept(f)?.revision).toBe(12)
  gate.invalidate()
  expect(gate.accept(f)).toBeNull()
  const next = { ...f, revision: 13 }
  expect(gate.accept(next)?.response).toBeNull()
  next.response = { type: 'none', meta: { akagi_revision: 13 } }
  expect(gate.accept(next)?.response).toEqual(next.response)
  expect(gate.accept(f)).toBeNull()
})
it('accepts a fresh matching response on the same decision; never revives ended/disconnected actions', () => {
  const gate = new FrameGate(), f = frame()
  expect(gate.accept({ ...f, response: null })?.response).toBeNull()
  expect(gate.accept(f)?.response).not.toBeNull()
  expect(gate.accept({ ...f, can_act: false })?.response).toBeNull()
  expect(gate.accept({ ...f, capture: { state: 'stopped' } })?.response).toBeNull()
})
it('uses authoritative event revisions even before first hydration and ignores notifications already included', () => {
  const gate = new FrameGate(), f = frame()
  gate.invalidate(13)
  expect(gate.accept(f)).toBeNull()
  const next = { ...f, revision: 13, response: { type: 'none' as const, meta: { akagi_revision: 13 } } }
  expect(gate.accept(next)?.response).toEqual(next.response)
  expect(gate.invalidate(13)).toBe(false)
  expect(gate.accept(next)?.response).toEqual(next.response)
  expect(gate.invalidate(12)).toBe(false)
})
