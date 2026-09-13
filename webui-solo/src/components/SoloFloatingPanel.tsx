import { useEffect, type ReactNode } from 'react'

// ============================================================================
// 单人模式 · 浮层外壳
// 移动端不再把日志 / 操作区 / 队伍常驻在版面上，而是统一收纳成「右侧滑出的小窗」，
// 由右侧按钮列的按钮随时调出、关闭。这里提供两种外壳：
//   SoloFloatingPanel —— 贴右侧滑出的抽屉（日志 / 操作 / 队伍）
//   SoloModal         —— 居中浮层（角色详情 / 设置 / 终止确认 / 开局选角色）
// ============================================================================

type Tone = 'gold' | 'blue' | 'red' | 'violet'

const TONE_BAR: Record<Tone, string> = {
  gold: 'from-gold-500/85',
  blue: 'from-alliance-500/85',
  red: 'from-horde-500/85',
  violet: 'from-purple-500/85',
}

interface FloatingPanelProps {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  /** 标题栏右侧的附加动作（关闭按钮之前） */
  actions?: ReactNode
  /** 内容区样式：日志 / 队伍需要自身滚动，操作区需要自定义布局 */
  bodyClassName?: string
  /** 抽屉宽度（窄屏下自动收窄） */
  widthClass?: string
}

export default function SoloFloatingPanel({
  title,
  subtitle,
  onClose,
  children,
  actions,
  bodyClassName = 'overflow-y-auto overscroll-contain p-2.5',
  widthClass = 'w-[min(340px,86vw)]',
}: FloatingPanelProps) {
  // Esc 关闭：桌面上也能顺手收起
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="solo-fade absolute inset-0 z-30 bg-ink-900/35" onClick={onClose} />
      <aside
        className={`solo-drawer absolute inset-y-0 right-0 z-40 flex flex-col border-l border-gold-500/35 bg-parchment-100/95 shadow-2xl backdrop-blur ${widthClass}`}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-ink-800/10 bg-gradient-to-r from-gold-300/25 to-transparent px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-fantasy text-[13.5px] font-bold tracking-wide text-gold-700">{title}</div>
            {subtitle ? <div className="truncate text-[10.5px] text-ink-500">{subtitle}</div> : null}
          </div>
          {actions}
          <button
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 rounded-lg border border-ink-400/25 bg-parchment-200/70 px-2 py-1 text-[12px] leading-none text-ink-600 hover:bg-parchment-300/70"
          >
            ✕
          </button>
        </header>
        <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
      </aside>
    </>
  )
}

interface ModalProps {
  title: ReactNode
  subtitle?: ReactNode
  tone?: Tone
  onClose?: () => void
  canClose?: boolean
  children: ReactNode
  footer?: ReactNode
  maxW?: string
  /** 标题栏左侧图标 */
  icon?: ReactNode
}

/** 居中浮层：角色详情 / 设置 / 终止确认 / 开局选角色 */
export function SoloModal({
  title,
  subtitle,
  tone = 'gold',
  onClose,
  canClose = true,
  children,
  footer,
  maxW = 'w-[min(440px,94vw)]',
  icon,
}: ModalProps) {
  useEffect(() => {
    if (!canClose || !onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canClose, onClose])

  return (
    <>
      <div
        className="solo-fade absolute inset-0 z-40 bg-ink-900/45 backdrop-blur-[2px]"
        onClick={canClose ? onClose : undefined}
      />
      <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center p-3">
        <div className={`solo-pop panel pointer-events-auto flex max-h-full flex-col overflow-hidden rounded-2xl ${maxW}`}>
          <header className={`flex shrink-0 items-center gap-2 bg-gradient-to-r ${TONE_BAR[tone]} to-transparent px-3.5 py-2.5`}>
            {icon ? <span className="shrink-0 text-[18px] leading-none">{icon}</span> : null}
            <div className="min-w-0 flex-1">
              <div className="truncate font-fantasy text-[14.5px] font-bold tracking-wide text-white drop-shadow">{title}</div>
              {subtitle ? <div className="truncate text-[10.5px] text-white/85">{subtitle}</div> : null}
            </div>
            {canClose ? (
              <button
                onClick={onClose}
                aria-label="关闭"
                className="shrink-0 rounded-lg bg-white/20 px-2 py-1 text-[12px] leading-none text-white hover:bg-white/30"
              >
                ✕
              </button>
            ) : null}
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">{children}</div>
          {footer ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-ink-800/10 bg-parchment-200/40 px-3 py-2.5">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
