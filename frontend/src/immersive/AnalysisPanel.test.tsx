import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AnalysisPanel } from './AnalysisPanel'
import { frame } from './fixtures'

it('uses the same per-tile unconditional risk as the table HUD and distinguishes missing data', () => {
  const f = frame()
  f.analysis = { revision:12,seat:0,turn:1,shanten:2,state:'discard14',hand13:null,hand14:null,
    opponents:[{seat:1,tenpai_rate:25,risk:[8],is_riichi:false}],mixed_risk:[],best_attack_discard:null,best_defence_discard:null }
  render(<AnalysisPanel frame={f} />)
  const row = screen.getByRole('row', {name:'1万 2.0% —'})
  expect(within(row).getByText('2.0%')).toBeTruthy()
  expect(screen.queryByText('—%')).toBeNull()
})
