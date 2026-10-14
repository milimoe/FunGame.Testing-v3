using FunGame.Core.Api;
using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.DecisionTable;
using FunGame.Core.Model.EffectContext;
using FunGame.Core.Model.Framework;
using Milimoe.FunGameTesting.OshimaGameModules.Items;
using Milimoe.FunGameTesting.OshimaGameModules.Skills;

namespace Milimoe.FunGameTesting.Tests;

/// <summary>通过完整模组入口验证决策表的配置、规划与真实结算。</summary>
public static partial class DecisionTableTest
{
    /// <summary>运行真实模组集成测试，不启动 HTTP 服务或写入战斗存档。</summary>
    /// <param name="filter">可选的场景名称筛选。</param>
    /// <returns>全部通过返回零，否则返回一。</returns>
    public static int RunAllTests(string? filter = null)
    {
        List<(string Name, Action Test)> tests =
        [
            ("真实角色、技能和物品目录", CheckCatalog),
            ("JSON 文件加载与链式配置一致", CheckJsonFixture),
            ("真实模组资源目录拒绝未知技能", CheckUnknownResource),
            ("角色复制及 JSON 往返重新绑定", CheckCharacterBinding),
            ("受伤友军绑定与规则优先级", CheckBoundPatient),
            ("真实小回复药治疗、扣次数与移除", CheckItem),
            ("真实疾风步排除不可选中目标", CheckUnselectable),
            ("模组选择覆盖角色策略", CheckModuleOverride),
            ("原地协同使用角色治疗策略", CheckChainPolicy),
            ("动作开始失效重验不扣真实技能资源", CheckInvalidation),
            ("真实回复术排除满血友军", CheckHealingPredicate)
        ];
        foreach (bool map in new[] { false, true })
        {
            bool mapMode = map;
            tests.Add(($"真实回复弹执行（map={map}）", () => CheckHealing(mapMode)));
            tests.Add(($"真实金刚击伤害与扣费（map={map}）", () => CheckAttack(mapMode)));
            tests.Add(($"真实冰霜攻击吟唱与结算（map={map}）", () => CheckCasting(mapMode)));
        }
        foreach (string restriction in new[] { "cooldown", "energy", "quota", "disabled" })
        {
            string current = restriction;
            tests.Add(($"不可执行规则跳过（{restriction}）", () => CheckRestriction(current)));
        }
        AddMapTests(tests);
        AddBattleTests(tests);
        if (!string.IsNullOrWhiteSpace(filter)) tests = [.. tests.Where(t => t.Name.Contains(filter, StringComparison.OrdinalIgnoreCase))];
        if (tests.Count == 0) { Console.WriteLine($"[FAIL] 没有匹配的决策表场景：{filter}"); return 1; }
        int failures = 0;
        foreach ((string name, Action test) in tests)
        {
            try { test(); Console.WriteLine($"[PASS] {name}"); }
            catch (Exception error) { failures++; Console.WriteLine($"[FAIL] {name}: {error}"); }
        }
        Console.WriteLine($"DecisionTable integration: {tests.Count - failures}/{tests.Count} passed");
        return failures == 0 ? 0 : 1;
    }

    private static DecisionTableConfig HealerConfig() => DecisionTableBuilder.Create("oshima:test-healer").WithFallback("endTurn")
        .AddRule("heal-patient", r => r.Priority(100).Target(Targets.Allies("patient"))
            .When(Conditions.All(Conditions.TargetHpRatio("patient", "lessThan", .75), Conditions.SkillAvailable((long)SkillID.回复弹)))
            .Then(Actions.CastSkill((long)SkillID.回复弹, "patient", "never"))).Build();

    private static DecisionTableConfig SkillConfig(Skill skill, string id = "oshima:test-skill", string movement = "never") =>
        DecisionTableBuilder.Create(id).WithFallback("endTurn").AddRule("cast", r => r.Then(Actions.CastSkill(skill.Id, movement: movement))).Build();

    private static void CheckCatalog()
    {
        Check(FunGameService.Characters.Count == 18, "角色目录不完整。");
        Check(FunGameService.AllSkills.Any(s => s is 回复弹) && FunGameService.AllSkills.Any(s => s is 火山咆哮), "真实技能未加载。");
        Check(FunGameService.AllItems.Any(i => i is 小回复药), "真实物品未加载。");
        Console.WriteLine($"  characters={FunGameService.Characters.Count}, skills={FunGameService.AllSkills.Count}, items={FunGameService.AllItems.Count}");
    }

    private static void CheckJsonFixture()
    {
        string path = Path.Combine(AppContext.BaseDirectory, "decision-tables", "healer.json");
        DecisionTableConfig parsed = DecisionTableParser.Parse(File.ReadAllText(path));
        Check(DecisionTableGenerator.GetJson(parsed) == DecisionTableGenerator.GetJson(HealerConfig()), "文件与 Builder 不等价。");
        Fixture fixture = new();
        fixture.Learn(new 回复弹());
        fixture.Patient.HP = fixture.Patient.MaxHP * .2;
        Check(fixture.Loader.Load(path).Count == 0, "JSON 策略加载失败。");
        Bind(fixture.Loader, fixture.Actor, parsed.Id);
        fixture.RunActor();
        Check(fixture.Hits.Contains("heal-patient"), "文件策略没有进入普通行动。");
    }

    private static void CheckUnknownResource()
    {
        DecisionTableConfig config = DecisionTableBuilder.Create("oshima:test-invalid")
            .AddRule("unknown", r => r.Then(Actions.CastSkill(long.MaxValue))).Build();
        IReadOnlyList<DecisionDiagnostic> errors = NewLoader().Register(config);
        Check(errors.Any(e => e.Path.EndsWith("skillId")), "目录没有诊断未知技能。");
    }

    private static void CheckCharacterBinding()
    {
        Fixture fixture = new();
        fixture.Use(HealerConfig());
        Character copy = fixture.Actor.Copy();
        Check(copy.DecisionTableId == fixture.Actor.DecisionTableId && copy.DecisionPolicy == fixture.Actor.DecisionPolicy, "复制丢失策略。");
        Character decoded = JsonService.GetObject<Character>(JsonService.GetString(fixture.Actor))!;
        Check(decoded.DecisionTableId == fixture.Actor.DecisionTableId && decoded.DecisionPolicy == null, "JSON 策略持久化不正确。");
        Check(fixture.Loader.Bind(decoded).Count == 0 && decoded.DecisionPolicy != null, "JSON 角色重新绑定失败。");
    }

    private static void CheckBoundPatient()
    {
        Fixture fixture = new();
        fixture.Learn(new 回复弹());
        fixture.Patient.HP = fixture.Patient.MaxHP * .2;
        fixture.Ally.HP = fixture.Ally.MaxHP * .6;
        DecisionTableConfig config = HealerConfig();
        config.Rules.Add(new() { Id = "attack", Priority = 10, Target = Targets.Enemies("victim"), Action = Actions.NormalAttack("victim", "never") });
        fixture.Use(config);
        DecisionEvaluationResult result = fixture.Actor.DecisionPolicy!.Evaluate(fixture.Context());
        Check(result.RuleId == "heal-patient" && result.Decision!.Targets.SequenceEqual([fixture.Patient]), "条件与执行目标没有绑定到同一病人。");
    }

    private static void CheckHealing(bool mapMode)
    {
        Fixture fixture = new(mapMode);
        Skill skill = fixture.Learn(new 回复弹());
        fixture.Patient.HP = fixture.Patient.MaxHP * .4;
        double hp = fixture.Patient.HP;
        double epAtRelease = double.NaN;
        fixture.Queue.CharacterCastSkillEvent += ctx => { if (ctx.Skill == skill) epAtRelease = fixture.Actor.EP; };
        fixture.Use(HealerConfig());
        fixture.RunActor();
        ActionRecord action = fixture.Queue.LastRound.Actions.Single(a => a.Skill == skill && a.IsSuccess);
        Check(fixture.Hits.Contains("heal-patient") && action.Targets.SequenceEqual([fixture.Patient]), "治疗规则或绑定目标不正确。");
        Check(fixture.Patient.HP > hp && action.Heals.GetValueOrDefault(fixture.Patient) > 0, "真实治疗未结算。");
        Equal(100 - skill.RealEPCost, epAtRelease, "治疗扣 EP");
        Equal(skill.RealEPCost, action.EPCost, "治疗成本记录");
        Check(skill.CurrentCD > 0 && fixture.Queue.CharacterStatistics[fixture.Actor].TotalHeal > 0, "治疗 CD 或贡献记录缺失。");
    }

    private static void CheckAttack(bool mapMode)
    {
        Fixture fixture = new(mapMode);
        Skill skill = fixture.Learn(new 金刚击());
        fixture.Enemy.HP = fixture.Enemy.MaxHP * .5;
        double hp = fixture.Enemy.HP;
        double epAtRelease = double.NaN;
        fixture.Queue.CharacterCastSkillEvent += ctx => { if (ctx.Skill == skill) epAtRelease = fixture.Actor.EP; };
        fixture.Use(DecisionTableBuilder.Create("oshima:test-attack").WithFallback("endTurn")
            .AddRule("focus", r => r.Target(Targets.Enemies("victim")).Then(Actions.CastSkill(skill.Id, "victim", "never"))).Build());
        fixture.RunActor();
        ActionRecord action = fixture.Queue.LastRound.Actions.Single(a => a.Skill == skill && a.IsSuccess);
        Check(action.Targets.Contains(fixture.Enemy) && fixture.Enemy.HP < hp && action.Damages.GetValueOrDefault(fixture.Enemy) > 0, "金刚击未伤害绑定敌人。");
        Equal(100 - skill.RealEPCost, epAtRelease, "攻击扣 EP");
        Check(skill.CurrentCD > 0, "金刚击未进入冷却。");
    }

    private static void CheckCasting(bool mapMode)
    {
        Fixture fixture = new(mapMode);
        Skill skill = fixture.Learn(new 冰霜攻击());
        double hp = fixture.Enemy.HP + fixture.OtherEnemy.HP;
        double mpAtRelease = double.NaN;
        double mp = fixture.Actor.MP;
        fixture.Queue.CharacterCastSkillEvent += ctx => { if (ctx.Skill == skill) mpAtRelease = fixture.Actor.MP; };
        fixture.Use(SkillConfig(skill));
        fixture.RunActor();
        Check(fixture.Actor.CharacterState == CharacterState.Casting, "真实魔法没有开始吟唱。");
        Equal(mp, fixture.Actor.MP, "吟唱开始不扣 MP");
        fixture.FinishCasting(skill);
        Equal(mp - skill.RealMPCost, mpAtRelease, "魔法结算扣 MP");
        Check(fixture.Enemy.HP + fixture.OtherEnemy.HP < hp && skill.CurrentCD > 0, "真实魔法伤害或冷却缺失。");
    }

    private static void CheckRestriction(string restriction)
    {
        Fixture fixture = new();
        Skill skill = fixture.Learn(new 金刚击());
        switch (restriction)
        {
            case "cooldown": skill.CurrentCD = 10; break;
            case "energy": fixture.Actor.EP = 0; break;
            case "quota": fixture.Queue.CharacterDecisionPoints[fixture.Actor].CurrentDecisionPoints = 0; break;
            case "disabled": skill.Enable = false; break;
        }
        double ep = fixture.Actor.EP;
        fixture.Use(SkillConfig(skill));
        DecisionEvaluationResult result = fixture.Actor.DecisionPolicy!.Evaluate(fixture.Context());
        Check(result.Decision?.ActionType == CharacterActionType.EndTurn, "不可执行规则没有回退。");
        Equal(ep, fixture.Actor.EP, "只读评估改变资源");
    }

    private static void CheckItem()
    {
        Fixture fixture = new();
        Item item = new 小回复药();
        item.Skills.Active!.Character = fixture.Actor;
        fixture.Actor.Items.Add(item);
        fixture.Actor.HP -= 1200;
        double hp = fixture.Actor.HP;
        fixture.Use(DecisionTableBuilder.Create("oshima:test-item").WithFallback("endTurn")
            .AddRule("recover", r => r.Target(Targets.Self()).Then(Actions.UseItem(item.Id, "self"))).Build());
        fixture.RunActor();
        Check(fixture.Actor.HP > hp && item.RemainUseTimes == 0 && !fixture.Actor.Items.Contains(item), "物品治疗或次数扣除不正确。");
        Check(fixture.Queue.LastRound.Actions.Any(a => a.Item == item && a.Heals.GetValueOrDefault(fixture.Actor) > 0), "物品治疗记录缺失。");
    }

    private static void CheckUnselectable()
    {
        Fixture fixture = new();
        Skill strike = fixture.Learn(new 金刚击());
        Skill wind = fixture.Learn(new 疾风步(), fixture.Enemy);
        wind.OnSkillCasted(fixture.Queue, fixture.Enemy, [fixture.Enemy], []);
        Check(fixture.Enemy.IsUnselectable, "真实疾风步未生效。");
        fixture.Use(SkillConfig(strike));
        DecisionEvaluationResult result = fixture.Actor.DecisionPolicy!.Evaluate(fixture.Context());
        Check(result.Decision!.Targets.SequenceEqual([fixture.OtherEnemy]), "策略选中了真实不可选中目标。");
    }

    private static void CheckModuleOverride()
    {
        Fixture fixture = new();
        fixture.Learn(new 金刚击());
        fixture.Use(DecisionTableBuilder.Create("oshima:test-stop").WithFallback("endTurn").Build());
        int decisions = 0;
        fixture.Queue.DecideActionEvent += _ => ++decisions == 1 ? CharacterActionType.NormalAttack : CharacterActionType.EndTurn;
        fixture.Queue.SelectNormalAttackTargetsEvent += _ => [fixture.Enemy];
        fixture.RunActor();
        Check(fixture.Queue.LastRound.Actions.Any(a => a.ActionType == CharacterActionType.NormalAttack && a.IsSuccess), "角色策略覆盖了宿主模组动作。");
    }

    private static void CheckHealingPredicate()
    {
        Fixture fixture = new();
        Skill skill = fixture.Learn(new 回复术());
        fixture.Use(SkillConfig(skill));
        Check(fixture.Actor.DecisionPolicy!.Evaluate(fixture.Context()).Decision?.ActionType == CharacterActionType.EndTurn, "满血友军绕过真实技能谓词。");
        fixture.Patient.HP = fixture.Patient.MaxHP * .4;
        DecisionEvaluationResult result = fixture.Actor.DecisionPolicy.Evaluate(fixture.Context());
        Check(result.Decision!.Targets.SequenceEqual([fixture.Patient]), "真实魔法未绑定受伤友军。");
    }

    private static void CheckInvalidation()
    {
        Fixture fixture = new();
        Skill skill = fixture.Learn(new 金刚击());
        fixture.Use(SkillConfig(skill));
        fixture.Actor.Effects.Add(new InvalidateSkillEffect(skill));
        fixture.RunActor();
        Check(fixture.Hits.Contains("cast"), "测试未形成待执行技能方案。");
        Check(!fixture.Queue.LastRound.Actions.Any(a => a.Skill == skill), "失效方案仍执行了真实技能。");
        Equal(100, fixture.Actor.EP, "失效方案扣资源");
    }

    private static void CheckChainPolicy()
    {
        Fixture fixture = new();
        fixture.Learn(new 回复弹(), fixture.Patient);
        fixture.Actor.HP = fixture.Actor.MaxHP * .4;
        fixture.Use(HealerConfig(), fixture.Patient);
        double hp = fixture.Actor.HP;
        bool selected = false;
        fixture.Queue.SelectChainActionEvent += (_, pending) =>
        {
            ChainActionRequest request = pending.Single(r => r.Actor == fixture.Patient);
            Check(request.Targets.SequenceEqual([fixture.Actor]), "协同策略未选中出队的受伤友军。");
            selected = true;
            return request.Id;
        };
        fixture.RunActor();
        Check(selected && fixture.Actor.HP > hp, "协同治疗没有生效。");
        Check(fixture.Queue.LastRound.Actions.Any(a => a.Actor == fixture.Patient && a.TurnActor == fixture.Actor &&
            a.Heals.GetValueOrDefault(fixture.Actor) > 0), "协同治疗记录或归属缺失。");
    }

    private sealed class InvalidateSkillEffect(Skill skill) : Effect(skill)
    {
        public override void OnCharacterActionStart(ActionContext context) => Skill.CurrentCD = 100;
    }
}
