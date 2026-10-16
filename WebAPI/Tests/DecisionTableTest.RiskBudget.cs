using FunGame.Core.Api;
using FunGame.Core.Controller;
using FunGame.Core.Entity;
using FunGame.Core.Model;
using FunGame.Core.Model.DecisionTable;
using FunGame.Core.Model.Framework;
using Milimoe.FunGameTesting.OshimaGameModules.Skills;

namespace Milimoe.FunGameTesting.Tests;

public static partial class DecisionTableTest
{
    private static void CheckActualRisk(string preference)
    {
        Fixture fixture = new(mapMode: true);
        fixture.Enemy.ExATR = fixture.OtherEnemy.ExATR = 100;
        Skill skill = fixture.Learn(new 冰霜攻击());
        ActionConfig action = Actions.CastSkill(skill.Id, movement: "never");
        action.PositionPreference = preference;
        action.BindPlan = "p";
        fixture.Use(DecisionTableBuilder.Create("oshima:test-risk").WithFallback("endTurn")
            .AddRule("risk", rule => rule.When(Conditions.Not(Conditions.Compare("plan.risk", "atMost", 0, "p"))).Then(action)).Build());
        DecisionEvaluationContext context = fixture.Context();
        Check(fixture.Actor.DecisionPolicy!.Evaluate(context).RuleId == "risk", "真实魔法的风险条件未读取实际威胁。");
        Equal(1, context.Metrics.PositionsEvaluated, "风险计算不额外移动搜索");
        Equal(1, context.Metrics.RiskEvaluations, "单位置风险计算次数");
        IReadOnlyList<DecisionPlan> plans = DecisionActionPlanner.Plan(context, action, null);
        Check(plans.Count > 0 && plans.All(plan => plan.Risk == 2), "真实魔法风险没有包含两个全图威胁。");
        Check(context.Metrics.RiskCacheHits > 0, "同局面规划没有复用风险缓存。");
    }

    private static void CheckRiskScoring()
    {
        Fixture fixture = new(mapMode: true);
        fixture.Enemy.ExATR = fixture.OtherEnemy.ExATR = 100;
        Skill skill = fixture.Learn(new 金刚击());
        fixture.Use(DecisionTableBuilder.Create("oshima:test-risk-fallback").Build());
        AIController ai = fixture.Queue.AI!;
        ai.EvaluatePlanEvent += (_, _) => 100;
        List<Character> enemies = [fixture.Enemy, fixture.OtherEnemy];
        AIDecision decision = ai.DecideAIAction(fixture.Actor, fixture.Queue.CharacterDecisionPoints[fixture.Actor],
            fixture.Queue.Map!.GetCharacterCurrentGrid(fixture.Actor), [.. fixture.Queue.Map.Grids.Values], [skill], [],
            enemies, [fixture.Patient, fixture.Ally], enemies, [fixture.Patient, fixture.Ally], 0, 1, 0);
        Check(decision.HasCandidate && decision.SkillToUse == skill, "默认 AI 没有规划真实金刚击。");
        Equal(98, decision.Score, "即时战技扣除两个敌人的位置威胁");
    }

    private static void CheckSharedBudget()
    {
        Fixture fixture = new();
        Skill skill = fixture.Learn(new 金刚击());
        ActionConfig first = Actions.NormalAttack();
        first.BindPlan = "p";
        fixture.Use(DecisionTableBuilder.Create("oshima:test-shared-budget").WithFallback("endTurn")
            .AddRule("miss", rule => rule.When(Conditions.Compare("plan.targetCount", "greaterThan", 100, "p")).Then(first))
            .AddRule("cast", rule => rule.Then(Actions.CastSkill(skill.Id))).Build());
        DecisionEvaluationContext context = fixture.Context(planBudget: 2);
        DecisionEvaluationResult result = fixture.Actor.DecisionPolicy!.Evaluate(context);
        Check(result.RuleId == "cast", "前序普攻规划挤占了后序真实战技预算。");
        Equal(2, context.Metrics.PolicyPlansEvaluated, "两条规则分别使用方案额度");
        Check(result.Diagnostics.Any(d => d.Path == "miss" && d.Code == "budget.truncated"), "缺少规则搜索截断诊断。");
        double hp = fixture.Enemy.HP + fixture.OtherEnemy.HP;
        fixture.RunActor();
        Check(fixture.Enemy.HP + fixture.OtherEnemy.HP < hp && fixture.Hits.Contains("cast"), "预算分配后的真实战技未结算。");
    }
}
