using FunGame.Core.Api;
using FunGame.Core.Controller;
using FunGame.Core.Entity;
using FunGame.Core.Model.DecisionTable;
using FunGame.Core.Model.Framework;
using Milimoe.FunGameTesting.OshimaGameModules.Skills;

namespace Milimoe.FunGameTesting.Tests;

public static partial class DecisionTableTest
{
    private static void AddLifecycleTests(List<(string Name, Action Test)> tests)
    {
        foreach (bool mapped in new[] { false, true })
        {
            bool initiallyMapped = mapped;
            tests.Add(($"AI 生命周期换图后真实治疗（map={mapped}）", () => CheckLifecycleHealing(initiallyMapped)));
        }
        tests.Add(("AI 生命周期开关换图后协同治疗", CheckLifecycleChain));
    }

    private static void ReloadAIMap(Fixture fixture)
    {
        AIController ai = fixture.Queue.AI!;
        ai.ScoreTolerance = 17;
        ai.MovementBenefitThreshold = 4;
        ai.RepeatedPositionPenalty = 8;
        for (int i = 0; i < 3; i++)
        {
            fixture.Queue.EnableAI = false;
            Check(fixture.Queue.AI == null, "关闭期间仍暴露队列 AI。");
            fixture.Queue.LoadGameMap(new DecisionMap(12));
            Check(ReferenceEquals(ai.Map, fixture.Queue.Map), "禁用期间未同步已持有控制器的地图。");
            fixture.Queue.EnableAI = true;
            Check(ReferenceEquals(ai, fixture.Queue.AI), "重新启用丢失控制器实例。");
        }
        Check(ai.SelectionMode == AISelectionMode.Deterministic && ai.ScoreTolerance == 17 &&
            ai.MovementBenefitThreshold == 4 && ai.RepeatedPositionPenalty == 8, "控制器配置未保留。");
        GameMap map = fixture.Queue.Map!;
        map.SetCharacterCurrentGrid(fixture.Actor, map[5, 4]!);
        map.SetCharacterCurrentGrid(fixture.Patient, map[4, 4]!);
        map.SetCharacterCurrentGrid(fixture.Ally, map[4, 5]!);
        map.SetCharacterCurrentGrid(fixture.Enemy, map[7, 4]!);
        map.SetCharacterCurrentGrid(fixture.OtherEnemy, map[8, 4]!);
    }

    private static void CheckLifecycleHealing(bool initiallyMapped)
    {
        Fixture fixture = new(mapMode: initiallyMapped);
        Skill skill = fixture.Learn(new 回复弹());
        fixture.Patient.HP = fixture.Patient.MaxHP * .4;
        double hp = fixture.Patient.HP;
        fixture.Use(HealerConfig());
        ReloadAIMap(fixture);
        fixture.RunActor();
        Check(fixture.Patient.HP > hp && fixture.Hits.Count(id => id == "heal-patient") == 1,
            "换图后的治疗未执行，或策略订阅丢失/重复。");
        Check(fixture.Queue.LastRound.Actions.Any(action => action.Skill == skill && action.IsSuccess &&
            action.Heals.GetValueOrDefault(fixture.Patient) > 0), "换图后缺少真实治疗结算。");
    }

    private static void CheckLifecycleChain()
    {
        Fixture fixture = new(mapMode: true);
        Skill skill = fixture.Learn(new 回复弹(), fixture.Patient);
        fixture.Actor.HP = fixture.Actor.MaxHP * .4;
        double hp = fixture.Actor.HP;
        fixture.Use(HealerConfig(), fixture.Patient);
        int policyHits = 0;
        fixture.Queue.AI!.PolicyEvaluatedEvent += (actor, result, _) =>
        {
            if (actor == fixture.Patient && result.RuleId == "heal-patient") policyHits++;
        };
        ReloadAIMap(fixture);
        fixture.Queue.SelectChainActionEvent += (_, pending) => pending.Single(request => request.Actor == fixture.Patient).Id;
        fixture.RunActor();
        Check(fixture.Actor.HP > hp && policyHits == 1, "开关换图后协同策略未执行，或订阅丢失/重复。");
        Check(fixture.Queue.LastRound.Actions.Any(action => action.Skill == skill && action.Actor == fixture.Patient &&
            action.TurnActor == fixture.Actor && action.Heals.GetValueOrDefault(fixture.Actor) > 0), "协同治疗归属或结算缺失。");
    }
}
