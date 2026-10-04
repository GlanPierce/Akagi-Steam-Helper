import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MenuPresence } from './MenuPresence'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('keeps closing menu art until exit ends but removes its interactive surface immediately', () => {
  vi.useFakeTimers()
  const view = render(<MenuPresence open><button>返回牌桌</button></MenuPresence>)
  view.rerender(<MenuPresence open={false}><button>返回牌桌</button></MenuPresence>)
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.getByText('返回牌桌')).toBeTruthy()
  act(() => vi.advanceTimersByTime(249))
  expect(screen.getByText('返回牌桌')).toBeTruthy()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.queryByText('返回牌桌')).toBeNull()
})

it('does not let a previous close timer remove a reopened menu', () => {
  vi.useFakeTimers()
  const view = render(<MenuPresence open><button>返回牌桌</button></MenuPresence>)
  view.rerender(<MenuPresence open={false}><button>返回牌桌</button></MenuPresence>)
  act(() => vi.advanceTimersByTime(100))
  view.rerender(<MenuPresence open><button>返回牌桌</button></MenuPresence>)
  act(() => vi.advanceTimersByTime(500))
  expect(screen.getByRole('button', { name: '返回牌桌' })).toBeTruthy()
})

it('reports an exit once, only after an open menu finishes closing', () => {
  vi.useFakeTimers()
  const exited = vi.fn()
  const view = render(<MenuPresence open={false} onExited={exited}>Menu</MenuPresence>)
  act(() => vi.advanceTimersByTime(500))
  expect(exited).not.toHaveBeenCalled()
  view.rerender(<MenuPresence open onExited={exited}>Menu</MenuPresence>)
  view.rerender(<MenuPresence open={false} onExited={exited}>Menu</MenuPresence>)
  act(() => vi.advanceTimersByTime(100))
  view.rerender(<MenuPresence open onExited={exited}>Menu</MenuPresence>)
  act(() => vi.advanceTimersByTime(500))
  expect(exited).not.toHaveBeenCalled()
  view.rerender(<MenuPresence open={false} onExited={exited}>Menu</MenuPresence>)
  act(() => vi.advanceTimersByTime(249))
  expect(exited).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(1))
  expect(exited).toHaveBeenCalledTimes(1)
})

it('closes without a wait when reduced motion is enabled', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const view = render(<MenuPresence open><button>返回牌桌</button></MenuPresence>)
  view.rerender(<MenuPresence open={false}><button>返回牌桌</button></MenuPresence>)
  expect(screen.queryByText('返回牌桌')).toBeNull()
})
