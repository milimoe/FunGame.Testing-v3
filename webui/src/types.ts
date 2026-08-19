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

// ===== 单回合记录（RoundRecord，RoundRecordConverter 输出格式）=====
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
}

export interface SkillStateSnapshot {
  SkillId: number
  SkillName: string
  Level: number
  CurrentCD: number
}

export interface ItemStateSnapshot {
  ItemId: number
  ItemName: string
}

export interface EffectStateSnapshot {
  EffectId: number
  EffectName: string
  EffectType: number
  RemainDuration: number
  RemainDurationTurn: number
  // 特效施加者（Source 角色）的 Guid，无施加者为空字符串
  SourceGuid?: string
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

// ===== 游戏数据字典（/api/gamedata，供按 id 匹配显示技能/物品描述）=====
export interface GameDataEntryDto {
  id: number
  name: string
  description: string
}

export interface GameDataDto {
  skills: GameDataEntryDto[]
  items: GameDataEntryDto[]
  characters: GameDataEntryDto[]
}
