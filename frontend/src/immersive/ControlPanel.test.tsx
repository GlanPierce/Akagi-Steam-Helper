import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AppConfig, BotInfo } from '@/types'
import { useBotStore } from '@/stores/botStore'
import { useConfigStore } from '@/stores/configStore'
import { useGameStore } from '@/stores/gameStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import { useModelImportStore } from './modelImportStore'
import { useModelPresetStore } from './modelPresetStore'
import { ControlPanel } from './ControlPanel'
import { game } from './fixtures'

const { invoke, openFile } = vi.hoisted(() => ({ invoke: vi.fn(), openFile: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: openFile }))
vi.mock('@/lib/tauri', () => ({ invoke, listen: async () => () => {}, HAS_TAURI: false }))
vi.mock('./menuMotion', () => ({ menuMotionDuration: () => 0, pageMotionTiming: () => ({ outMs: 0, inMs: 0 }), menuMotionStyle: {} }))
vi.mock('./NativeSprite', () => ({ NativeSprite: () => null }))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null, toast: { info: vi.fn(), error: vi.fn() } }))

const config: AppConfig = {
  general: { first_run_completed: true, developer_mode: false },
  logging: { dir: '', level: 'info', all_level: 'warn' },
  platform: { kind: 'Majsoul' },
  proxy: { enabled: true, addr: '127.0.0.1:23410', ca_dir: '', block_telemetry: true },
  bot: {
    enabled: true, active_4p: 'akagi-native', active_3p: 'akagi-native3p', auto_sync: false, dir: '',
    api: { enabled: false, base_url: '', key: '', model_4p: '', model_3p: '', proxy_enabled: false, proxy: '', react_timeout_ms: 3000 },
  },
  capture: { mode: 'mitm', chromium: { executable: '', user_data_dir: '', start_url: 'https://game.maj-soul.com/1/', cft_channel: 'stable', force_cft: false, extra_args: [] } },
  autoplay: {
    enabled: false,
    majsoul: { pre_click_delay_min_ms: 0, pre_click_delay_max_ms: 0, inter_click_delay_ms: 0, hover_delay_ms: 0, click_hold_ms: 0, verify_input_ms: 0, click_retries: 0, reload_after_failures: 0, dealer_first_discard_extra_delay_ms: 0 },
    delay: { mode: 'legacy', min_delay_ms: 0, min_button_delay_ms: 0, distribution: 'uniform', lognormal: {}, bank_on_long_thought: false, riichi_extra_ms: 0, kan_extra_ms: 0, safety_margin_ms: 0, bank_use_fraction: 0, bank_max_single_ms: 0, no_budget_cap_ms: 0 },
  },
  overlay: { enabled: true, top_n: 5, opacity: .95, always_on_top: true, immersive: true },
  network: { github_mirror_mode: 'auto', github_custom_mirror: '' },
}

const bots: BotInfo[] = [
  { name: 'akagi-native', dir: '', has_pyproject: false, env_ready: true },
  { name: 'akagi-native3p', dir: '', has_pyproject: false, env_ready: true },
  { name: 'mortal', dir: 'C:/bots/mortal', has_pyproject: true, env_ready: true,
    manifest: { manifest_version: 1, bot: { name: 'mortal', display: 'Mortal', supported_modes: ['4p'] }, settings: {} } },
]

function mount() {
  return render(<ControlPanel frame={null} cfg={config.overlay} close={() => {}} />)
}

beforeEach(() => {
  invoke.mockReset()
  openFile.mockReset()
  useModelPresetStore.setState({ error: '' })
  useModelImportStore.setState({ picking: false, busy: false, selecting: false, progress: '', error: '', message: '', warning: '' })
  invoke.mockImplementation((command: string, args?: { name: string }) => {
    if (command === 'list_bots') return Promise.resolve(bots)
    if (command === 'get_config') return Promise.resolve(config)
    if (command === 'set_model_preset') return Promise.resolve({ ...config.bot, active_4p: args!.name })
    return Promise.resolve(undefined)
  })
  useBotStore.setState({ list: [], status: { state: 'idle' } })
  useGameStore.setState({ game: null })
  useConfigStore.setState({ config: null })
  useUiPrefsStore.setState({ favoriteModels: [] })
})

it('opens models by default and keeps only models and guidance', () => {
  mount()
  expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['模型', '提示与校准'])
  expect(screen.getByRole('heading', { name: '本地模型' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: '对局复盘' })).toBeNull()
  expect(screen.queryByRole('link', { name: '助手设置' })).toBeNull()
})

it('uses numbered presets, two native mode rows and a plus icon for importing', async () => {
  mount()
  await screen.findByRole('radio', { name: '为四人局指定 Mortal' })
  expect(screen.getAllByRole('tab')).toHaveLength(10)
  expect(screen.getByRole('tab', { name: '方案 1' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('button', { name: '四人东/南' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: '三人东/南' }).getAttribute('aria-pressed')).toBe('false')
  const plus = screen.getByRole('button', { name: '导入模型' })
  expect(plus.textContent).toBe('')
  expect(plus.querySelector('img')?.getAttribute('src')).toBe('/maka/lobby/add_1.png')
  expect(screen.getByRole('button', { name: '使用中' }).hasAttribute('disabled')).toBe(true)
})

it('saves an inactive preset without applying it and uses its pair only on 使用', async () => {
  mount()
  await screen.findByRole('radio', { name: '为四人局指定 Mortal' })
  fireEvent.click(screen.getByRole('tab', { name: '方案 2' }))
  const assigned = Array.from({ length: 10 }, (_, index) => ({ name: String(index + 1), model_4p: index === 1 ? 'mortal' : 'akagi-native', model_3p: 'akagi-native3p' }))
  const saved = { ...config.bot, active_model_preset: 0, model_presets: assigned }
  invoke.mockResolvedValueOnce(saved)
  const card = screen.getByRole('radio', { name: '为四人局指定 Mortal' })
  fireEvent.click(card)
  expect(invoke).not.toHaveBeenCalledWith('set_model_preset', expect.anything())
  fireEvent.click(card)
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('set_model_preset', { index: 1, mode: '4p', name: 'mortal' }))
  await waitFor(() => expect(useModelImportStore.getState().selecting).toBe(false))
  expect(useConfigStore.getState().config?.bot.active_4p).toBe('akagi-native')
  expect(screen.getByRole('tab', { name: '方案 1' }).getAttribute('data-active')).toBe('true')
  invoke.mockResolvedValueOnce({ ...saved, active_model_preset: 1, active_4p: 'mortal' })
  fireEvent.click(screen.getByRole('button', { name: '使用' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('activate_model_preset', { index: 1 }))
  await waitFor(() => expect(screen.getByRole('tab', { name: '方案 2' }).getAttribute('data-active')).toBe('true'))
  expect(useConfigStore.getState().config?.bot.active_3p).toBe('akagi-native3p')
})

it('autosaves a renamed preset and preserves other config changes during a model operation', async () => {
  mount()
  await screen.findByRole('radio', { name: '为四人局指定 Mortal' })
  fireEvent.click(screen.getByRole('button', { name: '重命名方案' }))
  const name = screen.getByRole('textbox', { name: '方案名称' })
  fireEvent.change(name, { target: { value: '练习' } })
  const presets = Array.from({ length: 10 }, (_, i) => ({ name: i ? String(i + 1) : '练习', model_4p: 'akagi-native', model_3p: 'akagi-native3p' }))
  let finish!: (bot: AppConfig['bot']) => void
  invoke.mockReturnValueOnce(new Promise<AppConfig['bot']>(resolve => { finish = resolve }))
  fireEvent.keyDown(name, { key: 'Enter' })
  useConfigStore.setState({ config: { ...config, overlay: { ...config.overlay, opacity: 0.6 } } })
  finish({ ...config.bot, model_presets: presets, active_model_preset: 0 })
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('rename_model_preset', { index: 0, name: '练习' }))
  await waitFor(() => expect(screen.getByRole('tab', { name: '方案 练习' })).toBeTruthy())
  expect(useConfigStore.getState().config?.overlay.opacity).toBe(0.6)
  expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
})

it('autosaves calibration without duplicate feature switches and preserves other preferences', async () => {
  render(<ControlPanel frame={null} cfg={{ ...config.overlay, show_actions: false, show_risk: false }} close={() => {}} />)
  fireEvent.click(screen.getByRole('link', { name: '提示与校准' }))
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.queryByText(/手牌保留前五个/)).toBeNull()
  fireEvent.change(screen.getByRole('slider', { name: '提示不透明度' }), { target: { value: '0.6' } })
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('update_immersive_options', {
    overlay: { ...config.overlay, show_actions: false, show_risk: false, opacity: 0.6 },
  }))
})

it('previews a model on the first click and only activates it on the second click', async () => {
  mount()
  fireEvent.click(screen.getByRole('link', { name: '模型' }))
  const activate = await screen.findByRole('radio', { name: '为四人局指定 Mortal' })
  fireEvent.click(activate)
  expect(activate.getAttribute('aria-checked')).toBe('true')
  expect(useConfigStore.getState().config?.bot.active_4p).toBe('akagi-native')
  expect(invoke.mock.calls.some(([command]) => command === 'set_model_preset')).toBe(false)
  fireEvent.click(activate)
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('set_model_preset', { index: 0, mode: '4p', name: 'mortal' }))
  await waitFor(() => expect(activate.closest('[data-active]')?.getAttribute('data-active')).toBe('true'))
  expect(useConfigStore.getState().config?.bot.active_4p).toBe('mortal')
})

it('invalidates an old preview after an external assignment change without affecting favorites', async () => {
  const replacement: BotInfo = { name: 'replacement', dir: '', has_pyproject: true, env_ready: true }
  invoke.mockImplementation(command => Promise.resolve(command === 'list_bots' ? [...bots, replacement] : config))
  mount()
  const mortal = await screen.findByRole('radio', { name: '为四人局指定 Mortal' })
  fireEvent.click(mortal)
  fireEvent.click(screen.getByRole('button', { name: '收藏 Mortal' }))
  const all = within(screen.getByRole('radiogroup', { name: '所有模型' }))
  act(() => useConfigStore.setState({ config: { ...config, bot: { ...config.bot, active_4p: 'replacement' } } }))
  expect(screen.getByRole('radio', { name: '为四人局指定 replacement' }).getAttribute('aria-checked')).toBe('true')
  expect(all.getByRole('radio', { name: '为四人局指定 Mortal' }).getAttribute('aria-checked')).toBe('false')
  expect(useUiPrefsStore.getState().favoriteModels).toEqual(['mortal'])
  fireEvent.click(all.getByRole('radio', { name: '为四人局指定 Mortal' }))
  expect(invoke.mock.calls.some(([name]) => name === 'set_model_preset')).toBe(false)
  act(() => useConfigStore.setState({ config }))
  expect(screen.getByRole('radio', { name: '为四人局指定 内置四人模型' }).getAttribute('aria-checked')).toBe('true')
})

it('keeps built-in models selectable without a Python environment', async () => {
  const configured = { ...config, bot: { ...config.bot, active_4p: 'mortal' } }
  invoke.mockImplementation((command: string) => {
    if (command === 'list_bots') return Promise.resolve(bots.map(bot => ({ ...bot, env_ready: bot.name === 'akagi-native' ? false : bot.env_ready })))
    if (command === 'get_config') return Promise.resolve(configured)
    return Promise.resolve(undefined)
  })
  mount()
  fireEvent.click(screen.getByRole('link', { name: '模型' }))
  await waitFor(() => expect(useConfigStore.getState().config?.bot.active_4p).toBe('mortal'))
  expect(screen.getByRole('radio', { name: '为四人局指定 内置四人模型' })).toBeTruthy()
})

it('keeps selection independent of the running model without adding runtime captions', async () => {
  useBotStore.setState({ status: { state: 'ready', bot: 'mortal', actor_id: 0 } })
  useGameStore.setState({ game: game() })
  mount()
  fireEvent.click(screen.getByRole('link', { name: '模型' }))
  await screen.findByRole('radio', { name: '为四人局指定 Mortal' })
  expect(screen.queryByText(/本局正在使用/)).toBeNull()
  const fourPlayer = screen.getByRole('region', { name: '四人局模型' })
  expect(within(fourPlayer).getByRole('radio', { name: '为四人局指定 内置四人模型' }).getAttribute('aria-checked')).toBe('true')
  fireEvent.click(screen.getByRole('radio', { name: '为四人局指定 Mortal' }))
  await waitFor(() => expect(within(fourPlayer).getByRole('radio', { name: '为四人局指定 Mortal' }).getAttribute('aria-checked')).toBe('true'))
  expect(screen.queryByText('下场使用')).toBeNull()
  fireEvent.click(screen.getByRole('radio', { name: '为四人局指定 内置四人模型' }))
  await waitFor(() => expect(within(fourPlayer).getByRole('radio', { name: '为四人局指定 内置四人模型' }).getAttribute('aria-checked')).toBe('true'))
  expect(screen.queryByText(/本局正在使用/)).toBeNull()
})

it('does not present a stopped runner as the model currently playing', async () => {
  useBotStore.setState({ status: { state: 'stopped', bot: 'mortal' } })
  mount()
  fireEvent.click(screen.getByRole('link', { name: '模型' }))
  expect(screen.queryByText('当前没有运行中的模型')).toBeNull()
  expect(screen.queryByText(/本局正在使用/)).toBeNull()
  expect(screen.queryByText('已选用')).toBeNull()
})

it.each([null, { ...game(), is_done: true }])('omits runtime captions while the game snapshot is still catching up (case %#)', async snapshot => {
  useBotStore.setState({ status: { state: 'ready', bot: 'mortal', actor_id: 0 } })
  useGameStore.setState({ game: snapshot })
  mount()
  fireEvent.click(screen.getByRole('link', { name: '模型' }))
  await screen.findByRole('radio', { name: '为四人局指定 Mortal' })
  expect(screen.queryByText(/本局正在使用/)).toBeNull()
  expect(screen.queryByText('当前没有运行中的模型')).toBeNull()
})

it('requires two clicks on the new card after changing the preview and keeps each mode independent', async () => {
  mount()
  const mortal = await screen.findByRole('radio', { name: '为四人局指定 Mortal' })
  expect(mortal.getAttribute('aria-checked')).toBe('false')
  fireEvent.click(mortal)
  await waitFor(() => expect(mortal.getAttribute('aria-checked')).toBe('true'))
  const builtin = screen.getByRole('radio', { name: '为四人局指定 内置四人模型' })
  expect(builtin.getAttribute('aria-checked')).toBe('false')
  fireEvent.click(builtin)
  fireEvent.click(mortal)
  expect(invoke.mock.calls.filter(([command]) => command === 'set_model_preset')).toHaveLength(0)
  expect(mortal.getAttribute('aria-checked')).toBe('true')
  fireEvent.click(mortal)
  await waitFor(() => expect(useConfigStore.getState().config?.bot.active_4p).toBe('mortal'))
  fireEvent.click(mortal)
  expect(invoke.mock.calls.filter(([command]) => command === 'set_model_preset')).toHaveLength(1)
  fireEvent.click(builtin)
  fireEvent.click(builtin)
  await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('set_model_preset', { index: 0, mode: '4p', name: 'akagi-native' }))
  expect(useConfigStore.getState().config?.bot.active_3p).toBe('akagi-native3p')
  fireEvent.click(screen.getByRole('button', { name: '三人东/南' }))
  expect(screen.getByRole('radio', { name: '为三人局指定 内置三人模型' }).getAttribute('aria-checked')).toBe('true')
})

it('opens the ZIP picker directly from the plus and imports with the filename as its default name', async () => {
  const imported = { name: 'local-pack', dir: 'C:/bots/local-pack', has_pyproject: true, env_ready: true }
  let installed = false
  openFile.mockResolvedValue('C:/models/local-pack.zip')
  invoke.mockImplementation((command: string) => {
    if (command === 'get_config') return Promise.resolve(config)
    if (command === 'list_bots') return Promise.resolve(installed ? [...bots, imported] : bots)
    if (command === 'install_bot_from_zip') { installed = true; return Promise.resolve(imported) }
    return Promise.resolve(undefined)
  })
  mount()
  const plus = screen.getByRole('button', { name: '导入模型' }) as HTMLButtonElement
  expect(plus.disabled).toBe(true)
  fireEvent.click(plus)
  expect(openFile).not.toHaveBeenCalled()
  await waitFor(() => expect(plus.disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '导入模型' }))
  expect(openFile).toHaveBeenCalledWith({ multiple: false, directory: false, filters: [{ name: '模型 ZIP 包', extensions: ['zip'] }] })
  expect(screen.queryByRole('region', { name: '导入本地模型' })).toBeNull()
  expect(screen.queryByRole('textbox', { name: '模型 ZIP 文件' })).toBeNull()
  expect(screen.queryByRole('textbox', { name: '安装名称（可选）' })).toBeNull()
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('install_bot_from_zip', { zipPath: 'C:/models/local-pack.zip', name: undefined }))
  expect(await screen.findByRole('radio', { name: '为四人局指定 local-pack' })).toBeTruthy()
  expect(invoke.mock.calls.some(([command]) => command === 'set_model_preset')).toBe(false)
  expect(useConfigStore.getState().config?.bot.active_4p).toBe('akagi-native')
})

it('cancelling the file picker does not install anything and picker errors remain visible', async () => {
  openFile.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('picker failed'))
  mount()
  await waitFor(() => expect((screen.getByRole('button', { name: '导入模型' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '导入模型' }))
  await waitFor(() => expect(openFile).toHaveBeenCalledTimes(1))
  await waitFor(() => expect((screen.getByRole('button', { name: '导入模型' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '导入模型' }))
  expect((await screen.findByRole('alert')).textContent).toContain('picker failed')
  expect(invoke.mock.calls.some(([command]) => command === 'install_bot_from_zip')).toBe(false)
})

it('keeps a pending file picker across menu reopen and imports its result only once', async () => {
  let finishPicker!: (path: string) => void
  openFile.mockReturnValue(new Promise<string>(resolve => { finishPicker = resolve }))
  const first = mount()
  await waitFor(() => expect((screen.getByRole('button', { name: '导入模型' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '导入模型' }))
  expect(openFile).toHaveBeenCalledTimes(1)
  first.unmount()
  mount()
  const plus = screen.getByRole('button', { name: '导入模型' }) as HTMLButtonElement
  expect(plus.disabled).toBe(true)
  fireEvent.click(plus)
  expect(openFile).toHaveBeenCalledTimes(1)
  const imported = { name: 'picked', dir: '', has_pyproject: true, env_ready: true }
  invoke.mockImplementation(command => Promise.resolve(command === 'install_bot_from_zip' ? imported : command === 'list_bots' ? [...bots, imported] : config))
  await act(async () => { finishPicker('C:/models/picked.zip') })
  await waitFor(() => expect(plus.disabled).toBe(false))
  expect(invoke.mock.calls.filter(([command]) => command === 'install_bot_from_zip')).toEqual([['install_bot_from_zip', { zipPath: 'C:/models/picked.zip', name: undefined }]])
})

it('keeps imported models with missing dependencies visible so their environment can be prepared', async () => {
  invoke.mockImplementation((command: string) => {
    if (command === 'list_bots') return Promise.resolve([...bots, { name: 'pending', dir: '', has_pyproject: true, env_ready: false }])
    if (command === 'get_config') return Promise.resolve(config)
    return Promise.resolve(undefined)
  })
  mount()
  expect(await screen.findByText('pending')).toBeTruthy()
  expect((screen.getByRole('radio', { name: '为四人局指定 pending' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('button', { name: '为 pending 安装环境' })).toBeTruthy()
})

it('keeps selection pending across menu reopen so activation and installation cannot overlap', async () => {
  let finish!: (bot: AppConfig['bot']) => void
  invoke.mockImplementation((command: string) => {
    if (command === 'list_bots') return Promise.resolve(bots)
    if (command === 'get_config') return Promise.resolve(config)
    if (command === 'set_model_preset') return new Promise<AppConfig['bot']>(resolve => { finish = resolve })
    return Promise.resolve(undefined)
  })
  const first = mount()
  const mortal = await screen.findByRole('radio', { name: '为四人局指定 Mortal' })
  fireEvent.click(mortal)
  fireEvent.click(mortal)
  first.unmount()
  mount()
  expect((await screen.findByRole('radio', { name: '为四人局指定 Mortal' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '导入模型' }))
  expect((screen.getByRole('button', { name: '导入模型' }) as HTMLButtonElement).disabled).toBe(true)
  expect(openFile).not.toHaveBeenCalled()
  finish({ ...config.bot, active_4p: 'mortal' })
  await waitFor(() => expect(useModelImportStore.getState().selecting).toBe(false))
  expect(useConfigStore.getState().config?.bot.active_4p).toBe('mortal')
})

it('keeps the existing model after a failed confirmation and lets the selected card retry', async () => {
  mount()
  const mortal = await screen.findByRole('radio', { name: '为四人局指定 Mortal' })
  invoke.mockRejectedValueOnce(new Error('save failed'))
  fireEvent.click(mortal)
  fireEvent.click(mortal)
  expect(await screen.findByText(/切换失败/)).toBeTruthy()
  expect(useConfigStore.getState().config?.bot.active_4p).toBe('akagi-native')
  expect(mortal.getAttribute('aria-checked')).toBe('true')
  fireEvent.click(mortal)
  await waitFor(() => expect(useConfigStore.getState().config?.bot.active_4p).toBe('mortal'))
})

it('only exposes an empty favorite star on the currently selected card', async () => {
  mount()
  await screen.findByRole('radio', { name: '为四人局指定 Mortal' })
  fireEvent.click(screen.getByRole('button', { name: '三人东/南' }))
  const threePlayer = screen.getByRole('region', { name: '三人局模型' })
  expect(within(threePlayer).getAllByRole('radio')).toHaveLength(1)
  expect(within(threePlayer).getByRole('radio').getAttribute('aria-checked')).toBe('true')
  expect(within(threePlayer).getByRole('button', { name: '收藏 内置三人模型' }).querySelector('img')?.getAttribute('src')).toBe('/maka/dorm/sushe_card_normal_star_dark.png')
  fireEvent.click(screen.getByRole('button', { name: '四人东/南' }))
  expect(screen.queryByRole('button', { name: '收藏 Mortal' })).toBeNull()
  fireEvent.click(screen.getByRole('radio', { name: '为四人局指定 Mortal' }))
  expect(screen.getByRole('button', { name: '收藏 Mortal' }).querySelector('img')?.getAttribute('src')).toBe('/maka/dorm/sushe_card_normal_star_dark.png')
  expect(invoke.mock.calls.some(([command]) => command === 'set_model_preset')).toBe(false)
  fireEvent.click(screen.getByRole('radio', { name: '为四人局指定 内置四人模型' }))
  expect(screen.queryByRole('button', { name: '收藏 Mortal' })).toBeNull()
  expect(useUiPrefsStore.getState().favoriteModels).toEqual([])
})

it('toggles a favorite without changing the preview or activated model and keeps it on reopen', async () => {
  const view = mount()
  fireEvent.click(await screen.findByRole('radio', { name: '为四人局指定 Mortal' }))
  const star = screen.getByRole('button', { name: '收藏 Mortal' })
  fireEvent.click(star)
  const fourPlayer = screen.getByRole('region', { name: '四人局模型' })
  const favorites = within(fourPlayer).getByRole('radiogroup', { name: '收藏模型' })
  const all = within(fourPlayer).getByRole('radiogroup', { name: '所有模型' })
  expect(within(favorites).getByRole('button', { name: '取消收藏 Mortal' }).getAttribute('aria-pressed')).toBe('true')
  expect(within(favorites).getByRole('radio', { name: '为四人局指定 Mortal' }).getAttribute('aria-checked')).toBe('true')
  expect(within(all).getByRole('radio', { name: '为四人局指定 Mortal' }).getAttribute('aria-checked')).toBe('true')
  expect(within(all).getByRole('button', { name: '取消收藏 Mortal' }).getAttribute('aria-pressed')).toBe('true')
  expect(within(favorites).getAllByRole('radio')).toHaveLength(1)
  expect(within(all).getAllByRole('radio')).toHaveLength(2)
  expect(invoke.mock.calls.some(([command]) => command === 'set_model_preset')).toBe(false)
  expect(useConfigStore.getState().config?.bot.active_4p).toBe('akagi-native')
  view.unmount()
  mount()
  const reopened = await screen.findByRole('region', { name: '四人局模型' })
  fireEvent.click(await within(reopened).findByRole('radiogroup', { name: '所有模型' }).then(group => within(group).getByRole('button', { name: '取消收藏 Mortal' })))
  expect(screen.queryByRole('button', { name: '收藏 Mortal' })).toBeNull()
  const emptyFavorites = within(reopened).getByRole('radiogroup', { name: '收藏模型' })
  expect(within(emptyFavorites).queryByRole('radio')).toBeNull()
  expect(within(emptyFavorites).getByText('空空如也')).toBeTruthy()
  expect(within(reopened).getByRole('separator')).toBeTruthy()
})

it('keeps an empty favorites row with its heading and separator in both modes', async () => {
  mount()
  for (const name of ['四人局模型', '三人局模型']) {
    fireEvent.click(screen.getByRole('button', { name: name.startsWith('四') ? '四人东/南' : '三人东/南' }))
    const section = await screen.findByRole('region', { name })
    expect(within(section).getByRole('heading', { name: '已收藏' })).toBeTruthy()
    const favorites = within(section).getByRole('radiogroup', { name: '收藏模型' })
    expect(within(favorites).getByText('空空如也')).toBeTruthy()
    expect(within(section).getByRole('separator')).toBeTruthy()
    expect(within(section).getByRole('radiogroup', { name: '所有模型' })).toBeTruthy()
  }
})

it('keeps favorites in all models and confirms across both copies on a second click', async () => {
  useUiPrefsStore.setState({ favoriteModels: ['mortal'] })
  mount()
  const fourPlayer = screen.getByRole('region', { name: '四人局模型' })
  const favorites = await within(fourPlayer).findByRole('radiogroup', { name: '收藏模型' })
  const all = within(fourPlayer).getByRole('radiogroup', { name: '所有模型' })
  const card = within(favorites).getByRole('radio', { name: '为四人局指定 Mortal' }) as HTMLInputElement
  const allCard = within(all).getByRole('radio', { name: '为四人局指定 Mortal' }) as HTMLInputElement
  fireEvent.click(card)
  expect(card.getAttribute('aria-checked')).toBe('true')
  expect(card.checked).toBe(true)
  expect(allCard.checked).toBe(true)
  expect(useConfigStore.getState().config?.bot.active_4p).toBe('akagi-native')
  fireEvent.click(allCard)
  await waitFor(() => expect(useConfigStore.getState().config?.bot.active_4p).toBe('mortal'))
  expect(card.closest('[data-active]')?.getAttribute('data-active')).toBe('true')
  expect(allCard.closest('[data-active]')?.getAttribute('data-active')).toBe('true')
})


it('saves each native calibration slider independently with fractional precision', async () => {
  mount()
  fireEvent.click(screen.getByRole('link', { name: '提示与校准' }))
  expect(screen.getAllByRole('slider')).toHaveLength(6)
  expect(screen.queryByRole('spinbutton')).toBeNull()
  fireEvent.change(screen.getByRole('slider', { name: '水平位置' }), { target: { value: '0.01' } })
  fireEvent.change(screen.getByRole('slider', { name: '垂直位置' }), { target: { value: '-0.01' } })
  fireEvent.change(screen.getByRole('slider', { name: '整体缩放' }), { target: { value: '1.005' } })
  fireEvent.change(screen.getByRole('slider', { name: '整体缩放' }), { target: { value: '1.01' } })
  expect((screen.getByRole('slider', { name: '水平位置' }) as HTMLInputElement).value).toBe('0.01')
  expect((screen.getByRole('slider', { name: '垂直位置' }) as HTMLInputElement).value).toBe('-0.01')
  expect((screen.getByRole('slider', { name: '整体缩放' }) as HTMLInputElement).value).toBe('1.01')
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('update_immersive_options', {
    overlay: { ...config.overlay, calibration: { x: .01, y: -.01, scale: 1.01, hand_y: 0, button_y: 0 } },
  }))
})

it('preserves slider bounds and displays fine scale changes as percentages', () => {
  mount()
  fireEvent.click(screen.getByRole('link', { name: '提示与校准' }))
  const field = screen.getByRole('slider', { name: '整体缩放' }) as HTMLInputElement
  fireEvent.change(field, { target: { value: '1.2' } })
  expect(field.value).toBe('1.2')
  expect(field.getAttribute('aria-valuetext')).toBe('120%')
  fireEvent.change(field, { target: { value: '0.8' } })
  expect(field.value).toBe('0.8')
  fireEvent.change(field, { target: { value: '0.805' } })
  expect(field.value).toBe('0.805')
  expect(field.getAttribute('aria-valuetext')).toBe('80.5%')
})


it('finishes queued autosaves in order after leaving calibration', async () => {
  let finish!: () => void
  invoke.mockImplementation((command: string) => {
    if (command === 'update_immersive_options') return new Promise<void>(resolve => { finish = resolve })
    if (command === 'list_bots') return Promise.resolve(bots)
    if (command === 'get_config') return Promise.resolve(config)
    return Promise.resolve(undefined)
  })
  mount()
  fireEvent.click(screen.getByRole('link', { name: '提示与校准' }))
  fireEvent.change(screen.getByRole('slider', { name: '水平位置' }), { target: { value: '0.01' } })
  await waitFor(() => expect(invoke.mock.calls.filter(([name]) => name === 'update_immersive_options')).toHaveLength(1))
  fireEvent.change(screen.getByRole('slider', { name: '水平位置' }), { target: { value: '0.02' } })
  fireEvent.change(screen.getByRole('slider', { name: '水平位置' }), { target: { value: '0.03' } })
  fireEvent.click(screen.getByRole('link', { name: '模型' }))
  finish()
  await waitFor(() => expect(invoke.mock.calls.filter(([name]) => name === 'update_immersive_options')).toHaveLength(2))
  expect(invoke.mock.calls.filter(([name]) => name === 'update_immersive_options')[1][1].overlay.calibration.x).toBe(.03)
  finish()
  await waitFor(() => expect(useConfigStore.getState().config?.overlay.calibration?.x).toBe(.03))
})
