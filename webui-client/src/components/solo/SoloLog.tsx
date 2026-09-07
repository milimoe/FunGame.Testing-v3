import { useEffect, useMemo, useRef, useState } from 'react'

interface SoloLogProps {
  log: string[]
  round: number
}

export default function SoloLog({ log, round }: SoloLogProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  const lastLenRef = useRef(0)

  // 内容新增且处于「跟随」状态时自动滚动到底部
  useEffect(() => {
    const el = boxRef.current
    if (el && follow && log.length !== lastLenRef.current) {
      el.scrollTop = el.scrollHeight
    }
    lastLenRef.current = log.length
  }, [log, follow])

  const trimmed = useMemo(() => {
    const n = log.length
    return n > 2000 ? log.slice(n - 2000) : log
  }, [log])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">
          战斗日志 · 第 {round} 回合 · {log.length} 行
        </span>
        <label className="flex cursor-pointer items-center gap-1 text-[11px] text-ink-500">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
            className="accent-gold-500"
          />
          自动滚动
        </label>
      </div>
      <div
        ref={boxRef}
        className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-lg border border-ink-800/10 bg-parchment-100/50 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-ink-700"
      >
        {trimmed.map((line, idx) => {
          const l = line.trim()
          const isHeading = /^===|^---/.test(l)
          const isActor = /^现在是|^轮到|回合/.test(l)
          return (
            <div
              key={idx}
              className={
                isHeading
                  ? 'mt-1 border-b border-gold-500/25 pb-0.5 font-sans font-bold text-gold-700'
                  : isActor
                    ? 'font-sans font-semibold text-ink-800'
                    : ''
              }
            >
              {l || '\u00A0'}
            </div>
          )
        })}
        {trimmed.length === 0 && <div className="text-ink-400">（日志为空，游戏开始后在此显示战斗过程）</div>}
      </div>
    </div>
  )
}
