import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ImmersiveFrame } from './types'
import { frame } from './fixtures'
const bridge = vi.hoisted(() => ({ handlers: new Map<string, (p: any) => void>(), next: null as any }))
vi.mock('@/lib/tauri', () => ({
  listen: vi.fn(async (name, handler) => { bridge.handlers.set(name, handler); return () => bridge.handlers.delete(name) }),
  invoke: vi.fn((name) => name === 'get_immersive_host' ? Promise.resolve({foreground:true,panel:false,hints:true}) : bridge.next()),
}))
import { useImmersiveFrame } from './useImmersiveFrame'
afterEach(() => { vi.useRealTimers(); bridge.handlers.clear() })
it('retires only the decision during refresh and ignores stale in-flight replies without blanking the table', async () => {
  vi.useFakeTimers()
  const f = frame()
  bridge.next = () => Promise.resolve(f)
  const { result } = renderHook(useImmersiveFrame)
  await act(async () => {})
  expect(result.current.frame?.game).toEqual(f.game)
  let resolve!: (f: ImmersiveFrame) => void
  bridge.next = () => new Promise<ImmersiveFrame>(r => { resolve = r })
  act(() => bridge.handlers.get('immersive-event')!({revision:13,event:{type:'dahai'}}))
  expect(result.current.frame?.game).toEqual(f.game)
  expect(result.current.frame?.response).toBeNull()
  expect(result.current.frame?.can_act).toBe(false)
  await act(async () => resolve(f))
  expect(result.current.frame?.game).toEqual(f.game)
  expect(result.current.frame?.response).toBeNull()
  act(() => bridge.handlers.get('immersive-event')!({revision:14,event:{type:'end_kyoku'}}))
  expect(result.current.frame).toBeNull()
})
