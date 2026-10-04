import { beforeEach, expect, it, vi } from 'vitest'
import { useBotStore } from '@/stores/botStore'
import { useModelImportStore } from './modelImportStore'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tauri', () => ({ invoke }))
beforeEach(() => {
  invoke.mockReset()
  useModelImportStore.setState({ picking: false, busy: false, selecting: false, progress: '', error: '', message: '', warning: '' })
  useBotStore.setState({ list: [] })
})

it('guards duplicate imports across page unmounts and allows retry after failure', async () => {
  let reject!: (error: Error) => void
  invoke.mockReturnValue(new Promise((_, fail) => { reject = fail }))
  const pending = useModelImportStore.getState().importZip('C:/model.zip')
  await useModelImportStore.getState().importZip('C:/model.zip')
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(invoke).toHaveBeenCalledWith('install_bot_from_zip', { zipPath: 'C:/model.zip', name: undefined })
  expect(useModelImportStore.getState().busy).toBe(true)
  reject(new Error('already exists'))
  await pending
  expect(useModelImportStore.getState().busy).toBe(false)
  expect(useModelImportStore.getState().error).toContain('already exists')
  const bot = { name: 'copy', dir: '', has_pyproject: false, env_ready: false }
  invoke.mockImplementation(cmd => Promise.resolve(cmd === 'list_bots' ? [bot] : bot))
  await useModelImportStore.getState().importZip('C:/model.zip')
  expect(useBotStore.getState().list).toEqual([bot])
  expect(useModelImportStore.getState().error).toBe('')
})

it('retains the successful imported result if refreshing the list fails', async () => {
  const bot = { name: 'copy', dir: '', has_pyproject: true, env_ready: true }
  invoke.mockImplementation(cmd => cmd === 'list_bots' ? Promise.reject(new Error('offline')) : Promise.resolve(bot))
  await useModelImportStore.getState().importZip('C:/model.zip')
  expect(useBotStore.getState().list).toEqual([bot])
  expect(useModelImportStore.getState().message).toContain('导入成功')
  expect(useModelImportStore.getState().error).toBe('')
})

it('prepares dependencies using the void command response and then refreshes readiness', async () => {
  const bot = { name: 'pending', dir: '', has_pyproject: true, env_ready: false }
  useBotStore.setState({ list: [bot] })
  invoke.mockImplementation(cmd => Promise.resolve(cmd === 'list_bots' ? [{ ...bot, env_ready: true }] : undefined))
  await useModelImportStore.getState().prepareEnvironment('pending')
  expect(invoke).toHaveBeenCalledWith('sync_bot_deps', { name: 'pending', force: false })
  expect(useBotStore.getState().list[0].env_ready).toBe(true)
  expect(useModelImportStore.getState().busy).toBe(false)
})
