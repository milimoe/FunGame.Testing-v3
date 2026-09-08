import { useEffect, useMemo, useState } from 'react'
import type { SoloCharacterDto, SoloDecisionRequest, SoloMapDto } from '../../game/soloTypes'

interface SoloMapProps {
  map: SoloMapDto
  charByGuid: ReadonlyMap<string, SoloCharacterDto>
  playerGuid: string | null
  decision: SoloDecisionRequest | null
  /** 选中格子（TargetGrid 单击即提交；TargetGrids 点选后点确定提交） */
  onPickGrid: (gridId: number) => void
  onSubmitGrids: (gridIds: number[]) => void
  /** 直接点选地图上的角色作为目标（Targets 决策） */
  onPickTargets: (guids: string[]) => void
  /** 取消当前决策（回传 cancelled） */
  onCancelDecision: () => void
}

interface TokenStyle {
  bg: string
  ring: string
  label: string
  dim?: boolean
}

function tokenStyle(c: SoloCharacterDto, isPlayer: boolean): TokenStyle {
  if (c.isEliminated) return { bg: '#6b7280', ring: '#4b5563', label: '#f9fafb', dim: true }
  if (isPlayer) return { bg: '#d4a838', ring: '#8a5f12', label: '#2a1f14' }
  return { bg: '#dc2626', ring: '#7f1d1d', label: '#fff7ed' }
}

function shortName(c: SoloCharacterDto): string {
  const src = c.nickName || c.name || '?'
  return [...src][0] ?? '?'
}

export default function SoloMap({ map, charByGuid, playerGuid, decision, onPickGrid, onSubmitGrids, onPickTargets, onCancelDecision }: SoloMapProps) {
  const [multiSel, setMultiSel] = useState<Set<number>>(new Set())
  const [hoverId, setHoverId] = useState<number | null>(null)

  const selectKind = decision?.payload.kind

  // 选目标（Targets）：允许直接点击地图上的角色
  const targetPayload = decision?.payload.kind === 'Targets' ? decision.payload : null
  const targetMulti = (targetPayload?.maxTargets ?? 1) > 1
  const targetByGrid = useMemo(() => {
    const m = new Map<number, string>()
    if (targetPayload) for (const t of targetPayload.targets) if (t.gridId >= 0) m.set(t.gridId, t.guid)
    return m
  }, [targetPayload])
  // TargetGrid 的 requestId 变化时清空点选状态
  const requestKey = decision?.requestId ?? 'none'
  useEffect(() => {
    setMultiSel(new Set())
    setHoverId(null)
  }, [requestKey])

  const moveIds = useMemo(() => {
    if (!decision) return new Set<number>()
    const p = decision.payload
    if (p.kind === 'TargetGrid') return new Set(p.gridIds)
    if (p.kind === 'TargetGrids') return new Set(p.gridIds)
    return new Set<number>()
  }, [decision])

  const isMulti = selectKind === 'TargetGrids'
  const currentGridId = decision?.payload.kind === 'TargetGrid' ? decision.payload.currentGridId : null

  const cells = useMemo(() => [...map.grids].sort((a, b) => a.y - b.y || a.x - b.x), [map.grids])

  const handleCellClick = (gridId: number) => {
    if (!decision) return
    const p = decision.payload

    // 选目标：直接点地图上的角色
    if (p.kind === 'Targets') {
      const guid = targetByGrid.get(gridId)
      if (!guid) return
      if (!targetMulti) {
        onPickTargets([guid])
        return
      }
      setMultiSel((prev) => {
        const next = new Set(prev)
        if (next.has(gridId)) next.delete(gridId)
        else if (next.size < (targetPayload?.maxTargets ?? 1)) next.add(gridId)
        return next
      })
      return
    }

    if (p.kind !== 'TargetGrid' && p.kind !== 'TargetGrids') return
    if (!moveIds.has(gridId)) return
    if (p.kind === 'TargetGrid') {
      onPickGrid(gridId)
      return
    }
    setMultiSel((prev) => {
      const next = new Set(prev)
      if (next.has(gridId)) next.delete(gridId)
      else next.add(gridId)
      return next
    })
  }

  const gridCount = map.length * map.width

  return (
    <div className="flex h-full flex-col gap-2">
      {/* 选目标操作条：可直接点地图上的角色 */}
      {decision && selectKind === 'Targets' && targetPayload && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-horde-500/40 bg-horde-500/10 px-3 py-1.5 text-[12px] text-ink-700">
          <span className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm border border-horde-600/60 bg-horde-500/40" />
            {targetMulti
              ? `为「${targetPayload.skillName || '技能'}」点选地图上的角色（最多 ${targetPayload.maxTargets} 个）`
              : `为「${targetPayload.skillName || '技能'}」点击地图上的角色作为目标`}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {targetMulti ? (
              <>
                <span className="text-ink-500">已选 {multiSel.size}</span>
                <button
                  className="rounded-lg border border-horde-600/50 bg-horde-500/85 px-2.5 py-1 font-medium text-white hover:bg-horde-500 disabled:opacity-40"
                  disabled={multiSel.size === 0}
                  onClick={() =>
                    onPickTargets(
                      [...multiSel]
                        .map((id) => targetByGrid.get(id))
                        .filter((g): g is string => typeof g === 'string'),
                    )
                  }
                >
                  确认目标
                </button>
                <button
                  className="rounded-lg border border-ink-400/30 bg-parchment-200/70 px-2.5 py-1 text-ink-600 hover:bg-parchment-300/70"
                  onClick={onCancelDecision}
                >
                  取消
                </button>
              </>
            ) : (
              <button
                className="rounded-lg border border-ink-400/30 bg-parchment-200/70 px-2.5 py-1 text-ink-600 hover:bg-parchment-300/70"
                onClick={onCancelDecision}
              >
                取消
              </button>
            )}
          </span>
        </div>
      )}

      {/* 选区操作条 */}
      {decision && (selectKind === 'TargetGrid' || selectKind === 'TargetGrids') && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-gold-500/40 bg-gold-300/15 px-3 py-1.5 text-[12px] text-ink-700">
          <span className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm border border-emerald-700/60 bg-emerald-200" />
            {selectKind === 'TargetGrid' ? '可移动 / 可选取范围：单击目标格子确认（或点击自身格子原地待命）' : '施放范围：点选多个格子，再点「确认施放」'}
          </span>
          {isMulti ? (
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="text-ink-500">已选 {multiSel.size} 格</span>
              <button
                className="rounded-lg border border-emerald-700/50 bg-emerald-600/85 px-2.5 py-1 font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
                disabled={multiSel.size === 0}
                onClick={() => onSubmitGrids([...multiSel])}
              >
                确认施放
              </button>
              <button
                className="rounded-lg border border-ink-400/30 bg-parchment-200/70 px-2.5 py-1 text-ink-600 hover:bg-parchment-300/70"
                onClick={() => onSubmitGrids([])}
              >
                取消
              </button>
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-1.5">
              {currentGridId !== null && currentGridId >= 0 && (
                <button
                  className="rounded-lg border border-gold-600/50 bg-gold-300/30 px-2.5 py-1 text-ink-700 hover:bg-gold-300/50"
                  onClick={() => onPickGrid(currentGridId)}
                  title="移动距离为 0，原地待命"
                >
                  原地待命
                </button>
              )}
              <button
                className="rounded-lg border border-ink-400/30 bg-parchment-200/70 px-2.5 py-1 text-ink-600 hover:bg-parchment-300/70"
                onClick={() => onSubmitGrids([])}
              >
                取消
              </button>
            </span>
          )}
        </div>
      )}

      {/* 地图网格 */}
      <div className="relative min-h-0 flex-1 overflow-auto rounded-xl border border-gold-500/30 bg-parchment-100/40 p-2 shadow-inner">
        <div
          className="grid gap-[3px]"
          style={{
            gridTemplateColumns: `repeat(${map.length}, minmax(18px, 1fr))`,
            gridTemplateRows: `repeat(${map.width}, minmax(18px, 1fr))`,
            width: 'fit-content',
            maxWidth: '100%',
          }}
        >
          {cells.map((g) => {
            const token = g.characters.length > 0 ? charByGuid.get(g.characters[0]) : undefined
            const inRange = moveIds.has(g.id)
            const multiOn = multiSel.has(g.id)
            const isCurrent = currentGridId === g.id
            // 可选目标所在格（Targets 决策）
            const targetGuid = targetByGrid.get(g.id)
            const targetOn = targetGuid !== undefined && multiSel.has(g.id)

            let cellBg = 'rgba(255, 252, 240, 0.55)'
            let cellBorder = '1px solid rgba(133, 95, 18, 0.16)'
            let cursor = ''
            if (inRange && !isMulti) {
              cellBg = 'rgba(16, 185, 129, 0.35)'
              cellBorder = '1px solid rgba(4, 120, 87, 0.65)'
              cursor = 'pointer'
            } else if (inRange && isMulti) {
              cellBg = multiOn ? 'rgba(37, 99, 235, 0.5)' : 'rgba(96, 165, 250, 0.32)'
              cellBorder = multiOn ? '2px solid rgba(29, 78, 216, 0.9)' : '1px dashed rgba(37, 99, 235, 0.7)'
              cursor = 'pointer'
            } else if (isCurrent) {
              cellBg = 'rgba(212, 168, 56, 0.22)'
              cellBorder = '1px dashed rgba(138, 95, 18, 0.7)'
            } else if (targetGuid !== undefined) {
              cellBg = targetOn ? 'rgba(220, 38, 38, 0.42)' : 'rgba(220, 38, 38, 0.14)'
              cellBorder = targetOn ? '2px solid rgba(153, 27, 27, 0.9)' : '1px dashed rgba(220, 38, 38, 0.6)'
              cursor = 'pointer'
            }

            let ts: TokenStyle | null = null
            if (token) ts = tokenStyle(token, token.guid === playerGuid)

            return (
              <button
                key={g.id}
                onClick={() => handleCellClick(g.id)}
                onMouseEnter={() => setHoverId(g.id)}
                onMouseLeave={() => setHoverId(null)}
                title={`格子 #${g.id} (${g.x},${g.y},${g.z})${token ? ` · ${token.displayName}` : ''}`}
                className="relative flex aspect-square items-center justify-center rounded-[4px] transition-colors"
                style={{ backgroundColor: cellBg, border: cellBorder, cursor }}
              >
                {ts ? (
                  <span
                    className="flex h-[70%] w-[70%] items-center justify-center rounded-full text-[clamp(9px,1.4vw,15px)] font-bold shadow-sm"
                    style={{
                      backgroundColor: ts.bg,
                      color: ts.label,
                      opacity: ts.dim ? 0.45 : 1,
                      boxShadow: ts.dim ? 'none' : `0 0 0 1.5px ${ts.ring}, 0 1px 3px rgba(0,0,0,0.35)`,
                    }}
                  >
                    {shortName(token!)}
                  </span>
                ) : null}
                {hoverId === g.id && !token ? (
                  <span className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-ink-800/90 px-1.5 py-0.5 text-[10px] text-parchment-100">
                    #{g.id}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        {/* 尺寸提示 */}
        <div className="pointer-events-none absolute bottom-1.5 right-2 text-[10px] text-ink-400">
          {map.name} · {map.length}×{map.width}×{map.height} · {gridCount} 格
        </div>
      </div>
    </div>
  )
}
