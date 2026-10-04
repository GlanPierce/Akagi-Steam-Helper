import { describe, expect, it } from 'vitest'
import { act, cancel, isPending } from './presentation'

describe('local game prompts without a network revision', () => {
  it('keeps ordinary discards after canceling an own-turn prompt', () => {
    expect(act(undefined, 'pass', true, 100).choice).toBe('discard')
    expect(cancel({ choice: 'reach' }).choice).toBe('discard')
  })
  it('only hides an unconfirmed tile click briefly, then restores its selection', () => {
    const state = act({ choice: 'reach' }, 'discard', true, 100)
    expect(isPending(state, 200)).toBe(true)
    expect(isPending(state, 600)).toBe(false)
    expect(state.choice).toBe('reach')
  })
  it('keeps a declined opponent call hidden until the next game event', () => {
    expect(act(undefined, 'pass', false, 100).declined).toBe(true)
    expect(cancel({ choice: 'chi' }).choice).toBeUndefined()
  })
})
