import { useEffect, useState } from 'react'

interface SoloTurnBannerProps {
  /** 当前是否有待玩家处理的决策请求 */
  hasDecision: boolean
  /** 决策截止时间戳（ms），来自服务端下发的 timeoutMs */
  decisionDeadline: number | null
  /** 玩家角色是否已被服务端交给 AI 托管 */
  aiEscalated: boolean
  /** 对局是否已暂停（引擎线程挂起，倒计时不计） */
  paused: boolean
  /** 当前回合数 */
  round: number
}

/**
 * 回合状态横幅：明确告诉玩家"现在轮到谁、还剩多久、是否被 AI 托管"。
 *
 * 服务端在决策下发时携带 timeoutMs；超时后服务端会把玩家角色交 AI 托管并推进回合，
 * 因此这里必须把倒计时显性化，避免玩家在 UI 上看不出是否轮到自己而干等。
 *
 * 移动端注意：横幅浮在地图之上，必须**单行不换行**，否则会在窄屏上撑成一坨挡住战场。
 */
export function SoloTurnBanner({ hasDecision, decisionDeadline, aiEscalated, paused, round }: SoloTurnBannerProps) {
  const [remain, setRemain] = useState<number | null>(null)

  useEffect(() => {
    if (decisionDeadline === null) {
      setRemain(null)
      return
    }
    const tick = () => setRemain(Math.max(0, Math.ceil((decisionDeadline - Date.now()) / 1000)))
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [decisionDeadline])

  // 暂停优先级最高：引擎线程已挂起，回合与倒计时都不推进
  if (paused) {
    return (
      <div className="pointer-events-none absolute left-1/2 top-1 z-20 -translate-x-1/2">
        <div className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-400/60 bg-emerald-50/95 px-2.5 py-[3px] text-[10.5px] font-medium text-emerald-700 shadow-sm">
          <span className="text-[11px] leading-none">⏸</span>
          对局已暂停 · 点顶栏 ▶ 继续
        </div>
      </div>
    )
  }

  // AI 托管优先级最高：此时玩家收不到任何决策请求，必须显式说明原因
  if (aiEscalated) {
    return (
      <div className="pointer-events-none absolute left-1/2 top-1 z-20 -translate-x-1/2">
        <div className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-400/60 bg-amber-50/95 px-2.5 py-[3px] text-[10.5px] font-medium text-amber-800 shadow-sm">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
          </span>
          AI 托管中 · 下回合夺回控制权
        </div>
      </div>
    )
  }

  if (hasDecision) {
    const urgent = remain !== null && remain <= 10
    return (
      <div className="pointer-events-none absolute left-1/2 top-1 z-20 -translate-x-1/2">
        <div
          className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[10.5px] font-medium shadow-sm ${
            urgent ? 'border-rose-400/60 bg-rose-50/95 text-rose-700' : 'border-emerald-400/60 bg-emerald-50/95 text-emerald-700'
          }`}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${urgent ? 'bg-rose-400' : 'bg-emerald-400'}`}
            />
            <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${urgent ? 'bg-rose-500' : 'bg-emerald-500'}`} />
          </span>
          轮到你行动
          {remain !== null ? <span className="tabular-nums">· {remain}s</span> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute left-1/2 top-1 z-20 -translate-x-1/2">
      <div className="whitespace-nowrap rounded-full border border-ink-800/10 bg-parchment-100/90 px-2.5 py-[3px] text-[10.5px] text-ink-500">
        {round > 0 ? `第 ${round} 回合 · 其他角色行动中` : '战斗进行中…'}
      </div>
    </div>
  )
}
