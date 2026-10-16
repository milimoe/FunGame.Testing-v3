using FunGame.Core.Api;
using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model;
using FunGame.Core.Model.DecisionTable;
using FunGame.Core.Model.Framework;
using Milimoe.FunGameTesting.OshimaGameModules.Skills;

namespace Milimoe.FunGameTesting.Tests;

public static partial class DecisionTableTest
{
    private static void AddMapTests(List<(string Name, Action Test)> tests)
    {
        tests.Add(("全图指向性原地规划", CheckGlobalDirectional));
        foreach (string preference in new[] { "current", "coverage", "safe" })
        {
            string current = preference;
            tests.Add(($"真实魔法风险条件与缓存（{preference}）", () => CheckActualRisk(current)));
        }
        tests.Add(("真实即时战技使用位置风险评分", CheckRiskScoring));
        tests.Add(("规则共享预算后真实战技继续执行", CheckSharedBudget));
        tests.Add(("有限射程移动后执行真实金刚击", CheckMoveToCast));
        tests.Add(("有限射程协同禁止移动", CheckChainRange));
        tests.Add(("风险上限拒绝危险吟唱", CheckUnsafeCasting));
        foreach (bool global in new[] { false, true })
        {
            bool castAnywhere = global;
            tests.Add(($"真实火山咆哮空地覆盖与结算（global={global}）", () => CheckAreaCasting(castAnywhere)));
        }
        tests.Add(("真实岩石之息的假设起点投影", () => CheckDirectionalProjection(new 岩石之息())));
        tests.Add(("真实地狱之门的假设起点投影", () => CheckDirectionalProjection(new 地狱之门())));
    }

    private static void CheckGlobalDirectional()
    {
        Fixture fixture = new(mapMode: true, size: 48);
        Skill skill = fixture.Learn(new 冰霜攻击());
        DecisionEvaluationContext context = fixture.Context();
        IReadOnlyList<DecisionPlan> plans = DecisionActionPlanner.Plan(context, Actions.CastSkill(skill.Id), Targets.Enemies());
        Check(plans.Count > 0 && context.Metrics.PositionsEvaluated == 1, "全图指向性仍重复评估站位。");
        Check(plans.All(p => p.Decision.TargetMoveGrid == context.TurnOrigin), "原地策略产生多余移动。");
    }

    private static DecisionTableConfig FocusConfig(Skill skill) => DecisionTableBuilder.Create("oshima:test-range").WithFallback("endTurn")
        .AddRule("focus", r => r.Target(Targets.Enemies("victim"))
            .When(Conditions.TargetHpRatio("victim", "lessThan", .3))
            .Then(Actions.CastSkill(skill.Id, "victim"))).Build();

    private static Fixture RangedFixture()
    {
        Fixture fixture = new(mapMode: true);
        fixture.Queue.Map!.SetCharacterCurrentGrid(fixture.OtherEnemy, fixture.Queue.Map[11, 4]!);
        fixture.OtherEnemy.HP = fixture.OtherEnemy.MaxHP * .2;
        Skill skill = fixture.Learn(new 金刚击());
        fixture.Use(FocusConfig(skill));
        return fixture;
    }

    private static void CheckMoveToCast()
    {
        Fixture fixture = RangedFixture();
        Grid original = fixture.Queue.Map!.GetCharacterCurrentGrid(fixture.Actor)!;
        double hp = fixture.OtherEnemy.HP;
        fixture.RunActor();
        Check(fixture.Queue.Map.GetCharacterCurrentGrid(fixture.Actor) != original, "有限射程未移动到合法站位。");
        Check(fixture.Hits.Contains("focus") && fixture.OtherEnemy.HP < hp, "移动后规则技能未执行。");
        Check(fixture.Queue.LastRound.Actions.Any(a => a.Skill is 金刚击 && a.IsSuccess && a.Targets.Contains(fixture.OtherEnemy)), "真实移动施法记录缺失。");
    }

    private static void CheckChainRange()
    {
        Fixture fixture = RangedFixture();
        DecisionEvaluationResult result = fixture.Actor.DecisionPolicy!.Evaluate(fixture.Context(chain: true));
        Check(result.Decision?.ActionType == CharacterActionType.EndTurn, "协同规划绕过原地射程。");
    }

    private static void CheckUnsafeCasting()
    {
        Fixture fixture = new(mapMode: true);
        Skill skill = fixture.Learn(new 冰霜攻击());
        fixture.Enemy.ExATR = fixture.OtherEnemy.ExATR = 100;
        ActionConfig action = Actions.CastSkill(skill.Id);
        action.PositionPreference = "safe";
        action.MaxRisk = 0;
        fixture.Use(DecisionTableBuilder.Create("oshima:test-safe").WithFallback("endTurn")
            .AddRule("channel", r => r.Then(action)).Build());
        DecisionEvaluationResult result = fixture.Actor.DecisionPolicy!.Evaluate(fixture.Context());
        Check(result.Decision?.ActionType == CharacterActionType.EndTurn, "风险上限没有阻止吟唱。");
    }

    private static void CheckAreaCasting(bool global)
    {
        Fixture fixture = new(mapMode: true);
        GameMap map = fixture.Queue.Map!;
        map.SetCharacterCurrentGrid(fixture.OtherEnemy, map[11, 4]!);
        Skill skill = fixture.Learn(new 火山咆哮());
        skill.SkillType = global ? SkillType.Magic : SkillType.Skill;
        skill.CastAnywhere = global;
        skill.CastRange = 3;
        ActionConfig action = Actions.CastSkill(skill.Id, movement: "never");
        action.BindPlan = "area";
        action.PositionPreference = "coverage";
        fixture.Use(DecisionTableBuilder.Create("oshima:test-area").WithFallback("endTurn")
            .AddRule("cluster", r => r.When(Conditions.Compare("plan.targetCount", "atLeast", 2, "area")).Then(action)).Build());
        DecisionEvaluationContext context = fixture.Context();
        DecisionEvaluationResult result = fixture.Actor.DecisionPolicy!.Evaluate(context);
        Check(result.RuleId == "cluster" && result.Decision!.Targets.Count == 2, "真实范围技能没有覆盖两个敌人。");
        Grid center = result.Decision!.CastCenter!;
        Check(center.Characters.Count == 0, "最佳候选没有保留敌人之间的空地。");
        int reference = map.GetGridsByRange(context.TurnOrigin!, skill.CastRange, true).Max(grid =>
            skill.SelectTargetsByRangeFrom(fixture.Actor, context.TurnOrigin!, [fixture.Enemy, fixture.OtherEnemy], [fixture.Patient, fixture.Ally],
                skill.SelectNonDirectionalTargets(fixture.Actor, grid, true)).Count);
        Equal(reference, result.Decision.Targets.Count, "真实范围覆盖与全量参考");
        double hp = fixture.Enemy.HP;
        double otherHp = fixture.OtherEnemy.HP;
        fixture.RunActor();
        fixture.FinishCasting(skill);
        Check(fixture.Enemy.HP < hp && fixture.OtherEnemy.HP < otherHp, "真实范围伤害没有作用到两个目标。");
        Console.WriteLine($"  global={global}, center=({center.X},{center.Y}), candidates={context.Metrics.CentersGenerated}, projections={context.Metrics.CentersEvaluated}");
    }

    private static void CheckDirectionalProjection(Skill template)
    {
        Fixture fixture = new(mapMode: true);
        Skill skill = fixture.Learn(template);
        GameMap map = fixture.Queue.Map!;
        Grid original = map.GetCharacterCurrentGrid(fixture.Actor)!;
        Grid hypothetical = map[5, 5]!;
        Grid center = map[8, 4]!;
        List<Grid> projected = skill.SelectNonDirectionalTargetsFrom(fixture.Actor, hypothetical, center, true);
        Check(map.GetCharacterCurrentGrid(fixture.Actor) == original, "规划修改真实位置。");
        map.SetCharacterCurrentGrid(fixture.Actor, hypothetical);
        Check(projected.SequenceEqual(skill.SelectNonDirectionalTargets(fixture.Actor, center, true)), "模组方向范围与真实移动不一致。");
    }
}
