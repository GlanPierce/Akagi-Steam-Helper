import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { useModelImportStore } from './modelImportStore'

export function ModelImport({ open: expanded, disabled }: { open: boolean; disabled: boolean }) {
  const state = useModelImportStore()
  const [picking, setPicking] = useState(false)
  const locked = disabled || picking || state.busy
  const choose = async () => {
    if (locked) return
    setPicking(true)
    useModelImportStore.setState({ error: '' })
    try {
      const path = await open({ multiple: false, directory: false, filters: [{ name: '模型 ZIP 包', extensions: ['zip'] }] })
      if (typeof path === 'string') useModelImportStore.setState({ zipPath: path })
    } catch (error) { useModelImportStore.setState({ error: `选择文件失败：${String(error)}` }) }
    finally { setPicking(false) }
  }
  return <>
    {(expanded || state.busy) && <section className="hud-local-card hud-model-import" aria-label="导入本地模型" aria-busy={state.busy}>
      <h3>导入本地模型</h3>
      <p>选择包含 bot.py 和 pyproject.toml 的完整模型 ZIP 包，导入后在下方指定使用。</p>
      <div className="hud-import-file"><label>模型 ZIP 文件<input data-slot="input" value={state.zipPath} disabled={locked} onChange={e => useModelImportStore.setState({ zipPath: e.target.value })} placeholder="选择或粘贴 ZIP 文件路径" /></label><button className="hud-local-button" data-native-press-scale aria-label="选择文件" disabled={locked} onClick={() => void choose()}>选择</button></div>
      <div className="hud-import-file"><label>安装名称（可选）<input data-slot="input" value={state.name} disabled={locked} onChange={e => useModelImportStore.setState({ name: e.target.value })} placeholder="默认使用 ZIP 文件名" /></label><button className="hud-local-button" data-native-press-scale aria-label="开始导入" disabled={locked || !state.zipPath.trim()} onClick={() => void state.importZip()}>导入</button></div>
      {state.busy && <p role="status">{state.progress || '正在安装…'} 可以返回牌桌，安装会继续。</p>}
    </section>}
    {state.error && <p className="hud-local-error" role="alert">{state.error}</p>}
    {state.warning && <p className="hud-local-error" role="alert">{state.warning}</p>}
    {state.message && <p className="hud-local-status" role="status">{state.message}</p>}
  </>
}
