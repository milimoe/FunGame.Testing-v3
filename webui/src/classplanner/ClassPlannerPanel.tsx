import { useEffect, useMemo, useState } from 'react'
import { talentById, subById, classById } from '../classplanner/content'
import {
  activateTalent,
  activeSkillQuota,
  applyPlan,
  changeLevel,
  commitClass,
  downgradeClass,
  forgetTalent,
  learnSkill,
  learnTalent,
  passiveOrBoostQuota,
  refreshRoleTypes,
  removeClass,
  resetPlan,
  resolvedNumericBoostBudget,
  roadmapSkillLevel,
  selectClass,
  setClassLevel,
  unlearnSkill,
  validate,
  type PlanAction,
} from '../classplanner/engine'
import { CLASSES, SUBCLASSES, SKILLS, TALENTS } from '../classplanner/content'
import {
  ROLE_META,
  RULES,
  availablePoints,
  classPointsForLevel,
  draftOccupied,
  emptyPlan,
  hasPendingAdjustment,
  isUnconfirmed,
  levelFloor,
  roleLabel,
  settleDebt,
  type PlanState,
  type RoleType,
  type SkillDef,
} from '../classplanner/types'
import { allLearnedTalents, candidatesOf, roleTypesOfPlan, samplePlanFromCatalog, talentRoleOf } from '../classplanner/content'
import AttributeAllocationPanel from '../classplanner/AttributeAllocationPanel'
import { applySnapshot, createSession, fetchDefinitions, performAction, type ServerDefinitionsDto, type ServerRoute } from '../classplanner/api'
import { applyCatalog, catalogFromServer, classIdName, subClassIdName, talentIdName } from '../classplanner/catalog'
import { planFromSnapshot, toClassPlanSnapshot, type ClassPlanSnapshotJson } from '../classplanner/snapshot'

// 调用方保证传入非 None（候选/已选列表均已过滤）
function roleMeta(r: RoleType): (typeof ROLE_META)[Exclude<RoleType, 'None'>] {
  return ROLE_META[r as Exclude<RoleType, 'None'>]
}

/**
 * 技能等级预览：基础等级 = 路线图绝对水位（对齐内核 RoadmapSkillLevel），
 * 核心定位天赋生效时全部主动技能再 +1（内核为 ExLevel，独立于基础等级）
 */
function skillLevelOf(plan: PlanState, classLevel: number, skill: SkillDef): { base: number; buffed: number } {
  const base = roadmapSkillLevel(classLevel, skill.skillType)
  const coreBuff = plan.activeTalentRole === 'Core' && skill.skillType !== 'Passive'
  return { base, buffed: base + (coreBuff ? 1 : 0) }
}

const STEPS = ['① 选择职业', '② 定位推导', '③ 选择天赋', '④ 完成']

// 职业点数获取等级（含 60 满级档），− / + 在此之间跳转
const POINT_LEVELS = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]

export default function ClassPlannerPanel() {
  // 干净的初始角色：1 级、1 职业点、无任何规划
  const [plan, setPlan] = useState<PlanState>(() => emptyPlan(1))
  const [step, setStep] = useState(0)
  const [lvText, setLvText] = useState('1')
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [serverDefs, setServerDefs] = useState<ServerDefinitionsDto | null>(null)
  /** 内容来源：mock = 本地示例数据；server = 已连接 WebAPI 的真实职业内容 */
  const [catalogSource, setCatalogSource] = useState<'mock' | 'server'>('mock')
  /** 目录版本号：applyCatalog 原地替换数组后，用它触发重渲染 */
  const [catalogVersion, setCatalogVersion] = useState(0)
  const [catalogLoading, setCatalogLoading] = useState(true)
  /** 服务端规划会话 id：有它才能把动作同步到服务端（服务端权威） */
  const [sessionId, setSessionId] = useState<string | null>(null)
  /** 动作正在与服务端同步（期间禁用操作，避免竞态） */
  const [syncing, setSyncing] = useState(false)
  /** 数值提升与被动互斥：先在「已学技能管理」里选中「数值提升」，额度分配面板才可用 */
  const [numericArmed, setNumericArmed] = useState(false)

  useEffect(() => {
    setLvText(String(plan.level))
  }, [plan.level])

  /**
   * 执行规划动作（服务端权威）
   * <para/>流程：本地即时算出结果 → 乐观更新 UI → 发服务端执行 → 用返回的内核快照回写 → 失败则回滚到执行前
   * <para/>route 为空表示该动作没有服务端对应端点（撤销职业 / 遗忘技能 / 改角色等级），只走本地
   */
  const act = async (r: PlanAction, route?: ServerRoute) => {
    if (!r.ok) {
      toastFlash(r.msg, false)
      return
    }
    // 上一个动作还在与服务端同步：直接丢弃，避免快照回写竞态
    if (syncing) {
      toastFlash('正在与服务端同步，请稍候。', false)
      return
    }
    const prev = plan
    setPlan(r.state)
    toastFlash(r.msg, true)
    if (!sessionId) {
      toastFlash('尚未连接服务端会话，本次改动仅保存在本地。', false)
      return
    }
    setSyncing(true)
    // route 为空 = 内核没有对应端点（撤销职业 / 遗忘技能）：把本地结果整体作为快照提交，
    // 否则服务端仍保留旧状态，下一次同步（如升级）时会被服务端快照覆盖而「复活」
    const res = route
      ? await performAction(sessionId, route)
      : await applySnapshot(sessionId, toClassPlanSnapshot(r.state))
    setSyncing(false)
    if (res === null) {
      toastFlash('服务端连接失败，改动仅保存在本地。', false)
      return
    }
    if (!res.ok) {
      setPlan(prev)
      toastFlash(`服务端拒绝：${res.message}`, false)
      return
    }
    if (res.plan) {
      setPlan(planFromSnapshot(res.plan as ClassPlanSnapshotJson, r.state))
    }
    if (res.message) toastFlash(res.message, true)
  }
  const selectedRoles = roleTypesOfPlan(plan)
  const candidates = candidatesOf(plan)
  // catalogVersion：服务端目录替换后（职业/技能池变了）需要重算校验
  const validation = useMemo(() => validate(plan), [plan, catalogVersion])
  const totalPoints = classPointsForLevel(plan.level)
  /** 草稿期的即时点数口径：账本余额 − 未结算等级占用 = 可用点数 */
  const occupied = draftOccupied(plan)
  const available = availablePoints(plan)

  const applyLevel = (level: number) => {
    const c = Math.min(60, Math.max(1, Math.round(level)))
    if (c === plan.level) return
    const r = changeLevel(plan, c)
    setPlan(r.state)
    setLvText(String(c))
    setToast({ msg: r.msg, ok: true })
    window.setTimeout(() => setToast(null), 2000)
    // 角色等级决定职业点数，必须同步到服务端，否则服务端会话仍是模板等级
    void act(r, { kind: 'set-character-level', level: c })
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
    if (step === 1) return Object.keys(plan.classes).length > 0
      ? { next: true, hint: '' }
      : { next: false, hint: '请先选择一个职业与流派（定位由流派自动推导）' }
    if (step === 2) {
      const learned = allLearnedTalents(plan).length
      return learned > 0
        ? { next: true, hint: '' }
        : { next: false, hint: '请至少学习一个战斗天赋（主要定位由生效天赋决定）' }
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

  /**
   * 挂载即拉取内核真实职业内容（/api/classplan/definitions）并**替换**本地目录，
   * 之后职业 / 流派 / 技能池 / 天赋全部来自服务端。失败则保留本地示例数据。
   */
  const loadServerDefs = async () => {
    setCatalogLoading(true)
    const d = await fetchDefinitions()
    setCatalogLoading(false)
    const classes = d?.classes ?? []
    if (!d || classes.length === 0) {
      setSessionId(null)
      toastFlash('无法连接职业规划端点（WebAPI 未启动或未注册职业内容），当前使用本地示例数据。', false)
      return
    }
    applyCatalog(catalogFromServer(d))
    setServerDefs(d)
    setCatalogSource('server')
    setCatalogVersion(v => v + 1)
    const subCount = classes.reduce((n, c) => n + (c.subClasses?.length ?? 0), 0)
    // 职业内容就绪后创建规划会话，之后的动作都走服务端（服务端权威）
    const session = await createSession()
    if (session?.sessionId) {
      setSessionId(session.sessionId)
      toastFlash(`已连接 WebAPI 并创建会话：${classes.length} 个职业 · ${subCount} 个流派。`, true)
    } else {
      setSessionId(null)
      toastFlash(`已加载 ${classes.length} 个职业，但会话创建失败，操作将只保存在本地。`, false)
    }
  }

  // 进入页面即加载一次（即时获取服务端职业数据）
  useEffect(() => {
    loadServerDefs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const newPlan = () => {
    setPlan(emptyPlan(1))
    setStep(0)
    setNumericArmed(false)
    toastFlash('已创建干净的新角色（1 级 · 1 职业点）。', true)
  }

  /**
   * 导出规划 JSON：形状 = 内核 ClassPlanSnapshot（嵌套 ClassRecordSnapshot / SubClassRecordSnapshot /
   * ClassSkillStateSnapshot / ClassRewardLedger），可由
   * JsonSerializer.Deserialize&lt;ClassPlanSnapshot&gt;(json, JsonTool.JsonSerializerOptions) 直接解析，
   * 再经 ClassPlanSnapshot.ApplyTo 重建。校验结果一并附在 Validation 字段（内核忽略未知字段）。
   */
  const exportJson = () => {
    const snapshot = { ...toClassPlanSnapshot(plan), Validation: validation }
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'class-plan-snapshot.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  /** 物化到角色：物化即确认（先确认全部职业等级，点数不足则整体失败） */
  const applyToCharacter = () => act(applyPlan(plan), { kind: 'apply' })

  const coreTalent = talentById(plan.activeTalentId)
  const coreActive = plan.activeTalentRole === 'Core' && !!coreTalent?.isCoreBuff
  /** 数值提升额度：账本覆盖（随等级重算）优先，缺省回落平衡常数默认 */
  const boostOverride = resolvedNumericBoostBudget(plan)
  const boostBudget = boostOverride ?? RULES.numericBoostBudget
  /** 路线图配额构成：主动技能选择权（2 / 5 / 8 / 10 各 2）与「被动 / 数值提升」互斥共享份额（4 / 9 级） */
  const activeQuota = activeSkillQuota()
  const sharedQuota = passiveOrBoostQuota()

  // 定位不再手动选择：主要跟随生效天赋、次要由流派推导，此处仅提供手动刷新入口
  const refreshRoles = () => act(refreshRoleTypes(plan), { kind: 'refresh-roles' })

  return (
    <div className="pp-shell p-4 lg:px-8 lg:py-6">
      {/* 顶栏：标题 + 等级与洗点（角色级操作） */}
      <header className="mx-auto mb-4 flex max-w-3xl flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-rose-500 lg:text-2xl">⚔️ 职业规划向导</h1>
          <p className="pp-note mt-0.5 flex flex-wrap items-center gap-1.5">
            按步骤完成构筑 · 内核 ClassPlanner 语义复刻
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                catalogLoading
                  ? 'bg-slate-100 text-slate-500'
                  : catalogSource === 'server'
                    ? 'bg-emerald-100 text-emerald-600'
                    : 'bg-amber-100 text-amber-600'
              }`}
              title="职业 / 流派 / 技能池的数据来源"
            >
              {catalogLoading
                ? '正在拉取职业数据…'
                : catalogSource !== 'server'
                  ? '本地示例数据（未连接 WebAPI）'
                  : sessionId
                    ? `WebAPI 服务端权威 · ${CLASSES.length} 职业${syncing ? ' · 同步中…' : ''}`
                    : `WebAPI 数据 · ${CLASSES.length} 职业（无会话，仅本地）`}
            </span>
          </p>
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
            <span className="ml-1">
              · 职业点 <b className={available <= 0 ? 'text-rose-600' : 'text-emerald-600'}>{available}</b> / {totalPoints}
              {occupied > 0 && <span className="pp-note ml-1">（余额 {plan.classPoints} − 未结算占用 {occupied}）</span>}
            </span>
          </span>
          <button className="pp-btn" onClick={() => { act(resetPlan(plan), { kind: 'reset' }); setStep(0); setNumericArmed(false) }}>洗点</button>
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
                    {clsLevel !== undefined && (() => {
                      const floor = levelFloor(plan, cls.id)
                      const pending = hasPendingAdjustment(plan, cls.id)
                      const committed = plan.committedLevels[cls.id] ?? -1
                      const unconfirmed = isUnconfirmed(plan, cls.id)
                      const debt = settleDebt(plan, cls.id)
                      return (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold text-rose-500">已选 · Lv{clsLevel} / {RULES.maxClassLevel}</span>
                          <span className={pending
                            ? 'rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-600'
                            : 'rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-600'}>
                            {committed < 0
                              ? (pending ? `未确认 · 未结算 +${debt}` : '未确认')
                              : pending ? `已确认 ${committed} 级 · 未结算 +${debt}` : `已确认 ${committed} 级 · 不可下调`}
                          </span>
                          <button className="pp-btn !py-0.5"
                            disabled={clsLevel <= floor}
                            title={`降 1 级（下限 = 已确认的 ${floor} 级；不结算点数）`}
                            onClick={() => act(downgradeClass(plan, cls.id), { kind: 'set-class-level', classId: classIdName(cls.id) ?? '', level: clsLevel - 1 })}>降级</button>
                          <button className="pp-btn !py-0.5"
                            disabled={clsLevel >= RULES.maxClassLevel || available < 1}
                            title={available < 1
                              ? '没有可用的职业点数（草稿期的未结算占用已达上限）'
                              : '草稿态升 1 级：不结算点数，提交 / 物化时统一结算'}
                            onClick={() => act(setClassLevel(plan, cls.id, clsLevel + 1), { kind: 'set-class-level', classId: classIdName(cls.id) ?? '', level: clsLevel + 1 })}>升级</button>
                          <button className="pp-btn-primary !py-0.5"
                            disabled={!pending}
                            title={pending ? `结算并确认到 ${clsLevel} 级（消耗职业点数 ${debt} 点），此后不可下调` : '已是最新确认等级'}
                            onClick={() => act(commitClass(plan, cls.id), { kind: 'commit-class', classId: classIdName(cls.id) ?? '' })}>确认 {clsLevel} 级{debt > 0 ? `（${debt} 点）` : ''}</button>
                          <button className="pp-btn !py-0.5 !text-slate-400"
                            disabled={!unconfirmed}
                            title={unconfirmed ? '撤销该职业与流派，退回已结算的 1 点职业点' : '已确认过等级，请用洗点'}
                            onClick={() => act(removeClass(plan, cls.id))}>撤销</button>
                        </div>
                      )
                    })()}
                  </div>
                  {clsLevel === undefined && <p className="pp-note mt-1">{cls.desc}</p>}
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {subs.map(sub => {
                      const owned = plan.subClasses.includes(sub.id)
                      const disabled = owned || clsLevel !== undefined
                      return (
                        <button key={sub.id}
                          onClick={() => act(selectClass(plan, cls.id, sub.id), { kind: 'select-class', classId: classIdName(cls.id) ?? '', subClassId: subClassIdName(sub.id) ?? '' })}
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
            <p className="pp-note px-1">
              · 升降级是**草稿调整**：本身不结算职业点数，但会做**即时校验** —— 右上角「职业点」显示的是
              「账本余额 − 未结算占用」，因此照样刷不出超出点数预算的等级组合。
              · 点「确认 N 级」（或最后的「物化到角色」）才真正**结算**并扣除对应点数，同时把该等级登记为不可下调的下限。
            </p>
          </div>
        )}

        {/* ═══ ② 定位推导（自动） ═══ */}
        {step === 1 && (
          <div className="pp-card space-y-4 p-5">
            <div>
              <h2 className="text-sm font-bold text-rose-500">角色定位（自动推导，无需手选）</h2>
              <p className="pp-note mt-1">
                主要定位 = 当前生效战斗天赋所属的定位（未激活天赋时为空，MOV 取默认 3）；
                次要定位 = 已选流派按「所属职业等级降序、同级按选择顺序」展开候选并去重。
              </p>
            </div>

            <div className="rounded-lg border border-rose-100 bg-rose-50/50 px-3 py-2 text-xs text-slate-600">
              <b className="text-rose-500">主要定位：</b>
              {plan.primaryRoleType === 'None'
                ? <span>无 —— 尚未激活战斗天赋（在下一步学习并激活天赋后自动生效）</span>
                : <b style={{ color: roleMeta(plan.primaryRoleType).hue }}>
                  {roleMeta(plan.primaryRoleType).glyph} {roleLabel(plan.primaryRoleType)}
                </b>}
              <span className="pp-note ml-2">MOV 等按此定位取值的属性会随之变化</span>
            </div>

            <div className="rounded-lg border border-rose-100 px-3 py-2 text-xs text-slate-600">
              <b className="text-rose-500">次要定位：</b>
              {plan.secondaryRoleTypes.length === 0
                ? <span>无 —— 流派候选不足或尚未选择流派</span>
                : plan.secondaryRoleTypes.map(r => (
                  <b key={r} className="mx-0.5" style={{ color: roleMeta(r).hue }}>
                    {roleMeta(r).glyph} {roleLabel(r)}
                  </b>
                ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {(['Core', 'Vanguard', 'Guardian', 'Support', 'Medic'] as Exclude<RoleType, 'None'>[]).map(r => {
                const m = ROLE_META[r]
                const inCandidates = candidates.includes(r)
                const isPrimary = plan.primaryRoleType === r
                const isSecondary = plan.secondaryRoleTypes.includes(r)
                const label = isPrimary ? '（主要）' : isSecondary ? '（次要）' : inCandidates ? '（候选）' : ''
                return (
                  <span key={r}
                    className={`pp-chip border px-3 py-1.5 ${inCandidates ? 'border-rose-200' : 'border-rose-50 text-slate-300'}`}
                    style={isPrimary ? { borderColor: m.hue, background: `${m.hue}1f`, color: m.hue }
                      : isSecondary ? { borderColor: '#fda4af', background: '#fff1f2', color: '#be123c' } : undefined}>
                    {m.glyph} {m.label}{label}
                  </span>
                )
              })}
            </div>

            <div className="pp-note">· 五个定位：{(['Core', 'Vanguard', 'Guardian', 'Support', 'Medic'] as Exclude<RoleType, 'None'>[]).map(r => `${roleLabel(r)}（${ROLE_META[r].desc}）`).join('、')}</div>
            <div className="flex items-center justify-between border-t border-dashed border-rose-200 pt-3">
              <span className="pp-note">定位随「激活 / 转换天赋」与「职业等级」实时重算</span>
              <button className="pp-btn" onClick={refreshRoles}>↻ 刷新定位</button>
            </div>
          </div>
        )}

        {/* ═══ ③ 选择天赋 ═══ */}
        {step === 2 && (
          <div className="space-y-3">
            <div className="pp-card p-3 text-xs text-slate-600">
              <b className="text-rose-500">已学天赋 {allLearnedTalents(plan).length} / {RULES.maxRoleTypes}</b>
              <span className="pp-note ml-2">学习只做记录、不会挂载到角色；只有激活的那一个会以 1 级挂载生效。</span>
            </div>
            {selectedRoles.map(role => {
              const m = roleMeta(role)
              const pool = TALENTS.filter(t => t.roleType === role && plan.classes[t.classId] !== undefined)
              const learnedIds = plan.learnedTalents[role] ?? []
              const full = allLearnedTalents(plan).length >= RULES.maxRoleTypes
              return (
                <div key={role} className="pp-card p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-bold" style={{ color: m.hue }}>
                    <span>{m.glyph}</span>{m.label} 定位天赋
                    <span className="pp-note font-normal">（同一定位可学多个 · 全场至多激活 1 个）</span>
                    {plan.activeTalentRole === role && <span className="ml-auto rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-semibold text-white">该定位生效中</span>}
                  </div>
                  <div className="space-y-2">
                    {pool.map(t => {
                      const isLearned = learnedIds.includes(t.id)
                      const isActive = plan.activeTalentId === t.id
                      return (
                        <div key={t.id} className={`rounded-lg border p-2.5 ${isActive ? 'border-rose-400 bg-rose-50' : isLearned ? 'border-rose-200 bg-rose-50/50' : 'border-rose-100'}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-700">
                              {t.name}
                              {t.isCoreBuff && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-600">☀ 核心（技能 +1）</span>}
                              {isActive && <span className="ml-1 rounded bg-rose-500 px-1 text-[10px] text-white">生效中</span>}
                            </span>
                            <div className="flex gap-1.5">
                              <button className="pp-btn !py-0.5" disabled={isLearned}
                                title={isLearned ? '已学习' : full ? `已学天赋已达上限 ${RULES.maxRoleTypes} 个` : ''}
                                onClick={() => act(learnTalent(plan, role, t.id), { kind: 'learn-talent', roleType: role, talentId: talentIdName(t.id) ?? '' })}>
                                {isLearned ? '已学习 ✓' : '学习'}
                              </button>
                              {isLearned && !isActive && (
                                <button className="pp-btn-primary !py-0.5" onClick={() => act(activateTalent(plan, role, t.id), { kind: 'activate-talent', talentId: talentIdName(t.id) ?? '' })}>激活</button>
                              )}
                              {isLearned && (
                                <button className="pp-btn !py-0.5 !text-slate-400"
                                  title="遗忘该天赋，释放名额以便学习其他天赋（遗忘不消耗也不退还资源；遗忘生效天赋会自动接续其余已学天赋）"
                                  onClick={() => act(forgetTalent(plan, role, t.id), { kind: 'forget-talent', talentId: talentIdName(t.id) ?? '' })}>遗忘</button>
                              )}
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
            {selectedRoles.length === 0 && <div className="pp-card p-6 text-center text-sm text-slate-400">请先回到上一步选择职业与流派（定位由流派自动推导）</div>}
            <p className="pp-note px-1">· 已学天赋 ≥ 2 个（含同一定位多个）即获得【转换战斗天赋】战技：切换激活任意一个已学天赋（2 决策点 + 1 战技配额）；同定位切换时主要定位与 MOV 不变。</p>
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
                  <dd>{plan.activeTalentId !== null
                    ? `${roleLabel(talentRoleOf(plan, plan.activeTalentId))} · ${talentById(plan.activeTalentId)?.name}`
                    : '未激活'}</dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">已学天赋</dt>
                  <dd>{allLearnedTalents(plan).length
                    ? allLearnedTalents(plan).map(id => talentById(id)?.name).join('、')
                    : '—'}</dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">职业点</dt>
                  <dd>{available} / {totalPoints}{occupied > 0 ? `（余额 ${plan.classPoints} − 未结算占用 ${occupied}）` : ''}</dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">确认状态</dt>
                  <dd>{Object.entries(plan.classes).map(([id, lv]) => {
                    const committed = plan.committedLevels[Number(id)] ?? -1
                    return `${classById(Number(id))?.name} Lv${lv}${committed < 0 ? '（草稿）' : `（已确认 ${committed}）`}`
                  }).join('、') || '—'}</dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">提升额度</dt>
                  <dd>{boostBudget.attributePoints} 点 + {boostBudget.growthPoints} 成长
                    <span className="pp-note ml-1">{boostOverride ? '（路线图自带）' : '（平衡常数默认）'}</span></dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">选择权</dt>
                  <dd>主动技能 {plan.pendingActiveChoices} / {activeQuota.total} · 被动或数值提升 {plan.pendingPassiveChoices} / {sharedQuota.passive}
                    <span className="pp-note ml-1">（互斥；数值提升剩 {plan.numericBoosts}）</span></dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">初始分配</dt>
                  <dd>{plan.initialAllocationAvailable ? <span className="font-semibold text-amber-600">待领取（30 点 + 3.0 成长）</span> : '已领取'}</dd></div>
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
                {plan.learnedSkillIds.length === 0 && <p className="pp-note">· 已学技能为空。选择制已启用：职业技能须消耗路线图发放的「选择权」逐个习得（2 / 5 / 8 / 10 级各 2 点主动技能选择权，4 / 9 级为被动或数值提升）。</p>}
              </div>
            </div>

            <div className="pp-card p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-rose-500">已学技能管理</h2>
                <span className="pp-note">
                  主动技能选择权 <b className="text-rose-600">{plan.pendingActiveChoices}</b>
                  <span className="opacity-70"> / {activeQuota.total}</span>（{activeQuota.tiers.map(t => `${t.level} 级 ${t.count}`).join('、')}）{' · '}
                  被动或数值提升 <b className="text-rose-600">{plan.pendingPassiveChoices}</b>
                  <span className="opacity-70"> / {sharedQuota.passive}</span>（{sharedQuota.tiers.map(t => `${t.level} 级 ${t.count}`).join('、')}，互斥）
                </span>
              </div>
              <p className="pp-note mb-2">
                · 职业技能 / 被动在职业<b>提交确认后不可遗忘</b>，回退只能洗点；草稿态可自由调整。
                · 唯一可随时遗忘的是<b>战斗天赋</b>：上限 {RULES.maxRoleTypes} 个备选，同时只有 1 个激活。
                · 撤销职业仅在草稿态提供。
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SKILLS.filter(s => plan.classes[s.classId] !== undefined).map(s => {
                  const isLearned = plan.learnedSkillIds.includes(s.id)
                  const isPassive = s.skillType === 'Passive'
                  const noQuota = isPassive ? plan.pendingPassiveChoices < 1 : plan.pendingActiveChoices < 1
                  // 职业提交确认后，已习得的技能不可遗忘（回退只能洗点）
                  const locked = isLearned && !isUnconfirmed(plan, s.classId)
                  return (
                    <button key={s.id}
                      disabled={locked || (!isLearned && noQuota)}
                      title={locked
                        ? '职业已提交确认，已习得的技能不能遗忘；如需重来请使用洗点'
                        : !isLearned && noQuota ? `剩余${isPassive ? '被动' : '职业技能'}选择权不足` : ''}
                      onClick={() => act(isLearned ? unlearnSkill(plan, s.id) : learnSkill(plan, s.classId, s.id), isLearned ? undefined : { kind: 'learn-skill', classId: classIdName(s.classId) ?? '', skillId: s.id })}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        isLearned
                          ? 'border-rose-300 bg-rose-50 font-medium text-rose-600 hover:border-rose-400'
                          : noQuota
                            ? 'cursor-not-allowed border-rose-50 text-slate-300'
                            : 'border-rose-100 text-slate-400 hover:border-rose-300 hover:text-rose-500'
                      }`}>
                      {isLearned ? '✓ ' : '+'}{s.name}
                      <span className="ml-1 opacity-60">{isPassive ? '被动' : s.skillType === 'Magic' ? '魔法' : s.skillType === 'SuperSkill' ? '爆发技' : '战技'}</span>
                    </button>
                  )
                })}
                {/* 数值提升：与被动互斥的同一份额，选中后才解锁下方的额度分配 */}
                <button key="__numeric_boost__"
                  disabled={plan.numericBoosts < 1 || plan.pendingPassiveChoices < 1}
                  title={plan.pendingPassiveChoices < 1
                    ? '被动选择权已用尽：数值提升与被动共用同一份「4 / 9 级」份额，二者互斥（取其一）'
                    : plan.numericBoosts < 1
                      ? '暂无可用的数值提升份额（4 / 9 级按 max(该档被动选择权, 1) 发放）'
                      : `与被动互斥的同一份额：选择后会占用 1 次被动选择权，随后在下方分配额度（剩余份额 ${plan.pendingPassiveChoices}）`}
                  onClick={() => {
                    setNumericArmed(true)
                    toastFlash('已选择「数值提升」，请在下方「数值提升」面板分配额度。', true)
                  }}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    numericArmed
                      ? 'border-amber-400 bg-amber-50 font-medium text-amber-600'
                      : plan.numericBoosts < 1 || plan.pendingPassiveChoices < 1
                        ? 'cursor-not-allowed border-rose-50 text-slate-300'
                        : 'border-amber-200 text-amber-600 hover:border-amber-400 hover:bg-amber-50/60'
                  }`}>
                  {numericArmed ? '▶ ' : '+'}数值提升
                  <span className="ml-1 opacity-60">替代被动 · 剩 {plan.numericBoosts}</span>
                </button>
              </div>
              <p className="pp-note mt-2">
                · 「数值提升」与「被动」<b>互斥</b>：4 / 9 级按 max(该档被动选择权, 1) 发放共享份额
                （{sharedQuota.tiers.map(t => `${t.level} 级 ${t.count} 个`).join('、')}，共 {sharedQuota.passive} 个），取其一 ——
                选被动就少一次数值提升；选数值提升会同时占用 1 次被动份额。
                · 点上方「数值提升」后才解锁下方的额度分配，提交即消耗 1 次份额并发放属性 / 成长额度。
              </p>
            </div>

            <AttributeAllocationPanel
              plan={plan}
              onAction={act}
              hasClasses={Object.keys(plan.classes).length > 0}
              numericArmed={numericArmed}
              onNumericApplied={() => setNumericArmed(false)}
            />

            <div className="pp-card p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-rose-500">内核内容对齐</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="pp-btn !py-1" onClick={() => { setPlan(samplePlanFromCatalog()); setStep(3); setNumericArmed(false) }}
                    title="用当前目录（服务端数据）生成一个 10 级示例">
                    载入示例
                  </button>
                  <button className="pp-btn !py-1" onClick={loadServerDefs} disabled={catalogLoading}>
                    {catalogLoading ? '拉取中…' : '重新拉取职业定义'}
                  </button>
                </div>
              </div>
              {serverDefs ? (
                <div className="space-y-1.5 text-xs">
                  <p className="pp-note">规则：初始分配 {serverDefs.rules.initialBudget} · 数值提升 {serverDefs.rules.numericBoostBudget}</p>
                  {serverDefs.classes.map(c => (
                    <div key={c.id} className="rounded-lg border border-rose-100 px-2.5 py-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <b className="text-rose-600">{c.name}</b>
                        <span className="pp-note">{c.id}</span>
                        <span className="pp-note ml-auto">限值：{c.attributeLimitText ?? '无上下限'}</span>
                      </div>
                      <p className="pp-note mt-1">
                        战技 {c.skills.length} · 被动 {c.passives.length} · 天赋 {Object.values(c.talents).reduce((n, t) => n + t.length, 0)} · 流派{' '}
                        {c.subClasses.map(s => `${s.name}（${s.roleTypes.join('/')}）`).join('、') || '—'}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="pp-note">· 尚未连接。启动 WebAPI 后可拉取内核已注册的职业 / 流派 / 技能池与真实额度规则，用于核对本原型的演示数据。</p>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button className="pp-btn" onClick={exportJson} title="导出内核 ClassPlanSnapshot 形状的 JSON（可被 GamePlanSnapshot 反序列化）">导出规划 JSON（内核快照）</button>
              <button className="pp-btn-primary" onClick={applyToCharacter} title="物化即确认：先确认全部职业等级（按净增级数扣点），再重挂技能 / 特效 / 天赋">物化到角色（即确认）</button>
              <button className="pp-btn" onClick={newPlan}>开始新的规划</button>
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
