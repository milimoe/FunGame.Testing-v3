import type { SoloCharacterDto, SoloDpDto, SoloQueueEntryDto } from '../game/soloTypes'

// ============================================================================
// 行动顺序表（左侧竖条）
// 竖版手游的空间很紧，这里只保留「谁先动」这一条主线信息：
// 序号 + 头像 + 名字 + 迷你血条。点一下可以看该角色的完整详情。
// ============================================================================

interface SoloQueueProps {
  queue: SoloQueueEntryDto[]
  charByGuid: ReadonlyMap<string, SoloCharacterDto>
  playerGuid: string | null
  currentActorGuid: string | null
  playerDP: SoloDpDto | null
  onInspect: (guid: string) => void
}

export default function SoloQueue({ queue, charByGuid, playerGuid, currentActorGuid, playerDP, onInspect }: SoloQueueProps) {
  const dpPct = playerDP ? Math.min(100, (playerDP.current / Math.max(1, playerDP.max)) * 100) : 0
  // 阵营配色：团队模式下己方（蓝队）蓝、敌方红；混战则是玩家金、其余红
  const myTeam = playerGuid ? charByGuid.get(playerGuid)?.teamName ?? null : null
  const teamMode = myTeam !== null
  const tokenColor = (teamName: string | null, dead: boolean, isPlayer: boolean): string => {
    if (dead) return '#6b7280'
    if (teamMode) return teamName === myTeam ? '#2563eb' : '#dc2626'
    return isPlayer ? '#d4a838' : '#dc2626'
  }
  const ringColor = (teamName: string | null, dead: boolean, isPlayer: boolean): string => {
    if (dead) return 'none'
    if (teamMode) return `0 0 0 1.5px ${teamName === myTeam ? '#1d4ed8' : '#7f1d1d'}`
    return `0 0 0 1.5px ${isPlayer ? '#8a5f12' : '#7f1d1d'}`
  }

  return (
    <aside className="flex w-[58px] shrink-0 flex-col gap-1 overflow-hidden rounded-xl border border-ink-800/10 bg-parchment-200/55 p-1">
      {/* 决策点：玩家回合的行动资源，放在最显眼的位置 */}
      {playerDP ? (
        <div className="shrink-0 rounded-lg border border-gold-500/45 bg-gradient-to-b from-gold-300/30 to-gold-500/10 px-1 py-1 text-center">
          <div className="text-[8.5px] font-bold tracking-wide text-gold-600">决策点</div>
          <div className="font-mono text-[13px] font-bold leading-none text-ink-800">
            {playerDP.current}
            <span className="text-[9px] font-normal text-ink-500">/{playerDP.max}</span>
          </div>
          <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-ink-800/10">
            <div className="h-full rounded-full bg-gradient-to-r from-gold-500 to-gold-300 transition-all" style={{ width: `${dpPct}%` }} />
          </div>
        </div>
      ) : null}

      <div className="shrink-0 text-center text-[8.5px] font-medium tracking-wide text-ink-400">行动顺序</div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pr-[1px]">
        {queue.length === 0 ? <div className="py-3 text-center text-[9.5px] leading-tight text-ink-400">等待中…</div> : null}
        {queue.map((entry, idx) => {
          const ch = charByGuid.get(entry.guid)
          const isFirst = idx === 0
          const isPlayer = entry.guid === playerGuid
          const isActor = entry.guid === currentActorGuid
          const dead = ch ? ch.isEliminated || ch.hp <= 0 : false
          const hpPct = ch && ch.maxHP > 0 ? Math.min(100, Math.max(0, (ch.hp / ch.maxHP) * 100)) : 0
          return (
            <button
              key={`${entry.guid}-${entry.order}`}
              onClick={() => onInspect(entry.guid)}
              title={`${entry.displayName} · 行动硬度 ${entry.hardnessTime.toFixed(1)}`}
              className={`flex shrink-0 flex-col items-center gap-[2px] rounded-lg border px-0.5 py-1 transition-all ${
                isFirst ? 'border-gold-500/70 bg-gold-300/25 shadow-sm' : 'border-transparent bg-parchment-100/45'
              } ${dead ? 'opacity-45' : ''}`}
            >
              <span className="relative">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${
                    isActor && !dead ? 'solo-actor-ring' : ''
                  }`}
                  style={{
                    backgroundColor: tokenColor(entry.teamName ?? null, dead, isPlayer),
                    color: dead || (!teamMode && isPlayer) ? '#2a1f14' : '#fff7ed',
                    boxShadow: ringColor(entry.teamName ?? null, dead, isPlayer),
                  }}
                >
                  {[...(ch?.nickName || ch?.name || entry.displayName || '?')][0]}
                </span>
                <span
                  className={`absolute -left-1 -top-1 flex h-[14px] w-[14px] items-center justify-center rounded-full text-[9px] font-bold ${
                    isFirst ? 'bg-gold-500 text-white' : 'bg-ink-800/15 text-ink-600'
                  }`}
                >
                  {idx + 1}
                </span>
              </span>
              <span className={`w-full truncate text-center text-[9px] leading-tight ${isPlayer ? 'font-bold text-gold-700' : 'text-ink-600'}`}>
                {isPlayer ? '★' : ''}
                {(ch?.nickName || ch?.name || entry.displayName || '?').slice(0, 3)}
              </span>
              <span className="h-[3px] w-[82%] overflow-hidden rounded-full bg-ink-800/10">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${hpPct}%`, backgroundColor: dead ? '#9ca3af' : '#dc2626' }}
                />
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
