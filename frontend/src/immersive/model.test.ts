import { describe, expect, it } from 'vitest'
import { buildHints, decodeDistribution, preferenceColor, probabilityText } from './model'
import { frame, action } from './fixtures'

describe('full model preference distribution', () => {
  it('decodes compressed q values without 32-bit mask truncation and uses temperature 0.3', () => {
    const p = decodeDistribution({ mask_bits: 1 + 2 ** 34 + 2 ** 45, q_values: [0, 0.3, 0] }, 4)
    expect(p.get('discard:5mr')).toBeCloseTo(Math.E / (2 + Math.E), 8)
    expect(p.get('pass')).toBeCloseTo(1 / (2 + Math.E), 8)
    expect([...p.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
  })
  it('uses sanma kita index and rejects malformed probabilities', () => {
    expect(decodeDistribution({ mask_bits: 2 ** 40, q_values: [5000] }, 3).get('kita')).toBe(1)
    expect(decodeDistribution({ mask_bits: 3, q_values: [1] }, 4).size).toBe(0)
    expect(decodeDistribution({ mask_bits: 1, q_values: [NaN] }, 4).size).toBe(0)
    expect(probabilityText(null)).toBe('—')
    expect(probabilityText(0)).toBe('0.00%')
    expect(probabilityText(0.735)).toBe('73.50%')
  })
  it('maps native precise candidate rows without rounding raw probabilities', () => {
    const p = decodeDistribution({ show: { items: [{ label: 'Discard', pais: ['5m'], prob: 0.12345 }, { label: 'Pass', prob: 0.87655 }] } }, 4)
    expect(p.get('discard:5m')).toBe(0.12345)
    expect(p.get('pass')).toBe(0.87655)
  })
  it('colors a sole/maximum candidate green, midpoint yellow and zero red, without changing numbers', () => {
    expect(preferenceColor(0.7, 0.7)).toBe('#39e58c')
    expect(preferenceColor(0.35, 0.7)).toBe('#f5ce54')
    expect(preferenceColor(0, 0.7)).toBe('#f26b6b')
    expect(preferenceColor(null, 0.7)).toBe('#9ca3af')
  })
  it('shares probability across physical duplicates and separates red fives', () => {
    const f = frame()
    f.response!.meta = { akagi_revision: 12, mask_bits: 1 + 2 ** 34, q_values: [0, 0] }
    const before = JSON.stringify(f)
    const hints = buildHints(f)
    expect(hints.filter(h => h.tile === '1m').map(h => h.probability)).toEqual([0.5, 0.5])
    expect(hints.find(h => h.tile === '5mr')?.probability).toBe(0.5)
    expect(hints.find(h => h.tile === '5m')?.probability).toBeNull()
    expect(JSON.stringify(f)).toBe(before)
  })
  it('sums mutually exclusive chi directions once and exposes per-choice values', () => {
    const f = frame()
    f.legal_actions = [action('pass'), action('chi', '3m', ['4m', '5m']), action('chi', '3m', ['1m', '2m'])]
    f.response = { type: 'none', meta: { akagi_revision: 12, mask_bits: 2 ** 38 + 2 ** 40 + 2 ** 45, q_values: [0, 0, 0] } }
    expect(buildHints(f).find(h => h.kind === 'chi')?.probability).toBeCloseTo(2 / 3)
    const choices = buildHints(f, 'chi').filter(h => h.choice)
    expect(choices).toHaveLength(2)
    expect(choices.map(h => h.probability)).toEqual([1 / 3, 1 / 3])
  })
  it('does not invent a split of aggregate kan probability', () => {
    const f = frame()
    f.legal_actions = [action('pass'), action('ankan', null, Array(4).fill('1m')), action('ankan', null, Array(4).fill('2m'))]
    f.response = { type: 'ankan', actor: 0, consumed: ['1m', '1m', '1m', '1m'], meta: { akagi_revision: 12, mask_bits: 2 ** 42, q_values: [0] } }
    expect(buildHints(f).find(h => h.kind === 'ankan')?.probability).toBe(1)
    const choices = buildHints(f, 'ankan').filter(h => h.choice)
    expect(choices.map(h => h.probability)).toEqual([null, null])
    expect(choices.filter(h => h.best)).toHaveLength(1)
  })
  it('hides stale responses, finished rounds and disconnected capture', () => {
    const f = frame()
    for (const revision of [11, 13]) {
      f.response!.meta!.akagi_revision = revision
      expect(buildHints(f)).toEqual([])
    }
    f.response!.meta!.akagi_revision = 12
    f.game!.is_done = true
    expect(buildHints(f)).toEqual([])
    f.game!.is_done = false
    f.capture = { state: 'stopped' }
    expect(buildHints(f)).toEqual([])
  })
  it('does not turn truncated display rows into a complete cancel probability or exact pon-choice probability', () => {
    const f = frame()
    f.legal_actions.push(action('reach'))
    f.response!.meta = { akagi_revision: 12, show: { items: [{ label: 'Discard', pais: ['1m'], prob: 0.2 }] } }
    expect(buildHints(f).find(h => h.kind === 'pass')?.probability).toBeNull()
    f.legal_actions = [action('pass'), action('pon', '5p', ['5p', '5p']), action('pon', '5p', ['5pr', '5p'])]
    f.response!.meta = { akagi_revision: 12, show: { items: [{ label: 'Pon', pais: ['5p', '5pr', '5p'], prob: 0.8 }] } }
    expect(buildHints(f, 'pon').filter(h => h.choice).map(h => h.probability)).toEqual([null, null])
  })
  it('reads full machine policy separately from display rows', () => {
    const d = decodeDistribution({ akagi_policy: { complete: true, candidates: [{ action: 'discard:1m', prob: 0.1 }, { action: 'reach', prob: 0.9 }] } }, 4)
    expect(d.get('discard:1m')).toBe(0.1)
    expect(d.get('reach')).toBe(0.9)
  })
  it('does not sum incomplete legacy kan rows into an exact aggregate', () => {
    const f = frame()
    f.legal_actions = [action('ankan', null, Array(4).fill('1m')), action('ankan', null, Array(4).fill('2m')), action('discard', '3m')]
    f.response!.meta = { akagi_revision: 12, show: { items: [{ label: 'Ankan', pais: Array(4).fill('1m'), prob: .4 }, { label: 'Discard', pais: ['3m'], prob: .3 }] } }
    expect(buildHints(f).find(h => h.kind === 'ankan')?.probability).toBeNull()
  })
  it('uses native per-tile kan probabilities for the combined button and each choice', () => {
    const f = frame()
    f.legal_actions = [action('ankan', null, Array(4).fill('1m')), action('kakan', '9p', Array(3).fill('9p'))]
    f.response!.meta = { akagi_revision: 12, akagi_policy: { complete: true, granularity: 'action_index', candidates: [{ action: 'kan_tile:1m', prob: .4 }, { action: 'kan_tile:9p', prob: .6 }] } }
    expect(buildHints(f).find(h => h.kind === 'ankan')?.probability).toBe(1)
    expect(buildHints(f, 'ankan').map(h => h.probability)).toEqual([.6, .4])
  })
  it('restricts local reach selection to legal riichi discards without reusing ordinary discard probabilities', () => {
    const f = frame()
    f.riichi_discards = ['5m']
    f.legal_actions.push(action('reach'))
    const hints = buildHints(f, 'reach')
    expect(hints.filter(h => h.kind === 'discard').map(h => h.tile)).toEqual(['5m'])
    expect(hints.filter(h => h.kind === 'discard').map(h => h.probability)).toEqual([null])
    expect(hints.some(h => h.kind === 'reach')).toBe(false)
  })
})
