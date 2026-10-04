import { useEffect, useRef, useState } from 'react'
import { useBotStore } from '@/stores/botStore'
import { useConfigStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import { ModelImport } from './ModelImport'
import { MenuFooter } from './MenuFooter'
import { ModelCard } from './ModelCard'
import { NativeSprite } from './NativeSprite'
import { useModelImportStore } from './modelImportStore'
import { loadModelConfiguration, useModelPresetStore } from './modelPresetStore'
import { builtins, MODEL_MODES, modelLabel, modeKey, modeName, modeTitle, portrait, presetView, supports, type ModelMode } from './modelPresets'
import type { ModelPreset } from '@/types'
import './modelPresets.css'

function PresetName({ index, preset, disabled }: { index: number; preset: ModelPreset; disabled: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(preset.name)
  const committing = useRef(false)
  const save = async () => {
    if (committing.current) return
    if (draft.trim() === preset.name) { setEditing(false); return }
    committing.current = true
    const saved = await useModelPresetStore.getState().run('rename_model_preset', { index, name: draft.trim() })
    committing.current = false
    if (saved) setEditing(false)
  }
  return <div className="hud-preset-name">
    {editing ? <input autoFocus aria-label="方案名称" value={draft} maxLength={32} disabled={disabled} onChange={e => setDraft(e.target.value)} onBlur={() => void save()} onKeyDown={e => {
      if (e.key === 'Enter') { e.preventDefault(); void save() }
      if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) }
    }} /> : <button type="button" disabled={disabled} aria-label="重命名方案" title={preset.name} onClick={() => { setDraft(preset.name); setEditing(true) }}><span>{preset.name}</span><img src="/maka/character/dress_up_change_name_button.png" alt="" /></button>}
  </div>
}

export function LocalModels({ scale = 1 }: { scale?: number }) {
  const cached = useBotStore(s => s.list)
  const config = useConfigStore(s => s.config)
  const selecting = useModelImportStore(s => s.selecting)
  const installing = useModelImportStore(s => s.busy)
  const picking = useModelImportStore(s => s.picking)
  const chooseAndImport = useModelImportStore(s => s.chooseAndImport)
  const error = useModelPresetStore(s => s.error)
  const favorites = useUiPrefsStore(s => s.favoriteModels)
  const toggleFavorite = useUiPrefsStore(s => s.toggleFavoriteModel)
  const { activeIndex, presets } = presetView(config?.bot)
  const [viewedIndex, setViewedIndex] = useState<number | null>(null)
  const [mode, setMode] = useState<ModelMode>('4p')
  const [previews, setPreviews] = useState<Record<string, { name: string; assigned: string }>>({})
  const index = viewedIndex ?? activeIndex
  const preset = presets[index]
  const models = cached.length ? cached : builtins
  const assigned = preset[modeKey(mode)]
  const entry = previews[`${index}:${mode}`]
  const preview = entry?.assigned === assigned ? entry.name : assigned
  const choices = models.filter(bot => supports(bot, mode))
  const selected = choices.some(bot => bot.name === preview) ? preview : assigned
  const locked = !config || selecting || installing || picking

  useEffect(() => { void loadModelConfiguration() }, [])
  useEffect(() => {
    const current = presetView(config?.bot).presets
    setPreviews(previous => {
      const valid = Object.entries(previous).filter(([key, value]) => {
        const [slot, mode] = key.split(':')
        return current[Number(slot)]?.[modeKey(mode as ModelMode)] === value.assigned
      })
      return valid.length === Object.keys(previous).length ? previous : Object.fromEntries(valid)
    })
  }, [config?.bot])

  const select = (name: string) => {
    const state = useModelImportStore.getState()
    if (!config || state.selecting || state.busy || state.picking) return
    if (selected !== name) setPreviews(current => ({ ...current, [`${index}:${mode}`]: { name, assigned } }))
    else if (assigned !== name) void useModelPresetStore.getState().run('set_model_preset', { index, mode, name })
  }
  const cards = (group: 'favorites' | 'all') => choices.filter(bot => group === 'all' || favorites.includes(bot.name)).map(bot => <ModelCard key={bot.name} bot={bot} mode={mode} group={group} selected={selected === bot.name} assigned={assigned === bot.name} favorite={favorites.includes(bot.name)} disabled={locked} onSelect={() => select(bot.name)} onFavorite={() => toggleFavorite(bot.name)} />)
  const starred = cards('favorites')
  const description = (choice: ModelPreset, row: ModelMode) => {
    const name = choice[modeKey(row)]
    const bot = models.find(bot => bot.name === name)
    return bot ? modelLabel(bot).replace(/\s*\(Local\)\s*$/i, '') : name
  }

  return <div className="hud-local-page hud-local-models hud-preset-page">
    <h2 className="sr-only">本地模型</h2>
    <div className="hud-preset-tabs" role="tablist" aria-label="模型方案" aria-orientation="vertical">
      {presets.map((item, i) => <button className="hud-preset-tab" key={i} role="tab" aria-label={`方案 ${item.name}`} title={item.name} aria-selected={index === i} data-active={activeIndex === i} disabled={!config} onClick={() => setViewedIndex(i)}>
        <span className="hud-preset-tab-art" data-selected={index === i}><NativeSprite src={`/maka/character/${index === i ? 'tab_bright' : 'tab_gray'}.png`} border={index === i ? [34, 0, 112, 0] : [50, 8, 100, 7]} pixelScale={scale} /></span>
        <span className="hud-preset-tab-name">{item.name}</span>
        {activeIndex === i && <img className="hud-preset-check" src="/maka/lobby/mode_confirm.png" alt="" />}
      </button>)}
    </div>
    <PresetName key={index} index={index} preset={preset} disabled={locked} />
    <div className="hud-preset-modes" aria-label="局制">
      {MODEL_MODES.map(row => <button className="hud-preset-mode" type="button" key={row} aria-label={modeTitle(row)} aria-pressed={row === mode} onClick={() => setMode(row)}>
        <span className="hud-preset-mode-bg"><NativeSprite src="/maka/character/bf_popout.png" border={[17, 19, 18, 18]} pixelScale={scale} /></span>
        <span className="hud-preset-mode-title">{modeTitle(row)}</span>
        <img className="hud-preset-mode-line" src="/maka/character/line.png" alt="" />
        <span className="hud-preset-mode-description" title={description(preset, row)}>{description(preset, row)}</span>
        <img className="hud-preset-mode-icon" src={portrait(preset[modeKey(row)])} alt="" />
        {mode === row && <span className="hud-preset-mode-selected"><NativeSprite src="/maka/character/choose.png" border={[22, 0, 42, 0]} pixelScale={scale} /></span>}
      </button>)}
    </div>
    <button className="hud-local-button hud-preset-use" data-native-press-scale data-using={activeIndex === index} disabled={locked || activeIndex === index} onClick={() => void useModelPresetStore.getState().run('activate_model_preset', { index })}>{activeIndex === index ? '使用中' : '使用'}</button>
    <section className="hud-preset-preview" aria-label={`${modeName(mode)}模型`}>
      <NativeSprite src="/maka/character/bf_popout.png" border={[17, 19, 18, 18]} pixelScale={scale} />
      <h3 className="hud-preset-preview-title">{modeTitle(mode)}</h3>
      <button className="hud-preset-import" type="button" data-native-press-scale aria-label="导入模型" title="导入模型" disabled={locked} onClick={() => void chooseAndImport()}><img src="/maka/lobby/add_1.png" alt="" /></button>
      <img className="hud-preset-preview-line" src="/maka/character/line.png" alt="" />
      <div className="hud-preset-preview-content" key={`${index}:${mode}`}>
        <ModelImport />
        <div className="hud-model-list" role="group" aria-label={`${modeName(mode)}模型选择`}>
          <h4 className="hud-native-field-heading">已收藏</h4>
          <div className="hud-model-cards hud-model-favorites" role="radiogroup" aria-label="收藏模型">{starred.length ? starred : <div className="hud-model-empty"><img src="/maka/character/noinfo.png" alt="" /><span>空空如也</span></div>}</div>
          <div className="hud-model-divider" role="separator"><img src="/maka/dorm/dividing_line.png" alt="" /></div>
          <h4 className="hud-native-field-heading">所有模型</h4>
          <div className="hud-model-cards" role="radiogroup" aria-label="所有模型">{cards('all')}</div>
        </div>
      </div>
    </section>
    <MenuFooter>{error && <p className="hud-local-status" role="alert">{error}</p>}</MenuFooter>
  </div>
}
