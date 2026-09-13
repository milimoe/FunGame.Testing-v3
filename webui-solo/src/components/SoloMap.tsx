import { useEffect, useMemo, useRef, useState } from 'react'
import type { SoloCharacterDto, SoloDecisionRequest, SoloGridDto, SoloMapDto } from '../game/soloTypes'
import type { SoloPreviewRange } from './SoloActionPanel'
import { shapeGridIds, type ShapeParams } from '../game/shape'

// ============================================================================
// 战场地图（移动端竖版核心区域）
// - 棋盘按可用空间自适应缩放，格子恒为正方形，窄屏也不会横向溢出
// - 每个棋子上方直接画血条（HP），格子够大时再补一条 MP
// - 点击棋子 → 打开角色详情模态；若当前决策是「选目标」，点击则改为勾选目标
//   勾选与确认分离：这里只负责勾选，提交由地图下方的确认条执行（见 SoloPanel）
//
// 射程配色（问题 2）：
//   黄色 = 攻击距离 / 技能选取距离（优先显示）
//   绿色 = 移动距离
//   两色重叠时按「黄色优先」渲染
//   距离一律按引擎口径的曼哈顿距离计算（GameMap.GetGridsByRange），因此与服务端判定一致
// ============================================================================

interface SoloMapProps {
  map: SoloMapDto
  charByGuid: ReadonlyMap<string, SoloCharacterDto>
  playerGuid: string | null
  /** 正在行动的角色（用于呼吸环提示） */
  currentActorGuid: string | null
  decision: SoloDecisionRequest | null
  /** 已勾选的格子（TargetGrid = 单格 / TargetGrids = 多格） */
  pickedGrids: number[]
  /** 已勾选的目标角色（Targets） */
  pickedTargets: string[]
  /** 射程预演（操作菜单勾选时下发） */
  preview?: SoloPreviewRange | null
  onToggleGrid: (gridId: number) => void
  onToggleTarget: (guid: string) => void
  /** 点击棋子查看详情 */
  onInspect: (guid: string) => void
}

const GAP = 3
const MAX_CELL = 68

// 射程配色（黄 = 攻击/施法，绿 = 移动）
const YELLOW_BG = 'rgba(250, 204, 21, 0.36)'
const YELLOW_BORDER = '1px solid rgba(202, 138, 4, 0.75)'
const GREEN_BG = 'rgba(16, 185, 129, 0.28)'
const GREEN_BORDER = '1px solid rgba(4, 120, 87, 0.6)'

function shortName(c: SoloCharacterDto): string {
  const src = c.nickName || c.name || '?'
  return [...src][0] ?? '?'
}

/** 观测容器尺寸，用于把棋盘精确铺满可用空间 */
function useBoxSize() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

/**
 * 与 Core 的 GameMap.GetGridsByRange 完全一致的曼哈顿距离取格。
 * range < 0 视为「全图」（技能 CastAnywhere）。
 */
function gridsInRange(grids: SoloGridDto[], center: SoloGridDto | undefined, range: number, skipOccupied: boolean): Set<number> {
  const out = new Set<number>()
  if (!center) return out
  for (const g of grids) {
    if (skipOccupied && g.characters.length > 0) continue
    if (range < 0 || Math.abs(g.x - center.x) + Math.abs(g.y - center.y) + Math.abs(g.z - center.z) <= range) out.add(g.id)
  }
  return out
}

export default function SoloMap({
  map,
  charByGuid,
  playerGuid,
  currentActorGuid,
  decision,
  pickedGrids,
  pickedTargets,
  preview,
  onToggleGrid,
  onToggleTarget,
  onInspect,
}: SoloMapProps) {
  const [boxRef, size] = useBoxSize()
  const [hoverId, setHoverId] = useState<number | null>(null)

  const targetPayload = decision?.payload.kind === 'Targets' ? decision.payload : null
  const targetList = targetPayload?.targets ?? null
  const targetByGrid = useMemo(() => {
    const m = new Map<number, string>()
    if (targetList) for (const t of targetList) if (t.gridId >= 0) m.set(t.gridId, t.guid)
    return m
  }, [targetList])
  const targetGuids = useMemo(() => new Set(targetList?.map((t) => t.guid) ?? []), [targetList])

  const currentGridId = decision?.payload.kind === 'TargetGrid' ? decision.payload.currentGridId : null
  const pickedGridSet = useMemo(() => new Set(pickedGrids), [pickedGrids])
  const pickedTargetSet = useMemo(() => new Set(pickedTargets), [pickedTargets])

  const byId = useMemo(() => new Map(map.grids.map((g) => [g.id, g])), [map.grids])

  // ==================== 黄 / 绿高亮集合 ====================
  const { yellowIds, greenIds, yellowCenter, shapeIds } = useMemo(() => {
    const none = new Set<number>()
    let yellow = none
    let green = none
    let shape = none
    let center: SoloGridDto | undefined

    const p = decision?.payload
    if (p?.kind === 'TargetGrid') {
      // 移动阶段：绿色 = 可达格子；黄色 = 以「已选/当前格」为圆心的攻击范围
      green = new Set(p.gridIds)
      const range = p.attackRange ?? p.atr ?? -1
      const c = byId.get(pickedGrids[0] ?? p.currentGridId)
      if (c && range >= 0) {
        yellow = gridsInRange(map.grids, c, range, false)
        center = c
      }
    } else if (p?.kind === 'TargetGrids') {
      // 非指向性技能：黄色 = 技能选取范围（施法距离）；玩家只点一个中心格，
      // 选中后按技能形状（shapeRangeType + shapeRadius）预览受影响区域（紫色）。
      yellow = new Set(p.gridIds)
      const centerId = pickedGrids[0]
      if (centerId !== undefined && p.shapeRangeType) {
        const c = byId.get(centerId)
        const actor = p.actorGridId !== undefined ? byId.get(p.actorGridId) : undefined
        if (c) {
          const params: ShapeParams = {
            type: p.shapeRangeType as ShapeParams['type'],
            radius: p.shapeRadius ?? 0,
            sectorAngle: p.sectorAngle,
            includeCharacterGrid: p.includeCharacterGrid,
          }
          shape = shapeGridIds(
            map.grids.map((g) => ({ id: g.id, x: g.x, y: g.y, z: g.z, occupied: g.characters.length > 0 })),
            { id: c.id, x: c.x, y: c.y, z: c.z, occupied: c.characters.length > 0 },
            actor ? { id: actor.id, x: actor.x, y: actor.y, z: actor.z, occupied: actor.characters.length > 0 } : undefined,
            params,
          )
          center = c
        }
      }
    } else if (p?.kind === 'Targets') {
      // 选目标阶段：黄色 = 以施法者为圆心的攻击 / 施法距离
      const range = p.range ?? -1
      const actor = p.actorGridId !== undefined ? byId.get(p.actorGridId) : undefined
      if (actor && range >= 0) {
        yellow = gridsInRange(map.grids, actor, range, false)
        center = actor
      }
    } else if (preview && preview.actorGridId >= 0) {
      // 操作菜单勾选时的预演
      const actor = byId.get(preview.actorGridId)
      if (actor) {
        if (preview.attackRange != null && preview.attackRange >= 0) {
          yellow = gridsInRange(map.grids, actor, preview.attackRange, false)
          center = actor
        }
        if (preview.moveRange != null && preview.moveRange >= 0) {
          green = gridsInRange(map.grids, actor, preview.moveRange, true)
        }
      }
    }
    return { yellowIds: yellow, greenIds: green, yellowCenter: center, shapeIds: shape }
  }, [decision, preview, byId, map.grids, pickedGrids])

  const cols = map.length
  const rows = map.width

  // 棋盘自适应：先按可用空间算出格子边长，再居中铺开
  const cell = useMemo(() => {
    if (size.w <= 0 || size.h <= 0) return 22
    const byW = (size.w - GAP * (cols - 1)) / cols
    const byH = (size.h - GAP * (rows - 1)) / rows
    return Math.max(12, Math.min(MAX_CELL, Math.floor(Math.min(byW, byH))))
  }, [size.w, size.h, cols, rows])

  const tokenPx = Math.min(34, Math.max(11, Math.round(cell * 0.62)))
  const barW = Math.min(46, Math.max(10, Math.round(cell * 0.78)))
  const barH = cell >= 34 ? 4 : 3
  const showMp = cell >= 34

  /** 同格多角色时只画第一个，其余用角标提示数量 */
  const occupantsOf = (gridId: number, ids: string[]): SoloCharacterDto[] => {
    const list = ids.map((g) => charByGuid.get(g)).filter((c): c is SoloCharacterDto => !!c)
    if (list.length > 0) return list
    // 兜底：快照未带 grid.characters 时按角色自身的 gridId 归位
    return [...charByGuid.values()].filter((c) => c.gridId === gridId && !c.isEliminated)
  }

  const cells = useMemo(() => [...map.grids].sort((a, b) => a.y - b.y || a.x - b.x), [map.grids])

  const handleCellClick = (gridId: number, ids: string[]) => {
    const p = decision?.payload
    if (p?.kind === 'Targets') {
      const occ = occupantsOf(gridId, ids)
      const guid = targetByGrid.get(gridId) ?? occ.map((c) => c.guid).find((g) => targetGuids.has(g))
      if (guid) onToggleTarget(guid)
      return
    }
    if (p?.kind === 'TargetGrid' || p?.kind === 'TargetGrids') {
      if (greenIds.has(gridId) || (p?.kind === 'TargetGrids' && yellowIds.has(gridId))) onToggleGrid(gridId)
      return
    }
    const first = occupantsOf(gridId, ids)[0]
    if (first) onInspect(first.guid)
  }

  /** 队伍配色：己方（蓝队 / 玩家所在队）恒为蓝色，对方为红色 */
  const playerTeam = playerGuid ? charByGuid.get(playerGuid)?.teamName ?? null : null
  const teamMode = playerTeam !== null
  const myColor = '#2563eb'
  const myRing = '#1d4ed8'
  const foeColor = '#dc2626'
  const foeRing = '#7f1d1d'

  return (
    <div ref={boxRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, ${cell}px)`,
          gridTemplateRows: `repeat(${rows}, ${cell}px)`,
          gap: `${GAP}px`,
        }}
      >
        {cells.map((g) => {
          const occ = occupantsOf(g.id, g.characters)
          const token = occ[0]
          const extra = occ.length - 1
          const inYellow = yellowIds.has(g.id)
          const inGreen = greenIds.has(g.id)
          const inShape = shapeIds.has(g.id)
          const gridOn = pickedGridSet.has(g.id)
          const isCurrent = currentGridId === g.id || yellowCenter?.id === g.id
          const targetGuid = targetByGrid.get(g.id)
          const targetOn = targetGuid !== undefined && pickedTargetSet.has(targetGuid)
          const isPlayerCell = token?.guid === playerGuid
          const isActor = token?.guid === currentActorGuid
          const dead = !!token && (token.isEliminated || token.hp <= 0)
          const isMyTeamToken = !!token && (teamMode ? token.teamName === playerTeam : isPlayerCell)

          // 选中态优先级：已勾选（中心格） > 已选目标 > 可选目标 > 形状覆盖区（紫）> 绿色（移动距离）> 黄色（攻击/施法距离）> 当前格
          // ⚠️ 「可选目标」必须排在黄色之前：否则站在射程内的目标会被整片黄色淹没，
          //    玩家根本看不出哪一格上有人可以点（射程格与目标格长得一样）。
          // ⚠️ 「绿色（移动）」必须排在黄色之前：ATR >= MOV 的角色（如 攻击3/移动3）两个范围
          //    完全重合，黄色会整片吃掉绿色 → 移动阶段一格绿色都看不到，但点上去其实是可以走的。
          //    绿色是「可操作」的格子，优先级必须高于只是提示性的黄色；黄但非绿的格子仍显示黄色。
          const isSelectableTarget = targetGuid !== undefined
          let cellBg = 'rgba(255, 252, 240, 0.78)'
          let cellBorder = '1px solid rgba(133, 95, 18, 0.26)'
          let cursor = 'default'
          if (gridOn) {
            cellBg = 'rgba(16, 185, 129, 0.55)'
            cellBorder = '2px solid rgba(4, 120, 87, 0.95)'
            cursor = 'pointer'
          } else if (targetOn) {
            cellBg = 'rgba(220, 38, 38, 0.55)'
            cellBorder = '2px solid rgba(153, 27, 27, 0.95)'
            cursor = 'pointer'
          } else if (isSelectableTarget) {
            cellBg = 'rgba(220, 38, 38, 0.24)'
            cellBorder = '1.5px dashed rgba(220, 38, 38, 0.85)'
            cursor = 'pointer'
          } else if (inShape) {
            // 非指向性技能的形状覆盖区（预览，服务端按同一形状权威展开）
            cellBg = 'rgba(147, 51, 234, 0.30)'
            cellBorder = '1.5px dashed rgba(126, 34, 206, 0.85)'
            cursor = 'pointer'
          } else if (inGreen) {
            cellBg = GREEN_BG
            cellBorder = GREEN_BORDER
            cursor = 'pointer'
          } else if (inYellow) {
            cellBg = YELLOW_BG
            cellBorder = YELLOW_BORDER
            cursor = 'pointer'
          } else if (isCurrent) {
            cellBg = 'rgba(212, 168, 56, 0.22)'
            cellBorder = '1px dashed rgba(138, 95, 18, 0.7)'
          } else if (token) {
            cursor = 'pointer'
          }

          const hpPct = token && token.maxHP > 0 ? Math.min(100, Math.max(0, (token.hp / token.maxHP) * 100)) : 0
          const mpPct = token && token.maxMP > 0 ? Math.min(100, Math.max(0, (token.mp / token.maxMP) * 100)) : 0

          return (
            <button
              key={g.id}
              onClick={() => handleCellClick(g.id, g.characters)}
              onMouseEnter={() => setHoverId(g.id)}
              onMouseLeave={() => setHoverId(null)}
              title={`格子 #${g.id} (${g.x},${g.y},${g.z})${token ? ` · ${token.displayName}` : ''}`}
              className="relative flex items-center justify-center rounded-[4px] transition-colors"
              style={{ backgroundColor: cellBg, border: cellBorder, cursor }}
            >
              {token ? (
                <span className="pointer-events-none flex flex-col items-center justify-center" style={{ gap: 2 }}>
                  {/* 血条：直接画在棋子正上方 */}
                  <span className="overflow-hidden rounded-full" style={{ width: barW, height: barH, backgroundColor: 'rgba(42,31,20,0.3)' }}>
                    <span className="block h-full rounded-full" style={{ width: `${hpPct}%`, backgroundColor: dead ? '#9ca3af' : '#dc2626' }} />
                  </span>
                  {/* 棋子本体：己方蓝、敌方红 */}
                  <span
                    className={`flex items-center justify-center rounded-full font-bold ${isActor && !dead ? 'solo-actor-ring' : ''}`}
                    style={{
                      width: tokenPx,
                      height: tokenPx,
                      fontSize: Math.max(9, Math.round(tokenPx * 0.52)),
                      backgroundColor: dead ? '#6b7280' : isMyTeamToken ? myColor : foeColor,
                      color: '#fff',
                      opacity: dead ? 0.55 : 1,
                      boxShadow: dead
                        ? 'none'
                        : `0 0 0 ${isPlayerCell ? 2 : 1.5}px ${isPlayerCell ? '#8a5f12' : isMyTeamToken ? myRing : foeRing}, 0 1px 3px rgba(0,0,0,0.3)`,
                    }}
                  >
                    {shortName(token)}
                  </span>
                  {/* 格子够大时补一条 MP */}
                  {showMp && token.maxMP > 0 ? (
                    <span className="overflow-hidden rounded-full" style={{ width: barW, height: 2, backgroundColor: 'rgba(37,99,235,0.2)' }}>
                      <span className="block h-full rounded-full" style={{ width: `${mpPct}%`, backgroundColor: '#2563eb' }} />
                    </span>
                  ) : null}
                </span>
              ) : null}

              {/* 同格多角色 */}
              {extra > 0 ? (
                <span className="pointer-events-none absolute right-0 top-0 rounded-bl-md rounded-tr-[4px] bg-ink-800/80 px-[3px] text-[8.5px] leading-[11px] text-parchment-100">
                  +{extra}
                </span>
              ) : null}

              {/* 桌面端悬停提示空格编号 */}
              {hoverId === g.id && !token ? (
                <span className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-ink-800/90 px-1.5 py-0.5 text-[10px] text-parchment-100">
                  #{g.id}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {/* 图例 / 尺寸信息 */}
      <div className="pointer-events-none absolute bottom-0.5 left-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9.5px] text-ink-400">
        <span className="flex items-center gap-0.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: myColor }} />
          己方
        </span>
        <span className="flex items-center gap-0.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: foeColor }} />
          敌方
        </span>
        <span className="flex items-center gap-0.5">
          <span className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: '#facc15' }} />
          攻击/施法距离
        </span>
        <span className="flex items-center gap-0.5">
          <span className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: '#10b981' }} />
          移动距离
        </span>
        <span className="flex items-center gap-0.5">
          <span
            className="inline-block h-2 w-2 rounded-[2px]"
            style={{ backgroundColor: 'rgba(220, 38, 38, 0.24)', border: '1px dashed rgba(220, 38, 38, 0.85)' }}
          />
          可选目标
        </span>
        <span className="flex items-center gap-0.5">
          <span
            className="inline-block h-2 w-2 rounded-[2px]"
            style={{ backgroundColor: 'rgba(147, 51, 234, 0.30)', border: '1px dashed rgba(126, 34, 206, 0.85)' }}
          />
          技能形状区域
        </span>
        <span className="flex items-center gap-0.5">
          <span className="inline-block h-2 w-2 rounded-full bg-ink-400" />
          阵亡
        </span>
      </div>
      <div className="pointer-events-none absolute bottom-0.5 right-1.5 font-mono text-[9.5px] text-ink-400">
        {map.name} · {cols}×{rows}
      </div>
    </div>
  )
}
