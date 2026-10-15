import { COMPARISONS, CONDITIONS, clone, leaf, type Condition, type Resource } from './model'
import { Field, Parameters, ResourceField, Select } from './Fields'

const FORMS = [['leaf', '数值 / 状态条件'], ['all', '全部满足 · AND'], ['any', '任一满足 · OR'], ['not', '条件取反 · NOT']] as const

export default function ConditionEditor({ value, onChange, target, plan, resources, depth = 0, onRemove, onParameterValidity }: {
  value: Condition; onChange: (value: Condition) => void; target?: string; plan?: string; resources: Resource[];
  depth?: number; onRemove?: () => void; onParameterValidity: (id: string, valid: boolean) => void
}) {
  const form = value.all ? 'all' : value.any ? 'any' : value.not ? 'not' : 'leaf'
  const type = value.type ?? 'self.hpRatio'
  const custom = !CONDITIONS.some(([key]) => key === type)
  const patch = (change: Partial<Condition>) => onChange({ ...value, ...change })
  const children = value.all ?? value.any
  return <div className={`dt-condition ${depth % 2 ? 'bg-white' : 'bg-rose-50/50'}`}>
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold text-rose-400">{depth === 0 ? '当' : '↳'}</span>
      <div className="min-w-0 flex-1"><Select label="条件形式" value={form} options={depth >= 16 ? FORMS.filter(([key]) => key === 'leaf') : FORMS} onChange={next => {
        if (next === 'leaf') onChange(leaf())
        else if (next === 'not') onChange({ not: clone(value) })
        else onChange(next === 'all' ? { all: [clone(value)] } : { any: [clone(value)] })
      }} /></div>
      {onRemove && <button className="dt-icon" onClick={onRemove} title="删除此条件" aria-label="删除此条件">×</button>}
    </div>
    {children && <div className="mt-3 space-y-2 border-l-2 border-rose-200 pl-3">
      {children.map((child, index) => <ConditionEditor key={index} value={child} target={target} plan={plan} resources={resources} depth={depth + 1}
        onParameterValidity={onParameterValidity}
        onChange={next => onChange({ [form]: children.map((entry, childIndex) => childIndex === index ? next : entry) })}
        onRemove={() => onChange({ [form]: children.filter((_, childIndex) => childIndex !== index) })} />)}
      {!children.length && <p className="text-xs text-slate-500">{form === 'all' ? '空 AND 始终成立。' : '空 OR 始终不成立。'}</p>}
      <button className="pp-btn" disabled={children.length >= 64 || depth >= 16} onClick={() => onChange({ [form]: [...children, leaf()] })}>＋ 添加子条件</button>
    </div>}
    {value.not && <div className="mt-3 border-l-2 border-rose-200 pl-3">
      <ConditionEditor value={value.not} onChange={next => onChange({ not: next })} target={target} plan={plan} resources={resources}
        depth={depth + 1} onParameterValidity={onParameterValidity} />
    </div>}
    {form === 'leaf' && <div className="mt-3 space-y-3">
      <Field label="条件项目"><Select label="条件项目" value={custom ? 'custom' : type} options={[...CONDITIONS, ['custom', '自定义扩展…']]} onChange={next => {
        const changed: Condition = { type: next === 'custom' ? 'custom:condition' : next, operator: 'atLeast', value: 0 }
        if (next.startsWith('target.') || next === 'distance') changed.target = target
        if (next.startsWith('plan.')) changed.target = plan
        if (next === 'skill.available') changed.skillId = resources[0]?.id
        onChange(changed)
      }} /></Field>
      {custom && <Field label="扩展条件标识" hint="需要由使用此配置的宿主注册。"><input className="dt-input" value={type} onChange={event => patch({ type: event.target.value })} /></Field>}
      {type === 'skill.available'
        ? <ResourceField kind="技能" value={value.skillId} resources={resources} onChange={skillId => patch({ skillId })} />
        : <>
          {(type.startsWith('target.') || type === 'distance' || type.startsWith('plan.')) && <Field label={type.startsWith('plan.') ? '引用方案绑定' : '引用目标绑定'}>
            <Select value={value.target ?? ''} options={[['', '请选择绑定'], ...((type.startsWith('plan.') ? plan : target) ? [[(type.startsWith('plan.') ? plan : target)!, (type.startsWith('plan.') ? plan : target)!] as const] : [])]}
              onChange={next => patch({ target: next || undefined })} />
          </Field>}
          {type !== 'target.exists' && <div className="grid grid-cols-2 gap-2">
            <Field label="比较方式"><Select value={value.operator ?? 'atLeast'} options={COMPARISONS} onChange={operator => patch({ operator })} /></Field>
            <Field label={type.endsWith('hpRatio') ? '比例（0～1）' : '比较值'}>
              <input className="dt-input" aria-label="条件比较值" type="number" step="any" value={value.value ?? 0} onChange={event => patch({ value: Number(event.target.value) })} />
            </Field>
          </div>}
        </>}
      {(type === 'distance' || type === 'plan.risk') && <p className="text-xs text-slate-500">此条件在无地图模式下不匹配。</p>}
      {custom && <Parameters value={value.parameters} onChange={parameters => patch({ parameters })} onValidityChange={onParameterValidity} />}
    </div>}
  </div>
}
