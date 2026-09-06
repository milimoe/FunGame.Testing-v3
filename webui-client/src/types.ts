// ===== 通用 =====
export type TestStatus = 'success' | 'fail' | 'running' | 'idle'

// ===== REST：ApiResponse 包装（Server 统一 camelCase 输出）=====
export interface ApiResponse<T> {
  ok: boolean
  code: number
  message: string | null
  data: T
  timestamp: string
}

// ===== WebSocket：MessageEnvelope 信封 =====
export interface MessageError {
  code: string
  message: string
}

export interface MessageEnvelope {
  t: string
  i: number
  ok: boolean
  error?: MessageError | null
  d: Record<string, unknown>
  ts: number
}

// ===== 测试记录（客户端本地）=====
export type TestKind = 'rest' | 'ws'

export interface TestRecord {
  id: string
  kind: TestKind
  name: string
  method?: string
  path?: string
  wsType?: string
  requestBody?: unknown
  responseBody?: unknown
  error?: string
  elapsedMs: number
  status: TestStatus
  timestamp: number
  description?: string
}

// ===== 认证 =====
export interface AuthTokenResponse {
  accessToken: string
  refreshToken: string
  userId: number
  username: string
  permissions: string[]
  roles: string[]
}

export interface AuthProfile {
  userId: number
  username: string
  roles: string[]
  permissions: string[]
}

// ===== 战斗（对局面板）=====
export interface BattleCharacter {
  guid: string
  name: string
  nickName: string
  level: number
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  ep: number
  alive: boolean
  team: 'alliance' | 'horde' | 'neutral'
  statuses: string[]
}

export interface GameOverInfo {
  gameId: string
  mode: string
  totalRound: number
  totalTime: number
  gameResult: unknown
}

export interface GameEvent {
  id: string
  type: string
  time: number
  data: unknown
}

// ===== 回放：RoundRecord（PascalCase，与 Core 转换器输出一致）=====
export interface CharacterRef {
  Guid: string
  Name: string
  FirstName: string
  NickName: string
  UserName: string
}

export interface TeamRef {
  Id: string
  Name: string
  Score: number
  IsWinner: boolean
  Members: CharacterRef[]
}

export interface RankingEntry {
  Rank: number
  IsWinner: boolean
  IsTeam: boolean
  Character: CharacterRef | null
  Team: TeamRef | null
  Kills: number
  Deaths: number
  Assists: number
  FirstKills: number
  TotalEarnedMoney: number
  MaxContinuousKilling: number
  Score: number
}

export interface CharacterStateSnapshot {
  Character: CharacterRef
  HP: number
  MaxHP: number
  MP: number
  MaxMP: number
  EP: number
  HR: number
  MR: number
  Attributes: Record<string, string>
  Equipments: Record<string, number>
  EquipmentsDetail: unknown[]
  Skills: unknown[]
  Items: unknown[]
  Effects: unknown[]
}

export interface ActionRecord {
  Round: number
  AllCharacters?: CharacterRef[]
  Actor: CharacterRef | null
  ActionIndex: number
  ActionType: number
  Skill?: unknown
  Item?: unknown
  MPCost: number
  EPCost: number
  SkillCD: number
  DecisionPointsCost: number
  Targets: CharacterRef[]
  Damages: Record<string, number>
  IsCritical: Record<string, boolean>
  IsEvaded: Record<string, boolean>
  IsImmune: Record<string, boolean>
  Heals: Record<string, number>
  ApplyEffects: Record<string, number[]>
  Messages: string[]
  IsSuccess: boolean
  FailReason?: string
  CastTime: number
  HardnessTime: number
}

export interface RoundRecord {
  Round: number
  AllCharacters: CharacterRef[]
  Actor: CharacterRef | null
  Targets: Record<string, CharacterRef[]>
  Damages: Record<string, number>
  IsCritical: Record<string, boolean>
  IsEvaded: Record<string, boolean>
  IsImmune: Record<string, boolean>
  Heals: Record<string, number>
  ActionTypes: number[]
  Skills: Record<string, unknown[]>
  SkillsCost: Record<string, string>
  Items: Record<string, unknown[]>
  ItemsCost: Record<string, string>
  HasKill: boolean
  Assists: CharacterRef[]
  Effects: Record<string, unknown>
  ApplyEffects: Record<string, number[]>
  ActorContinuousKilling: string[]
  DeathContinuousKilling: string[]
  CastTime: number
  HardnessTime: number
  RespawnCountdowns: Record<string, number>
  Respawns: CharacterRef[]
  RoundRewards: unknown[]
  OtherMessages: string[]
  Actions: ActionRecord[]
  Checkpoint: CharacterStateSnapshot[] | null
  TotalTime: number
  GameResult: RankingEntry[]
  TeamMap: Record<string, string>
  CharacterStatistics: Record<string, unknown> | null
}

// ===== 回放 DTO（Server /api/games 系列，camelCase）=====
export interface GameMetaDto {
  id: string
  mode: string
  state: number
  startedAt: string
  endedAt: string
  totalRounds: number
  winner: string
  roundCount: number
  totalTime: number
  modeType: string
  characters: { guid: string; name: string; nickName: string; level: number }[]
  teams: { name: string; score: number; isWinner: boolean }[]
}

export interface GameSummaryDto {
  round: number
  actorGuid: string
  actorName: string
  hasKill: boolean
  damageTotal: number
  healTotal: number
  actionCount: number
  effectCount: number
  hasCheckpoint: boolean
  totalTime: number
}

export interface GameRecordRef {
  id: string
  mode: string
  state: number
  startedAt: string
  endedAt: string
  totalRounds: number
  winner: string
}

// ===== 预设测试用例 =====
export interface TestCase {
  id: string
  group: string
  kind: TestKind
  name: string
  description: string
  method?: string
  path?: string
  body?: unknown
  bodyText?: string
  wsType?: string
  wsData?: Record<string, unknown>
}

// ===== 模组目录（GET /api/game-modules）=====
export interface ModuleInfoDto {
  name: string
  version: string
  author: string
  description: string
  kind: string | null // null = 游戏模式（ServerPlugin），否则为 CharacterModule/SkillModule/ItemModule
}

export interface GameModulesDto {
  modes: ModuleInfoDto[]
  modules: ModuleInfoDto[]
}
