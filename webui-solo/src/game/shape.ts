// ============================================================================
// 非指向性技能的选取形状几何
//
// 与 FunGame.Core 的 GameMap / Skill.SelectNonDirectionalTargets 保持同一口径：
// 玩家只点一个【中心格】，受影响区域由形状（SkillRangeType）+ 半径（CanSelectTargetRange）
// 决定，服务端按同一套算法权威展开；这里的计算只用于客户端的形状预览高亮。
//   Diamond   菱形    曼哈顿距离 ≤ r          （GetGridsByRange）
//   Circle    圆形    欧氏距离² ≤ r²          （GetGridsByCircleRange）
//   Square    正方形  切比雪夫距离 ≤ r        （GetGridsBySquareRange）
//   Line      线段    施法者→中心的直线，粗细 r/2（GetGridsOnThickLine）
//   LinePass  贯穿直线 线段延伸至地图边缘
//   Sector    扇形    以施法者为顶点、朝向中心、张角 sectorAngle（GetGridsInSector）
// ============================================================================

export type ShapeRangeType = 'Diamond' | 'Circle' | 'Square' | 'Line' | 'LinePass' | 'Sector'

export interface ShapeGrid {
  id: number
  x: number
  y: number
  z: number
  /** 格子上是否有角色（includeCharacterGrid=false 时形状会排除有角色的格子） */
  occupied: boolean
}

export interface ShapeParams {
  type: ShapeRangeType
  radius: number
  /** 扇形角度（仅 Sector） */
  sectorAngle?: number
  /** 形状区域是否包含有角色的格子（默认 true） */
  includeCharacterGrid?: boolean
}

/** 两个格子是否同层（引擎要求 z 相同才参与形状） */
function sameZ(a: ShapeGrid, b: ShapeGrid): boolean {
  return a.z === b.z
}

/** 近似 GameMap.GetLinePoints：整数化直线采样（Bresenham） */
function linePoints(x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  let dx = Math.abs(x1 - x0)
  let dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  let x = x0
  let y = y0
  for (let guard = 0; guard < 4096; guard++) {
    pts.push({ x, y })
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
  }
  return pts
}

/**
 * 计算以 center 为中心选取时的形状覆盖格子 id 集合。
 * caster 为施法者所在格（Line/LinePass/Sector 需要它做锚点）。
 */
export function shapeGridIds(grids: ShapeGrid[], center: ShapeGrid, caster: ShapeGrid | undefined, p: ShapeParams): Set<number> {
  const out = new Set<number>()
  const includeChar = p.includeCharacterGrid ?? true
  const r = Math.max(0, Math.floor(p.radius))
  const push = (g: ShapeGrid) => {
    if (includeChar || !g.occupied) out.add(g.id)
  }

  const centerInShape = (g: ShapeGrid): boolean => {
    if (!sameZ(g, center)) return false
    const dx = g.x - center.x
    const dy = g.y - center.y
    switch (p.type) {
      case 'Circle':
        return dx * dx + dy * dy <= r * r
      case 'Square':
        return Math.max(Math.abs(dx), Math.abs(dy)) <= r
      default:
        return Math.abs(dx) + Math.abs(dy) <= r // Diamond（以及 Line 加粗复用前的兜底）
    }
  }

  if (p.type === 'Line' || p.type === 'LinePass') {
    if (!caster) {
      out.add(center.id)
      return out
    }
    // 直线：施法者 → 中心（贯穿模式继续延伸到地图边缘），线上每格再按 r/2 正方形加粗
    const pts = linePoints(caster.x, caster.y, center.x, center.y)
    if (p.type === 'LinePass' && pts.length >= 2) {
      let dirX = pts[pts.length - 1].x - pts[pts.length - 2].x
      let dirY = pts[pts.length - 1].y - pts[pts.length - 2].y
      const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
      const g = gcd(Math.abs(dirX), Math.abs(dirY)) || 1
      dirX /= g
      dirY /= g
      const maxSteps = 128
      let x = center.x + dirX
      let y = center.y + dirY
      for (let i = 0; i < maxSteps; i++) {
        const next = grids.find((gg) => gg.x === x && gg.y === y && sameZ(gg, center))
        if (!next) break
        pts.push({ x, y })
        x += dirX
        y += dirY
      }
    }
    const half = Math.floor(r / 2)
    for (const g of grids) {
      if (!sameZ(g, center)) continue
      for (const pt of pts) {
        if (Math.max(Math.abs(g.x - pt.x), Math.abs(g.y - pt.y)) <= half) {
          push(g)
          break
        }
      }
    }
    return out
  }

  if (p.type === 'Sector') {
    if (!caster) {
      out.add(center.id)
      return out
    }
    const dirX = center.x - caster.x
    const dirY = center.y - caster.y
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY)
    if (dirLen < 0.01) {
      // 与引擎一致：重合时退化为圆形（半径 r-1）
      const rr = Math.max(0, r - 1)
      for (const g of grids) {
        if (!sameZ(g, caster)) continue
        const dx = g.x - caster.x
        const dy = g.y - caster.y
        if (dx * dx + dy * dy <= rr * rr) push(g)
      }
      return out
    }
    const unitX = dirX / dirLen
    const unitY = dirY / dirLen
    const halfAngle = ((p.sectorAngle ?? 90) / 2) * (Math.PI / 180)
    for (const g of grids) {
      if (!sameZ(g, caster)) continue
      const vx = g.x - caster.x
      const vy = g.y - caster.y
      const len = Math.sqrt(vx * vx + vy * vy)
      if (len > r + 0.01) continue
      if (len < 0.01) {
        push(g) // 施法者自身始终包含
        continue
      }
      const dot = Math.max(-1, Math.min(1, (unitX * vx + unitY * vy) / len))
      if (Math.acos(dot) <= halfAngle) push(g)
    }
    return out
  }

  // Diamond / Circle / Square：以中心格展开
  for (const g of grids) {
    if (centerInShape(g)) push(g)
  }
  return out
}

/** 形状中文名（界面提示用） */
export function shapeLabel(type: string | undefined): string {
  switch (type) {
    case 'Diamond':
      return '菱形'
    case 'Circle':
      return '圆形'
    case 'Square':
      return '正方形'
    case 'Line':
      return '线段'
    case 'LinePass':
      return '贯穿直线'
    case 'Sector':
      return '扇形'
    default:
      return type ?? '菱形'
  }
}
