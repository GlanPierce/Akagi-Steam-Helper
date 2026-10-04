import { create } from 'zustand'
import { invoke } from '@/lib/tauri'
import { useConfigStore } from '@/stores/configStore'
import { useBotStore } from '@/stores/botStore'
import type { AppConfig, BotInfo } from '@/types'
import { useModelImportStore } from './modelImportStore'

type PresetCommand = 'set_model_preset' | 'activate_model_preset' | 'rename_model_preset'
let revision = 0
let readRequest = 0

// Commands and errors survive closing the menu. Merge only the returned bot
// fields, so calibration saves that finish during a model edit remain intact.
export const useModelPresetStore = create<{
  error: string
  run: (command: PresetCommand, args: Record<string, string | number>) => Promise<boolean>
}>(set => ({
  error: '',
  run: async (command, args) => {
    const operation = useModelImportStore.getState()
    if (operation.selecting || operation.busy || operation.picking || !useConfigStore.getState().config) return false
    revision++
    useModelImportStore.setState({ selecting: true })
    set({ error: '' })
    try {
      const bot = await invoke<AppConfig['bot']>(command, args)
      const latest = useConfigStore.getState().config!
      useConfigStore.getState().setConfig({ ...latest, bot })
      return true
    } catch (error) { set({ error: `切换失败：${String(error)}` }); return false }
    finally { revision++; useModelImportStore.setState({ selecting: false }) }
  },
}))

export async function loadModelConfiguration() {
  const request = ++readRequest
  const before = revision
  const initial = useConfigStore.getState().config
  const busy = useModelImportStore.getState().busy || useModelImportStore.getState().selecting
  try {
    const [bots, config] = await Promise.all([invoke<BotInfo[]>('list_bots'), invoke<AppConfig>('get_config')])
    if (request !== readRequest || before !== revision || busy || useModelImportStore.getState().busy || useModelImportStore.getState().selecting) return
    useBotStore.getState().setList(bots)
    const latest = useConfigStore.getState().config
    useConfigStore.getState().setConfig(latest && latest !== initial ? { ...latest, bot: config.bot } : config)
  } catch (error) { if (request === readRequest) useModelPresetStore.setState({ error: `读取失败：${String(error)}` }) }
}
