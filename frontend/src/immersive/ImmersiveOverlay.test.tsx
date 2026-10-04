import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { action, frame } from './fixtures'
import type { ImmersiveFrame } from './types'
const live = vi.hoisted(() => ({frame:null as ImmersiveFrame | null, error:false, host:{foreground:true, panel:false, hints:true}}))
const command = vi.hoisted(()=>vi.fn().mockResolvedValue(undefined))
vi.mock('@/lib/tauri',()=>({invoke:command,listen:async()=>()=>{}}))
vi.mock('./useImmersiveFrame', () => ({useImmersiveFrame: () => live}))
vi.mock('./useContours', () => ({useContours: () => []}))
vi.mock('./ControlPanel', () => ({ControlPanel: ({close}: {close: () => void}) => <div role="dialog" aria-label="MAKA INGAME 牌桌菜单"><button onClick={close}>返回牌桌</button></div>}))
import { ImmersiveOverlay } from './ImmersiveOverlay'
const cfg = {enabled:true, top_n:5, opacity:.95, always_on_top:true, immersive:true}
beforeEach(() => { command.mockClear(); live.frame = frame(); live.error = false; live.host = {foreground:true,panel:false,hints:true} })
afterEach(() => vi.useRealTimers())

it('finishes the return-button exit animation before releasing the native menu window', () => {
  vi.useFakeTimers()
  live.host.panel = true
  const view = render(<ImmersiveOverlay cfg={cfg} />)
  fireEvent.click(screen.getByRole('button', {name:'返回牌桌'}))
  expect(view.container.querySelector('.maka-menu-transition.is-closing')).toBeTruthy()
  expect(command).not.toHaveBeenCalledWith('set_immersive_panel', {open:false})
  act(() => vi.advanceTimersByTime(249))
  expect(screen.getByText('返回牌桌')).toBeTruthy()
  expect(command).not.toHaveBeenCalledWith('set_immersive_panel', {open:false})
  act(() => vi.advanceTimersByTime(1))
  expect(command).toHaveBeenCalledWith('set_immersive_panel', {open:false})
  expect(screen.queryByText('返回牌桌')).toBeNull()
  // A delayed host acknowledgement must not reopen the menu for a frame.
  view.rerender(<ImmersiveOverlay cfg={{...cfg,opacity:.9}} />)
  expect(screen.queryByText('返回牌桌')).toBeNull()
  live.host.panel = false
  view.rerender(<ImmersiveOverlay cfg={cfg} />)
  expect(screen.queryByText('返回牌桌')).toBeNull()
  live.host.panel = true
  view.rerender(<ImmersiveOverlay cfg={cfg} />)
  expect(screen.getByRole('button', {name:'返回牌桌'})).toBeTruthy()
})

it('waits the full button delay again when MAKA is turned back on', () => {
  vi.useFakeTimers()
  live.frame!.legal_actions = [action('pon'),action('pass')]
  live.frame!.response!.meta = {akagi_revision:12,akagi_policy:{complete:true,candidates:[{action:'pon',prob:.9},{action:'pass',prob:.1}]}}
  const view = render(<ImmersiveOverlay cfg={cfg} />)
  act(() => vi.advanceTimersByTime(460))
  expect(screen.getByTestId('event-button-pon')).toBeTruthy()
  live.host.hints = false
  view.rerender(<ImmersiveOverlay cfg={cfg} />)
  expect(screen.queryByTestId('event-button-pon')).toBeNull()
  live.host.hints = true
  view.rerender(<ImmersiveOverlay cfg={cfg} />)
  expect(screen.queryByTestId('event-button-pon')).toBeNull()
  act(() => vi.advanceTimersByTime(459))
  expect(screen.queryByTestId('event-button-pon')).toBeNull()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByTestId('event-button-pon')).toBeTruthy()
})

it('keeps the master switch available when guidance is off while the menu stays independent', () => {
  const { rerender } = render(<ImmersiveOverlay cfg={cfg} />)
  expect(screen.getByLabelText('MAKA INGAME：启用中')).toBeTruthy()
  live.host = {...live.host, hints:false}
  rerender(<ImmersiveOverlay cfg={cfg} />)
  expect(screen.getByLabelText('MAKA INGAME：未开启')).toBeTruthy()
  expect(screen.queryByLabelText('牌效与进张')).toBeNull()
  live.host = {...live.host, panel:true}
  rerender(<ImmersiveOverlay cfg={cfg} />)
  expect(screen.queryByLabelText('MAKA INGAME：启用中')).toBeNull()
  expect(screen.getByRole('dialog', {name:'MAKA INGAME 牌桌菜单'})).toBeTruthy()
  live.host = {...live.host, hints:true, panel:false}
  rerender(<ImmersiveOverlay cfg={cfg} />)
  expect(screen.getByLabelText('MAKA INGAME：启用中')).toBeTruthy()
})
it('does not cover the lobby, ended games or open menus with a status icon', () => {
  const { rerender } = render(<ImmersiveOverlay cfg={cfg} />)
  for (const game of [null, {...frame().game!,is_done:true}]) {
    live.frame = {...frame(),game}
    rerender(<ImmersiveOverlay cfg={cfg} />)
    expect(screen.queryByRole('status')).toBeNull()
  }
  live.frame = frame(); live.host.panel = true
  rerender(<ImmersiveOverlay cfg={cfg} />)
  expect(screen.queryByRole('status')).toBeNull()
})
it('uses the original open/closed sprite according to connection readiness', () => {
  const { rerender } = render(<ImmersiveOverlay cfg={cfg} />)
  expect(screen.getByRole('status').querySelector('img')?.src).toContain('button_open.png')
  live.frame = {...frame(),transport_connected:false}
  rerender(<ImmersiveOverlay cfg={cfg} />)
  expect(screen.getByRole('status').querySelector('img')?.src).toContain('button_close.png')
  expect(screen.getByRole('status').textContent).toContain('未开启')
})
it('uses Ctrl+Space for MAKA guidance and Ctrl+Shift+Space only for the menu in preview', () => {
  vi.useFakeTimers()
  render(<ImmersiveOverlay cfg={cfg} preview={frame()} />)
  fireEvent.keyDown(window, {code:'Space', key:' ', ctrlKey:true})
  expect(screen.getByLabelText('MAKA INGAME：未开启')).toBeTruthy()
  fireEvent.keyDown(window, {code:'Space', key:' ', ctrlKey:true, shiftKey:true})
  expect(screen.getByRole('dialog', {name:'MAKA INGAME 牌桌菜单'})).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
  fireEvent.keyDown(window, {code:'Space', key:' ', ctrlKey:true})
  expect(screen.queryByRole('status')).toBeNull()
  fireEvent.keyDown(window, {key:'Escape'})
  act(() => vi.advanceTimersByTime(250))
  expect(screen.getByLabelText('MAKA INGAME：启用中')).toBeTruthy()
})
it('opens three directional feature buttons and keeps their settings after reopening', async () => {
  render(<ImmersiveOverlay cfg={cfg} preview={frame()} />)
  fireEvent.contextMenu(screen.getByRole('button',{name:'MAKA 实时指导'}))
  expect(within(screen.getByRole('group',{name:'实时指导功能'})).getAllByRole('button')).toHaveLength(3)
  for (const [label,rotation] of [['出牌提示',-90],['向听与进张',180],['碰杠吃胡',0]] as const) {
    const button = screen.getByRole('button',{name:label}) as HTMLButtonElement
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.querySelector('img')?.src).toContain('next_difference_bright.png')
    expect(button.querySelector('img')?.style.transform).toBe(`rotate(${rotation}deg)`)
    fireEvent.click(button)
    await waitFor(() => expect(button.disabled).toBe(false))
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.querySelector('img')?.src).toContain('next_difference_dark.png')
  }
  fireEvent.contextMenu(screen.getByRole('button',{name:'MAKA 实时指导'}))
  expect(screen.queryByRole('group',{name:'实时指导功能'})).toBeNull()
  fireEvent.contextMenu(screen.getByRole('button',{name:'MAKA 实时指导'}))
  for (const button of within(screen.getByRole('group',{name:'实时指导功能'})).getAllByRole('button')) expect(button.getAttribute('aria-pressed')).toBe('false')
  expect(screen.getByRole('status').textContent).toContain('启用中')
})
it('removes input immediately while the native closing animation finishes and can reopen midway',()=>{
  vi.useFakeTimers()
  const view=render(<ImmersiveOverlay cfg={cfg} preview={frame()} />)
  const master=screen.getByRole('button',{name:'MAKA 实时指导'})
  fireEvent.contextMenu(master)
  fireEvent.contextMenu(master)
  expect(screen.queryByRole('group',{name:'实时指导功能'})).toBeNull()
  expect(view.container.querySelector('.maka-quick-settings.is-closing')).toBeTruthy()
  expect(view.container.querySelectorAll('.maka-quick-settings [data-hud-interactive]')).toHaveLength(0)
  act(()=>vi.advanceTimersByTime(40))
  fireEvent.contextMenu(master)
  act(()=>vi.advanceTimersByTime(100))
  expect(within(screen.getByRole('group',{name:'实时指导功能'})).getAllByRole('button')).toHaveLength(3)
  fireEvent.contextMenu(master)
  act(()=>vi.advanceTimersByTime(84))
  expect(view.container.querySelector('.maka-quick-settings')).toBeNull()
})
it('keeps the tenpai toggle outside the three MAKA settings and changes only opponent information', async () => {
  render(<ImmersiveOverlay cfg={cfg} preview={frame()} />)
  const tenpai = screen.getByRole('button',{name:'听牌提示'}) as HTMLButtonElement
  expect(tenpai.querySelector('img')?.src).toContain('ob_ting_on_btn.png')
  fireEvent.click(tenpai)
  await waitFor(()=>expect(tenpai.disabled).toBe(false))
  expect(tenpai.getAttribute('aria-pressed')).toBe('false')
  expect(tenpai.querySelector('img')?.src).toContain('ob_ting_off_btn.png')
  fireEvent.contextMenu(screen.getByRole('button',{name:'MAKA 实时指导'}))
  const group = screen.getByRole('group',{name:'实时指导功能'})
  expect(group.contains(tenpai)).toBe(false)
  expect(within(group).getAllByRole('button').map(button=>button.getAttribute('aria-pressed'))).toEqual(['true','true','true'])
  expect(screen.getByRole('button',{name:'MAKA 实时指导'}).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(tenpai)
  await waitFor(()=>expect(tenpai.getAttribute('aria-pressed')).toBe('true'))
})
it('keeps tenpai panels and their expanded state independent of MAKA clicks and its shortcut', async () => {
  render(<ImmersiveOverlay cfg={cfg} preview={frame()} />)
  const master = screen.getByRole('button',{name:'MAKA 实时指导'})
  const tenpai = screen.getByRole('button',{name:'听牌提示'})
  const right = screen.getByTestId('opponent-1')
  fireEvent.click(within(right).getByRole('button',{name:'展开全部放铳牌'}))
  fireEvent.click(master)
  await waitFor(()=>expect(master.getAttribute('aria-pressed')).toBe('false'))
  expect(screen.getByTestId('opponent-1')).toBe(right)
  expect(within(right).getByRole('button',{name:'收起放铳牌'})).toBeTruthy()
  expect(tenpai.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(tenpai)
  await waitFor(()=>expect(screen.queryByTestId('opponent-1')).toBeNull())
  fireEvent.keyDown(window,{code:'Space',key:' ',ctrlKey:true})
  expect(master.getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByTestId('opponent-1')).toBeNull()
  fireEvent.click(tenpai)
  await waitFor(()=>expect(screen.getByTestId('opponent-1')).toBeTruthy())
  fireEvent.keyDown(window,{code:'Space',key:' ',ctrlKey:true})
  expect(master.getAttribute('aria-pressed')).toBe('false')
  expect(screen.getByTestId('opponent-1')).toBeTruthy()
})
it('keeps receiving current opponent estimates while live MAKA guidance is off', () => {
  live.host.hints = false
  const view = render(<ImmersiveOverlay cfg={cfg} />)
  expect(screen.getByTestId('opponent-1')).toBeTruthy()
  live.frame = {...frame(),analysis:{revision:12,seat:0,turn:3,shanten:2,state:'discard14',hand13:null,hand14:null,opponents:[{seat:1,is_riichi:false,tenpai_rate:96,risk:[]}],mixed_risk:[],best_attack_discard:null,best_defence_discard:null}}
  view.rerender(<ImmersiveOverlay cfg={cfg} />)
  expect(within(screen.getByTestId('opponent-1')).getByText('96%')).toBeTruthy()
  live.frame = {...live.frame,transport_connected:false}
  view.rerender(<ImmersiveOverlay cfg={cfg} />)
  expect(screen.queryByTestId('opponent-1')).toBeNull()
})
it('sends independent feature patches even before a delayed config event arrives', async () => {
  render(<ImmersiveOverlay cfg={cfg} />)
  fireEvent.contextMenu(screen.getByRole('button',{name:'MAKA 实时指导'}))
  fireEvent.click(screen.getByRole('button',{name:'出牌提示'}))
  await waitFor(()=>expect((screen.getByRole('button',{name:'碰杠吃胡'}) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button',{name:'碰杠吃胡'}))
  await waitFor(()=>expect(command).toHaveBeenCalledWith('update_immersive_options',{feature:'show_actions',enabled:false}))
  expect(command).toHaveBeenCalledWith('update_immersive_options',{feature:'show_discards',enabled:false})
})
it('clicks the master off and back on without changing individual preferences', async () => {
  render(<ImmersiveOverlay cfg={{...cfg,show_discards:false}} preview={frame()} />)
  const master = screen.getByRole('button',{name:'MAKA 实时指导'})
  fireEvent.click(master)
  await waitFor(()=>expect(master.getAttribute('aria-pressed')).toBe('false'))
  expect(screen.getByLabelText('MAKA INGAME：未开启')).toBeTruthy()
  expect(screen.queryByLabelText('牌效与进张')).toBeNull()
  fireEvent.click(master)
  await waitFor(()=>expect(master.getAttribute('aria-pressed')).toBe('true'))
  expect(screen.getByLabelText('MAKA INGAME：启用中')).toBeTruthy()
  fireEvent.contextMenu(master)
  expect(screen.getByRole('button',{name:'出牌提示'}).getAttribute('aria-pressed')).toBe('false')
})
it('uses keyboard and MAKA clicks interchangeably, including closing feature settings', async () => {
  render(<ImmersiveOverlay cfg={{...cfg,show_discards:false}} preview={frame()} />)
  const master = screen.getByRole('button',{name:'MAKA 实时指导'})
  fireEvent.contextMenu(master)
  fireEvent.keyDown(window,{code:'Space',key:' ',ctrlKey:true})
  expect(master.getAttribute('aria-pressed')).toBe('false')
  expect(screen.queryByRole('group',{name:'实时指导功能'})).toBeNull()
  fireEvent.click(master)
  await waitFor(()=>expect(master.getAttribute('aria-pressed')).toBe('true'))
  fireEvent.contextMenu(master)
  expect(screen.getByRole('button',{name:'出牌提示'}).getAttribute('aria-pressed')).toBe('false')
})
it('keeps autoplay off by default and independent from guidance visibility', async () => {
  render(<ImmersiveOverlay cfg={cfg} preview={frame()} />)
  const auto=screen.getByRole('button',{name:'托管挂机'})
  expect(auto.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(auto)
  await waitFor(()=>expect(auto.getAttribute('aria-pressed')).toBe('true'))
  fireEvent.click(screen.getByRole('button',{name:'MAKA 实时指导'}))
  await waitFor(()=>expect(screen.getByLabelText('MAKA INGAME：未开启')).toBeTruthy())
  expect(auto.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(auto)
  await waitFor(()=>expect(auto.getAttribute('aria-pressed')).toBe('false'))
})
