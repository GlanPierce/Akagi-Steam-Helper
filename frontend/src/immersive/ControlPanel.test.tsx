import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AppConfig, BotInfo } from '@/types'
import { useBotStore } from '@/stores/botStore'
import { useConfigStore } from '@/stores/configStore'
import { useGameStore } from '@/stores/gameStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import { useModelImportStore } from './modelImportStore'
import { ControlPanel } from './ControlPanel'
import { game } from './fixtures'

const { invoke, openFile } = vi.hoisted(() => ({ invoke: vi.fn(), openFile: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: openFile }))
vi.mock('@/lib/tauri', () => ({ invoke, listen: async () => () => {}, HAS_TAURI: false }))
vi.mock('./menuMotion', () => ({ menuMotionDuration: () => 0, menuMotionStyle: {} }))
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
  useModelImportStore.setState({ zipPath: '', name: '', busy: false, selecting: false, progress: '', error: '', message: '', warning: '' })
  invoke.mockImplementation((command: string) => {
    if (command === 'list_bots') return Promise.resolve(bots)
    if (command === 'get_config') return Promise.resolve(config)
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
  expect(invoke.mock.calls.some(([command]) => command === 'set_active_bot')).toBe(false)
  fireEvent.click(activate)
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('set_active_bot', { mode: '4p', name: 'mortal' }))
  await waitFor(() => expect(screen.getByText('Mortal').closest('[data-active]')?.getAttribute('data-active')).toBe('true'))
  expect(useConfigStore.getState().config?.bot.active_4p).toBe('mortal')
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

it('distinguishes the running model from a selection for the next game', async () => {
  useBotStore.setState({ status: { state: 'ready', bot: 'mortal', actor_id: 0 } })
  useGameStore.setState({ game: game() })
  mount()
  fireEvent.click(screen.getByRole('link', { name: '模型' }))
  expect(await screen.findByText('本局正在使用：Mortal')).toBeTruthy()
  const fourPlayer = screen.getByRole('region', { name: '四人局模型' })
  expect(within(fourPlayer).getByRole('radio', { name: '为四人局指定 内置四人模型' }).getAttribute('aria-checked')).toBe('true')
  fireEvent.click(screen.getByRole('radio', { name: '为四人局指定 Mortal' }))
  await waitFor(() => expect(within(fourPlayer).getByRole('radio', { name: '为四人局指定 Mortal' }).getAttribute('aria-checked')).toBe('true'))
  expect(screen.queryByText('下场使用')).toBeNull()
  fireEvent.click(screen.getByRole('radio', { name: '为四人局指定 内置四人模型' }))
  await waitFor(() => expect(within(fourPlayer).getByRole('radio', { name: '为四人局指定 内置四人模型' }).getAttribute('aria-checked')).toBe('true'))
  expect(screen.getByText('本局正在使用：Mortal')).toBeTruthy()
})

it('does not present a stopped runner as the model currently playing', async () => {
  useBotStore.setState({ status: { state: 'stopped', bot: 'mortal' } })
  mount()
  fireEvent.click(screen.getByRole('link', { name: '模型' }))
  expect(screen.queryByText('当前没有运行中的模型')).toBeNull()
  expect(screen.queryByText(/本局正在使用/)).toBeNull()
  expect(screen.queryByText('已选用')).toBeNull()
})

it.each([null, { ...game(), is_done: true }])('uses runner status while the game snapshot is still catching up (case %#)', async snapshot => {
  useBotStore.setState({ status: { state: 'ready', bot: 'mortal', actor_id: 0 } })
  useGameStore.setState({ game: snapshot })
  mount()
  fireEvent.click(screen.getByRole('link', { name: '模型' }))
  expect(await screen.findByText('本局正在使用：Mortal')).toBeTruthy()
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
  expect(invoke.mock.calls.filter(([command]) => command === 'set_active_bot')).toHaveLength(0)
  expect(mortal.getAttribute('aria-checked')).toBe('true')
  fireEvent.click(mortal)
  await waitFor(() => expect(useConfigStore.getState().config?.bot.active_4p).toBe('mortal'))
  fireEvent.click(mortal)
  expect(invoke.mock.calls.filter(([command]) => command === 'set_active_bot')).toHaveLength(1)
  fireEvent.click(builtin)
  fireEvent.click(builtin)
  await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('set_active_bot', { mode: '4p', name: 'akagi-native' }))
  expect(useConfigStore.getState().config?.bot.active_3p).toBe('akagi-native3p')
  expect(screen.getByRole('radio', { name: '为三人局指定 内置三人模型' }).getAttribute('aria-checked')).toBe('true')
})

it('imports a picked ZIP, refreshes the list and leaves current model selection alone', async () => {
  const imported = { name: 'local-pack', dir: 'C:/bots/local-pack', has_pyproject: true, env_ready: true }
  openFile.mockResolvedValue('C:/models/local-pack.zip')
  invoke.mockImplementation((command: string) => {
    if (command === 'get_config') return Promise.resolve(config)
    if (command === 'list_bots') return Promise.resolve(bots)
    if (command === 'install_bot_from_zip') return Promise.resolve(imported)
    return Promise.resolve(undefined)
  })
  mount()
  fireEvent.click(screen.getByRole('button', { name: '导入模型' }))
  fireEvent.click(screen.getByRole('button', { name: '选择文件' }))
  await waitFor(() => expect((screen.getByRole('textbox', { name: '模型 ZIP 文件' }) as HTMLInputElement).value).toBe('C:/models/local-pack.zip'))
  invoke.mockImplementation((command: string) => {
    if (command === 'list_bots') return Promise.resolve([...bots, imported])
    if (command === 'install_bot_from_zip') return Promise.resolve(imported)
    return Promise.resolve(config)
  })
  fireEvent.click(screen.getByRole('button', { name: '开始导入' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('install_bot_from_zip', { zipPath: 'C:/models/local-pack.zip', name: undefined }))
  expect(await screen.findByRole('radio', { name: '为四人局指定 local-pack' })).toBeTruthy()
  expect(invoke.mock.calls.some(([command]) => command === 'set_active_bot')).toBe(false)
  expect(useConfigStore.getState().config?.bot.active_4p).toBe('akagi-native')
})

it('cancelling the file picker does not install anything and picker errors remain visible', async () => {
  openFile.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('picker failed'))
  mount()
  fireEvent.click(screen.getByRole('button', { name: '导入模型' }))
  fireEvent.click(screen.getByRole('button', { name: '选择文件' }))
  await waitFor(() => expect(openFile).toHaveBeenCalledTimes(1))
  expect((screen.getByRole('button', { name: '开始导入' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '选择文件' }))
  expect((await screen.findByRole('alert')).textContent).toContain('picker failed')
  expect(invoke.mock.calls.some(([command]) => command === 'install_bot_from_zip')).toBe(false)
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
  let finish!: () => void
  invoke.mockImplementation((command: string) => {
    if (command === 'list_bots') return Promise.resolve(bots)
    if (command === 'get_config') return Promise.resolve(config)
    if (command === 'set_active_bot') return new Promise<void>(resolve => { finish = resolve })
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
  expect((screen.getByRole('button', { name: '选择文件' }) as HTMLButtonElement).disabled).toBe(true)
  finish()
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

it('toggles a favorite independently of the preview and activated model and keeps it on reopen', async () => {
  const view = mount()
  const star = await screen.findByRole('button', { name: '收藏 Mortal' })
  fireEvent.click(star)
  const fourPlayer = screen.getByRole('region', { name: '四人局模型' })
  const favorites = within(fourPlayer).getByRole('group', { name: '收藏模型' })
  const all = within(fourPlayer).getByRole('group', { name: '全部模型' })
  expect(within(favorites).getByRole('button', { name: '取消收藏 Mortal' }).getAttribute('aria-pressed')).toBe('true')
  expect(within(all).getByRole('radio', { name: '为四人局指定 Mortal' }).getAttribute('aria-checked')).toBe('false')
  expect(within(favorites).getAllByRole('radio')).toHaveLength(1)
  expect(within(all).getAllByRole('radio')).toHaveLength(2)
  expect(invoke.mock.calls.some(([command]) => command === 'set_active_bot')).toBe(false)
  expect(useConfigStore.getState().config?.bot.active_4p).toBe('akagi-native')
  view.unmount()
  mount()
  const reopened = await screen.findByRole('region', { name: '四人局模型' })
  fireEvent.click(await within(reopened).findByRole('group', { name: '收藏模型' }).then(group => within(group).getByRole('button', { name: '取消收藏 Mortal' })))
  expect(screen.getByRole('button', { name: '收藏 Mortal' }).getAttribute('aria-pressed')).toBe('false')
  const emptyFavorites = within(reopened).getByRole('group', { name: '收藏模型' })
  expect(within(emptyFavorites).queryByRole('radio')).toBeNull()
  expect(within(emptyFavorites).getByText('空空如也')).toBeTruthy()
  expect(within(reopened).getByRole('separator')).toBeTruthy()
})

it('keeps an empty favorites row with its heading and separator in both modes', async () => {
  mount()
  for (const name of ['四人局模型', '三人局模型']) {
    const section = await screen.findByRole('region', { name })
    expect(within(section).getByRole('heading', { name: '已收藏' })).toBeTruthy()
    const favorites = within(section).getByRole('group', { name: '收藏模型' })
    expect(within(favorites).getByText('空空如也')).toBeTruthy()
    expect(within(section).getByRole('separator')).toBeTruthy()
    expect(within(section).getByRole('group', { name: '全部模型' })).toBeTruthy()
  }
})

it('only highlights the clicked copy of a favorite and confirms it on a second click', async () => {
  useUiPrefsStore.setState({ favoriteModels: ['mortal'] })
  mount()
  const fourPlayer = screen.getByRole('region', { name: '四人局模型' })
  const favorites = await within(fourPlayer).findByRole('group', { name: '收藏模型' })
  const all = within(fourPlayer).getByRole('group', { name: '全部模型' })
  const card = within(favorites).getByRole('radio', { name: '为四人局指定 Mortal' })
  fireEvent.click(card)
  expect(card.getAttribute('aria-checked')).toBe('true')
  expect(within(all).getByRole('radio', { name: '为四人局指定 Mortal' }).getAttribute('aria-checked')).toBe('false')
  expect(useConfigStore.getState().config?.bot.active_4p).toBe('akagi-native')
  fireEvent.click(card)
  await waitFor(() => expect(useConfigStore.getState().config?.bot.active_4p).toBe('mortal'))
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
