import { act, fireEvent, render as mount, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { HudSurface } from './HudSurface'
import { action, frame } from './fixtures'
import type { AnalysisResult, Hand13Result } from '@/types'
import { buildHints } from './model'
import type { ImmersiveFrame } from './types'
import type { Silhouette } from './contours'
const shapes = (f: ImmersiveFrame): Silhouette[] => buildHints(f).map(h => ({ id: h.id, bounds: [h.x-.3, h.y-.5, .6, 1], paths: [[[h.x-.3,h.y], [h.x,h.y-.5], [h.x+.3,h.y], [h.x,h.y+.5]]] }))
const cfg = { enabled: true, top_n: 5, opacity: 0.95, always_on_top: true, immersive: true }
beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
function render(element: ReactElement) {
  const view = mount(element)
  act(() => vi.advanceTimersByTime(460))
  return {...view, rerender(next: ReactElement) { view.rerender(next); act(() => vi.advanceTimersByTime(460)) }}
}
const distribution = (f: ImmersiveFrame, candidates: Array<[string, number]>) => {
  f.response!.meta = { akagi_revision: 12, akagi_policy: { complete: true, candidates: candidates.map(([action, prob]) => ({ action, prob })) } }
}
it('shows at most five distinct recommendations without spending places on duplicate tiles', () => {
  const f = frame()
  distribution(f, [['discard:1m', .40], ['discard:5mr', .20], ['discard:5m', .15], ['discard:9p', .1], ['discard:E', .09], ['discard:9m', .06]])
  const { container } = render(<HudSurface frame={f} cfg={cfg} shapes={shapes(f)} />)
  const badges = [...container.querySelectorAll('[data-recommendation]')]
  expect(badges.map(b => b.getAttribute('data-recommendation'))).toEqual(['tile-0', 'tile-2', 'tile-3', 'tile-13', 'tile-11'])
  expect(screen.queryByTestId('hint-tile-1')).toBeNull()
  expect(container.querySelectorAll('svg, .hud-silhouette, .hud-calibration-rect')).toHaveLength(0)
  expect(screen.queryByTestId('maka-first')).toBeNull()
  expect(screen.queryByRole('complementary', { name: '按钮动作概率' })).toBeNull()
})
it('keeps a shared red/ordinary probability as one qualified recommendation', () => {
  const f = frame()
  distribution(f, [['discard_base:5m', 1]])
  const { container } = render(<HudSurface frame={f} cfg={{ ...cfg, show_analysis: false }} shapes={shapes(f)} />)
  const shared = [...container.querySelectorAll('[data-recommendation]')].filter(b => b.textContent?.includes('赤／普通合计'))
  expect(shared).toHaveLength(1)
})
it('does not invent hand locations and keeps the original label attached when a tile lifts', () => {
  const { container, rerender } = render(<HudSurface frame={frame()} cfg={cfg} />)
  expect(container.querySelectorAll('[data-recommendation]')).toHaveLength(0)
  expect(screen.queryByTestId('maka-first')).toBeNull()
  const s = shapes(frame())
  rerender(<HudSurface frame={frame()} cfg={cfg} shapes={s} />)
  const before = screen.getByTestId('hint-tile-0').style.top
  s[0] = { ...s[0], bounds: [s[0].bounds[0], s[0].bounds[1] - .4, .6, 1] }
  rerender(<HudSurface frame={frame()} cfg={cfg} shapes={s} />)
  expect(parseFloat(screen.getByTestId('hint-tile-0').style.top)).toBeLessThan(parseFloat(before))
})
it('adapts every native action to a Maka asset and keeps missing probability distinct', () => {
  const f = frame()
  for (const [kind, asset] of [['chi', 'big_chi'], ['pon', 'big_peng'], ['ankan', 'big_gang'], ['kakan', 'big_gang'], ['daiminkan', 'big_gang'], ['reach', 'small_lizhi'], ['tsumo', 'big_zimo'], ['ron', 'big_hu'], ['ryukyoku', 'big_liuju'], ['kita', 'big_babei']] as const) {
    f.game!.num_players = kind === 'kita' ? 3 : 4
    f.legal_actions = [action(kind, '3m', ['1m', '2m']), action('pass')]
    const key = kind === 'chi' ? 'chi_high' : ['ankan', 'kakan', 'daiminkan'].includes(kind) ? 'kan' : ['ron', 'tsumo'].includes(kind) ? 'hora' : kind
    distribution(f, [[key, .7], ['pass', .3]])
    const { unmount } = render(<HudSurface frame={f} cfg={cfg} shapes={shapes(f)} />)
    const panel = screen.getByRole('complementary', { name: '按钮动作概率' })
    const badge = within(panel).getByTestId(`event-button-${kind}`)
    expect(badge.querySelector('img')?.getAttribute('src')).toContain(asset)
    expect(badge.textContent).toContain('70')
    expect(within(panel).getByTestId('event-button-pass').querySelector('img')?.getAttribute('src')).toContain('big_skip')
    expect(screen.queryByTestId(`hint-button-${kind}`)).toBeNull()
    unmount()
  }
  f.response = { type: 'none', meta: { akagi_revision: 12 } }
  render(<HudSurface frame={f} cfg={cfg} shapes={shapes(f)} />)
  expect(screen.getByTestId('event-button-kita').textContent).toContain('—')
})
it('does not pad a short policy with unranked legal tiles', () => {
  const f = frame()
  distribution(f, [['discard:1m', 1]])
  const { container } = render(<HudSurface frame={f} cfg={cfg} shapes={shapes(f)} />)
  expect(container.querySelectorAll('[data-recommendation]')).toHaveLength(1)
})
it('keeps button labels aligned with calibrated controls before their first measurement', () => {
  const f = frame()
  f.legal_actions = [action('pon'), action('pass')]
  distribution(f, [['pon', .9], ['pass', .1]])
  const { rerender } = render(<HudSurface frame={f} cfg={cfg} />)
  const label = screen.getByTestId('event-button-pon')
  const before = [parseFloat(label.style.left), parseFloat(label.style.top)]
  rerender(<HudSurface frame={f} cfg={{...cfg,calibration:{x:1,y:0,scale:1,hand_y:0,button_y:-.5}}} />)
  expect(parseFloat(label.style.left) - before[0]).toBeCloseTo(6.25)
  expect(parseFloat(label.style.top)).toBeLessThan(before[1]-5)
})
it('keeps action labels at their docking positions through slide-in and missed detections', () => {
  const f = frame()
  f.legal_actions = [action('pon'), action('pass')]
  distribution(f, [['pon', .9], ['pass', .1]])
  const { rerender } = render(<HudSurface frame={f} cfg={cfg} />)
  const labels = ['pon', 'pass'].map(k => screen.getByTestId(`event-button-${k}`))
  const docked = labels.map(e => [e.style.left, e.style.top])
  for (const offset of [3, 2, 1, 0]) {
    const moving = shapes(f).map(s => ({...s, bounds: [s.bounds[0]+offset, s.bounds[1]-.1, s.bounds[2], s.bounds[3]] as Silhouette['bounds']}))
    rerender(<HudSurface frame={f} cfg={cfg} shapes={moving} />)
    expect(labels.map(e => [e.style.left, e.style.top])).toEqual(docked)
    rerender(<HudSurface frame={f} cfg={cfg} shapes={[]} />)
    expect(labels.map(e => [e.style.left, e.style.top])).toEqual(docked)
  }
})
it('anchors risk panels to the full client viewport at native face height, including after resize', () => {
  vi.stubGlobal('innerWidth', 1920)
  vi.stubGlobal('innerHeight', 1200)
  render(<HudSurface frame={frame()} cfg={cfg} />)
  const right = screen.getByTestId('opponent-1')
  const across = screen.getByTestId('opponent-2')
  const left = screen.getByTestId('opponent-3')
  // The visible waist meets the avatar; transparent cap columns add no gap.
  expect(parseFloat(right.style.left)-4).toBeCloseTo(1705.108, 2)
  expect(parseFloat(right.style.top)).toBeCloseTo(240.425, 2)
  expect(parseFloat(left.style.top)).toBeCloseTo(237.555, 2)
  expect(parseFloat(across.style.top)).toBeCloseTo(34.829, 2)
  expect(parseFloat(right.style.height)).toBeCloseTo(103.275, 2)
  act(() => {
    vi.stubGlobal('innerWidth', 2560)
    vi.stubGlobal('innerHeight', 1080)
    window.dispatchEvent(new Event('resize'))
  })
  expect(parseFloat(right.style.left)-4).toBeCloseTo(2025.108, 2)
  expect(parseFloat(right.style.top)).toBeCloseTo(288.425, 2)
  expect(parseFloat(left.style.left)+4).toBeCloseTo(-156.58706, 2)
  expect(parseFloat(right.style.height)).toBeCloseTo(103.275, 2)
})

it('keeps replay-strip dimensions and clears multi-row action labels even while inference refreshes', () => {
  const f = {...frame(), analysis: waitAnalysisResult()}
  f.legal_actions = [action('chi', '3m', ['1m', '2m']), action('pon'), action('daiminkan'), action('ron'), action('pass')]
  distribution(f, [['chi_high', .2], ['pon', .2], ['kan', .1], ['hora', .4], ['pass', .1]])
  const { rerender } = render(<HudSurface frame={f} cfg={cfg} />)
  const strip = screen.getByLabelText('牌效与进张')
  expect(parseFloat(strip.style.maxWidth)).toBeCloseTo(56.765625)
  expect(parseFloat(strip.style.height)).toBeCloseTo(10.333333)
  const bottom = parseFloat(strip.style.top) + parseFloat(strip.style.height)
  for (const hint of screen.getAllByTestId(/^event-button-/)) {
    const hintHeight = parseFloat(hint.style.width) * 16 / 9 * 126 / 260
    expect(bottom).toBeLessThan(parseFloat(hint.style.top) - hintHeight)
  }
  const position = strip.style.top
  rerender(<HudSurface frame={{...f,response:null,analysis:null}} cfg={cfg} />)
  expect(screen.getByLabelText('牌效与进张')).toBe(strip)
  expect(strip.style.top).toBe(position)
  expect(parseFloat(strip.style.height)).toBeCloseTo(10.333333)
})
it('replaces the entire tenpai heading with riichi immediately, even during analysis refresh', () => {
  const f = frame()
  f.analysis = analysisResult()
  f.analysis.opponents = [{seat:1,tenpai_rate:25,risk:[8],is_riichi:false}]
  const { rerender } = render(<HudSurface frame={f} cfg={cfg} />)
  const panel = screen.getByTestId('opponent-1')
  expect(within(panel).getByText('听牌')).toBeTruthy()
  expect(within(panel).getByText('放铳')).toBeTruthy()
  const game = structuredClone(f.game!)
  game.players[1].riichi_declared = true
  rerender(<HudSurface frame={{...f, revision:13, analysis:null, response:null, game}} cfg={cfg} />)
  expect(within(panel).getByText('立直')).toBeTruthy()
  expect(within(panel).queryByText('听牌')).toBeNull()
  expect(within(panel).queryByText('25%')).toBeNull()
  expect(within(panel).getByText('放铳')).toBeTruthy()
  expect(within(panel).getByLabelText('打1万，对其放铳估计—')).toBeTruthy()
  rerender(<HudSurface frame={{...f, revision:13, game, analysis:{...f.analysis,revision:13,opponents:[{seat:1,tenpai_rate:100,risk:[8],is_riichi:true}]}}} cfg={cfg} />)
  expect(within(panel).getByLabelText('打1万，对其放铳估计8.0%')).toBeTruthy()
})
it('removes every recommendation at round end, on stale responses or transport loss', () => {
  const f = frame()
  const { container, rerender } = render(<HudSurface frame={f} cfg={cfg} shapes={shapes(f)} />)
  expect(container.querySelectorAll('[data-recommendation]').length).toBeGreaterThan(0)
  for (const next of [{ ...f, response: { ...f.response!, meta: { akagi_revision: 11 } } }, { ...f, game: { ...f.game!, is_done: true } }, { ...f, transport_connected: false }]) {
    rerender(<HudSurface frame={next} cfg={cfg} shapes={shapes(f)} />)
    expect(container.querySelectorAll('[data-recommendation], [data-testid="maka-first"], [data-testid^="event-"]')).toHaveLength(0)
    expect(screen.queryByText(/本场结束|本局结束/)).toBeNull()
  }
})
it('places every button event above the native controls without reordering their columns by probability', () => {
  const f = frame()
  f.legal_actions = [action('chi', '3m', ['1m', '2m']), action('pon'), action('daiminkan'), action('ron'), action('pass')]
  distribution(f, [['chi_high', .2], ['pon', .2], ['kan', .1], ['hora', .4], ['pass', .1]])
  const { container, rerender } = render(<HudSurface frame={f} cfg={cfg} />)
  const panel = screen.getByRole('complementary', { name: '按钮动作概率' })
  expect(within(panel).getAllByTestId(/^event-button-/)).toHaveLength(5)
  expect(within(panel).getByTestId('event-button-ron').textContent).toContain('40')
  const chi = within(panel).getByTestId('event-button-chi')
  const pass = within(panel).getByTestId('event-button-pass')
  expect(parseFloat(chi.style.left)).toBeLessThan(parseFloat(pass.style.left))
  expect(parseFloat(pass.style.top)).toBeLessThan(60)
  expect(container.querySelectorAll('[data-recommendation]')).toHaveLength(0)
  rerender(<HudSurface frame={f} cfg={cfg} shapes={shapes(f)} />)
  expect(container.querySelectorAll('[data-recommendation]')).toHaveLength(0)
  rerender(<HudSurface frame={{ ...f, can_act: false }} cfg={cfg} />)
  expect(screen.queryByRole('complementary', { name: '按钮动作概率' })).toBeNull()
})

it('labels risk for every distinct held tile per opponent, including red fives, rather than only the first choice', () => {
  const f = frame()
  distribution(f, [['discard:1m', 1]])
  f.analysis = { revision: 12, seat: 0, turn: 5, shanten: 2, state: 'discard14', hand13: null, hand14: null, mixed_risk: [], best_attack_discard: '9p', best_defence_discard: null,
    opponents: [{seat:1,tenpai_rate:25,risk:[8,0,0,0,20],is_riichi:false},{seat:2,tenpai_rate:100,risk:[12],is_riichi:true},{seat:3,tenpai_rate:60,risk:[],is_riichi:false}] }
  const { rerender } = render(<HudSurface frame={f} cfg={cfg} shapes={shapes(f)} />)
  const right = screen.getByTestId('opponent-1')
  expect(right.textContent).toContain('25%')
  expect(right.textContent).toContain('2.0%')
  expect(within(right).getByAltText('1万')).toBeTruthy()
  expect(within(right).getByLabelText('打赤5万，对其放铳估计5.0%')).toBeTruthy()
  expect(within(right).getAllByAltText('1万')).toHaveLength(1)
  expect(screen.getByTestId('opponent-2').textContent).toContain('12.0%')
  expect(screen.getByTestId('opponent-3').textContent).toContain('—')
  rerender(<HudSurface frame={{...f, response: null}} cfg={cfg} />)
  expect(within(screen.getByTestId('opponent-1')).getByLabelText('打1万，对其放铳估计2.0%')).toBeTruthy()
  rerender(<HudSurface frame={{...f, transport_connected:false}} cfg={cfg} />)
  expect(screen.queryByTestId('opponent-1')).toBeNull()
  rerender(<HudSurface frame={{...f, game:null}} cfg={cfg} />)
  expect(screen.queryByTestId('opponent-1')).toBeNull()
})

const handResult = (): Hand13Result => ({ shanten: 2, waits: [{tile:'6m',left:4,agari_rate:null}], waits_total:4, next_shanten_waits_count:{}, avg_next_shanten_waits:0, mixed_waits_score:0, avg_agari_rate:0, is_furiten:false, furiten_rate:0, improves:[], improve_way_count:0, avg_improve_waits_count:0, dama_point:0, riichi_point:0, mixed_round_point:0, yaku_ids:[] })
const analysisResult = (): AnalysisResult => ({revision:12,seat:0,turn:3,shanten:2,state:'discard14',hand13:null,hand14:{shanten:2,maintain:[{discard:'2m',result:handResult()}],backwards:[]},opponents:[],mixed_risk:[],best_attack_discard:'2m',best_defence_discard:null})

const waitAnalysisResult = (): AnalysisResult => ({...analysisResult(), state:'wait13',hand13:handResult(),hand14:null})

it('keeps the tenpai label nearest the avatar on every side', () => {
  const f = {...frame(),analysis:analysisResult()}
  f.analysis.opponents = [1,2,3].map(seat=>({seat,is_riichi:false,tenpai_rate:96,risk:[]}))
  render(<HudSurface frame={f} cfg={cfg} />)
  expect(screen.getByTestId('opponent-1').querySelector('.maka-opponent-heading')?.textContent).toBe('96%听牌')
  expect(screen.getByTestId('opponent-2').querySelector('.maka-opponent-heading')?.textContent).toBe('96%听牌')
  expect(screen.getByTestId('opponent-3').querySelector('.maka-opponent-heading')?.textContent).toBe('听牌96%')
})

it('defaults to the four highest per-tile risks and expands without stretching avatar height', () => {
  const f = {...frame(),analysis:analysisResult()}
  f.analysis.opponents = [{seat:1,is_riichi:false,tenpai_rate:50,risk:Array.from({length:34},(_,i)=>i)}]
  render(<HudSurface frame={f} cfg={cfg} />)
  const panel = screen.getByTestId('opponent-1')
  const initialHeight = panel.style.height
  const tiles = () => [...panel.querySelectorAll('.maka-risk-tiles > span')].map(e=>e.getAttribute('aria-label'))
  expect(tiles()).toEqual(['打东，对其放铳估计13.5%','打6索，对其放铳估计11.5%','打5索，对其放铳估计11.0%','打4索，对其放铳估计10.5%'])
  fireEvent.click(within(panel).getByRole('button',{name:'展开全部放铳牌'}))
  expect(tiles()).toHaveLength(12)
  expect(panel.style.height).toBe(initialHeight)
  fireEvent.click(within(panel).getByRole('button',{name:'收起放铳牌'}))
  expect(tiles()).toHaveLength(4)
})
it('allows each guidance category to be disabled independently', () => {
  const f = {...frame(), analysis: waitAnalysisResult()}
  f.legal_actions.push(action('reach'))
  const {container,rerender} = render(<HudSurface frame={f} cfg={{...cfg,show_discards:false,show_actions:false}} shapes={shapes(f)} />)
  expect(container.querySelectorAll('[data-recommendation],.maka-event')).toHaveLength(0)
  expect(screen.getByLabelText('牌效与进张')).toBeTruthy()
  expect(screen.getByTestId('opponent-1')).toBeTruthy()
  rerender(<HudSurface frame={f} cfg={{...cfg,show_risk:false,show_analysis:false}} shapes={shapes(f)} />)
  expect(screen.queryByLabelText('牌效与进张')).toBeNull()
  expect(screen.queryByTestId('opponent-1')).toBeNull()
  expect(container.querySelectorAll('[data-recommendation]').length).toBeGreaterThan(0)
})

it('shows only current-hand shanten and never presents a hypothetical discard or its waits', () => {
  const f = {...frame(), analysis: analysisResult()}
  const { rerender } = render(<HudSurface frame={f} cfg={cfg} />)
  expect(screen.queryByLabelText('牌效与进张')).toBeNull()
  rerender(<HudSurface frame={{...f,analysis:{...f.analysis,hand13:handResult(),hand14:null,state:'wait13'}}} cfg={cfg} />)
  expect(within(screen.getByLabelText('牌效与进张')).getByAltText('6万')).toBeTruthy()
})

it('keeps analysis panels mounted between revisions, but never reuses hand results for a changed hand', () => {
  const f = {...frame(), analysis: waitAnalysisResult()}
  f.analysis.opponents = [{seat:1,tenpai_rate:25,risk:[8],is_riichi:false}]
  const { rerender } = render(<HudSurface frame={f} cfg={cfg} />)
  const panel = screen.getByLabelText('牌效与进张')
  const opponent = screen.getByTestId('opponent-1')
  rerender(<HudSurface frame={{...f,revision:13,analysis:null,response:null}} cfg={cfg} />)
  expect(screen.getByLabelText('牌效与进张')).toBe(panel)
  expect(panel.textContent).toContain('2 向听')
  expect(screen.getByTestId('opponent-1')).toBe(opponent)
  const changed = structuredClone(f.game!)
  changed.players[0].tehai.pop()
  rerender(<HudSurface frame={{...f,revision:14,game:changed,analysis:null,response:null}} cfg={cfg} />)
  expect(screen.queryByLabelText('牌效与进张')).toBeNull()
  rerender(<HudSurface frame={{...f,game:{...f.game!,is_done:true}}} cfg={cfg} />)
  expect(screen.queryByLabelText('牌效与进张')).toBeNull()
})

it('does not chase its own opaque badge in captured pixels, but still follows the real bottom edge', () => {
  const f = frame()
  distribution(f, [['discard:1m', 1]])
  const s = shapes(f)
  const { rerender } = render(<HudSurface frame={f} cfg={cfg} shapes={s} />)
  const top = parseFloat(screen.getByTestId('hint-tile-0').style.top)
  const polluted = s.map(v => v.id === 'tile-0' ? { ...v, bounds: [v.bounds[0], v.bounds[1] - .25, v.bounds[2], v.bounds[3] + .25] as [number, number, number, number] } : v)
  rerender(<HudSurface frame={f} cfg={cfg} shapes={polluted} />)
  expect(parseFloat(screen.getByTestId('hint-tile-0').style.top)).toBeCloseTo(top, 5)
  // After calls, all remaining tiles can carry labels. Retain the clean size.
  rerender(<HudSurface frame={f} cfg={cfg} shapes={polluted.filter(v => v.id === 'tile-0')} />)
  expect(parseFloat(screen.getByTestId('hint-tile-0').style.top)).toBeCloseTo(top, 5)
  polluted[0].bounds[1] -= .4
  rerender(<HudSurface frame={f} cfg={cfg} shapes={polluted} />)
  expect(parseFloat(screen.getByTestId('hint-tile-0').style.top)).toBeCloseTo(top - .4 / 9 * 100, 5)
})

it('hides the empty shanten box until current-hand waits are available and omits the caption', () => {
  const f = {...frame(), analysis: waitAnalysisResult()}
  const { rerender } = render(<HudSurface frame={{...f, analysis: {...f.analysis, hand13: {...handResult(), waits:[], waits_total:0}}}} cfg={cfg} />)
  expect(screen.queryByLabelText('牌效与进张')).toBeNull()
  rerender(<HudSurface frame={f} cfg={cfg} />)
  expect(screen.getByLabelText('牌效与进张').textContent).toContain('2 向听')
  expect(screen.getByAltText('6万')).toBeTruthy()
  expect(screen.queryByText('按可见牌计算')).toBeNull()
})
it('keeps pon and pass label spacing equal to the native controls in the supplied Steam frame', () => {
  const f = frame()
  f.legal_actions = [action('pon'), action('pass')]
  distribution(f, [['pon', .1], ['pass', .9]])
  render(<HudSurface frame={f} cfg={cfg} />)
  const pon = parseFloat(screen.getByTestId('event-button-pon').style.left) * 16 / 100
  const pass = parseFloat(screen.getByTestId('event-button-pass').style.left) * 16 / 100
  // Original op_peng/op_x opaque-template fits: centers 8.44449, 10.85913.
  // Both labels must have the same offset from the button underneath.
  expect(Math.abs((pon - 8.44449) - (pass - 10.85913))).toBeLessThan(.005)
})

it('keeps the waiting-hand strip throughout our draw, then replaces it after the discard', () => {
  const f = {...frame(), analysis: waitAnalysisResult(), can_act:false}
  f.game!.players[0].tehai.pop()
  f.game!.players[0].drawn_tile = null
  const { rerender } = render(<HudSurface frame={f} cfg={cfg} />)
  const strip = screen.getByLabelText('牌效与进张')
  const drawn = structuredClone(f.game!)
  drawn.players[0].tehai.push('6m')
  drawn.players[0].drawn_tile = '6m'
  const next = {...f, revision:13, game:drawn, analysis:null, response:null, can_act:true}
  rerender(<HudSurface frame={next} cfg={cfg} />)
  expect(screen.getByLabelText('牌效与进张')).toBe(strip)
  act(() => vi.advanceTimersByTime(5000))
  rerender(<HudSurface frame={{...next, analysis:{...analysisResult(),revision:13}}} cfg={cfg} />)
  expect(screen.getByLabelText('牌效与进张')).toBe(strip)
  expect(within(strip).getByAltText('6万')).toBeTruthy()
  const discarded = structuredClone(drawn)
  discarded.players[0].tehai.shift()
  discarded.players[0].drawn_tile = null
  const after = {...next,revision:14,game:discarded,can_act:false}
  rerender(<HudSurface frame={after} cfg={cfg} />)
  expect(screen.queryByLabelText('牌效与进张')).toBeNull()
  rerender(<HudSurface frame={{...after,analysis:{...waitAnalysisResult(),revision:14,hand13:{...handResult(),waits:[{tile:'9p',left:2,agari_rate:null}],waits_total:2}}}} cfg={cfg} />)
  expect(within(screen.getByLabelText('牌效与进张')).getByAltText('9筒')).toBeTruthy()
  rerender(<HudSurface frame={{...next,game:{...drawn,kyoku:2}}} cfg={cfg} />)
  expect(screen.queryByLabelText('牌效与进张')).toBeNull()
})
