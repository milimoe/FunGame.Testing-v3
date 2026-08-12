import { useMemo, useState } from 'react'
import { fetchStats } from '../api'
import { Badge, CharChip, ErrorBox, HBar, Section, Spinner, useFetch } from './ui'
import { charColor, fmt, fmtTime } from '../util'

type SortKey = 'rating' | 'kills' | 'deaths' | 'totalDamage' | 'totalHeal'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'rating', label: 'Rating' },
  { key: 'kills', label: '击杀' },
  { key: 'deaths', label: '死亡' },
  { key: 'totalDamage', label: '总伤害' },
  { key: 'totalHeal', label: '总治疗' },
]

export default function StatsPanel() {
  const { data, error, loading } = useFetch(fetchStats)
  const [sortKey, setSortKey] = useState<SortKey>('rating')

  const rows = useMemo(() => {
    if (!data) return []
    const sorted = [...data.rows]
    switch (sortKey) {
      case 'kills':
        sorted.sort((a, b) => b.kills - a.kills)
        break
      case 'deaths':
        sorted.sort((a, b) => a.deaths - b.deaths)
        break
      case 'totalDamage':
        sorted.sort((a, b) => b.totalDamage - a.totalDamage)
        break
      case 'totalHeal':
        sorted.sort((a, b) => b.totalHeal - a.totalHeal)
        break
      default:
        sorted.sort((a, b) => b.rating - a.rating)
    }
    return sorted
  }, [data, sortKey])

  if (loading) return <Spinner />
  if (error || !data) return <ErrorBox message={error ?? '无数据'} />

  const maxDamage = Math.max(...data.rows.map(r => r.totalDamage), 1)
  const maxHeal = Math.max(...data.rows.map(r => r.totalHeal + r.totalShield), 1)

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      {/* 存档信息条 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <InfoCard label="总回合数" value={fmt(data.roundCount)} icon="📜" />
        <InfoCard label="游戏模式" value={data.mode} icon="⚔️" />
        <InfoCard label="总时长" value={fmtTime(data.totalTime)} icon="⏱️" />
        <InfoCard label="MVP" value={data.mvpName || '—'} icon="👑" accent />
      </div>

      {/* 排行榜表格 */}
      <Section
        title="Rating 排行榜"
        subtitle="全场比赛的战斗表现总览"
        right={
          <div className="flex flex-wrap gap-1">
            {SORTS.map(s => (
              <button
                key={s.key}
                onClick={() => setSortKey(s.key)}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                  sortKey === s.key ? 'bg-rose-500 text-white' : 'bg-rose-50 text-slate-500 hover:text-rose-600'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="pb-2 pr-2">#</th>
                <th className="pb-2 pr-2">角色</th>
                <th className="pb-2 pr-2">队伍</th>
                <th className="pb-2 pr-2 text-right">Rating</th>
                <th className="pb-2 pr-2 text-right">击杀 / 助攻 / 死亡</th>
                <th className="pb-2 pr-2 text-right">总伤害</th>
                <th className="pb-2 pr-2 text-right">总治疗</th>
                <th className="pb-2 pr-2 text-right">金钱</th>
                <th className="pb-2 pr-2 text-right">MVP</th>
                <th className="pb-2 text-right">平均排名</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.guid} className="border-t border-rose-100 transition-colors hover:bg-rose-50/70">
                  <td className="py-2.5 pr-2 font-bold text-slate-400">
                    {i === 0 ? <span className="text-amber-500">🥇</span> : i === 1 ? <span className="text-slate-400">🥈</span> : i === 2 ? <span className="text-orange-400">🥉</span> : i + 1}
                  </td>
                  <td className="py-2.5 pr-2">
                    <CharChip char={r} size="sm" />
                  </td>
                  <td className="py-2.5 pr-2 text-xs text-slate-400">{r.teamName || '—'}</td>
                  <td className="py-2.5 pr-2 text-right">
                    <span className={`tabular-nums font-black ${r.rating >= 1.2 ? 'text-rose-500' : r.rating >= 1 ? 'text-emerald-600' : 'text-slate-600'}`}>
                      {r.rating.toFixed(4)}
                    </span>
                  </td>
                  <td className="py-2.5 pr-2 text-right tabular-nums">
                    <span className="text-red-500">{r.kills}</span>
                    <span className="text-rose-200"> / </span>
                    <span className="text-violet-500">{r.assists}</span>
                    <span className="text-rose-200"> / </span>
                    <span className="text-slate-400">{r.deaths}</span>
                  </td>
                  <td className="py-2.5 pr-2 text-right tabular-nums text-slate-600">{fmt(r.totalDamage, 0)}</td>
                  <td className="py-2.5 pr-2 text-right tabular-nums text-emerald-600">{fmt(r.totalHeal, 0)}</td>
                  <td className="py-2.5 pr-2 text-right tabular-nums text-amber-600">{fmt(r.totalEarnedMoney, 0)}</td>
                  <td className="py-2.5 pr-2 text-right tabular-nums text-slate-600">{r.mvPs > 0 ? r.mvPs : '—'}</td>
                  <td className="py-2.5 text-right tabular-nums text-slate-400">{r.avgRank > 0 ? r.avgRank.toFixed(1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 伤害 / 治疗对比 */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="总伤害对比" subtitle="全场比赛输出">
          <div className="space-y-2.5">
            {data.rows.map(r => (
              <HBar key={r.guid} label={r.nickName} value={r.totalDamage} max={maxDamage} color={charColor(r.guid)} format={n => fmt(n, 0)} />
            ))}
          </div>
        </Section>
        <Section title="总治疗 + 护盾对比" subtitle="全场比赛回复">
          <div className="space-y-2.5">
            {data.rows.map(r => (
              <HBar
                key={r.guid}
                label={r.nickName}
                value={r.totalHeal + r.totalShield}
                max={maxHeal}
                color={charColor(r.guid)}
                format={n => fmt(n, 0)}
              />
            ))}
          </div>
        </Section>
      </div>

      {/* 队伍结果 */}
      {data.teams.length > 0 && (
        <Section title="队伍结果" subtitle={`${data.teams.length} 支队伍 · ${data.mode}模式`}>
          <div className="grid gap-4 md:grid-cols-2">
            {data.teams.map(team => (
              <div
                key={team.id}
                className={`rounded-lg border p-4 ${
                  team.isWinner ? 'border-amber-400/60 bg-amber-50' : 'border-rose-200 bg-rose-50/60'
                }`}
              >
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="font-bold text-slate-800">
                    {team.name} {team.isWinner && <Badge tone="amber">🏆 获胜</Badge>}
                  </span>
                  <span className="text-lg font-black text-slate-600">Score {fmt(team.score)}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                  {team.members.map(m => (
                    <CharChip key={m.guid} char={m} size="sm" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

// ===== 信息卡片 =====
function InfoCard({ label, value, icon, accent }: { label: string; value: string; icon: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-rose-100 bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-400">
        {icon} {label}
      </p>
      <p className={`mt-1.5 truncate text-xl font-black tabular-nums ${accent ? 'text-rose-500' : 'text-slate-800'}`}>{value}</p>
    </div>
  )
}
