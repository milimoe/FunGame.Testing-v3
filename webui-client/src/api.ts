// REST 客户端：统一包装、耗时测量、ApiResponse 解包
export interface RestResult<T = unknown> {
  ok: boolean
  status: number
  elapsedMs: number
  body: T | null
  raw: string
  error?: string
}

export interface RestOptions {
  method?: string
  body?: unknown
  token?: string | null
  raw?: boolean
}

export async function restRequest<T = unknown>(
  baseUrl: string,
  path: string,
  options: RestOptions = {},
): Promise<RestResult<T>> {
  const { method = 'GET', body, token, raw = false } = options
  const url = path.startsWith('http') ? path : `${baseUrl}${path}`
  const started = performance.now()

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    return {
      ok: false,
      status: 0,
      elapsedMs: performance.now() - started,
      body: null,
      raw: '',
      error: e instanceof Error ? e.message : String(e),
    }
  }

  const text = await response.text()
  const elapsedMs = performance.now() - started

  let parsed: T | null = null
  let parseError: string | undefined
  if (text) {
    try {
      parsed = JSON.parse(text) as T
    } catch {
      parseError = '响应不是合法 JSON'
      parsed = null
    }
  }

  if (raw) {
    return { ok: response.ok, status: response.status, elapsedMs, body: parsed, raw: text, error: parseError }
  }

  // ApiResponse 包装解包：ok=false 时给出 message
  const wrapped = parsed as { ok?: boolean; message?: string } | null
  const ok = response.ok && wrapped?.ok !== false
  const message = wrapped?.message
  return {
    ok,
    status: response.status,
    elapsedMs,
    body: parsed,
    raw: text,
    error: ok ? undefined : message || `HTTP ${response.status} ${response.statusText}`,
  }
}

// 便捷方法
export const api = {
  get: <T = unknown>(baseUrl: string, path: string, token?: string | null) =>
    restRequest<T>(baseUrl, path, { method: 'GET', token }),
  post: <T = unknown>(baseUrl: string, path: string, body: unknown, token?: string | null) =>
    restRequest<T>(baseUrl, path, { method: 'POST', body, token }),
  put: <T = unknown>(baseUrl: string, path: string, body: unknown, token?: string | null) =>
    restRequest<T>(baseUrl, path, { method: 'PUT', body, token }),
  del: <T = unknown>(baseUrl: string, path: string, token?: string | null) =>
    restRequest<T>(baseUrl, path, { method: 'DELETE', token }),
  request: restRequest,
}

// 模组目录（公开接口，无需登录）
export const fetchGameModules = (baseUrl: string) =>
  restRequest<{ data: { modes: { name: string; version: string; author: string; description: string; kind: string | null }[]; modules: { name: string; version: string; author: string; description: string; kind: string | null }[] } }>(baseUrl, '/api/game-modules')
