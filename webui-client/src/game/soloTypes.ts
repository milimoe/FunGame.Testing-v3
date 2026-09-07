// ============================================================================
// 单人模式 · 协议类型
// 消息信封与 gaming.* 命名对齐 FunGame.Server-v3 的 MessageEnvelope/MessageTypes，
// 单人模式扩展三类：gaming.state（全量快照+增量日志）、gaming.request（决策请求）、
// gaming.resolved（决策已解决广播）。将来切 Server-v3 联机时仅替换传输实现。
// ============================================================================

// ==================== 信封 ====================
export interface SoloEnvelopeError {
  code: string
  message: string
}

export interface SoloEnvelope {
  t: string
  i: number
  ok: boolean
  d: Record<string, unknown> | null
  ts: number
  error?: SoloEnvelopeError | null
}

export const SoloMsg = {
  // 与 Server-v3 对齐
  Ping: 'system.ping',
  Pong: 'system.pong',
  GamingStart: 'gaming.start',
  GamingAction: 'gaming.action',
  GamingEnd: 'gaming.end',
  GamingOver: 'gaming.over',
  GamingRound: 'gaming.round',
  GamingQueue: 'gaming.queue',
  // 单人模式扩展
  GamingState: 'gaming.state',
  GamingRequest: 'gaming.request',
  GamingResolved: 'gaming.resolved',
} as const

export type SoloConnStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

// ==================== 快照 DTO（与 C# 端 SoloGameDtos 一一对应，camelCase） ====================
export interface SoloGridDto {
  id: number
  x: number
  y: number
  z: number
  color: string
  characters: string[] // 站在此格的角色 guid
}

export interface SoloMapDto {
  name: string
  length: number
  width: number
  height: number
  size: number
  grids: SoloGridDto[]
}

export interface SoloSkillDto {
  guid: string
  id: number
  name: string
  description: string
  level: number
  skillType: string
  isSuperSkill: boolean
  isMagic: boolean
  isActive: boolean
  enable: boolean
  isInEffect: boolean
  currentCD: number
  realCD: number
  realMPCost: number
  realEPCost: number
  canSelectEnemy: boolean
  canSelectTeammate: boolean
  canSelectSelf: boolean
  usable: boolean
  unusableReason: string
}

export interface SoloItemDto {
  guid: string
  id: number
  name: string
  description: string
  itemType: string
  isActive: boolean
  enable: boolean
  isInGameItem: boolean
  remainUseTimes: number
  usable: boolean
  unusableReason: string
}

export interface SoloCharacterDto {
  guid: string
  id: number
  name: string
  firstName: string
  nickName: string
  displayName: string
  level: number
  hp: number
  maxHP: number
  mp: number
  maxMP: number
  ep: number
  maxEP: number
  mov: number
  state: string
  isPlayer: boolean
  isAI: boolean
  isEliminated: boolean
  gridId: number
  skills: SoloSkillDto[]
  items: SoloItemDto[]
  effects: string[]
}

export interface SoloQueueEntryDto {
  guid: string
  displayName: string
  hardnessTime: number
  order: number
  isPlayer: boolean
}

export interface SoloDpDto {
  current: number
  max: number
  cost: number
  actionsTaken: number
  recovery: number
  actionCosts: Record<string, number>
}

export interface SoloStateDto {
  gameId: string
  mode: string
  round: number
  totalTime: number
  running: boolean
  gameOver: boolean
  map: SoloMapDto | null
  characters: SoloCharacterDto[]
  queue: SoloQueueEntryDto[]
  playerDP: SoloDpDto | null
  playerGuid: string | null
  currentActorGuid: string | null
  roundRewards: Record<string, string[]>
}

export interface SoloRankingDto {
  rank: number
  guid: string
  displayName: string
  isPlayer: boolean
  isWinner: boolean
  rating: number
  kills: number
  deaths: number
  assists: number
  totalDamage: number
  totalHeal: number
  totalShield: number
  liveRound: number
  actionTurn: number
  liveTime: number
  teamName: string
}

// ==================== 决策请求负载 ====================
export interface SoloCharOptionDto {
  guid: string
  id: number
  name: string
  firstName: string
  nickName: string
  displayName: string
  info: string
}

export interface SoloTargetOptionDto {
  guid: string
  displayName: string
  hp: number
  maxHp: number
  gridId: number
}

export interface SoloInquiryChoiceDto {
  key: string
  text: string
}

// 决策种类对应的负载（判别联合）
export type SoloDecisionPayload =
  | { kind: 'SelectCharacter'; characters: SoloCharOptionDto[] }
  | {
      kind: 'ActionType'
      actorGuid: string
      dp: SoloDpDto | null
      skills: SoloSkillDto[]
      items: SoloItemDto[]
      enemys: string[]
      teammates: string[]
    }
  | { kind: 'Skill'; actorGuid: string; skills: SoloSkillDto[] }
  | { kind: 'Item'; actorGuid: string; items: SoloItemDto[] }
  | { kind: 'Targets'; actorGuid: string; skillName: string; maxTargets: number; targets: SoloTargetOptionDto[] }
  | { kind: 'TargetGrid'; actorGuid: string; currentGridId: number; gridIds: number[] }
  | { kind: 'TargetGrids'; actorGuid: string; skillName: string; gridIds: number[] }
  | {
      kind: 'Inquiry'
      actorGuid: string
      topic: string
      description: string
      inquiryType: string
      choices: SoloInquiryChoiceDto[]
      defaultChoice: string
      canCancel: boolean
      minNumber: number
      maxNumber: number
      defaultNumber: number
    }
  | { kind: 'Continue'; actorGuid: string; message: string }

export type SoloDecisionKind = SoloDecisionPayload['kind']

/**
 * 服务端下发为 { requestId, kind, payload }（kind 在顶层，与 Server-v3 的消息风格一致）。
 * 客户端归一化时也会把 kind 注入 payload，方便 UI 用 payload.kind 做判别联合收窄。
 */
export interface SoloDecisionRequest {
  requestId: string
  kind: SoloDecisionKind
  payload: SoloDecisionPayload
}

// ==================== 决策回传负载（gaming.action 的 payload，按 request kind 对应） ====================
export type SoloDecisionReply =
  | { characterGuid: string }
  | { actionType: string }
  | { skillGuid: string }
  | { itemGuid: string }
  | { targetGuids: string[] }
  | { gridId: number }
  | { gridIds: number[] }
  | { choices?: string[]; number?: number; text?: string; cancel?: boolean }
  | { cancelled: boolean }

// ==================== 对局事件（gaming.state / gaming.over 等 d 字段） ====================
export interface SoloStateEvent {
  state: SoloStateDto
  log: string[]
}

export interface SoloOverEvent {
  gameId: string
  mode: string
  totalRound: number
  totalTime: number
  winnerGuid: string | null
  winnerName: string | null
  ranking: SoloRankingDto[]
}

export interface SoloRoundEvent {
  round: number
  actorGuid: string
}

export interface SoloResolvedEvent {
  requestId: string
  kind: string
}

export type SoloInboundEvent =
  | { type: 'gaming.state'; data: SoloStateEvent }
  | { type: 'gaming.over'; data: SoloOverEvent }
  | { type: 'gaming.round'; data: SoloRoundEvent }
  | { type: 'gaming.queue'; data: Record<string, unknown> }
  | { type: 'gaming.request'; data: SoloDecisionRequest }
  | { type: 'gaming.resolved'; data: SoloResolvedEvent }
  | { type: 'gaming.start'; data: Record<string, unknown> }
  | { type: 'system.pong'; data: Record<string, unknown> }
  | { type: 'system.notice'; data: Record<string, unknown> }
