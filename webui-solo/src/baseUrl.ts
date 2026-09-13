// ============================================================================
// 默认后端地址解析
//
// 部署形态：WebAPI 监听 127.0.0.1:<port>，nginx 反代 fun.milimoe.com →
// 前端与后端**同源**。因此非本机环境下默认直接用 window.location.origin，
// 既跟随域名（含 https/wss），也避免写死任何主机名。
//
// 本机开发时页面在 localhost（vite dev 5174 / 本地静态托管），
// 后端另起在 11030 或 5000，于是回落到调用方给的本地地址。
// ============================================================================

/** 判断是否为「本机开发」场景 */
function isLocalHost(hostname: string): boolean {
  return (
    hostname === '' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname === '::1'
  )
}

/**
 * 解析默认后端地址。
 * @param localFallback 本机环境下使用的地址（默认单人模式 WebAPI 的 11030）
 */
export function resolveDefaultBaseUrl(localFallback = 'http://localhost:11030'): string {
  if (typeof window === 'undefined') return localFallback
  const { protocol, hostname, origin } = window.location
  if (isLocalHost(hostname)) return localFallback
  // 非 http(s) 场景（如 file:// 直接打开构建产物）无法同源，退回本地地址
  if (protocol !== 'http:' && protocol !== 'https:') return localFallback
  return origin
}
