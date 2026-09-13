// ============================================================================
// 单人模式 · 数值展示小工具
// 引擎里的 MP / EP / CD 常带浮点噪声（618.5600000000001），直接渲染很难看，
// 统一走这里做一次收敛。
// ============================================================================

/** 数值美化：去掉浮点噪声（618.5600000000001 → 618.6），整数不补小数位 */
export function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const f = 10 ** digits
  const r = Math.round(n * f) / f
  return Number.isInteger(r) ? String(r) : r.toFixed(digits)
}
