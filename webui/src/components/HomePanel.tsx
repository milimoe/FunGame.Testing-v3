// 门户首页：整合「职业规划模拟器」与既有「回放模拟器」（统计/回放/快照），清新粉白风
export default function HomePanel() {
  const go = (path: string) => {
    window.location.href = path
  }

  const cards = [
    {
      path: '/classplanner',
      glyph: '⚔️',
      title: '职业规划',
      desc: '职业 / 流派 / 定位 / 战斗天赋分步向导，从干净角色开始构筑',
      tag: '新',
      note: '前端复刻内核规则 · 结果可导出 JSON',
    },
    {
      path: '/stats',
      glyph: '🏆',
      title: '赛后统计',
      desc: 'Rating 排行榜、击杀 / 助攻 / 伤害 / 治疗等战斗数据总览',
      tag: '回放',
      note: '读取最近一局存档统计',
    },
    {
      path: '/replay',
      glyph: '🎞️',
      title: '回合回放',
      desc: '逐回合回放战斗过程：行动流、伤害分桶、检查点',
      tag: '回放',
      note: '服务端存回合记录 JSON',
    },
    {
      path: '/snapshot',
      glyph: '📋',
      title: '状态快照',
      desc: '检查点回合的角色状态：HP/MP/EP、技能与特效',
      tag: '回放',
      note: '观战推算的基础数据',
    },
  ]

  return (
    <div className="pp-shell px-4 py-8 lg:px-10">
      {/* Hero */}
      <section className="mx-auto max-w-4xl text-center">
        <p className="text-xs font-semibold tracking-[0.35em] text-rose-400">FUNGAME · 测试工作台</p>
        <h1 className="mt-2 text-3xl font-black text-rose-500 lg:text-4xl">模拟 · 回放 · 职业规划</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-500">
          一个入口管理全部工具：<span className="font-semibold text-rose-500">职业规划</span>用于设计角色构筑，
          <span className="font-semibold text-rose-500">赛后统计 / 回合回放 / 状态快照</span>用于审视 AI 对战的每个回合。
        </p>
      </section>

      {/* 入口卡 */}
      <section className="mx-auto mt-8 grid max-w-4xl gap-4 sm:grid-cols-2">
        {cards.map(c => (
          <button
            key={c.path}
            onClick={() => go(c.path)}
            className="group rounded-xl border border-rose-100 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-rose-300 hover:shadow-md"
          >
            <div className="flex items-start justify-between">
              <span className="text-2xl">{c.glyph}</span>
              <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-semibold text-rose-500">{c.tag}</span>
            </div>
            <h2 className="mt-3 text-base font-bold text-slate-800 group-hover:text-rose-600">{c.title}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{c.desc}</p>
            <p className="pp-note mt-2">{c.note}</p>
          </button>
        ))}
      </section>

      {/* 架构说明 */}
      <section className="mx-auto mt-8 max-w-4xl">
        <div className="rounded-xl border border-rose-100 bg-white px-5 py-4 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wider text-rose-400">Architecture</h3>
          <ul className="pp-note mt-2 grid gap-1 sm:grid-cols-2">
            <li>· 回放侧：WebAPI 直接托管前端静态产物 + 回合存档 / 模拟接口（同源）</li>
            <li>· 职业规划：纯前端规则模拟，TS 复刻内核 ClassPlanner 语义</li>
            <li>· 导出的规划 JSON 形状 = 未来 FunGameServer-v3 职业端点请求体</li>
            <li>· 内核 FunGame.Core #153：ExLevel 破上限 / 流派反查职业 / 默认路线图</li>
          </ul>
        </div>
      </section>
    </div>
  )
}
