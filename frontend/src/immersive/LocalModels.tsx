import { useEffect, useState } from 'react'
import { invoke } from '@/lib/tauri'
import { NATIVE_3P, NATIVE_4P, isNativeBot } from '@/lib/nativeBots'
import { useBotStore } from '@/stores/botStore'
import { useConfigStore } from '@/stores/configStore'
import { useGameStore } from '@/stores/gameStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import type { AppConfig, BotInfo } from '@/types'
import type { ImmersiveFrame } from './types'
import { ModelImport } from './ModelImport'
import { MenuFooter } from './MenuFooter'
import { useModelImportStore } from './modelImportStore'

const builtins: BotInfo[] = [
  { name: NATIVE_4P, dir: '', has_pyproject: false, env_ready: true },
  { name: NATIVE_3P, dir: '', has_pyproject: false, env_ready: true },
]

const modelPortraits: Record<string, string> = {
  [NATIVE_4P]: '/maka/akagi_portrait/bighead.png',
  [NATIVE_3P]: '/maka/akagi_0_portrait/bighead.png',
  'mortal-298k': '/maka/akagi_sp2_portrait/bighead.png',
  'mortal-s42': '/maka/akagi_sp_portrait/bighead.png',
}

function supports(bot: BotInfo, mode: '4p' | '3p') {
  if (bot.name === NATIVE_4P) return mode === '4p'
  if (bot.name === NATIVE_3P) return mode === '3p'
  return (bot.manifest?.bot.supported_modes ?? ['4p']).includes(mode)
}

function label(bot: BotInfo) {
  if (bot.name === NATIVE_4P) return '内置四人模型'
  if (bot.name === NATIVE_3P) return '内置三人模型'
  return bot.manifest?.bot.display || bot.name
}

function cardName(bot: BotInfo) {
  if (isNativeBot(bot.name)) return '内置'
  const name = label(bot).replace(/\s*\(Local\)\s*$/i, '')
  return name.match(/(?:^|\s)(S\d+|\d+k)\b/i)?.[1] ?? name
}

export function LocalModels({ frame }: { frame: ImmersiveFrame | null }) {
  const cached = useBotStore(s => s.list)
  const setList = useBotStore(s => s.setList)
  const cachedRuntime = useBotStore(s => s.status)
  const cachedGame = useGameStore(s => s.game)
  const runtime = frame?.bot_status ?? cachedRuntime
  const game = frame?.game ?? cachedGame
  const config = useConfigStore(s => s.config)
  const setConfig = useConfigStore(s => s.setConfig)
  const busy = useModelImportStore(s => s.selecting)
  const [status, setStatus] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [previewModels, setPreviewModels] = useState<Partial<Record<'4p' | '3p', { name: string; section: 'favorites' | 'all' }>>>({})
  const favorites = useUiPrefsStore(s => s.favoriteModels)
  const toggleFavorite = useUiPrefsStore(s => s.toggleFavoriteModel)
  const installing = useModelImportStore(s => s.busy)
  const prepareEnvironment = useModelImportStore(s => s.prepareEnvironment)
  const models = cached.length ? cached : builtins
  // Runner status is authoritative; the separately fetched game snapshot may
  // still be null or describe the previous completed game during reconnection.
  const runningName = runtime.state === 'ready' ? runtime.bot : null
  const runningMode = runningName && game && !game.is_done ? (game.num_players === 3 ? '3p' : '4p') : null
  const modelName = (name: string) => {
    const bot = models.find(model => model.name === name)
    return bot ? label(bot) : name
  }
  const runtimeText = runningName ? `本局正在使用：${modelName(runningName)}`
    : runtime.state === 'loading' ? `正在加载：${modelName(runtime.bot)}`
    : runtime.state === 'error' ? `模型异常：${modelName(runtime.bot)}`
    : null

  useEffect(() => {
    let cancelled = false
    void Promise.all([invoke<BotInfo[]>('list_bots'), invoke<AppConfig>('get_config')]).then(([bots, cfg]) => {
      if (!cancelled) { setList(bots); setConfig(cfg) }
    }).catch(() => { if (!cancelled) setStatus('暂时无法读取模型状态') })
    return () => { cancelled = true }
  }, [setList, setConfig])

  const activate = async (mode: '4p' | '3p', name: string) => {
    const operation = useModelImportStore.getState()
    if (!config || operation.selecting || operation.busy || config.bot[mode === '4p' ? 'active_4p' : 'active_3p'] === name) return
    useModelImportStore.setState({ selecting: true }); setStatus('')
    try {
      await invoke('set_active_bot', { mode, name })
      const latest = useConfigStore.getState().config ?? config
      setConfig({ ...latest, bot: { ...latest.bot, [mode === '4p' ? 'active_4p' : 'active_3p']: name } })
    } catch (e) { setStatus(`切换失败：${String(e)}`) }
    finally { useModelImportStore.setState({ selecting: false }) }
  }

  const selectionFor = (mode: '4p' | '3p') => {
    const preview = previewModels[mode]
    return {
      name: preview?.name ?? config?.bot[mode === '4p' ? 'active_4p' : 'active_3p'],
      section: preview?.section === 'favorites' && favorites.includes(preview.name) ? 'favorites' : 'all',
    }
  }
  const select = (mode: '4p' | '3p', name: string, section: 'favorites' | 'all') => {
    const operation = useModelImportStore.getState()
    if (!config || operation.selecting || operation.busy) return
    const selected = selectionFor(mode)
    if (selected.name !== name || selected.section !== section) setPreviewModels(current => ({ ...current, [mode]: { name, section } }))
    else void activate(mode, name)
  }

  return <div className="hud-local-page hud-local-models">
    <h2 className="sr-only">本地模型</h2>
    <ModelImport open={importOpen} disabled={busy} />
    <div className="hud-local-model-groups">{(['4p', '3p'] as const).map(mode => {
      const modeName = mode === '4p' ? '四人局' : '三人局'
      const activeName = mode === '4p' ? config?.bot.active_4p : config?.bot.active_3p
      const selection = selectionFor(mode)
      const choices = models.filter(bot => supports(bot, mode))
      const starred = choices.filter(bot => favorites.includes(bot.name))
      const renderCard = (bot: BotInfo, section: 'favorites' | 'all') => {
          const active = activeName === bot.name
          const selected = selection.name === bot.name && selection.section === section
          const favorite = favorites.includes(bot.name)
          const running = runningName === bot.name && runningMode === mode
          const botLabel = label(bot)
          const ready = isNativeBot(bot.name) || (bot.has_pyproject && bot.env_ready)
          return <div key={bot.name} className="hud-model-choice" data-active={active} data-selected={selected} data-current={running}>
            <label className="hud-model-card" title={botLabel}>
              <input type="radio" name={`model-${mode}`} checked={selected} aria-checked={selected} readOnly disabled={!config || busy || installing || !ready} aria-label={`为${modeName}指定 ${botLabel}`} onClick={() => select(mode, bot.name, section)} />
              <img className="hud-model-glow" src="/maka/dorm/sushe_click_effect.png" alt="" />
              <span className="hud-model-portrait" aria-hidden="true"><img src={modelPortraits[bot.name] ?? '/maka/common/maka_match_analysis_button_open.png'} alt="" /></span>
              <img className="hud-model-outline" src="/maka/dorm/sushe_card_normal_outline.png" alt="" />
              {active && <img className="hud-model-using" src="/maka/lobby_chs/using_1.png" alt="" />}
              <span className="hud-model-name" data-long={cardName(bot).length > 6}>{cardName(bot)}</span>
            </label>
            <button className="hud-model-favorite" type="button" aria-label={`${favorite ? '取消收藏' : '收藏'} ${botLabel}`} title={favorite ? '取消收藏' : '收藏'} aria-pressed={favorite} onClick={() => toggleFavorite(bot.name)}>
              <img src={`/maka/dorm/sushe_card_normal_star_${favorite ? 'light' : 'dark'}.png`} alt="" />
            </button>
            {!ready && bot.has_pyproject && <button className="hud-local-button hud-model-install" data-native-press-scale disabled={busy || installing} aria-label={`为 ${botLabel} 安装环境`} onClick={() => void prepareEnvironment(bot.name)}>安装</button>}
          </div>
      }
      return <section key={mode} className="hud-local-model-group" aria-label={`${modeName}模型`}>
        <h3 className="hud-native-heading"><span>{mode === '4p' ? '四人东/南' : '三人东/南'}</span></h3>
        <div className="hud-model-list" role="radiogroup" aria-label={`${modeName}模型选择`}>
          <h4 className="hud-native-heading"><span>已收藏</span></h4>
          <div className="hud-model-cards hud-model-favorites" role="group" aria-label="收藏模型">
            {starred.length ? starred.map(bot => renderCard(bot, 'favorites')) : <div className="hud-model-empty"><img src="/maka/character/noinfo.png" alt="" /><span>空空如也</span></div>}
          </div>
          <div className="hud-model-divider" role="separator"><img src="/maka/dorm/dividing_line.png" alt="" /></div>
          <div className="hud-model-cards" role="group" aria-label="全部模型">{choices.map(bot => renderCard(bot, 'all'))}</div>
        </div>
        {!choices.length && <p className="hud-local-empty">暂无已就绪模型</p>}
      </section>
    })}</div>
    <MenuFooter>
      <button className="hud-local-button" data-native-press-scale aria-label="导入模型" aria-expanded={importOpen} onClick={() => setImportOpen(open => !open)}>导入</button>
      <div>{runtimeText && <p className="hud-local-running" role="status">{runtimeText}</p>}{status && <p className="hud-local-status" role="status">{status}</p>}</div>
    </MenuFooter>
  </div>
}
