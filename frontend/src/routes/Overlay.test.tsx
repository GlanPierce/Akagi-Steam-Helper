import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { Overlay } from './Overlay'
import { useModelImportStore } from '@/immersive/modelImportStore'

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }))
vi.mock('@/lib/tauri', () => ({ invoke, listen }))
vi.mock('@/immersive/ImmersiveOverlay', () => ({ ImmersiveOverlay: () => <div>牌桌界面</div> }))
beforeEach(() => {
  invoke.mockResolvedValue({ overlay: { enabled: true, immersive: true } })
  listen.mockReset().mockResolvedValue(() => {})
  useModelImportStore.setState({ busy: false, progress: '', warning: '' })
})
it('keeps model-install progress subscribed outside the menu', async () => {
  render(<Overlay />)
  expect(await screen.findByText('牌桌界面')).toBeTruthy()
  const notify = listen.mock.calls.find(([name]) => name === 'notify')![1]
  act(() => useModelImportStore.setState({ busy: true }))
  act(() => notify({ id: 'bot-install-local', title: '模型安装', body: '正在安装环境' }))
  expect(useModelImportStore.getState().progress).toBe('正在安装环境')
  act(() => notify({ id: 'bot-install-local-layout', title: '模型包不完整', body: '缺少配置文件', level: 'warn' }))
  act(() => useModelImportStore.setState({ busy: false, progress: '' }))
  expect(useModelImportStore.getState().warning).toBe('缺少配置文件')
  act(() => notify({ id: 'unrelated', title: '其他通知' }))
  expect(useModelImportStore.getState().progress).toBe('')
  expect(useModelImportStore.getState().warning).toBe('缺少配置文件')
})
it('releases event subscriptions even when registration completes after unmount', async () => {
  const pending: Array<(unlisten: () => void) => void> = []
  listen.mockImplementation(() => new Promise(resolve => pending.push(resolve)))
  const view = render(<Overlay />)
  view.unmount()
  const unlisten = vi.fn()
  await act(async () => pending.forEach(resolve => resolve(unlisten)))
  await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(2))
})
