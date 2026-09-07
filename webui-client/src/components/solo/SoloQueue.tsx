import type { SoloCharacterDto, SoloDpDto, SoloQueueEntryDto } from '../../game/soloTypes'

interface SoloQueueProps {
  queue: SoloQueueEntryDto[]
  charByGuid: ReadonlyMap<string, SoloCharacterDto>
  playerGuid: string | null
  playerDP: SoloDpDto | null
}

export default function SoloQueue({ queue, charByGuid, playerGuid, playerDP }: SoloQueueProps) {
  if (queue.length === 0) {
    return <div className="px-2 py-4 text-center text-[12px] text-ink-400">等待行动顺序…</div>
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {/* 决策点（玩家） */}
      {playerDP && (
        <div className="rounded-xl border border-gold-500/45 bg-gradient-to-b from-gold-300/25 to-gold-500/10 px-3 py-2">
          <div className="flex items-baseline justify-between">
            <span className="font-fantasy text-[12px] font-bold text-gold-600">决策点</span>
            <span className="text-[15px] font-bold text-ink-800">
              {playerDP.current}
              <span className="text-[11px] font-normal text-ink-500"> / {playerDP.max}</span>
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-800/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-gold-500 to-gold-300 transition-all"
              style={{ width: `${Math.min(100, (playerDP.current / Math.max(1, playerDP.max)) * 100)}%` }}
            />
          </div>
          <div className="mt-1 text-[10px] text-ink-500">每回合回复 {playerDP.recovery} · 已行动 {playerDP.actionsTaken} 次</div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-0.5">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-400">行动顺序表</div>
        {queue.map((entry, idx) => {
          const ch = charByGuid.get(entry.guid)
          const isFirst = idx === 0
          const isPlayer = entry.guid === playerGuid
          const dead = ch?.isEliminated || (ch !== undefined && ch.hp <= 0)
          return (
            <div
              key={entry.guid + entry.order}
              className={`flex items-center gap-2 rounded-lg border px-2 py-[5px] text-[12px] transition-all ${
                isFirst
                  ? 'border-gold-500/70 bg-gold-300/25 shadow-sm'
                  : 'border-transparent bg-parchment-200/30'
              } ${dead ? 'opacity-45' : ''}`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  isFirst ? 'bg-gold-500 text-white' : 'bg-ink-800/10 text-ink-500'
                }`}
              >
                {idx + 1}
              </span>
              <span className={`min-w-0 flex-1 truncate ${isPlayer ? 'font-bold text-gold-700' : 'text-ink-700'}`}>
                {isPlayer ? '★ ' : ''}
                {entry.displayName}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-ink-400">{entry.hardnessTime.toFixed(1)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
