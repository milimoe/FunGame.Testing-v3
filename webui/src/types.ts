// ===== 实体引用（EntityRefHelper 输出格式，PascalCase 字段）=====
export interface CharacterRef {
  Guid: string
  Name: string
  FirstName: string
  NickName: string
  UserName: string
}

export interface SkillRef {
  Guid: string
  Id: number
  Name: string
  SkillType: number
}

export interface ItemRef {
  Guid: string
  Id: number
  Name: string
}

export interface TeamRef {
  Id: string
  Name: string
  Score: number
  IsWinner: boolean
  Members: CharacterRef[]
}

// ===== 询问记录（InquiryRecord，InquiryRecordHelper 输出格式）=====
// 一次询问的概要：主题（标题）、描述、类型、选项与最终答复
export interface InquiryRecord {
  // 被询问的角色
  Character: CharacterRef
  // 询问主题（标题）
  Topic: string
  // 询问描述
  Description: string
  // 询问类型（InquiryType：0 未设置 / 1 单选 / 2 多选 / 3 二选一 / 4 文本输入 / 5 数值输入 / 6 自定义）
  InquiryType: number
  // 可选项（键 -> 说明）
  Choices: Record<string, string>
  // 最终选定的项（选择类询问）
  Selected: string[]
  // 文本结果（文本输入类询问）
  TextResult: string
  // 数值结果（数值输入类询问）
  NumberResult: number
  // 是否被取消
  Cancel: boolean
  // 答复来源（InquiryResponseSource：0 未设置 / 1 外部 / 2 特效 / 3 自定义 / 4 AI / 5 默认）
  Source: number
}

// ===== 单次行动记录（ActionRecord）=====
export interface ActionRecord {
  Round: number
  AllCharacters?: CharacterRef[]
  Actor: CharacterRef | null
  ActionIndex: number
  ActionType: number
  Skill?: SkillRef | null
  Item?: ItemRef | null
  MPCost: number
  EPCost: number
  SkillCD: number
  DecisionPointsCost: number
  Targets: CharacterRef[]
  Damages: Record<string, number>
  // 按伤害类型分桶的伤害值（角色 Guid -> 伤害类型 -> 伤害值；旧档无此字段）
  DamageDetails?: Record<string, Record<number, number>>
  IsCritical: Record<string, boolean>
  IsEvaded: Record<string, boolean>
  IsImmune: Record<string, boolean>
  Heals: Record<string, number>
  ApplyEffects: Record<string, number[]>
  Messages: string[]
  // 本次行动期间发生的询问（按发生顺序；旧档无此字段）
  Inquiries?: InquiryRecord[]
  IsSuccess: boolean
  FailReason?: string
  CastTime: number
  HardnessTime: number
}

// ===== 单回合记录（RoundRecord，RoundRecordConverter 输出格式）=====
export interface RoundRecord {
  Round: number
  AllCharacters: CharacterRef[]
  Actor: CharacterRef | null
  Targets: Record<string, CharacterRef[]>
  Damages: Record<string, number>
  // 按伤害类型分桶的伤害值（角色 Guid -> 伤害类型 -> 伤害值；旧档无此字段）
  DamageDetails?: Record<string, Record<number, number>>
  IsCritical: Record<string, boolean>
  IsEvaded: Record<string, boolean>
  IsImmune: Record<string, boolean>
  Heals: Record<string, number>
  ActionTypes: number[]
  Skills: Record<string, SkillRef[]>
  SkillsCost: Record<string, string>
  Items: Record<string, ItemRef[]>
  ItemsCost: Record<string, string>
  HasKill: boolean
  Assists: CharacterRef[]
  Effects: Record<string, SkillRef>
  ApplyEffects: Record<string, number[]>
  ActorContinuousKilling: string[]
  DeathContinuousKilling: string[]
  CastTime: number
  HardnessTime: number
  RespawnCountdowns: Record<string, number>
  Respawns: CharacterRef[]
  RoundRewards: SkillRef[]
  OtherMessages: string[]
  Actions: ActionRecord[]
  // 本回合全部询问（含各行动内的询问；旧档无此字段）
  Inquiries?: InquiryRecord[]
  Checkpoint: CharacterStateSnapshot[] | null
  TotalTime: number
  GameResult: RankingEntry[]
  TeamMap: Record<string, string>
  CharacterStatistics: Record<string, CharacterStatistics> | null
}

// ===== 状态快照（CharacterStateSnapshot）=====
export interface CharacterStateSnapshot {
  Character: CharacterRef
  HP: number
  MaxHP: number
  MP: number
  MaxMP: number
  EP: number
  HR: number
  MR: number
  // 角色全部属性（属性名 -> 展示值，与 Character.GetInfo() 中出现的属性一致）
  Attributes: Record<string, string>
  Equipments: Record<string, number>
  EquipmentsDetail: EquipmentStateSnapshot[]
  Skills: SkillStateSnapshot[]
  Items: ItemStateSnapshot[]
  Effects: EffectStateSnapshot[]
}

export interface EquipmentStateSnapshot {
  Slot: number
  ItemId: number
  ItemName: string
  // 装备描述（来自检查点快照，序列化后可直接使用）
  Description: string
}

export interface SkillStateSnapshot {
  SkillId: number
  SkillName: string
  Level: number
  CurrentCD: number
  // 技能描述（来自检查点快照，序列化后可直接使用）
  Description: string
}

export interface ItemStateSnapshot {
  ItemId: number
  ItemName: string
  // 物品描述（来自检查点快照，序列化后可直接使用）
  Description: string
}

export interface EffectStateSnapshot {
  EffectId: number
  EffectName: string
  EffectType: number
  RemainDuration: number
  RemainDurationTurn: number
  // 特效施加者（Source 角色）的 Guid，无施加者为空字符串
  SourceGuid?: string
  // 特效描述（来自检查点快照，序列化后可直接使用）
  Description: string
}

// ===== 最终排名条目（RankingEntry）=====
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

// ===== 角色统计（CharacterStatistics，PascalCase 字段）=====
export interface CharacterStatistics {
  TotalDamage: number
  TotalPhysicalDamage: number
  TotalMagicDamage: number
  TotalTrueDamage: number
  TotalTakenDamage: number
  TotalTakenPhysicalDamage: number
  TotalTakenMagicDamage: number
  TotalTakenTrueDamage: number
  AvgDamage: number
  AvgPhysicalDamage: number
  AvgMagicDamage: number
  AvgTrueDamage: number
  AvgTakenDamage: number
  AvgTakenPhysicalDamage: number
  AvgTakenMagicDamage: number
  AvgTakenTrueDamage: number
  TotalHeal: number
  AvgHeal: number
  TotalShield: number
  AvgShield: number
  LiveRound: number
  AvgLiveRound: number
  ActionTurn: number
  AvgActionTurn: number
  LiveTime: number
  AvgLiveTime: number
  ControlTime: number
  AvgControlTime: number
  DamagePerRound: number
  DamagePerTurn: number
  DamagePerSecond: number
  TotalEarnedMoney: number
  AvgEarnedMoney: number
  Kills: number
  Deaths: number
  Assists: number
  FirstKills: number
  FirstDeaths: number
  Plays: number
  Wins: number
  Top3s: number
  Loses: number
  Winrate: number
  Top3rate: number
  LastRank: number
  AvgRank: number
  Rating: number
  MVPs: number
  UseDecisionPoints: number
  TurnDecisions: number
  AvgUseDecisionPoints: number
  AvgTurnDecisions: number
}

// ===== 后端 API DTO（camelCase 输出）=====
export interface CharacterRefDto {
  guid: string
  name: string
  firstName: string
  nickName: string
  userName: string
}

export interface TeamDto {
  id: string
  name: string
  score: number
  isWinner: boolean
  members: CharacterRefDto[]
}

export interface MetaDto {
  roundCount: number
  totalTime: number
  mode: string
  zipUpdated: string
  characters: CharacterRefDto[]
  teams: TeamDto[]
}

export interface RoundSummaryDto {
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

// 注意：后端 camelCase 策略把 C# 的 MVPs 转成了 mvPs
export interface StatRowDto {
  guid: string
  name: string
  nickName: string
  teamName: string
  rating: number
  kills: number
  deaths: number
  assists: number
  totalDamage: number
  totalHeal: number
  totalShield: number
  winrate: number
  mvPs: number
  lastRank: number
  avgRank: number
  liveRound: number
  totalEarnedMoney: number
  damagePerRound: number
  damagePerSecond: number
  controlTime: number
}

export interface StatsDto {
  roundCount: number
  totalTime: number
  mode: string
  mvpName: string
  mvpRating: number
  rows: StatRowDto[]
  teams: TeamDto[]
}
