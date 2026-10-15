import { ACTIONS, MOVEMENTS, POSITIONS, RELATIONS, SELECTORS, leaf, renameReferences, type Catalog, type Rule } from './model'
import { Field, Parameters, ResourceField, Select } from './Fields'
import ConditionEditor from './ConditionEditor'

export default function RuleEditor({ rule, onChange, catalog, onParameterValidity }: {
  rule: Rule; onChange: (rule: Rule) => void; catalog: Catalog | null; onParameterValidity: (id: string, valid: boolean) => void
}) {
  const custom = !ACTIONS.some(([key]) => key === rule.action.type)
  const action = (patch: Partial<Rule['action']>) => onChange({ ...rule, action: { ...rule.action, ...patch } })
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
      <Field label="规则 ID"><input className="dt-input" aria-label="规则 ID" value={rule.id} onChange={event => onChange({ ...rule, id: event.target.value })} /></Field>
      <Field label="优先级"><input className="dt-input" aria-label="规则优先级" type="number" step="1" value={rule.priority} onChange={event => onChange({ ...rule, priority: Number(event.target.value) })} /></Field>
    </div>
    <section className="space-y-3">
      <div className="dt-section-title"><h3>选取目标</h3><label className="dt-check"><input type="checkbox" checked={!!rule.target} onChange={event => onChange({ ...rule,
        target: event.target.checked ? { relation: 'enemy', selector: 'lowestHpRatio', bind: 'target' } : undefined,
        action: { ...rule.action, target: undefined } })} />绑定目标</label></div>
      {rule.target ? <div className="grid gap-3 sm:grid-cols-2">
        <Field label="目标关系"><Select value={rule.target.relation} options={RELATIONS} onChange={relation => onChange({ ...rule, target: { ...rule.target!, relation } })} /></Field>
        <Field label="选择顺序"><Select value={rule.target.selector} options={SELECTORS} onChange={selector => onChange({ ...rule, target: { ...rule.target!, selector } })} /></Field>
        <Field label="目标绑定名" hint="条件与动作通过此名称引用同一个目标。"><input className="dt-input" aria-label="目标绑定名" value={rule.target.bind} onChange={event => {
          const bind = event.target.value
          onChange({ ...rule, target: { ...rule.target!, bind }, when: renameReferences(rule.when, rule.target!.bind, bind, 'target'),
            action: { ...rule.action, target: rule.action.target === rule.target!.bind ? bind : rule.action.target } })
        }} /></Field>
      </div> : <p className="text-xs text-slate-500">由动作规划器从合法目标中选择。</p>}
    </section>
    <section className="space-y-3">
      <div className="dt-section-title"><h3>执行动作</h3><span>然后</span></div>
      <Field label="动作类型"><Select label="动作类型" value={custom ? 'custom' : rule.action.type} options={[...ACTIONS, ['custom', '自定义扩展…']]} onChange={next => action({
        type: next === 'custom' ? 'custom:action' : next,
        skillId: next === 'castSkill' ? rule.action.skillId : undefined, itemId: next === 'useItem' ? rule.action.itemId : undefined,
        movement: next === 'endTurn' ? 'never' : rule.action.movement,
      })} /></Field>
      {custom && <Field label="扩展动作标识" hint="需要由使用此配置的宿主注册。"><input className="dt-input" value={rule.action.type} onChange={event => action({ type: event.target.value })} /></Field>}
      {rule.action.type === 'castSkill' && <ResourceField kind="技能" value={rule.action.skillId} resources={catalog?.skills ?? []} onChange={skillId => action({ skillId })} />}
      {rule.action.type === 'useItem' && <ResourceField kind="物品" value={rule.action.itemId} resources={catalog?.items ?? []} onChange={itemId => action({ itemId })} />}
      {rule.action.type !== 'endTurn' && <>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="引用目标"><Select value={rule.action.target ?? ''} options={[['', '由规划器选择'], ...(rule.target ? [[rule.target.bind, rule.target.bind] as const] : [])]}
            onChange={target => action({ target: target || undefined })} /></Field>
          <Field label="移动策略"><Select value={rule.action.movement} options={MOVEMENTS} onChange={movement => action({ movement })} /></Field>
          <Field label="位置偏好"><Select value={rule.action.positionPreference} options={POSITIONS} onChange={positionPreference => action({ positionPreference })} /></Field>
          <Field label="风险上限" hint="留空表示不限；风险是可威胁该位置的敌人数。"><input className="dt-input" aria-label="风险上限" type="number" min="0" step="any" value={rule.action.maxRisk ?? ''}
            onChange={event => action({ maxRisk: event.target.value === '' ? undefined : Number(event.target.value) })} /></Field>
        </div>
        <p className="text-xs leading-5 text-slate-500">协同申请始终在原地规划；需要移动的规则无法执行时会继续匹配后续规则。安全偏好不保证吟唱不会被打断。</p>
      </>}
      <Field label="方案绑定名（可选）" hint="在条件中引用此方案的目标数量或位置风险。"><input className="dt-input" aria-label="方案绑定名" placeholder="例如 plan" value={rule.action.bindPlan ?? ''} onChange={event => {
        const bindPlan = event.target.value || undefined
        onChange({ ...rule, action: { ...rule.action, bindPlan }, when: rule.action.bindPlan ? renameReferences(rule.when, rule.action.bindPlan, bindPlan ?? '', 'plan') : rule.when })
      }} /></Field>
      <Parameters value={rule.action.parameters} onChange={parameters => action({ parameters })} onValidityChange={onParameterValidity} />
    </section>
    <section className="space-y-3">
      <div className="dt-section-title"><h3>匹配条件</h3>{!rule.when && <button className="pp-btn" onClick={() => onChange({ ...rule, when: leaf() })}>＋ 添加条件</button>}</div>
      {rule.when ? <div className="overflow-x-auto"><ConditionEditor value={rule.when} onChange={when => onChange({ ...rule, when })} onRemove={() => onChange({ ...rule, when: undefined })}
        target={rule.target?.bind} plan={rule.action.bindPlan} resources={catalog?.skills ?? []} onParameterValidity={onParameterValidity} /></div>
        : <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">无条件尝试，仍需形成合法行动。无法执行时继续匹配下一条规则。</p>}
    </section>
  </div>
}
