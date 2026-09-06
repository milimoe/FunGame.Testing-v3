import { useEffect, useMemo, useState } from 'react'
import { talentById, subById, classById } from '../classplanner/content'
import {
  activateTalent,
  changeLevel,
  clearRoleTypes,
  downgradeClass,
  learnSkill,
  learnTalent,
  removeClass,
  resetPlan,
  selectClass,
  selectRoleTypes,
  unlearnSkill,
  upgradeClass,
  validate,
  type PlanAction,
} from '../classplanner/engine'
import { CLASSES, SUBCLASSES, SKILLS, TALENTS, REWARD_TABLE, SKILL_CAP } from '../classplanner/content'
import {
  ROLE_META,
  RULES,
  classPointsForLevel,
  emptyPlan,
  roleLabel,
  type PlanState,
  type RoleType,
  type SkillDef,
} from '../classplanner/types'
import { candidatesOf, roleTypesOfPlan } from '../classplanner/content'

// 调用方保证传入非 None（候选/已选列表均已过滤）
function roleMeta(r: RoleType): (typeof ROLE_META)[Exclude<RoleType, 'None'>] {
  return ROLE_META[r as Exclude<RoleType, 'None'>]
}

function skillLevelOf(plan: PlanState, classLevel: number, skill: SkillDef): { base: number; buffed: number } {
  let base = 1
  for (let lv = 2; lv <= classLevel; lv++) {
    const r = REWARD_TABLE.find(x => x.level === lv)
    if (!r) continue
    base += r.skillLevelUp
    if (skill.skillType === 'Magic') base += r.magicExtra
  }
  const cap = SKILL_CAP[skill.skillType as keyof typeof SKILL_CAP] ?? 6
  base = Math.min(base, cap)
  const coreBuff = plan.activeTalentRole === 'Core' && skill.skillType !== 'Passive'
  return { base, buffed: base + (coreBuff ? 1 : 0) }
}

const STEPS = ['① 选择职业', '② 选择定位', '③ 选择天赋', '④ 完成']

// 职业点数获取等级（含 60 满级档），− / + 在此之间跳转
const POINT_LEVELS = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]

export default function ClassPlannerPanel() {
  // 干净的初始角色：1 级、1 职业点、无任何规划
  const [plan, setPlan] = useState<PlanState>(() => emptyPlan(1))
  const [step, setStep] = useState(0)
  const [pendingRoles, setPendingRoles] = useState<RoleType[]>([])
  const [rolesConfirmed, setRolesConfirmed] = useState(false)
  const [lvText, setLvText] = useState('1')
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    setLvText(String(plan.level))
  }, [plan.level])

  const act = (r: PlanAction) => {
    if (r.ok) setPlan(r.state)
    setToast({ msg: r.msg, ok: r.ok })
    window.setTimeout(() => setToast(null), 2400)
  }
  const selectedRoles = roleTypesOfPlan(plan)
  const candidates = candidatesOf(plan)
  const validation = useMemo(() => validate(plan), [plan])
  const totalPoints = classPointsForLevel(plan.level)
  const rolesLocked = rolesConfirmed && selectedRoles.length > 0

  const applyLevel = (level: number) => {
    const c = Math.min(60, Math.max(1, Math.round(level)))
    if (c === plan.level) return
    const r = changeLevel(plan, c)
    setPlan(r.state)
    setLvText(String(c))
    setToast({ msg: r.msg, ok: true })
    window.setTimeout(() => setToast(null), 2000)
  }
  // − / +：跳转到上一个 / 下一个职业点数获取等级
  const jumpLevel = (delta: number) => {
    const ordered = delta > 0 ? POINT_LEVELS.find(l => l > plan.level) : [...POINT_LEVELS].reverse().find(l => l < plan.level)
    if (ordered === undefined) {
      setToast({ msg: delta > 0 ? '已达 60 级上限' : '已达 1 级', ok: false })
      window.setTimeout(() => setToast(null), 1600)
      return
    }
    applyLevel(ordered)
  }
  const commitLvInput = () => {
    const v = Number(lvText)
    if (!Number.isFinite(v)) {
      setLvText(String(plan.level))
      return
    }
    applyLevel(v)
  }

  const stepEnabled = (): { next: boolean; hint: string } => {
    if (step === 0) return Object.keys(plan.classes).length > 0
      ? { next: true, hint: '' }
      : { next: false, hint: '请先选择一个职业与流派' }
    if (step === 1) return selectedRoles.length > 0
      ? { next: true, hint: '' }
      : { next: false, hint: '请确认至少一个定位' }
    if (step === 2) {
      const ok = selectedRoles.length > 0 && selectedRoles.every(r => plan.learnedTalents[r] !== undefined)
      return ok ? { next: true, hint: '' } : { next: false, hint: '请为每个定位学习一个战斗天赋' }
    }
    return { next: false, hint: '' }
  }

  const goNext = () => {
    const en = stepEnabled()
    if (!en.next) {
      toastFlash(en.hint, false)
      return
    }
    setStep(s => Math.min(3, s + 1))
  }
  const toastFlash = (msg: string, ok: boolean) => {
    setToast({ msg, ok })
    window.setTimeout(() => setToast(null), 2200)
  }

  const newPlan = () => {
    setPlan(emptyPlan(1))
    setPendingRoles([])
    setStep(0)
    toastFlash('已创建干净的新角色（1 级 · 1 职业点）。', true)
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ ...plan, validation: validation.errors }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'class-plan.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const coreTalent = talentById(plan.learnedTalents.Core)
  const coreActive = plan.activeTalentRole === 'Core' && !!coreTalent?.isCoreBuff

  const rolePick = (r: RoleType) => {
    const next = pendingRoles.includes(r) ? pendingRoles.filter(x => x !== r) : [...pendingRoles, r]
    if (next.length > 3) {
      toastFlash('角色至多拥有 3 个定位。', false)
      setPendingRoles(next.slice(0, 3))
      return
    }
    setPendingRoles(next)
  }

  // 提交定位（顺序 = 勾选顺序 → 第 1/2/3 定位）；成功后写入角色并锁定，直到撤销
  const submitRoles = () => {
    const rs = pendingRoles.filter((x, i, a) => x !== 'None' && a.indexOf(x) === i)
    const r = selectRoleTypes(plan, rs)
    if (r.ok) {
      setPlan(r.state) // 关键：把确认结果写入角色（三个定位），否则界面会保持空白
      setRolesConfirmed(true)
    }
    setPendingRoles([])
    setToast({ msg: r.msg, ok: r.ok })
    window.setTimeout(() => setToast(null), 2400)
  }
  // 撤销已确认的定位：清空后把原定位预填回待选，便于调整顺序
  const revokeRoles = () => {
    const r = clearRoleTypes(plan)
    if (r.ok) {
      setPlan(r.state)
      setPendingRoles(selectedRoles)
    }
    setRolesConfirmed(false)
    setToast({ msg: r.ok ? '已解锁定位，可重新排列顺序。' : r.msg, ok: r.ok })
    window.setTimeout(() => setToast(null), 2400)
  }

  return (
    <div className="pp-shell p-4 lg:px-8 lg:py-6">
      {/* 顶栏：标题 + 等级与洗点（角色级操作） */}
      <header className="mx-auto mb-4 flex max-w-3xl flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-rose-500 lg:text-2xl">⚔️ 职业规划向导</h1>
          <p className="pp-note mt-0.5">按步骤完成构筑 · 内核 ClassPlanner 语义复刻</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="pp-note flex items-center gap-1">
            角色 Lv
            <input
              type="number" min={1} max={60}
              value={lvText}
              onChange={e => setLvText(e.target.value)}
              onBlur={commitLvInput}
              onKeyDown={e => e.key === 'Enter' && commitLvInput()}
              className="w-14 rounded-lg border border-rose-200 px-1.5 py-0.5 text-center text-sm font-bold text-rose-500 outline-none focus:border-rose-400"
            />
            <button className="pp-btn !px-2 !py-0.5" title="跳到上一个职业点获取等级" onClick={() => jumpLevel(-1)}>−</button>
            <button className="pp-btn !px-2 !py-0.5" title="跳到下一个职业点获取等级" onClick={() => jumpLevel(1)}>+</button>
            <span className="ml-1">· 职业点 {plan.classPoints} / {totalPoints}</span>
          </span>
          <button className="pp-btn" onClick={() => { act(resetPlan(plan)); setPendingRoles([]); setRolesConfirmed(false); setStep(0) }}>洗点</button>
        </div>
      </header>

      {/* 步骤指示 */}
      <nav className="mx-auto mb-4 flex max-w-3xl items-center justify-between">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <button
              onClick={() => i < step && setStep(i)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                i === step ? 'bg-rose-500 text-white' : i < step ? 'bg-rose-100 text-rose-500 hover:bg-rose-200' : 'bg-rose-50 text-slate-400'
              }`}
              disabled={i > step}
            >
              {s}
            </button>
            {i < STEPS.length - 1 && <span className="mx-1 text-rose-200">→</span>}
          </div>
        ))}
      </nav>

      <div className="mx-auto max-w-3xl">
        {/* ═══ ① 选择职业 ═══ */}
        {step === 0 && (
          <div className="space-y-3">
            <div className="pp-card p-3 text-xs text-slate-600">
              <b className="text-rose-500">当前构筑：</b>
              {Object.entries(plan.classes).map(([id, lv]) => (
                <span key={id} className="ml-1 inline-block rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-600">
                  {classById(Number(id))?.name} Lv{lv}
                </span>
              ))}
              {plan.subClasses.map(sid => (
                <span key={sid} className="ml-1 inline-block rounded-full bg-rose-50 px-2 py-0.5 text-rose-400">
                  流派 · {subById(sid)?.name}
                </span>
              ))}
              {Object.keys(plan.classes).length === 0 && <span className="text-slate-400">尚未选择 · 每个新职业消耗 1 职业点，可兼职多个职业</span>}
            </div>

            {CLASSES.map(cls => {
              const clsLevel = plan.classes[cls.id]
              const subs = SUBCLASSES.filter(s => s.classId === cls.id)
              return (
                <div key={cls.id} className={`pp-card p-4 ${clsLevel ? 'ring-1 ring-rose-300' : ''}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-bold" style={{ color: cls.hue }}>{cls.name}</span>
                      <span className="pp-note ml-2">{cls.epithet}</span>
                    </div>
                    {clsLevel !== undefined && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold text-rose-500">已选 · Lv{clsLevel} / {RULES.maxClassLevel}</span>
                        <button className="pp-btn !py-0.5" disabled={clsLevel <= 1}
                          onClick={() => act(downgradeClass(plan, cls.id))}>降级</button>
                        <button className="pp-btn !py-0.5" disabled={clsLevel >= RULES.maxClassLevel || plan.classPoints < 1}
                          onClick={() => act(upgradeClass(plan, cls.id))}>升级</button>
                        <button className="pp-btn !py-0.5 !text-slate-400" onClick={() => act(removeClass(plan, cls.id))}>撤销</button>
                      </div>
                    )}
                  </div>
                  {clsLevel === undefined && <p className="pp-note mt-1">{cls.desc}</p>}
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {subs.map(sub => {
                      const owned = plan.subClasses.includes(sub.id)
                      const disabled = owned || clsLevel !== undefined
                      return (
                        <button key={sub.id}
                          onClick={() => act(selectClass(plan, cls.id, sub.id))}
                          disabled={disabled}
                          className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                            owned
                              ? 'border-rose-300 bg-rose-50 font-semibold text-rose-600'
                              : disabled
                                ? 'cursor-not-allowed border-rose-50 text-slate-300'
                                : 'border-rose-200 hover:border-rose-400 hover:bg-rose-50/60'
                          }`}
                        >
                          {owned ? '✓ ' : ''}{sub.name}
                          <span className={`ml-1 ${disabled && !owned ? 'text-slate-300' : 'opacity-70'}`}>({sub.roleTypes.map(roleLabel).join('·')})</span>
                        </button>
                      )
                    })}
                  </div>
                  {clsLevel === undefined && <p className="pp-note mt-1.5">选择一个流派即完成该职业的加入 · 职业等级 1 起步，之后可在此升级</p>}
                  {clsLevel !== undefined && <p className="pp-note mt-1.5">· 固有被动：职业 Lv1 / Lv6 各获得一个（流派的固有被动门槛）</p>}
                </div>
              )
            })}
          </div>
        )}

        {/* ═══ ② 选择定位 ═══ */}
        {step === 1 && (
          <div className="pp-card space-y-4 p-5">
            <div>
              <h2 className="text-sm font-bold text-rose-500">从流派候选中选择定位（至多 3 个）</h2>
              <p className="pp-note mt-1">
                当前候选：
                {candidates.length ? candidates.filter(r => r !== 'None').map(r => `${ROLE_META[r].glyph}${roleLabel(r)}`).join(' · ') : '尚未选择流派（请回上一步）'}
              </p>
            </div>

            {/* 选择区（锁定后禁用） */}
            <div className="flex flex-wrap gap-2">
              {(['Core', 'Vanguard', 'Guardian', 'Support', 'Medic'] as Exclude<RoleType, 'None'>[]).map(r => {
                const m = ROLE_META[r]
                const enabled = candidates.includes(r)
                const chosen = selectedRoles.includes(r)
                const pendingIndex = pendingRoles.indexOf(r)
                const inPending = pendingIndex >= 0
                return (
                  <button key={r} disabled={!enabled || rolesLocked} onClick={() => rolePick(r)}
                    className={`pp-chip border px-3 py-1.5 transition-all ${!enabled || rolesLocked ? 'cursor-not-allowed border-rose-50 text-slate-300' : 'border-rose-200 hover:border-rose-400'}`}
                    style={chosen ? { borderColor: m.hue, background: `${m.hue}1f`, color: m.hue } : inPending && !chosen ? { borderColor: '#fb7185', background: '#fff1f2', color: '#be123c' } : undefined}>
                    {m.glyph} {m.label}
                    {chosen ? ` ✓（#${selectedRoles.indexOf(r) + 1}）` : inPending ? `（#${pendingIndex + 1} 待确认）` : ''}
                  </button>
                )
              })}
            </div>

            {/* 待确认顺序预览 */}
            {!rolesLocked && pendingRoles.length > 0 && (
              <div className="rounded-lg border border-rose-100 bg-rose-50/60 px-3 py-2 text-xs text-slate-600">
                确认顺序（按勾选先后）：{pendingRoles.map((r, i) => (
                  <b key={r} className="mx-0.5 text-rose-600">#{i + 1} {roleLabel(r)}</b>
                ))}
              </div>
            )}
            {rolesLocked && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                ✓ 定位已确认并锁定：{selectedRoles.map((r, i) => (
                  <b key={r} className="mx-0.5">#{i + 1} {roleLabel(r)}</b>
                ))}
                —— 修改定位请点右下「撤销定位」
              </div>
            )}

            <div className="pp-note">· 五个定位：{(['Core', 'Vanguard', 'Guardian', 'Support', 'Medic'] as Exclude<RoleType, 'None'>[]).map(r => `${roleLabel(r)}（${ROLE_META[r].desc}）`).join('、')}</div>
            <div className="flex items-center justify-between border-t border-dashed border-rose-200 pt-3">
              {rolesLocked ? (
                <>
                  <span className="pp-note">重新选择会清空已学天赋（见下一步）</span>
                  <button className="pp-btn" onClick={revokeRoles}>↺ 撤销定位</button>
                </>
              ) : (
                <>
                  <span className="pp-note">勾选顺序将作为第 1 / 2 / 3 定位</span>
                  <button className="pp-btn-primary" disabled={pendingRoles.filter(r => r !== 'None').length === 0} onClick={submitRoles}>
                    确认定位{pendingRoles.length ? `（${pendingRoles.length}）` : ''}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ═══ ③ 选择天赋 ═══ */}
        {step === 2 && (
          <div className="space-y-3">
            {selectedRoles.map(role => {
              const m = roleMeta(role)
              const pool = TALENTS.filter(t => t.roleType === role && plan.classes[t.classId] !== undefined)
              const learnedId = plan.learnedTalents[role]
              const active = plan.activeTalentRole === role
              return (
                <div key={role} className="pp-card p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-bold" style={{ color: m.hue }}>
                    <span>{m.glyph}</span>{m.label} 定位天赋
                    <span className="pp-note font-normal">（须学 1 个 · 至多激活 1 个）</span>
                    {active && <span className="ml-auto rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-semibold text-white">生效中</span>}
                  </div>
                  <div className="space-y-2">
                    {pool.map(t => {
                      const isLearned = learnedId === t.id
                      return (
                        <div key={t.id} className={`rounded-lg border p-2.5 ${isLearned ? 'border-rose-300 bg-rose-50' : 'border-rose-100'}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-700">
                              {t.name}
                              {t.isCoreBuff && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-600">☀ 核心（技能 +1）</span>}
                            </span>
                            <div className="flex gap-1.5">
                              <button className="pp-btn !py-0.5" disabled={isLearned} onClick={() => act(learnTalent(plan, role, t.id))}>
                                {isLearned ? '已学习 ✓' : learnedId !== undefined ? '替换为此天赋' : '学习'}
                              </button>
                              {isLearned && !active && <button className="pp-btn-primary !py-0.5" onClick={() => act(activateTalent(plan, role))}>激活</button>}
                            </div>
                          </div>
                          <p className="pp-note mt-1">{t.desc}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {selectedRoles.length === 0 && <div className="pp-card p-6 text-center text-sm text-slate-400">请先回到上一步选择定位</div>}
            <p className="pp-note px-1">· 拥有次要定位（≥2 个已学天赋）时获得【转换战斗天赋】战技：战斗内切换激活天赋（2 决策点 + 1 战技配额）；非战斗可随时直接切换。</p>
          </div>
        )}

        {/* ═══ ④ 完成 ═══ */}
        {step === 3 && (
          <div className="space-y-3">
            <div className="pp-card p-4">
              <h2 className="mb-2 text-sm font-bold text-rose-500">构筑总览</h2>
              <dl className="grid gap-1.5 text-xs sm:grid-cols-2">
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">职业</dt>
                  <dd>{Object.entries(plan.classes).map(([id, lv]) => `${classById(Number(id))?.name} Lv${lv}`).join('、') || '—'}</dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">流派</dt>
                  <dd>{plan.subClasses.map(sid => subById(sid)?.name).join('、') || '—'}</dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">定位</dt>
                  <dd>{selectedRoles.length ? selectedRoles.map(roleLabel).join('、') : '—'}</dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">激活天赋</dt>
                  <dd>{plan.activeTalentRole ? `${roleLabel(plan.activeTalentRole)} · ${talentById(plan.learnedTalents[plan.activeTalentRole as RoleType])?.name}` : '未激活'}</dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">职业点</dt><dd>{plan.classPoints} / {totalPoints}</dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">规则校验</dt>
                  <dd>{validation.ok ? <span className="font-semibold text-emerald-600">一致 ✓</span> : <span className="text-rose-500">{validation.errors.join('；')}</span>}</dd></div>
              </dl>
            </div>

            {/* 技能卷 + 核心祝福预览 */}
            <div className="pp-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-bold text-rose-500">技能卷（等级预览）</h2>
                {coreActive && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-600">☀ 核心祝福 · 技能 +1</span>}
              </div>
              <div className="space-y-1">
                {SKILLS.filter(s => plan.learnedSkillIds.includes(s.id)).map(s => {
                  const { base, buffed } = skillLevelOf(plan, plan.classes[s.classId] ?? 1, s)
                  return (
                    <div key={s.id} className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs ${coreActive && s.skillType !== 'Passive' ? 'border-amber-300 bg-amber-50' : 'border-rose-100'}`}>
                      <span className="font-medium text-slate-700">{s.name}<span className="pp-note ml-2">{s.skillType === 'Magic' ? '魔法' : s.skillType === 'SuperSkill' ? '爆发技' : s.skillType === 'Passive' ? '被动' : '战技'}</span></span>
                      <span className={coreActive && s.skillType !== 'Passive' ? 'font-semibold text-amber-600' : 'text-slate-500'}>
                        Lv {base}{coreActive && s.skillType !== 'Passive' ? ` → ${buffed}` : ''}
                      </span>
                    </div>
                  )
                })}
                {plan.learnedSkillIds.length === 0 && <p className="pp-note">· 已学技能为空。原型注：演示简化为「学习即授予」，未实现路线图选择权配额；技能等级按职业等级推演。</p>}
              </div>
            </div>

            <div className="pp-card p-4">
              <h2 className="mb-2 text-sm font-bold text-rose-500">已学技能管理</h2>
              <div className="flex flex-wrap gap-1.5">
                {SKILLS.filter(s => plan.classes[s.classId] !== undefined).map(s => {
                  const isLearned = plan.learnedSkillIds.includes(s.id)
                  return (
                    <button key={s.id}
                      onClick={() => act(isLearned ? unlearnSkill(plan, s.id) : learnSkill(plan, s.classId, s.id))}
                      className={`rounded-full border px-2.5 py-1 text-xs ${isLearned ? 'border-rose-300 bg-rose-50 font-medium text-rose-600' : 'border-rose-100 text-slate-400 hover:border-rose-300'}`}>
                      {isLearned ? '✓ ' : '+'}{s.name}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button className="pp-btn" onClick={exportJson}>导出规划 JSON</button>
              <button className="pp-btn-primary" onClick={newPlan}>开始新的规划</button>
            </div>
          </div>
        )}

        {/* 底部导航：上一步 / 下一步 */}
        <div className="mt-4 flex items-center justify-between border-t border-rose-100 pt-3">
          <button className="pp-btn" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}>← 上一步</button>
          <span className="pp-note">Step {step + 1} / {STEPS.length} · {stepEnabled().hint || (step < 3 ? '点击「下一步」继续' : '规划完成')}</span>
          {step < 3 ? (
            <button className="pp-btn-primary" onClick={goNext}>下一步 →</button>
          ) : (
            <span />
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border px-4 py-2 text-sm shadow-lg ${toast.ok ? 'border-emerald-200 bg-white text-emerald-700' : 'border-rose-200 bg-white text-rose-600'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
