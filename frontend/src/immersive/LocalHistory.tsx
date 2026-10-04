import { useHistoryStore } from '@/stores/historyStore'

export function LocalHistory() {
  const records = useHistoryStore(s => s.records)
  const loading = useHistoryStore(s => s.loading)
  const local = records.filter(r => r.platform === 'majsoul').sort((a, b) => b.started_at.localeCompare(a.started_at))

  return <div className="hud-local-page hud-local-history">
    <header className="hud-local-heading">
      <div><h2>本地战绩</h2><p>雀魂对局保存在本机，可随时回看最近的成绩。</p></div>
      <span className="hud-local-count">共 {local.length} 场</span>
    </header>
    <section className="hud-local-card" aria-label="最近对局">
      {local.length ? <table><thead><tr><th>日期</th><th>牌局</th><th>名次</th><th>终局点数</th><th>点数变化</th></tr></thead><tbody>
        {local.map(r => {
          const score = r.our_seat === null ? null : r.final_scores[r.our_seat]
          return <tr key={r.id}>
            <td>{new Date(r.started_at).toLocaleString()}</td>
            <td>{r.num_players} 人 · {r.kyoku_mode === 'east_only' ? '东风战' : r.kyoku_mode === 'east_south' ? '半庄战' : '其他'}</td>
            <td>{r.our_rank === null ? '—' : `${r.our_rank} 位`}</td>
            <td>{score === null || score === undefined ? '—' : score.toLocaleString()}</td>
            <td className={r.our_delta === null ? '' : r.our_delta >= 0 ? 'is-positive' : 'is-negative'}>{r.our_delta === null ? '—' : `${r.our_delta >= 0 ? '+' : ''}${r.our_delta.toLocaleString()}`}</td>
          </tr>
        })}
      </tbody></table> : <p className="hud-local-empty">{loading ? '正在读取本地战绩…' : '还没有雀魂对局记录'}</p>}
    </section>
  </div>
}
