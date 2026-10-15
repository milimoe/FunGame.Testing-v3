import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ACTIONS, clone, conditionSummary, emptyTable, newRule, parseConfig, template, toJson, validate, type Catalog, type DecisionTable, type Validation } from './model'
import { Field, Select } from './Fields'
import RuleEditor from './RuleEditor'
import './editor.css'

const DRAFT_KEY = 'fungame.decision-table.v1'

function initialDraft(): { config: DecisionTable; message: string } {
  try {
    const saved = localStorage.getItem(DRAFT_KEY)
    return saved ? { config: parseConfig(saved), message: '已恢复本机草稿。' } : { config: emptyTable(), message: '' }
  } catch {
    return { config: emptyTable(), message: '本机草稿无法恢复，原内容暂未覆盖。可导入 JSON 继续编辑。' }
  }
}

export default function DecisionTablePanel() {
  const [initial] = useState(initialDraft)
  const [config, setConfig] = useState(initial.config)
  const [selected, setSelected] = useState(0)
  const [message, setMessage] = useState(initial.message)
  const [edited, setEdited] = useState(false)
  const [storageError, setStorageError] = useState('')
  const [invalidParameters, setInvalidParameters] = useState<Set<string>>(new Set())
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [catalogError, setCatalogError] = useState('')
  const [catalogRevision, setCatalogRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [checkResources, setCheckResources] = useState(true)
  const [checked, setChecked] = useState<{ json: string; resources: boolean; result: Validation } | null>(null)
  const [checkError, setCheckError] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const [templateKey, setTemplateKey] = useState('attack')
  const [preview, setPreview] = useState<'flow' | 'json'>('flow')
  const past = useRef<DecisionTable[]>([])
  const future = useRef<DecisionTable[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const json = useMemo(() => toJson(config), [config])
  const diagnostics = useMemo(() => validate(config), [config])
  const valid = diagnostics.length === 0 && invalidParameters.size === 0
  const active = config.rules[selected]
  const ordered = useMemo(() => config.rules.map((rule, index) => ({ rule, index }))
    .filter(entry => entry.rule.enabled).sort((a, b) => b.rule.priority - a.rule.priority || a.index - b.index), [config.rules])
  const currentCheck = valid && checked?.json === json && checked.resources === checkResources ? checked.result : null

  const parameterValidity = useCallback((id: string, isValid: boolean) => {
    setInvalidParameters(previous => {
      if (previous.has(id) === !isValid) return previous
      const next = new Set(previous)
      if (isValid) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  useEffect(() => {
    if (!edited) return
    if (!valid) return
    try { localStorage.setItem(DRAFT_KEY, json); setStorageError('') }
    catch { setStorageError('本机草稿保存失败，请下载 JSON 保留配置。') }
  }, [json, edited, valid])

  useEffect(() => {
    const controller = new AbortController()
    setCatalogError('')
    fetch('/api/gamedata', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json() as Catalog
      if (!Array.isArray(data.skills) || !Array.isArray(data.items)) throw new Error('资源目录格式无效')
      setCatalog({ skills: data.skills, items: data.items })
    }).catch(error => {
      if (!controller.signal.aborted) setCatalogError(error instanceof Error ? error.message : '目录连接失败')
    })
    return () => controller.abort()
  }, [catalogRevision])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (edited && (!valid || storageError)) event.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [edited, valid, storageError])

  function change(next: DecisionTable) {
    past.current = [...past.current.slice(-49), clone(config)]
    future.current = []
    setConfig(next); setEdited(true); setMessage(''); setCheckError('')
  }
  function travel(undo: boolean) {
    const source = undo ? past : future
    const destination = undo ? future : past
    const next = source.current.pop()
    if (!next) return
    destination.current.push(clone(config))
    setSelected(0); setConfig(next); setEdited(true); setMessage(undo ? '已撤销。' : '已重做。')
  }
  function addRule() {
    const rule = newRule(config.rules)
    change({ ...config, rules: [...config.rules, rule] }); setSelected(config.rules.length)
  }
  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= config.rules.length) return
    const rules = [...config.rules]
    ;[rules[index], rules[target]] = [rules[target], rules[index]]
    change({ ...config, rules }); setSelected(target)
  }
  function importConfig(text: string) {
    try {
      const next = parseConfig(text)
      change(next); setSelected(0); setImportOpen(false); setImportError(''); setMessage('已导入配置，可撤销此操作。')
    } catch (error) { setImportError(error instanceof Error ? error.message : '导入失败。') }
  }
  async function checkCore() {
    setBusy(true); setCheckError('')
    try {
      const response = await fetch('/api/decision-tables/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json, checkResources }) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const result = await response.json() as Validation
      if (typeof result.valid !== 'boolean' || !Array.isArray(result.diagnostics)) throw new Error('校验响应格式无效')
      setChecked({ json, resources: checkResources, result })
    } catch (error) { setCheckError(`未完成 Core 校验：${error instanceof Error ? error.message : '连接失败'}。本地编辑与导出仍可使用。`) }
    finally { setBusy(false) }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([json + '\n'], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = `${config.id.replace(/[^\p{L}\p{N}_-]/gu, '-') || 'decision-table'}.json`
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('已导出 JSON。配置需由宿主加载并绑定角色后生效。')
  }

  return <div className="pp-shell px-4 py-6 lg:px-7">
    <div className="mx-auto max-w-[1600px]">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-[11px] font-semibold tracking-[0.24em] text-rose-400">FUNGAME · STRATEGY STUDIO</p>
          <h1 className="mt-1 text-2xl font-black text-slate-800">决策表编辑器</h1>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">编排行动优先级，为角色定义“何时、对谁、做什么”。规则无法执行时继续匹配，全部未命中时使用回退行为。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="pp-btn" onClick={() => travel(true)} disabled={!past.current.length}>撤销</button>
          <button className="pp-btn" onClick={() => travel(false)} disabled={!future.current.length}>重做</button>
          <button className="pp-btn" onClick={() => { setImportOpen(!importOpen); setImportError('') }}>导入 JSON</button>
          <button className="pp-btn-primary" onClick={download} disabled={!valid}>下载 JSON</button>
        </div>
      </header>

      <section className="pp-card mb-4 p-4">
        <div className="grid items-end gap-4 md:grid-cols-[minmax(180px,1fr)_minmax(150px,0.7fr)_auto]">
          <Field label="策略 ID" hint="例如 mymod:boss；由角色的 DecisionTableId 引用。"><input className="dt-input" aria-label="策略 ID" value={config.id} onChange={event => change({ ...config, id: event.target.value })} /></Field>
          <Field label="全部未命中时"><Select label="回退行为" value={config.fallback} options={[[ 'defaultAI', '交给默认 AI'], ['endTurn', '结束回合']]} onChange={fallback => change({ ...config, fallback })} /></Field>
          <div className="flex flex-wrap items-center gap-2 pb-1">
            <span className="dt-pill">协议 v{config.schemaVersion}</span><span className="dt-pill">行动决策前</span>
            <span className="text-xs text-slate-400">{edited ? valid && !storageError ? '草稿自动保存在本机' : '修正后自动保存' : initial.message ? '本机草稿' : '新建配置'}</span>
          </div>
        </div>
      </section>

      {message && <p role="status" className="mb-3 rounded-lg bg-rose-100/70 px-4 py-2 text-xs text-rose-700">{message}</p>}
      {storageError && <p role="alert" className="mb-3 text-xs text-red-600">{storageError}</p>}
      {importOpen && <section className="pp-card mb-4 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold">导入配置</h2>
          <button className="pp-btn" onClick={() => fileInput.current?.click()}>选择 JSON 文件</button></div>
        <input ref={fileInput} className="hidden" aria-label="导入配置文件" type="file" accept=".json,application/json" onChange={async event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          try { const text = await file.text(); setImportText(text); importConfig(text) }
          catch { setImportError('文件读取失败，请粘贴 JSON 重试。') }
        }} />
        <textarea aria-label="导入 JSON 文本" className="dt-input min-h-44 font-mono text-xs" placeholder="粘贴 Core 决策表 JSON…" value={importText} onChange={event => setImportText(event.target.value)} />
        {importError && <p role="alert" className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-red-600">{importError}</p>}
        <div className="mt-3 flex items-center gap-3"><button className="pp-btn-primary" onClick={() => importConfig(importText)}>导入并替换草稿</button>
          <span className="text-xs text-slate-400">导入失败会保留当前配置；成功后可撤销。</span></div>
      </section>}

      <div className="dt-workspace">
        <aside className="min-w-0 space-y-4">
          <section className="pp-card overflow-hidden">
            <div className="dt-card-heading"><h2>规则列表 <span className="font-normal text-slate-400">{config.rules.length}/256</span></h2>
              <button className="pp-btn" onClick={addRule} disabled={config.rules.length >= 256}>＋ 添加</button></div>
            <p className="px-4 py-3 text-[11px] leading-5 text-slate-400">优先级高的先匹配；同级按列表顺序。箭头调整配置顺序。</p>
            <div className="max-h-[65vh] space-y-1 overflow-auto px-2 pb-3">
              {config.rules.map((rule, index) => <div key={index} className={`dt-rule-row ${index === selected ? 'dt-rule-selected' : ''}`}>
                <button className="min-w-0 flex-1 p-2 text-left" onClick={() => setSelected(index)} aria-pressed={index === selected}>
                  <div className="flex items-center gap-2"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${rule.enabled ? 'bg-rose-400' : 'bg-slate-300'}`} />
                    <span className="truncate text-xs font-bold">{rule.id || '未命名规则'}</span></div>
                  <div className="mt-1 flex gap-2 pl-3.5 text-[10px] text-slate-400"><span>优先级 {rule.priority}</span><span>{rule.enabled ? '启用' : '停用'}</span></div>
                </button>
                <div className="flex shrink-0 flex-col pr-1">
                  <button className="dt-icon" aria-label={`上移规则 ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                  <button className="dt-icon" aria-label={`下移规则 ${index + 1}`} disabled={index === config.rules.length - 1} onClick={() => move(index, 1)}>↓</button>
                </div>
              </div>)}
              {!config.rules.length && <div className="px-3 py-8 text-center text-xs leading-6 text-slate-400">还没有规则。<br />添加第一条，或从模板开始。</div>}
            </div>
          </section>
          <section className="pp-card space-y-3 p-4"><h2 className="text-xs font-bold">从模板开始</h2>
            <Select label="配置模板" value={templateKey} options={[[ 'attack', '低血目标优先攻击'], ['healer', '优先治疗受伤友军'], ['empty', '空白决策表']]} onChange={setTemplateKey} />
            <button className="pp-btn w-full" onClick={() => {
              try { change(template(templateKey, catalog)); setSelected(0); setMessage('已载入模板，可撤销。') }
              catch (error) { setMessage(error instanceof Error ? error.message : '模板载入失败。') }
            }}>载入模板</button>
            <p className="text-[11px] leading-5 text-slate-400">模板会替换当前草稿。治疗模板使用当前模组的回复弹。</p>
          </section>
          <section className="pp-card p-4 text-xs"><h2 className="mb-2 font-bold">模组资源</h2>
            {catalog ? <p className="text-emerald-700">{catalog.skills.length} 个技能 · {catalog.items.length} 个物品</p> : <p className="text-slate-500">{catalogError ? '目录未连接，可手动填写 ID。' : '正在连接模组目录…'}</p>}
            {catalogError && <button className="pp-btn mt-2" onClick={() => setCatalogRevision(value => value + 1)}>重新连接目录</button>}
          </section>
        </aside>

        <section className="pp-card min-w-0 self-start overflow-hidden">
          <div className="dt-card-heading"><h2>编辑规则 {active ? `· ${selected + 1}` : ''}</h2>
            {active && <div className="flex flex-wrap items-center gap-2">
              <label className="dt-check"><input type="checkbox" checked={active.enabled} onChange={event => change({ ...config, rules: config.rules.map((rule, index) => index === selected ? { ...rule, enabled: event.target.checked } : rule) })} />启用</label>
              <button className="pp-btn" disabled={config.rules.length >= 256} onClick={() => {
                const duplicate = { ...clone(active), id: newRule(config.rules).id }
                const rules = [...config.rules]; rules.splice(selected + 1, 0, duplicate)
                change({ ...config, rules }); setSelected(selected + 1)
              }}>复制</button>
              <button className="pp-btn" onClick={() => { change({ ...config, rules: config.rules.filter((_, index) => index !== selected) }); setSelected(Math.max(0, selected - 1)) }}>删除</button>
            </div>}
          </div>
          <div className="p-4 lg:p-5">{active
            ? <RuleEditor key={selected} rule={active} catalog={catalog} onParameterValidity={parameterValidity}
              onChange={next => change({ ...config, rules: config.rules.map((rule, index) => index === selected ? next : rule) })} />
            : <div className="py-16 text-center"><div className="text-3xl text-rose-300">◇</div><h3 className="mt-4 text-base font-bold">从一条行动规则开始</h3>
              <p className="mx-auto mt-2 max-w-xs text-xs leading-6 text-slate-400">先选目标与动作，再添加条件。也可以保留空表，直接使用回退行为。</p>
              <button className="pp-btn-primary mt-5" onClick={addRule}>＋ 添加第一条规则</button></div>}
          </div>
        </section>

        <aside className="dt-preview min-w-0 space-y-4">
          <section className="pp-card overflow-hidden">
            <div className="dt-card-heading"><h2>配置预览</h2><div className="flex gap-1">
              <button className={`dt-tab ${preview === 'flow' ? 'dt-tab-active' : ''}`} onClick={() => setPreview('flow')}>匹配顺序</button>
              <button className={`dt-tab ${preview === 'json' ? 'dt-tab-active' : ''}`} onClick={() => setPreview('json')}>JSON</button>
            </div></div>
            {preview === 'json' ? <div className="p-3"><textarea readOnly aria-label="JSON 预览" className="dt-input min-h-[420px] font-mono text-[11px]" value={json} />
              <button className="pp-btn mt-2" disabled={!valid} onClick={async () => {
                try { await navigator.clipboard.writeText(json); setMessage('JSON 已复制。') }
                catch { setMessage('无法访问剪贴板，请在 JSON 预览中手动复制。') }
              }}>复制 JSON</button></div>
              : <div className="p-4"><p className="mb-3 text-[11px] leading-5 text-slate-400">展示启用规则的实际匹配顺序，不执行战斗模拟。</p>
                <ol className="space-y-3">{ordered.map(({ rule, index }, rank) => <li key={index}>
                  <button className="dt-flow-item" onClick={() => setSelected(index)}>
                    <span className="dt-flow-number">{rank + 1}</span><span className="min-w-0"><strong className="block truncate text-xs">{rule.id || '未命名'}</strong>
                      <span className="mt-1 block text-[11px] leading-5 text-slate-500">{conditionSummary(rule.when)}</span>
                      <span className="mt-1 block text-xs font-medium text-rose-600">→ {ACTIONS.find(([key]) => key === rule.action.type)?.[1] ?? rule.action.type}</span></span>
                  </button>
                </li>)}</ol>
                <div className="mt-4 rounded-lg border border-dashed border-rose-200 bg-rose-50 p-3 text-xs text-slate-500">全部未命中 → <b className="text-rose-600">{config.fallback === 'endTurn' ? '结束回合' : '默认 AI'}</b></div>
              </div>}
          </section>

          <section className="pp-card p-4">
            <div className="flex items-center justify-between gap-2"><h2 className="text-xs font-bold">配置校验</h2><span className={`text-[11px] ${valid ? 'text-emerald-700' : 'text-red-600'}`}>{valid ? '本地结构通过' : `${diagnostics.length + invalidParameters.size} 项待修正`}</span></div>
            {!valid && <ul className="mt-3 max-h-64 space-y-2 overflow-auto text-xs text-red-600">{diagnostics.map((error, index) => <li key={index}>
              <button className="text-left" onClick={() => { const match = /^rules\[(\d+)\]/.exec(error.path); if (match) setSelected(Number(match[1])) }}>
                <code className="break-all text-[10px]">{error.path}</code><span className="block">{error.message}</span>
              </button></li>)}{invalidParameters.size > 0 && <li>扩展参数尚未形成有效 JSON 对象，请修正后导出。</li>}</ul>}
            <label className="dt-check mt-4"><input type="checkbox" checked={checkResources} onChange={event => setCheckResources(event.target.checked)} />按当前模组校验资源 ID</label>
            <button className="pp-btn mt-3 w-full" disabled={!valid || busy} onClick={checkCore}>{busy ? 'Core 校验中…' : '使用 Core 校验'}</button>
            {currentCheck && <div role="status" className={`mt-3 text-xs ${currentCheck.valid ? 'text-emerald-700' : 'text-red-600'}`}>
              {currentCheck.valid ? `当前配置通过 Core 编译${checkResources ? '及模组资源校验' : '校验'}。` : 'Core 校验未通过：'}
              {currentCheck.diagnostics.map((error, index) => <p key={index} className="mt-2 break-words"><code>{error.path}</code>：{error.message}</p>)}
            </div>}
            {checked && !currentCheck && <p className="mt-2 text-xs text-amber-700">配置或校验选项已修改，请重新校验。</p>}
            {checkError && <p role="alert" className="mt-2 text-xs leading-5 text-amber-700">{checkError}</p>}
            <p className="mt-3 text-[11px] leading-5 text-slate-400">本地检查结构与绑定；Core 检查真实协议及已注册内容。自定义扩展需在宿主注册。</p>
          </section>
          <p className="px-1 text-[11px] leading-5 text-slate-400">导出配置不会自动应用到对局。由宿主通过 Loader 加载，并绑定到角色的 DecisionTableId 后生效。</p>
        </aside>
      </div>
    </div>
  </div>
}
