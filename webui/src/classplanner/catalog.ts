// 服务端职业定义 → 前端内容模型的映射层（把 /api/classplan/definitions 的 DTO 转成 content.ts 的模型）
// 小字注：内核用 IdName（"7101.导械师"）作主键，前端规划器用数字 id，故此处维护双向映射
import { CLASSES, SKILLS, SUBCLASSES, TALENTS } from './content'
import type { ServerDefinitionsDto, ServerSkillDto } from './api'
import type { AttributeLimit, ClassDef, RoleType, SkillDef, SkillType, SubClassDef, TalentDef } from './types'

/** IdName（"7101.导械师"）→ 数字 id；解析失败返回 null */
export function idOf(idName: string | undefined | null): number | null {
  if (!idName) return null
  const head = idName.split('.')[0]
  const n = Number(head)
  return Number.isFinite(n) ? n : null
}

/** 数字 id → IdName（调用服务端接口时用于定位职业 / 流派） */
export function classIdName(id: number): string | undefined {
  return CLASSES.find(c => c.id === id)?.idName
}

/** 数字 id → 流派 IdName */
export function subClassIdName(id: number): string | undefined {
  return SUBCLASSES.find(s => s.id === id)?.idName
}

/** 数字 id → 战斗天赋 IdName */
export function talentIdName(id: number): string | undefined {
  return TALENTS.find(t => t.id === id)?.idName ?? `${id}`
}

/** camelCase 的服务端限值 → 前端 PascalCase 的 AttributeLimit */
function toLimit(dto: unknown): AttributeLimit | undefined {
  if (!dto || typeof dto !== 'object') return undefined
  const raw = dto as Record<string, unknown>
  const num = (k: string): number | undefined => {
    const v = raw[k]
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined
  }
  const pairs: Array<[keyof AttributeLimit, string]> = [
    ['STRMin', 'strMin'],
    ['STRMax', 'strMax'],
    ['AGIMin', 'agiMin'],
    ['AGIMax', 'agiMax'],
    ['INTMin', 'intMin'],
    ['INTMax', 'intMax'],
    ['STRGrowthMin', 'strGrowthMin'],
    ['STRGrowthMax', 'strGrowthMax'],
    ['AGIGrowthMin', 'agiGrowthMin'],
    ['AGIGrowthMax', 'agiGrowthMax'],
    ['INTGrowthMin', 'intGrowthMin'],
    ['INTGrowthMax', 'intGrowthMax'],
  ]
  const limit: AttributeLimit = {}
  for (const [target, source] of pairs) {
    const v = num(source)
    if (v !== undefined) limit[target] = v
  }
  return Object.keys(limit).length ? limit : undefined
}

const SKILL_TYPES: SkillType[] = ['Magic', 'Skill', 'SuperSkill', 'Passive', 'Item']

function toSkillType(value: string | undefined): SkillType {
  return SKILL_TYPES.find(t => t === value) ?? 'Skill'
}

function toRoleType(value: string): RoleType | null {
  const all: RoleType[] = ['None', 'Core', 'Vanguard', 'Guardian', 'Support', 'Medic']
  return all.find(r => r === value) ?? null
}

/** 服务端只给定位 key 与技能，核心定位天赋在内核侧自带「全等级 +1」，故此处标记 isCoreBuff */
function toTalentDef(classId: number, role: RoleType, dto: ServerSkillDto, idName?: string): TalentDef {
  return {
    id: dto.id,
    idName,
    classId,
    roleType: role,
    name: dto.name,
    desc: dto.description ?? '',
    isCoreBuff: role === 'Core',
  }
}

export interface ClassCatalog {
  classes: ClassDef[]
  subClasses: SubClassDef[]
  skills: SkillDef[]
  talents: TalentDef[]
}

/**
 * 把服务端定义转成前端内容模型
 * <para/>数字的 id 取自 IdName 前缀（"7101.导械师" → 7101），技能直接用服务端 id
 */
export function catalogFromServer(dto: ServerDefinitionsDto): ClassCatalog {
  const classes: ClassDef[] = []
  const subClasses: SubClassDef[] = []
  const skills: SkillDef[] = []
  const talents: TalentDef[] = []

  for (const c of dto.classes) {
    const classId = idOf(c.id)
    if (classId === null) continue

    classes.push({
      id: classId,
      idName: c.id,
      name: c.name,
      epithet: '',
      hue: '#c94f3d',
      desc: `服务端职业定义 · 模板限值：${c.attributeLimitText ?? '无上下限'}`,
      attributeLimit: toLimit(c.attributeLimit),
    })

    // 技能池：战技 / 魔法 / 爆发技 均属主动技能，被动单独成池；类型以服务端为准（分池已保证大类正确）
    const push = (list: ServerSkillDto[] | undefined, fallback: SkillType) => {
      for (const s of list ?? []) {
        const type = toSkillType(s.skillType)
        skills.push({
          id: s.id,
          classId,
          name: s.name,
          skillType: type === 'Item' ? fallback : type,
          desc: s.description ?? '',
        })
      }
    }
    push(c.skills, 'Skill')
    push(c.magics, 'Magic')
    push(c.superSkills, 'SuperSkill')
    push(c.passives, 'Passive')

    // 天赋池：按定位分组（服务端 DTO 未直接给 IdName，用 id + name 拼装，与内核 GetIdName() 一致）
    for (const [role, list] of Object.entries(c.talents ?? {})) {
      const roleType = toRoleType(role)
      if (roleType === null || roleType === 'None') continue
      for (const t of list ?? []) {
        talents.push(toTalentDef(classId, roleType, t, `${t.id}.${t.name}`))
      }
    }

    // 流派
    for (const s of c.subClasses ?? []) {
      const subId = idOf(s.id)
      if (subId === null) continue
      const inherent: Record<number, string[]> = {}
      const detailed = (s as { inherentPassives?: Array<{ gate: number; names: string[] }> }).inherentPassives
      if (detailed?.length) {
        for (const item of detailed) inherent[item.gate] = item.names
      } else {
        // 旧版服务端只给门槛等级
        for (const gate of s.inherentPassiveGates ?? []) inherent[gate] = []
      }
      subClasses.push({
        id: subId,
        idName: s.id,
        classId,
        name: s.name,
        roleTypes: (s.roleTypes ?? []).map(toRoleType).filter((r): r is RoleType => r !== null && r !== 'None'),
        desc: `服务端流派定义 · 固有被动门槛 ${(s.inherentPassiveGates ?? []).join(' / ') || '无'}`,
        inherent,
      })
    }
  }

  return { classes, subClasses, skills, talents }
}

/**
 * 用新目录**原地替换** content.ts 导出的数组
 * <para/>保持数组引用不变，因此 engine / 面板里已有的 `SKILLS.find(...)`、`CLASSES.map(...)` 会自动看到新数据
 */
export function applyCatalog(c: ClassCatalog): void {
  CLASSES.splice(0, CLASSES.length, ...c.classes)
  SUBCLASSES.splice(0, SUBCLASSES.length, ...c.subClasses)
  SKILLS.splice(0, SKILLS.length, ...c.skills)
  TALENTS.splice(0, TALENTS.length, ...c.talents)
}
