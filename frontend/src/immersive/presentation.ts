import type { ActionKind } from './types'
export type Presentation = { choice?: ActionKind; declined?: boolean; pendingUntil?: number }
export function act(state: Presentation | undefined, action: ActionKind, ownTurn: boolean, now: number): Presentation {
  if (action === 'pass') return ownTurn ? { choice: 'discard' } : { declined: true }
  if (action === 'reach') return { choice: 'reach' }
  return { ...state, pendingUntil: now + 450 }
}
export function cancel(state?: Presentation): Presentation {
  return state?.choice === 'reach' || state?.choice === 'discard' ? { choice: 'discard' } : {}
}
export const isPending = (state: Presentation | undefined, now: number) => (state?.pendingUntil ?? 0) > now
