import { create } from 'zustand'
import { invoke } from '@/lib/tauri'
import { useBotStore } from '@/stores/botStore'
import type { BotInfo } from '@/types'

type ModelImportState = {
  zipPath: string
  name: string
  busy: boolean
  selecting: boolean
  progress: string
  error: string
  message: string
  warning: string
  importZip: () => Promise<void>
  prepareEnvironment: (name: string) => Promise<void>
}

async function refreshModels() {
  useBotStore.getState().setList(await invoke<BotInfo[]>('list_bots'))
}

// Owned by the overlay, so changing tabs or returning to the table cannot
// discard an in-flight import or allow a second installation to race it.
export const useModelImportStore = create<ModelImportState>((set, get) => ({
  zipPath: '', name: '', busy: false, selecting: false, progress: '', error: '', message: '', warning: '',
  importZip: async () => {
    const { busy, zipPath, name } = get()
    if (busy || get().selecting || !zipPath.trim()) return
    set({ busy: true, error: '', message: '', warning: '', progress: '正在解压并安装模型…' })
    try {
      const bot = await invoke<BotInfo>('install_bot_from_zip', { zipPath: zipPath.trim(), name: name.trim() || undefined })
      const store = useBotStore.getState()
      store.setList([...store.list.filter(item => item.name !== bot.name), bot])
      // The install already succeeded. A failed refresh must not invite a
      // second install into the same destination or hide the new model.
      await refreshModels().catch(() => {})
      const warning = !bot.has_pyproject ? '模型包缺少 pyproject.toml，暂时无法使用；请导入包含依赖配置的完整模型包。'
        : !bot.env_ready ? '模型已导入，依赖环境尚未就绪；请先安装环境。' : ''
      set({ zipPath: '', name: '', message: `导入成功：${bot.manifest?.bot.display || bot.name}`, warning: warning || get().warning })
    } catch (error) { set({ error: `导入失败：${String(error)}` }) }
    finally { set({ busy: false, progress: '' }) }
  },
  prepareEnvironment: async name => {
    if (get().busy || get().selecting) return
    set({ busy: true, error: '', message: '', warning: '', progress: `正在为 ${name} 安装环境…` })
    try {
      await invoke('sync_bot_deps', { name, force: false })
      const store = useBotStore.getState()
      store.setList(store.list.map(item => item.name === name ? { ...item, env_ready: true } : item))
      await refreshModels().catch(() => {})
      set({ message: `${name} 的环境已就绪` })
    } catch (error) { set({ error: `安装环境失败：${String(error)}` }) }
    finally { set({ busy: false, progress: '' }) }
  },
}))
