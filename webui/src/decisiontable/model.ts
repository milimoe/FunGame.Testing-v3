export interface Condition {
  type?: string
  all?: Condition[]
  any?: Condition[]
  not?: Condition
  target?: string
  operator?: string
  value?: number
  skillId?: number
  parameters?: Record<string, unknown>
}

export interface Rule {
  id: string
  enabled: boolean
  priority: number
  trigger: string
  target?: { relation: string; selector: string; bind: string }
  when?: Condition
  action: {
    type: string
    skillId?: number
    itemId?: number
    target?: string
    movement: string
    positionPreference: string
    bindPlan?: string
    maxRisk?: number
    parameters?: Record<string, unknown>
  }
}

export interface DecisionTable {
  schemaVersion: number
  id: string
  fallback: string
  rules: Rule[]
}

export interface Diagnostic { path: string; message: string }
export interface Resource { id: number; name: string; description: string }
export interface Catalog { skills: Resource[]; items: Resource[] }
export interface Validation { valid: boolean; diagnostics: Diagnostic[] }

export const ACTIONS = [
  ['normalAttack', '普通攻击'], ['castSkill', '释放技能'], ['useItem', '使用物品'],
  ['approach', '接近目标'], ['retreat', '撤离威胁'], ['endTurn', '结束回合'],
] as const
export const CONDITIONS = [
  ['self.hpRatio', '自身生命比例'], ['target.hpRatio', '目标生命比例'], ['self.mp', '自身 MP'],
  ['self.ep', '自身 EP'], ['self.state', '自身状态值'], ['skill.available', '技能可用'],
  ['decisionPoints', '剩余决策点'], ['target.exists', '目标存在'], ['distance', '与目标的距离'],
  ['plan.targetCount', '方案目标数量'], ['plan.risk', '方案位置风险'],
] as const
export const COMPARISONS = [
  ['lessThan', '小于'], ['atMost', '不大于'], ['equal', '等于'], ['atLeast', '不小于'], ['greaterThan', '大于'],
] as const
export const MOVEMENTS = [['never', '禁止移动'], ['ifNeeded', '必要时移动'], ['required', '必须移动']] as const
export const POSITIONS = [['current', '优先原地'], ['coverage', '优先覆盖'], ['safe', '优先安全']] as const
export const RELATIONS = [['enemy', '敌方'], ['ally', '友方（含自身）'], ['self', '自身']] as const
export const SELECTORS = [['lowestHpRatio', '生命比例最低'], ['highestHpRatio', '生命比例最高'], ['nearest', '距离最近'], ['self', '自身']] as const

export const emptyTable = (): DecisionTable => ({ schemaVersion: 1, id: 'custom:strategy', fallback: 'defaultAI', rules: [] })
export const leaf = (): Condition => ({ type: 'self.hpRatio', operator: 'lessThan', value: 0.3 })
export function newRule(rules: Rule[]): Rule {
  let index = rules.length + 1
  while (rules.some(rule => rule.id === `rule-${index}`)) index++
  return { id: `rule-${index}`, enabled: true, priority: 0, trigger: 'beforeDecision',
    action: { type: 'normalAttack', movement: 'ifNeeded', positionPreference: 'current' } }
}
export const clone = <T,>(value: T): T => structuredClone(value)
export const toJson = (config: DecisionTable): string => JSON.stringify(config, null, 2)
export function renameReferences(condition: Condition | undefined, from: string, to: string, kind: 'target' | 'plan'): Condition | undefined {
  if (!condition) return undefined
  const references = kind === 'plan' ? condition.type?.startsWith('plan.') : condition.type?.startsWith('target.') || condition.type === 'distance'
  return { ...condition, target: references && condition.target === from ? to : condition.target,
    all: condition.all?.map(child => renameReferences(child, from, to, kind)!),
    any: condition.any?.map(child => renameReferences(child, from, to, kind)!),
    not: renameReferences(condition.not, from, to, kind) }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const named = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const includes = (options: readonly (readonly [string, string])[], value: unknown) => options.some(([key]) => key === value)

export function validate(config: unknown): Diagnostic[] {
  const errors: Diagnostic[] = []
  const add = (path: string, message: string) => errors.push({ path, message })
  const known = (value: Record<string, unknown>, keys: string[], path: string) => {
    for (const key of Object.keys(value)) if (!keys.includes(key)) add(`${path}.${key}`, '未知字段。')
  }
  const id = (value: unknown, path: string) => {
    if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value))) add(path, 'ID 必须是浏览器可精确表示的整数。')
  }
  const optionalText = (value: unknown, path: string) => {
    if (value !== undefined && value !== null && typeof value !== 'string') add(path, '需要字符串。')
  }
  const parameters = (value: unknown, path: string) => {
    if (value !== undefined && !object(value)) add(path, '扩展参数必须是 JSON 对象。')
  }
  function condition(value: unknown, target: unknown, plan: unknown, path: string, depth: number) {
    if (value === undefined || value === null) return
    if (depth > 16) { add(path, '条件根节点深度为 0，最多嵌套 16 级。'); return }
    if (!object(value)) { add(path, '条件需要是对象。'); return }
    known(value, ['type', 'all', 'any', 'not', 'target', 'operator', 'value', 'skillId', 'parameters'], path)
    const forms = ['all', 'any', 'not'].filter(key => value[key] != null)
    if (typeof value.type === 'string' && value.type.length) forms.push('type')
    if (forms.length !== 1) { add(path, '条件只能包含一种形式。'); return }
    const form = forms[0]
    if (form === 'all' || form === 'any') {
      const children = value[form]
      if (!Array.isArray(children)) { add(`${path}.${form}`, '需要条件数组。'); return }
      if (children.length > 64) add(path, '单个组合最多 64 个直接子条件。')
      children.slice(0, 65).forEach((child, index) => {
        if (child === null) add(`${path}[${index}]`, '条件不可为 null。')
        else condition(child, target, plan, `${path}[${index}]`, depth + 1)
      })
      return
    }
    if (form === 'not') { condition(value.not, target, plan, `${path}.not`, depth + 1); return }
    if (!includes(CONDITIONS, value.type) && !(named(value.type) && value.type.includes(':'))) add(`${path}.type`, '请选择内置条件，或填写宿主已注册的 module:name 扩展。')
    const type = String(value.type)
    if (!includes(COMPARISONS, value.operator === undefined ? 'atLeast' : value.operator)) add(path, '未知比较方式。')
    const number = value.value === undefined ? 0 : value.value
    if (typeof number !== 'number' || !Number.isFinite(number)) add(`${path}.value`, '需要有限数值。')
    if (type.endsWith('hpRatio') && typeof number === 'number' && (number < 0 || number > 1)) add(`${path}.value`, '生命比例必须在 0 至 1 之间。')
    if ((type.startsWith('target.') || type === 'distance') && (!named(target) || value.target !== target)) add(`${path}.target`, '需要引用本规则的目标绑定。')
    if (type.startsWith('plan.') && (!named(plan) || value.target !== plan)) add(`${path}.target`, '需要引用本规则的方案绑定。')
    if (type === 'skill.available' && value.skillId == null) add(`${path}.skillId`, '缺少技能 ID。')
    optionalText(value.target, `${path}.target`)
    id(value.skillId, `${path}.skillId`)
    parameters(value.parameters, `${path}.parameters`)
  }
  if (!object(config)) return [{ path: '$', message: '决策表需要是 JSON 对象。' }]
  known(config, ['schemaVersion', 'id', 'fallback', 'rules'], '$')
  if ((config.schemaVersion === undefined ? 1 : config.schemaVersion) !== 1) add('schemaVersion', '仅支持版本 1。')
  if (!named(config.id) || !config.id.includes(':')) add('id', '需要 module:name 格式的策略 ID。')
  if (!['defaultAI', 'endTurn'].includes(String(config.fallback === undefined ? 'defaultAI' : config.fallback))) add('fallback', '未知回退方式。')
  const rules = config.rules === undefined ? [] : config.rules
  if (!Array.isArray(rules)) { add('rules', '规则列表不可为 null，允许空表，最多 256 条。'); return errors }
  if (rules.length > 256) add('rules', '最多 256 条规则。')
  const ids = new Set<string>()
  rules.slice(0, 257).forEach((rule, index) => {
    const path = `rules[${index}]`
    if (!object(rule)) { add(path, '规则需要是对象。'); return }
    known(rule, ['id', 'enabled', 'priority', 'trigger', 'target', 'when', 'action'], path)
    if (!named(rule.id) || ids.has(rule.id)) add(`${path}.id`, '规则 ID 不可为空或重复。')
    if (named(rule.id)) ids.add(rule.id)
    if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') add(`${path}.enabled`, '需要布尔值。')
    const priority = rule.priority === undefined ? 0 : rule.priority
    if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < -2147483648 || priority > 2147483647) add(`${path}.priority`, '优先级需要是 32 位整数。')
    if ((rule.trigger === undefined ? 'beforeDecision' : rule.trigger) !== 'beforeDecision') add(`${path}.trigger`, '仅支持 beforeDecision。')
    let target: unknown
    if (rule.target != null) {
      if (!object(rule.target)) add(`${path}.target`, '目标需要是对象。')
      else {
        known(rule.target, ['relation', 'selector', 'bind'], `${path}.target`)
        target = rule.target.bind === undefined ? 'target' : rule.target.bind
        if (!includes(RELATIONS, rule.target.relation === undefined ? 'enemy' : rule.target.relation) || !includes(SELECTORS, rule.target.selector === undefined ? 'lowestHpRatio' : rule.target.selector) || !named(target)) add(`${path}.target`, '目标关系、选择器或绑定无效。')
      }
    }
    if (!object(rule.action)) { add(`${path}.action`, '缺少动作对象。'); return }
    const action = rule.action
    known(action, ['type', 'skillId', 'itemId', 'target', 'movement', 'positionPreference', 'bindPlan', 'maxRisk', 'parameters'], `${path}.action`)
    if (!includes(ACTIONS, action.type) && !(named(action.type) && action.type.includes(':'))) add(`${path}.action.type`, '请选择内置动作，或填写宿主已注册的 module:name 扩展。')
    if (!includes(MOVEMENTS, action.movement === undefined ? 'ifNeeded' : action.movement)) add(`${path}.action.movement`, '未知移动策略。')
    if (!includes(POSITIONS, action.positionPreference === undefined ? 'current' : action.positionPreference)) add(`${path}.action.positionPreference`, '未知位置偏好。')
    if (action.target != null && action.target !== target) add(`${path}.action.target`, '动作引用了未定义的目标绑定。')
    if (action.type === 'castSkill' && action.skillId == null) add(`${path}.action.skillId`, '缺少技能 ID。')
    if (action.type === 'useItem' && action.itemId == null) add(`${path}.action.itemId`, '缺少物品 ID。')
    if (action.maxRisk != null && (typeof action.maxRisk !== 'number' || !Number.isFinite(action.maxRisk) || action.maxRisk < 0)) add(`${path}.action.maxRisk`, '风险上限必须是非负有限数。')
    optionalText(action.target, `${path}.action.target`)
    optionalText(action.bindPlan, `${path}.action.bindPlan`)
    id(action.skillId, `${path}.action.skillId`)
    id(action.itemId, `${path}.action.itemId`)
    parameters(action.parameters, `${path}.action.parameters`)
    condition(rule.when, target, action.bindPlan, `${path}.when`, 0)
  })
  function jsonDepth(value: unknown, depth: number): boolean {
    if (value === null || typeof value !== 'object') return false
    if (depth > 64) return true
    return Object.values(value).some(child => jsonDepth(child, depth + 1))
  }
  if (jsonDepth(config, 1)) add('$', 'JSON 对象与数组最多嵌套 64 层。')
  return errors
}

export function parseJson(json: string): unknown {
  // JSON.parse 会舍入大整数，导入前拒绝，避免静默改变技能或物品 ID。
  const tokens = json.match(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? []
  if (tokens.some(token => /^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token)))) throw new Error('JSON 包含超出浏览器精确整数范围的数值，原文未导入。')
  if (tokens.some(token => !token.startsWith('"') && !Number.isFinite(Number(token)))) throw new Error('JSON 包含浏览器无法表示的数值，原文未导入。')
  return JSON.parse(json) as unknown
}

export function parseConfig(json: string): DecisionTable {
  const value = parseJson(json)
  const errors = validate(value)
  if (errors.length) throw new Error(errors.map(error => `${error.path}：${error.message}`).join('\n'))
  const config = value as DecisionTable
  return { schemaVersion: 1, id: config.id, fallback: config.fallback ?? 'defaultAI', rules: (config.rules ?? []).map(rule => ({
    ...rule, enabled: rule.enabled ?? true, priority: rule.priority ?? 0, trigger: rule.trigger ?? 'beforeDecision',
    target: rule.target == null ? undefined : { ...rule.target, relation: rule.target.relation ?? 'enemy', selector: rule.target.selector ?? 'lowestHpRatio', bind: rule.target.bind ?? 'target' },
    when: rule.when ?? undefined,
    action: { ...rule.action, movement: rule.action.movement ?? 'ifNeeded', positionPreference: rule.action.positionPreference ?? 'current' },
  })) }
}

export function conditionSummary(condition?: Condition): string {
  if (!condition) return '始终尝试'
  if (condition.all) return condition.all.length ? condition.all.map(child => `(${conditionSummary(child)})`).join(' 且 ') : '始终成立'
  if (condition.any) return condition.any.length ? condition.any.map(child => `(${conditionSummary(child)})`).join(' 或 ') : '始终不成立'
  if (condition.not) return `非 (${conditionSummary(condition.not)})`
  const name = CONDITIONS.find(([key]) => key === condition.type)?.[1] ?? condition.type
  if (condition.type === 'skill.available') return `技能 ${condition.skillId ?? '?'} 可用`
  if (condition.type === 'target.exists') return `目标 ${condition.target ?? '?'} 存在`
  return `${name} ${COMPARISONS.find(([key]) => key === (condition.operator ?? 'atLeast'))?.[1]} ${condition.value ?? 0}`
}

export function template(kind: string, catalog: Catalog | null): DecisionTable {
  const config = emptyTable()
  if (kind === 'empty') return config
  if (kind === 'attack') {
    config.id = 'custom:attacker'
    config.rules = [newRule([])]
    config.rules[0].id = 'attack'
    config.rules[0].target = { relation: 'enemy', selector: 'lowestHpRatio', bind: 'enemy' }
    config.rules[0].action.target = 'enemy'
    return config
  }
  const heal = catalog?.skills.find(skill => skill.name === '回复弹')
  if (!heal) throw new Error('请连接模组目录后再载入治疗模板，或手动添加技能规则。')
  config.id = 'custom:healer'
  const rule = newRule([])
  rule.id = 'heal-patient'
  rule.priority = 100
  rule.target = { relation: 'ally', selector: 'lowestHpRatio', bind: 'patient' }
  rule.when = { all: [{ type: 'target.hpRatio', target: 'patient', operator: 'lessThan', value: 0.4 }, { type: 'skill.available', skillId: heal.id }] }
  rule.action = { type: 'castSkill', skillId: heal.id, target: 'patient', movement: 'ifNeeded', positionPreference: 'current' }
  config.rules = [rule]
  return config
}
