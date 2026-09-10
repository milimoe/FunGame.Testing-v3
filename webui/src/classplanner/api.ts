// 职业规划真实端点客户端（对齐 Enhancement/WebAPI 的 /api/classplan/*）
// 小字注：端点由 Services/ClassPlanEndpoints.cs 提供，内容来自 OshimaGameModules.OshimaClasses.RegisterAll()
import type { AttributeAllocation } from './types'

const BASE = '/api/classplan'

export interface ServerSkillDto {
  id: number
  name: string
  skillType: string
  level: number
  requiredSubClass?: string
  requiredAttribute?: string
  requiredAttributeValue?: number
}

export interface ServerSubClassDto {
  id: string
  name: string
  roleTypes: string[]
  inherentPassiveGates: number[]
}

export interface ServerClassDto {
  id: string
  name: string
  attributeLimit: string
  skills: ServerSkillDto[]
  passives: ServerSkillDto[]
  magics: ServerSkillDto[]
  superSkills: ServerSkillDto[]
  talents: Record<string, ServerSkillDto[]>
  subClasses: ServerSubClassDto[]
}

export interface ServerDefinitionsDto {
  classes: ServerClassDto[]
  rules: {
    initialBudget: string
    numericBoostBudget: string
    selectionEnabled: boolean
  }
}

export interface SessionRequest {
  characterId?: number
  characterName?: string
  restore?: boolean
  skillSelection?: boolean
}

/** 拉取服务端已注册的职业 / 流派 / 规则（内核真实内容） */
export async function fetchDefinitions(): Promise<ServerDefinitionsDto | null> {
  return fetch(`${BASE}/definitions`)
    .then(r => (r.ok ? (r.json() as Promise<ServerDefinitionsDto>) : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch(err => {
      console.error('加载职业定义失败：', err)
      return null
    })
}

/** 创建规划会话（可选从存档恢复） */
export async function createSession(request: SessionRequest = {}): Promise<{ sessionId: string; warnings: string[] } | null> {
  return fetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      characterId: request.characterId ?? null,
      characterName: request.characterName ?? null,
      restore: request.restore ?? false,
      skillSelection: request.skillSelection ?? true,
    }),
  })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch(err => {
      console.error('创建职业规划会话失败：', err)
      return null
    })
}

/** 在服务端选择职业与流派（IdName） */
export async function selectClassOnServer(sessionId: string, classId: string, subClassId: string): Promise<{ ok: boolean; message: string } | null> {
  return fetch(`${BASE}/sessions/${sessionId}/select-class`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ classId, subClassId }),
  })
    .then(async r => {
      const body = (await r.json()) as { message?: string }
      return { ok: r.ok, message: body.message ?? `HTTP ${r.status}` }
    })
    .catch(err => {
      console.error('服务端选择职业失败：', err)
      return null
    })
}

/** 在服务端升级职业 */
export async function upgradeClassOnServer(sessionId: string, classId: string): Promise<{ ok: boolean; message: string } | null> {
  return fetch(`${BASE}/sessions/${sessionId}/upgrade-class`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ classId }),
  })
    .then(async r => {
      const body = (await r.json()) as { message?: string }
      return { ok: r.ok, message: body.message ?? `HTTP ${r.status}` }
    })
    .catch(err => {
      console.error('服务端升级职业失败：', err)
      return null
    })
}

/** 在服务端分配核心属性（1 级初始分配 / 4 与 9 级数值提升） */
export async function allocateOnServer(
  sessionId: string,
  classId: string,
  allocation: AttributeAllocation,
  initial: boolean,
): Promise<{ ok: boolean; message: string } | null> {
  return fetch(`${BASE}/sessions/${sessionId}/allocate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ classId, initial, ...allocation }),
  })
    .then(async r => {
      const body = (await r.json()) as { message?: string }
      return { ok: r.ok, message: body.message ?? `HTTP ${r.status}` }
    })
    .catch(err => {
      console.error('服务端属性分配失败：', err)
      return null
    })
}

/** 保存职业计划到服务端存档 */
export async function savePlan(sessionId: string): Promise<{ ok: boolean; path?: string } | null> {
  return fetch(`${BASE}/sessions/${sessionId}/save`, { method: 'POST' })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch(err => {
      console.error('保存职业计划失败：', err)
      return null
    })
}
