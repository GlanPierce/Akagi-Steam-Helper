import { beforeEach, expect, it, vi } from 'vitest'
import { useConfigStore } from '@/stores/configStore'
import { useBotStore } from '@/stores/botStore'
import type { AppConfig, BotInfo } from '@/types'
import { loadModelConfiguration, useModelPresetStore } from './modelPresetStore'
import { useModelImportStore } from './modelImportStore'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tauri', () => ({ invoke }))
const config = {
  bot: { active_4p: 'akagi-native', active_3p: 'akagi-native3p', active_model_preset: 0, model_presets: [] },
  overlay: { opacity: .95 }, network: { github_mirror_mode: 'direct' },
} as unknown as AppConfig

beforeEach(() => {
  invoke.mockReset()
  useModelPresetStore.setState({ error: '' })
  useModelImportStore.setState({ selecting: false, busy: false, picking: false })
  useConfigStore.setState({ config })
  useBotStore.setState({ list: [] })
})

it('keeps the applied preset and saved pair unchanged after a failed activation', async () => {
  invoke.mockRejectedValue(new Error('file is locked'))
  expect(await useModelPresetStore.getState().run('activate_model_preset', { index: 1 })).toBe(false)
  expect(useConfigStore.getState().config).toBe(config)
  expect(useModelImportStore.getState().selecting).toBe(false)
  expect(useModelPresetStore.getState().error).toContain('file is locked')
})

it('discards a delayed config read after a preset save and blocks duplicate commands', async () => {
  let read!: (value: AppConfig) => void
  let save!: (value: AppConfig['bot']) => void
  invoke.mockImplementation(command => {
    if (command === 'list_bots') return Promise.resolve([] as BotInfo[])
    if (command === 'get_config') return new Promise<AppConfig>(resolve => { read = resolve })
    return new Promise<AppConfig['bot']>(resolve => { save = resolve })
  })
  const pendingRead = loadModelConfiguration()
  const pendingSave = useModelPresetStore.getState().run('activate_model_preset', { index: 1 })
  expect(await useModelPresetStore.getState().run('activate_model_preset', { index: 2 })).toBe(false)
  expect(invoke.mock.calls.filter(([name]) => name === 'activate_model_preset')).toHaveLength(1)
  const bot = { ...config.bot, active_model_preset: 1, active_4p: 'mortal-s42' }
  save(bot)
  await pendingSave
  read(config)
  await pendingRead
  expect(useConfigStore.getState().config?.bot).toBe(bot)
  expect(useConfigStore.getState().config?.network).toEqual(config.network)
})
