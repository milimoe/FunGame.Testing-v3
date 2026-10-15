import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/decisiontable/model.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { emptyTable, leaf, newRule, parseConfig, parseJson, renameReferences, template, toJson, validate } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const catalog = { skills: [{ id: 2025, name: '回复弹', description: '' }], items: [] }
const tableWith = condition => ({ ...emptyTable(), rules: [{ ...newRule([]), when: condition }] })

test('导入省略默认字段的 Core 配置，补齐编辑值并可往返', () => {
  const minimal = parseConfig('{"id":"test:minimal"}')
  assert.deepEqual(minimal, { ...emptyTable(), id: 'test:minimal' })
  const config = parseConfig('{"id":"test:minimal","rules":[{"id":"one","action":{"type":"normalAttack"}}]}')
  assert.equal(config.rules[0].enabled, true)
  assert.equal(config.rules[0].action.movement, 'ifNeeded')
  assert.deepEqual(parseConfig(toJson(config)), config)
})

test('实际模组治疗模板保留绑定、优先级、条件和技能引用', () => {
  const config = template('healer', catalog)
  assert.deepEqual(validate(config), [])
  const restored = parseConfig(toJson(config))
  assert.equal(restored.rules[0].action.skillId, 2025)
  assert.equal(restored.rules[0].when.all[0].target, 'patient')
  assert.equal(restored.rules[0].priority, 100)
})

test('显式 null 不冒充省略字段，未知字段不被静默丢弃', () => {
  for (const field of ['schemaVersion', 'fallback', 'rules']) assert.throws(() => parseConfig(JSON.stringify({ ...emptyTable(), [field]: null })))
  for (const field of ['priority', 'enabled', 'trigger']) {
    const config = tableWith(leaf())
    config.rules[0][field] = null
    assert.notEqual(validate(config).length, 0)
  }
  assert.throws(() => parseConfig('{"id":"test:bad","rulez":[]}'), /未知字段/)
  const config = tableWith(leaf())
  config.rules[0].when.value = null
  assert.notEqual(validate(config).length, 0)
})

test('规则 256/257 边界与重复 ID', () => {
  const config = emptyTable()
  for (let index = 0; index < 256; index++) config.rules.push(newRule(config.rules))
  assert.deepEqual(validate(config), [])
  config.rules.push(newRule(config.rules))
  assert.ok(validate(config).some(error => error.path === 'rules'))
  config.rules.pop()
  config.rules[1].id = config.rules[0].id
  assert.ok(validate(config).some(error => error.path === 'rules[1].id'))
})

test('AND/OR 的 64/65 子条件与深度 16/17 分开校验', () => {
  for (const form of ['all', 'any']) {
    assert.deepEqual(validate(tableWith({ [form]: Array.from({ length: 64 }, leaf) })), [])
    assert.ok(validate(tableWith({ [form]: Array.from({ length: 65 }, leaf) })).some(error => /64/.test(error.message)))
  }
  let condition = leaf()
  for (let depth = 0; depth < 16; depth++) condition = { not: condition }
  assert.deepEqual(validate(tableWith(condition)), [])
  assert.ok(validate(tableWith({ not: condition })).some(error => /嵌套 16/.test(error.message)))
})

test('JSON 参数深度 64/65 独立于条件嵌套', () => {
  for (const depth of [64, 65]) {
    let nested = 0
    for (let level = 0; level < depth - 5; level++) nested = [nested]
    const config = tableWith(undefined)
    config.rules[0].action.parameters = { nested }
    assert.equal(validate(config).some(error => /JSON.*64/.test(error.message)), depth === 65)
  }
})

test('目标、方案绑定与资源引用各自定位诊断', () => {
  const config = tableWith({ type: 'target.hpRatio', target: 'missing', value: .3 })
  config.rules[0].action.type = 'castSkill'
  assert.ok(validate(config).some(error => error.path.endsWith('.skillId')))
  assert.ok(validate(config).some(error => error.path.endsWith('.when.target')))
  config.rules[0].when = { type: 'plan.risk', target: 'missing' }
  assert.ok(validate(config).some(error => error.path.endsWith('.when.target')))
})

test('扩展参数与自定义标识导入导出保留', () => {
  const config = tableWith({ type: 'demo:condition', parameters: { enabled: true, tree: [1, 'x'] } })
  config.rules[0].action.type = 'demo:action'
  config.rules[0].action.parameters = { multiplier: 1.2 }
  const result = parseConfig(toJson(config))
  assert.deepEqual(result.rules[0].when.parameters, config.rules[0].when.parameters)
  assert.deepEqual(result.rules[0].action.parameters, { multiplier: 1.2 })
})

test('目标与方案同名时，改名只更新对应命名空间的嵌套引用', () => {
  const condition = { any: [{ not: { type: 'target.exists', target: 'shared' } }, { type: 'plan.risk', target: 'shared' }] }
  const renamedTarget = renameReferences(condition, 'shared', 'patient', 'target')
  assert.equal(renamedTarget.any[0].not.target, 'patient')
  assert.equal(renamedTarget.any[1].target, 'shared')
  const renamedPlan = renameReferences(condition, 'shared', 'safe-plan', 'plan')
  assert.equal(renamedPlan.any[0].not.target, 'shared')
  assert.equal(renamedPlan.any[1].target, 'safe-plan')
})

test('不静默舍入大整数、不把 Infinity 写成 null，字符串保持原样', () => {
  assert.throws(() => parseJson('{"skillId":9223372036854775807}'), /精确整数/)
  assert.throws(() => parseJson('{"param":1e999}'), /无法表示/)
  assert.deepEqual(parseJson('{"text":"9223372036854775807"}'), { text: '9223372036854775807' })
  const config = tableWith(undefined)
  config.rules[0].action.skillId = Number.MAX_SAFE_INTEGER + 1
  assert.ok(validate(config).some(error => error.path.endsWith('skillId')))
})

const api = process.env.DECISION_TABLE_API
test('HTTP Core 编译编辑器导出，并诊断真实资源、语义边界和未知扩展', { skip: !api }, async () => {
  const definitions = await fetch(`${api}/api/gamedata`).then(response => response.json())
  const check = async (config, checkResources = true) => {
    const response = await fetch(`${api}/api/decision-tables/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ json: typeof config === 'string' ? config : toJson(config), checkResources }) })
    assert.equal(response.status, 200)
    return response.json()
  }
  for (const kind of ['empty', 'attack', 'healer']) assert.equal((await check(parseConfig(toJson(template(kind, definitions))))).valid, true)
  const unknown = template('healer', definitions)
  unknown.rules[0].action.skillId = 2147483647
  assert.equal((await check(unknown)).valid, false)
  assert.equal((await check(unknown, false)).valid, true)
  const depth = tableWith(leaf())
  for (let index = 0; index < 17; index++) depth.rules[0].when = { not: depth.rules[0].when }
  assert.equal((await check(depth)).valid, false)
  assert.equal((await check('{"id":"test:null","rules":null}')).valid, false)
  assert.equal((await check('{')).valid, false)
  assert.equal((await check('{"id":"test:unknown","extra":1}')).valid, false)
  const custom = tableWith({ type: 'test:unregistered' })
  assert.equal((await check(custom)).valid, false)
})
