import type { ImmersiveFrame } from './types'
import { probabilityText, tileName } from './model'
import { tileIndex } from './geometry'
import { makaRecommendations, opponentDiscardRisk, riskPercent } from './maka'
import { MakaAction, MakaTile } from './MakaBadge'

export function AnalysisPanel({ frame }: { frame: ImmersiveFrame | null }) {
  const a = frame?.analysis?.revision === frame?.revision && frame?.capture.state === 'running' && frame.transport_connected !== false && !frame.game?.is_done ? frame?.analysis : null
  const unique = frame ? makaRecommendations(frame) : []
  const candidates = a?.hand14?.maintain ?? []
  const waiting = a?.hand13
  return <div className="hud-analysis-page">
    <section><h2>模型行动建议 · 前五选</h2><p>金色为一选，蓝色为其他候选。Maka 标签使用整数百分比，下面保留精确值；缺少细分概率时显示“—”。</p>
      {unique.length ? <table><thead><tr><th>行动</th><th>推荐概率</th><th>牌效</th><th>估算放铳</th></tr></thead><tbody>{unique.map((h, rank) => <tr key={h.id}>
        <td><span className="maka-table-action"><MakaAction kind={h.kind} best={rank === 0} />{h.tile && <MakaTile tile={h.tile} />}{rank === 0 && <em>一选</em>}{h.probabilityNote && <small>{h.probabilityNote}</small>}</span></td><td>{probabilityText(h.probability)}</td><td>{h.detail ?? '—'}</td><td>{h.risk === undefined ? '—' : h.risk.toFixed(1) + '%'}</td>
      </tr>)}</tbody></table> : <div className="hud-empty">等待当前决策的模型结果</div>}
    </section>
    <section><h2>牌效与打点 · 算法估计</h2>
      {candidates.length > 0 && <table><thead><tr><th>算法前三</th><th>切后向听</th><th>有效进张</th><th>和牌率</th><th>默听打点</th><th>立直打点</th><th>局收支期望</th></tr></thead><tbody>{candidates.slice(0, 3).map(c => <tr key={c.discard}><td>{tileName(c.discard)}</td><td>{c.result.shanten}</td><td>{c.result.waits.length} 种 / {c.result.waits_total} 枚</td><td>{c.result.avg_agari_rate.toFixed(1)}%</td><td>{Math.round(c.result.dama_point)}</td><td>{Math.round(c.result.riichi_point)}</td><td>{Math.round(c.result.mixed_round_point)}</td></tr>)}</tbody></table>}
      {waiting && <p>{waiting.shanten === 0 ? '听牌' : waiting.shanten + '向听'} · {waiting.waits.map(w => `${tileName(w.tile)} × ${w.left}`).join(' / ')} · 剩余 {waiting.waits_total} 枚{waiting.is_furiten ? ' · 振听' : ''} · 估算和牌率 {waiting.avg_agari_rate.toFixed(1)}%</p>}
      {!a && <div className="hud-empty">等待当前牌局的分析数据</div>}
      <p>剩余牌数只根据自己手牌和公开牌计算；听牌率、和牌率、打点均为算法估计。</p>
    </section>
    {a && <section><h2>防守与对手</h2><p>进攻参考：{a.best_attack_discard ? tileName(a.best_attack_discard) : '—'}　防守参考：{a.best_defence_discard ? tileName(a.best_defence_discard) : '—'}</p>
      <table><thead><tr><th>手牌</th>{a.opponents.map(o => <th key={o.seat}>{['东', '南', '西', '北'][(o.seat - (frame?.game?.oya ?? 0) + (frame?.game?.num_players ?? 4)) % (frame?.game?.num_players ?? 4)]}家 {o.is_riichi ? '立直' : ''}<small>估算听牌 {o.tenpai_rate.toFixed(1)}%</small></th>)}<th>综合放铳风险</th></tr></thead>
        <tbody>{[...new Set(frame?.game?.players.find(p => p.seat === frame.game?.our_seat)?.tehai ?? [])].map(tile => <tr key={tile}><td>{tileName(tile)}</td>{a.opponents.map(o => <td key={o.seat}>{riskPercent(opponentDiscardRisk(o, tile))}</td>)}<td>{riskPercent(a.mixed_risk[tileIndex(tile)])}</td></tr>)}</tbody></table>
    </section>}
  </div>
}
