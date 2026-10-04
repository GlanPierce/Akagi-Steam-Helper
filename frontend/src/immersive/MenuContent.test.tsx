import { act, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { MenuContent } from './MenuContent'

afterEach(() => vi.useRealTimers())

function setup() {
  const router = createMemoryRouter([{ element: <MenuContent />, children: [
    { index: true, element: <h1>模型内容</h1> },
    { path: '/calibration', element: <h1>校准内容</h1> },
  ] }])
  render(<RouterProvider router={router} />)
  return router
}

it('keeps the outgoing page mounted until the native exit animation finishes', async () => {
  vi.useFakeTimers()
  const router = setup()
  await act(async () => { await router.navigate('/calibration') })
  expect(screen.getByText('模型内容')).toBeTruthy()
  expect(screen.queryByText('校准内容')).toBeNull()
  act(() => vi.advanceTimersByTime(249))
  expect(screen.queryByText('校准内容')).toBeNull()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByRole('heading', { name: '校准内容' })).toBeTruthy()
  expect(screen.queryByText('模型内容')).toBeNull()
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
