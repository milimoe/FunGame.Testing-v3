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
  /** 重连时显式接管仍在运行的对局（避免新连接被旧会话的状态/结算污染） */
  GamingResume: 'gaming.resume',
  /** 暂停 / 继续（d: { paused: boolean }） */
  GamingPause: 'gaming.pause',
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
  /** 施法距离（格）；castAnywhere 为真时该值代表「全图」 */
  castRange: number
  /** 是否全图施法 */
  castAnywhere: boolean
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
  /** 主动效果的施法距离（格），无主动效果为 0 */
  castRange: number
  castAnywhere: boolean
  usable: boolean
  unusableReason: string
}

/** 装备栏中的一件装备 */
export interface SoloEquipmentDto {
  /** 槽位键：Weapon / Armor / Shoes / MagicCardPack / Accessory1 / Accessory2 */
  slot: string
  /** 槽位中文名 */
  slotLabel: string
  guid: string
  id: number
  name: string
  description: string
  itemType: string
  weaponType: number
  weaponTypeName: string
}

/** 状态效果（可点击查看描述） */
export interface SoloEffectDto {
  name: string
  description: string
  effectType: string
  isDebuff: boolean
  isDurative: boolean
  remainDuration: number
  remainDurationTurn: number
  isInEffect: boolean
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
  /** 攻击距离（格） */
  atr: number
  state: string
  isPlayer: boolean
  isAI: boolean
  isEliminated: boolean
  gridId: number
  /** 所属队伍名（团队模式）；混战为 null */
  teamName: string | null
  skills: SoloSkillDto[]
  items: SoloItemDto[]
  effects: SoloEffectDto[]
  /** 全部属性（属性名 → 展示值），含力量/敏捷/智力/攻防/暴击/穿透/移动距离/攻击距离等 */
  attributes: Record<string, string>
  equipments: SoloEquipmentDto[]
}

export interface SoloQueueEntryDto {
  guid: string
  displayName: string
  hardnessTime: number
  order: number
  isPlayer: boolean
  teamName: string | null
}

/** 单个行动类型的配额：剩余 = quota - used */
export interface SoloActionQuotaDto {
  actionType: string
  label: string
  quota: number
  used: number
  remaining: number
  decisionPointCost: number
  available: boolean
}

export interface SoloDpDto {
  current: number
  max: number
  cost: number
  actionsTaken: number
  recovery: number
  /** 本回合各行动类型已用次数（旧字段名 actionCosts 语义有误，已重命名） */
  actionUsed: Record<string, number>
  /** 各行动类型的配额 / 剩余 */
  quotas: SoloActionQuotaDto[]
}

/** 团队（团队模式；己方恒为「蓝队」） */
export interface SoloTeamDto {
  name: string
  score: number
  alive: number
  size: number
  isPlayerTeam: boolean
  members: string[]
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
  /** 玩家角色是否已被服务端交给 AI 托管（决策超时或断线） */
  aiEscalated?: boolean
  /** 团队模式：红蓝两队（己方固定为「蓝队」） */
  teams?: SoloTeamDto[] | null
  teamMode?: boolean
  /** 死亡竞赛夺冠人头数（0 = 非死亡竞赛） */
  maxScoreToWin?: number
  /** 对局是否已暂停 */
  paused?: boolean
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
  /** 是否是施法者自身 */
  isSelf?: boolean
  /** 是否是施法者的队友 */
  isTeammate?: boolean
  isEliminated?: boolean
}

export interface SoloInquiryChoiceDto {
  key: string
  text: string
}

/**
 * 射程信息（勾选行动类型时用于地图预演）：
 * - 黄色 = 攻击距离 / 技能选取距离
 * - 绿色 = 移动距离
 */
export interface SoloRangeInfo {
  /** 攻击距离（格）：普通攻击用 */
  atr: number
  /** 移动距离（格） */
  mov: number
  /** 施法者所在格子 */
  actorGridId: number
}

// 决策种类对应的负载（判别联合）
export type SoloDecisionPayload =
  | { kind: 'SelectCharacter'; characters: SoloCharOptionDto[] }
  | {
      kind: 'ActionType'
      actorGuid: string
      actorName?: string
      teamName?: string | null
      actorGridId?: number
      /** 攻击距离（格） */
      atr?: number
      /** 移动距离（格） */
      mov?: number
      dp: SoloDpDto | null
      skills: SoloSkillDto[]
      items: SoloItemDto[]
      enemys: string[]
      teammates: string[]
      /** 场上（射程内）的敌人列表，含名称与血量 */
      enemyOptions?: SoloTargetOptionDto[]
      /** 场上（射程内）的队友列表，含名称与血量 */
      teammateOptions?: SoloTargetOptionDto[]
    }
  | { kind: 'Skill'; actorGuid: string; actorGridId?: number; atr?: number; mov?: number; skills: SoloSkillDto[] }
  | { kind: 'Item'; actorGuid: string; actorGridId?: number; atr?: number; mov?: number; items: SoloItemDto[] }
  | {
      kind: 'Targets'
      actorGuid: string
      skillName: string
      maxTargets: number
      /** 「选取全体」类技能/普攻：前端应默认替玩家勾选全部可选目标 */
      selectAll?: boolean
      /** 攻击 / 施法距离（格）；-1 表示全图 */
      range?: number
      attackRange?: number
      moveRange?: number
      actorGridId?: number
      enemys?: string[]
      teammates?: string[]
      targets: SoloTargetOptionDto[]
    }
  | {
      kind: 'TargetGrid'
      actorGuid: string
      currentGridId: number
      /** 移动距离（格） */
      moveRange?: number
      /** 攻击距离（格） */
      attackRange?: number
      atr?: number
      mov?: number
      gridIds: number[]
    }
  | {
      kind: 'TargetGrids'
      actorGuid: string
      skillName: string
      /** 施法距离（格）；-1 表示全图 */
      range?: number
      actorGridId?: number
      gridIds: number[]
      /** 选取形状（SkillRangeType）：Diamond/Circle/Square/Line/LinePass/Sector。
       *  玩家只选一个中心格，服务端按此形状权威展开受影响区域。 */
      shapeRangeType?: string
      /** 形状半径（CanSelectTargetRange）：0 = 仅中心格自身 */
      shapeRadius?: number
      /** 扇形角度（仅 Sector 有效，默认 90） */
      sectorAngle?: number
      /** 形状区域是否包含有角色的格子 */
      includeCharacterGrid?: boolean
    }
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
  /** 服务端等待上限（ms）；超时后服务端会把玩家角色交 AI 托管并推进回合 */
  timeoutMs?: number
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
  gameId?: string
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
