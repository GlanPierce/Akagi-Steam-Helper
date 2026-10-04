import { useModelImportStore } from './modelImportStore'

export function ModelImport() {
  const state = useModelImportStore()
  return <>
    {state.busy && <p className="hud-local-status" role="status">{state.progress || '正在安装…'}</p>}
    {state.error && <p className="hud-local-error" role="alert">{state.error}</p>}
    {state.warning && <p className="hud-local-error" role="alert">{state.warning}</p>}
    {state.message && <p className="hud-local-status" role="status">{state.message}</p>}
  </>
}
