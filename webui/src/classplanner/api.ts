// 职业规划真实端点客户端（对齐 Enhancement/WebAPI 的 /api/classplan/*）
// 小字注：端点由 Services/ClassPlanEndpoints.cs 提供，内容来自 OshimaGameModules.OshimaClasses.RegisterAll()
import type { AttributeAllocation } from './types'

const BASE = '/api/classplan'

export interface ServerSkillDto {
  id: number
  name: string
  skillType: string
  level: number
  description?: string
  requiredSubClass?: string
  requiredAttribute?: string
  requiredAttributeValue?: number
}

export interface ServerSubClassDto {
  id: string
  name: string
  roleTypes: string[]
  inherentPassiveGates: number[]
  /** 固有被动明细：门槛等级 -> 被动名（新版服务端提供） */
  inherentPassives?: Array<{ gate: number; names: string[] }>
}

export interface ServerClassDto {
  id: string
  name: string
  /** 结构化属性上下限（camelCase）；未配置时为 null */
  attributeLimit: unknown
  /** 限值的人类可读描述，仅用于展示 */
  attributeLimitText?: string
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

/**
 * 服务端动作路由：前端动作 → /sessions/{id}/{path}
 * <para/>IdName 由 catalog.classIdName() / subClassIdName() / talentIdName() 提供
 */
export type ServerRoute =
  | { kind: 'select-class'; classId: string; subClassId: string }
  | { kind: 'set-class-level'; classId: string; level: number }
  | { kind: 'commit-class'; classId: string }
  | { kind: 'learn-skill'; classId: string; skillId: number }
  | { kind: 'allocate'; classId: string; allocation: AttributeAllocation; initial: boolean }
  | { kind: 'learn-talent'; roleType: string; talentId: string }
  | { kind: 'forget-talent'; talentId: string }
  | { kind: 'activate-talent'; talentId: string }
  | { kind: 'refresh-roles' }
  | { kind: 'set-character-level'; level: number }
  | { kind: 'apply' }
  | { kind: 'reset' }

const ROUTE_PATH: Record<ServerRoute['kind'], string> = {
  'select-class': 'select-class',
  'set-class-level': 'set-class-level',
  'commit-class': 'commit-class',
  'learn-skill': 'learn-skill',
  allocate: 'allocate',
  'learn-talent': 'learn-talent',
  'forget-talent': 'forget-talent',
  'activate-talent': 'activate-talent',
  'refresh-roles': 'refresh-roles',
  'set-character-level': 'set-character-level',
  apply: 'apply',
  reset: 'reset',
}

export interface ServerActionResult {
  ok: boolean
  message: string
  /** 服务端执行后的计划快照（内核 ClassPlanSnapshot 形状）；失败时为 null */
  plan: unknown | null
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

/** 在服务端升级职业（升级即确认等级，对齐 ClassPlanner.UpgradeClass） */
export async function upgradeClassOnServer(sessionId: string, classId: string): Promise<{ ok: boolean; message: string } | null> {
  return postAction(`${BASE}/sessions/${sessionId}/upgrade-class`, { classId }, '服务端升级职业失败')
}

/** 在服务端草稿态调级（可升可降、不消耗职业点数，对齐 ClassPlanner.SetClassLevel） */
export async function setClassLevelOnServer(sessionId: string, classId: string, level: number): Promise<{ ok: boolean; message: string } | null> {
  return postAction(`${BASE}/sessions/${sessionId}/set-class-level`, { classId, level }, '服务端草稿调级失败')
}

/** 在服务端确认职业等级（此后不可下调，对齐 ClassPlanner.CommitClassLevel） */
export async function commitClassOnServer(sessionId: string, classId: string): Promise<{ ok: boolean; message: string } | null> {
  return postAction(`${BASE}/sessions/${sessionId}/commit-class`, { classId }, '服务端确认职业等级失败')
}

/** 在服务端物化职业计划（物化即确认，对齐 ClassPlanner.ApplyToCharacter） */
export async function applyOnServer(sessionId: string): Promise<{ ok: boolean; valid: boolean; message: string; error?: string | null } | null> {
  return fetch(`${BASE}/sessions/${sessionId}/apply`, { method: 'POST' })
    .then(async r => {
      const body = (await r.json()) as { ok?: boolean; valid?: boolean; message?: string; error?: string | null }
      return { ok: body.ok ?? r.ok, valid: body.valid ?? false, message: body.message ?? `HTTP ${r.status}`, error: body.error ?? null }
    })
    .catch(err => {
      console.error('服务端物化职业计划失败：', err)
      return null
    })
}

/** 在服务端洗点（对齐 ClassPlanner.ResetPlan） */
export async function resetOnServer(sessionId: string): Promise<{ ok: boolean; message: string } | null> {
  return postAction(`${BASE}/sessions/${sessionId}/reset`, undefined, '服务端洗点失败')
}

/** 在服务端习得职业技能 / 被动（消耗选择权，对齐 ClassPlanner.LearnClassSkill） */
export async function learnSkillOnServer(sessionId: string, classId: string, skillId: number): Promise<{ ok: boolean; message: string } | null> {
  return postAction(`${BASE}/sessions/${sessionId}/learn-skill`, { classId, skillId }, '服务端习得技能失败')
}

/** 统一 POST + 取 message 的小工具 */
async function postAction(url: string, body: unknown, errLabel: string): Promise<{ ok: boolean; message: string } | null> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
    .then(async r => {
      const res = (await r.json()) as { message?: string }
      return { ok: r.ok, message: res.message ?? `HTTP ${r.status}` }
    })
    .catch(err => {
      console.error(`${errLabel}：`, err)
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

/**
 * 在服务端执行一个规划动作（服务端权威）
 * <para/>成功时返回 { ok, message, plan }，plan 为内核 ClassPlanSnapshot；失败（HTTP 4xx）时 ok=false 且带 message
 */
export async function performAction(sessionId: string, route: ServerRoute): Promise<ServerActionResult | null> {
  const body = ((): unknown => {
    switch (route.kind) {
      case 'select-class':
        return { classId: route.classId, subClassId: route.subClassId }
      case 'set-class-level':
        return { classId: route.classId, level: route.level }
      case 'commit-class':
        return { classId: route.classId }
      case 'learn-skill':
        return { classId: route.classId, skillId: route.skillId }
      case 'allocate':
        return { classId: route.classId, initial: route.initial, ...route.allocation }
      case 'learn-talent':
        return { roleType: route.roleType, talentId: route.talentId }
      case 'forget-talent':
      case 'activate-talent':
        return { talentId: route.talentId }
      case 'set-character-level':
        return { level: route.level }
      default:
        return undefined
    }
  })()

  return fetch(`${BASE}/sessions/${sessionId}/${ROUTE_PATH[route.kind]}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
    .then(async r => {
      const res = (await r.json()) as { ok?: boolean; message?: string; error?: string; plan?: unknown }
      return {
        ok: res.ok ?? r.ok,
        message: res.message ?? res.error ?? `HTTP ${r.status}`,
        plan: res.plan ?? null,
      }
    })
    .catch(err => {
      console.error(`服务端动作失败（${route.kind}）：`, err)
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
