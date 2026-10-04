import { act, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { MenuContent } from './MenuContent'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function setup() {
  const router = createMemoryRouter([{ element: <MenuContent />, children: [
    { index: true, element: <h1>模型内容</h1> },
    { path: '/calibration', element: <h1>校准内容</h1> },
  ] }])
  render(<RouterProvider router={router} />)
  return router
}

it('fades from the decoration layout for 200 ms before revealing the other page for 200 ms', async () => {
  vi.useFakeTimers()
  const router = setup()
  await act(async () => { await router.navigate('/calibration') })
  expect(screen.getByText('模型内容')).toBeTruthy()
  expect(screen.queryByText('校准内容')).toBeNull()
  act(() => vi.advanceTimersByTime(199))
  expect(screen.queryByText('校准内容')).toBeNull()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByRole('heading', { name: '校准内容' })).toBeTruthy()
  expect(screen.queryByText('模型内容')).toBeNull()
  expect(screen.getByText('校准内容').closest('[data-menu-phase]')?.getAttribute('data-menu-phase')).toBe('in')
  act(() => vi.advanceTimersByTime(199))
  expect(screen.getByText('校准内容').closest('[data-menu-phase]')?.getAttribute('data-menu-phase')).toBe('in')
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByText('校准内容').closest('[data-menu-phase]')?.getAttribute('data-menu-phase')).toBe('idle')
})

it('uses the shorter 150 ms outgoing and incoming fades when returning to the decoration layout', async () => {
  vi.useFakeTimers()
  const router = setup()
  await act(async () => { await router.navigate('/calibration') })
  act(() => vi.advanceTimersByTime(400))
  await act(async () => { await router.navigate('/') })
  act(() => vi.advanceTimersByTime(149))
  expect(screen.queryByText('模型内容')).toBeNull()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByRole('heading', { name: '模型内容' })).toBeTruthy()
  expect(screen.queryByText('校准内容')).toBeNull()
  act(() => vi.advanceTimersByTime(149))
  expect(screen.getByText('模型内容').closest('[data-menu-phase]')?.getAttribute('data-menu-phase')).toBe('in')
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByText('模型内容').closest('[data-menu-phase]')?.getAttribute('data-menu-phase')).toBe('idle')
})

it('cancels an obsolete page switch when the user returns before the exit finishes', async () => {
  vi.useFakeTimers()
  const router = setup()
  await act(async () => { await router.navigate('/calibration') })
  act(() => vi.advanceTimersByTime(100))
  await act(async () => { await router.navigate('/') })
  act(() => vi.advanceTimersByTime(500))
  expect(screen.getByRole('heading', { name: '模型内容' })).toBeTruthy()
  expect(screen.queryByText('校准内容')).toBeNull()
})

it('cancels the old incoming deadline when navigating again during a fade-in', async () => {
  vi.useFakeTimers()
  const router = setup()
  await act(async () => { await router.navigate('/calibration') })
  act(() => vi.advanceTimersByTime(250))
  await act(async () => { await router.navigate('/') })
  act(() => vi.advanceTimersByTime(150))
  expect(screen.getByText('模型内容').closest('[data-menu-phase]')?.getAttribute('data-menu-phase')).toBe('in')
  act(() => vi.advanceTimersByTime(150))
  expect(screen.getByText('模型内容').closest('[data-menu-phase]')?.getAttribute('data-menu-phase')).toBe('idle')
})

it('changes pages immediately with no incoming phase when reduced motion is enabled', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const router = setup()
  await act(async () => { await router.navigate('/calibration') })
  expect(screen.queryByText('模型内容')).toBeNull()
  expect(screen.getByRole('heading', { name: '校准内容' })).toBeTruthy()
  expect(screen.getByText('校准内容').closest('[data-menu-phase]')?.getAttribute('data-menu-phase')).toBe('idle')
})
