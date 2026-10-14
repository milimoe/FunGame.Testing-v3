using System.Diagnostics;
using System.Globalization;
using FunGame.Core.Api;
using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.DecisionTable;
using FunGame.Core.Model.Framework;
using FunGame.Core.Model.Queue;
using Milimoe.FunGameTesting.OshimaGameModules.Characters;
using Milimoe.FunGameTesting.OshimaGameModules.Skills;

namespace Milimoe.FunGameTesting.Tests;

public static partial class DecisionTableTest
{
    private static void AddBattleTests(List<(string Name, Action Test)> tests)
    {
        tests.Add(("空表回退保持默认 AI 序列", CheckEmptyFallback));
        foreach (bool map in new[] { false, true })
            foreach (AISelectionMode selection in new[] { AISelectionMode.Deterministic, AISelectionMode.WeightedNearBest })
            {
                bool mapMode = map;
                AISelectionMode mode = selection;
                tests.Add(($"完整模组战斗与固定种子重放（map={map}, mode={selection}）", () => CheckModuleBattles(mapMode, mode)));
                tests.Add(($"有界空表对照（map={map}, mode={selection}）", () => CheckControls(mapMode, mode)));
            }
        tests.Add(("真实模组施法规划采样", MeasurePlanning));
    }

    private static AIDecision Decide(Fixture fixture)
    {
        DecisionEvaluationContext context = fixture.Context();
        return fixture.Queue.AI!.DecideAIAction(context.Actor, context.Points, context.TurnOrigin, [.. context.MoveGrids],
            [.. context.Skills], [.. context.Items], [.. context.Enemies], [.. context.Allies], [.. context.SelectableEnemies], [.. context.SelectableAllies], 0, .5, .5);
    }

    private static string Describe(AIDecision decision) => $"{decision.ActionType}:{decision.SkillToUse?.Id}:{decision.TargetMoveGrid?.Id}:{string.Join(',', decision.Targets.Select(t => t.Guid))}";

    private static void CheckEmptyFallback()
    {
        Fixture empty = new();
        Fixture ordinary = new();
        empty.Learn(new 金刚击());
        ordinary.Learn(new 金刚击());
        empty.Use(DecisionTableBuilder.Create("oshima:test-empty").Build());
        ordinary.Actor.DecisionTableId = null;
        empty.Queue.AI!.SelectionMode = ordinary.Queue.AI!.SelectionMode = AISelectionMode.WeightedNearBest;
        for (int index = 0; index < 50; index++) Check(Describe(Decide(empty)) == Describe(Decide(ordinary)), "空表改变默认随机选择序列。");
    }

    private static DecisionTableConfig BattleConfig()
    {
        ActionConfig area = Actions.CastSkill((long)MagicID.火山咆哮, movement: "never");
        area.BindPlan = "cluster";
        area.PositionPreference = "coverage";
        return DecisionTableBuilder.Create("oshima:test-battle")
            .AddRule("recover", r => r.Priority(100).Target(Targets.Allies("patient"))
                .When(Conditions.All(Conditions.TargetHpRatio("patient", "lessThan", .5), Conditions.SkillAvailable((long)SkillID.回复弹)))
                .Then(Actions.CastSkill((long)SkillID.回复弹, "patient")))
            .AddRule("cluster", r => r.Priority(90).When(Conditions.All(Conditions.SkillAvailable((long)MagicID.火山咆哮),
                Conditions.Compare("plan.targetCount", "atLeast", 2, "cluster"))).Then(area))
            .AddRule("strike", r => r.Priority(80).Target(Targets.Enemies("victim"))
                .When(Conditions.SkillAvailable((long)SkillID.金刚击)).Then(Actions.CastSkill((long)SkillID.金刚击, "victim")))
            .AddRule("magic", r => r.Priority(70).Target(Targets.Enemies("victim"))
                .When(Conditions.SkillAvailable((long)MagicID.冰霜攻击)).Then(Actions.CastSkill((long)MagicID.冰霜攻击, "victim", "never")))
            .AddRule("attack", r => r.Priority(60).Target(Targets.Enemies("victim", "nearest")).Then(Actions.NormalAttack("victim"))).Build();
    }

    private static void CheckModuleBattles(bool mapMode, AISelectionMode mode)
    {
        foreach (int seed in new[] { 20261012, 20261013, 20261014 })
        {
            List<string> first = RunModuleBattle(seed, mapMode, mode, true);
            List<string> repeated = RunModuleBattle(seed, mapMode, mode, true);
            Check(first.SequenceEqual(repeated), $"seed={seed} 的完整行动序列不可重放。");
        }
    }

    private static void CheckControls(bool mapMode, AISelectionMode mode)
    {
        foreach (int seed in new[] { 20261012, 20261013, 20261014 }) RunModuleBattle(seed, mapMode, mode, false);
    }

    private static List<string> RunModuleBattle(int seed, bool mapMode, AISelectionMode mode, bool usePolicy)
    {
        List<Character> characters = [new OshimaShiya(), new NanGanYu(), new Yang(), new ColdBlue(), new XinYin(), new QingXiang()];
        for (int index = 0; index < characters.Count; index++)
        {
            Character character = characters[index];
            character.Guid = new Guid(index + 1, 0, 0, new byte[8]);
            character.Level = 10;
            character.NormalAttack.Level = 2;
            FunGameService.AddCharacterSkills(character, 1, 1, 1);
            foreach (Skill skill in new Skill[] { new 回复弹(), new 金刚击(), new 冰霜攻击(), new 火山咆哮() })
            {
                skill.Level = 1;
                skill.AddSkillToCharacter(character);
            }
            character.Recovery(100d);
            character.EP = 100;
        }
        TeamGamingQueue queue = new(_ => { }, mapMode ? new DecisionMap(12) : null, seed: seed);
        queue.InitCharacters(characters, regenerateGuids: false);
        queue.AddTeam("blue", characters.Take(3));
        queue.AddTeam("red", characters.Skip(3));
        DecisionTableLoader loader = NewLoader();
        Register(loader, usePolicy ? BattleConfig() : DecisionTableBuilder.Create("oshima:test-empty").Build());
        foreach (Character character in characters) Bind(loader, character, usePolicy ? "oshima:test-battle" : "oshima:test-empty");
        queue.InitActionQueue();
        queue.SetCharactersToAIControl(false, false, [.. characters]);
        foreach (DecisionPoints points in queue.CharacterDecisionPoints.Values)
        {
            points.CurrentDecisionPoints = points.MaxDecisionPoints = 3;
            points.RecoverDecisionPointsPerRound = 3;
        }
        queue.AI!.SelectionMode = mode;
        if (queue.Map is GameMap map)
        {
            (int X, int Y)[] positions = [(2, 2), (2, 3), (3, 2), (8, 8), (8, 9), (9, 8)];
            for (int index = 0; index < characters.Count; index++)
                map.SetCharacterCurrentGrid(characters[index], map[positions[index].X, positions[index].Y]!);
        }
        int hits = 0;
        queue.AI.PolicyEvaluatedEvent += (_, result, _) => { if (result.RuleId != null) hits++; };
        List<string> trace = [];
        Dictionary<string, int> actionsBySkill = [];
        int recentEffectiveActions = 0;
        int turns = 0;
        while (!queue.GameOver && turns < 1000)
        {
            Character actor = queue.NextCharacter() ?? throw new InvalidOperationException("战斗未结束但没有下一角色。");
            queue.ProcessTurn(actor);
            turns++;
            foreach (ActionRecord action in queue.LastRound.Actions)
            {
                string key = action.Skill?.Name ?? action.ActionType.ToString();
                actionsBySkill[key] = actionsBySkill.GetValueOrDefault(key) + 1;
                if (turns > 800 && (action.Damages.Values.Any(d => d > 0) || action.Heals.Values.Any(h => h > 0))) recentEffectiveActions++;
                string damage = string.Join(',', action.Damages.OrderBy(pair => pair.Key.Guid)
                    .Select(pair => $"{pair.Key.Id}:{pair.Value.ToString("F4", CultureInfo.InvariantCulture)}"));
                trace.Add($"{action.Actor.Id}:{action.ActionType}:{action.Skill?.Id}:{action.IsSuccess}:{string.Join(',', action.Targets.Select(t => t.Id))}:{damage}");
            }
            Check(trace.Count <= 5000, "完整模组对局动作数量超出保护上限。");
            Check(queue.HardnessTime.Values.All(t => double.IsFinite(t) && t >= 0), "硬直出现非法数值。");
            Check(characters.All(c => double.IsFinite(c.HP) && double.IsFinite(c.MP) && c.MP >= 0 && c.EP >= 0), "角色资源出现非法数值。");
            if (turns % 200 == 0) Console.WriteLine($"    [probe] seed={seed}, map={mapMode}, mode={mode}, policy={usePolicy}, turns={turns}, hp={characters.Sum(c => c.HP):F1}, alive={characters.Count(c => c.HP > 0)}");
        }
        string diagnostics = $"seed={seed}, map={mapMode}, mode={mode}, policy={usePolicy} 达到 1000 回合上限。" +
            $"状态：{string.Join(';', characters.Where(c => c.HP > 0).Select(c => $"{c.Name}:hp={c.HP:F1},mp={c.MP:F1},ep={c.EP:F1},state={c.CharacterState}"))}。" +
            $"动作：{string.Join(',', actionsBySkill.Select(pair => $"{pair.Key}={pair.Value}"))}";
        Check(queue.GameOver || !usePolicy && turns == 1000 && recentEffectiveActions > 0, diagnostics);
        if (!queue.GameOver) Console.WriteLine($"    [OBSERVATION] {diagnostics}。末 200 回合有效伤害/治疗行动={recentEffectiveActions}");
        Check(trace.Count > 0 && (!usePolicy || hits > 0), "完整对局没有执行策略。");
        Console.WriteLine($"  seed={seed}, map={mapMode}, mode={mode}, policy={usePolicy}, turns={turns}, actions={trace.Count}, hits={hits}, finished={queue.GameOver}");
        return trace;
    }

    private static void MeasurePlanning()
    {
        foreach ((bool map, bool area) in new (bool, bool)[] { (false, false), (true, false), (true, true) })
        {
            Fixture fixture = new(map, size: 48);
            Skill skill = fixture.Learn(area ? new 火山咆哮() : new 冰霜攻击());
            fixture.Use(SkillConfig(skill));
            List<double> samples = [];
            for (int index = 0; index < 51; index++)
            {
                long start = Stopwatch.GetTimestamp();
                AIDecision decision = Decide(fixture);
                double elapsed = Stopwatch.GetElapsedTime(start).TotalMilliseconds;
                Check(decision.SkillToUse == skill && decision.HasCandidate, "采样没有取得真实技能方案。");
                if (index > 0) samples.Add(elapsed);
            }
            samples.Sort();
            Console.WriteLine($"  map={map}, skill={skill.Name}, medianMs={samples[24]:F3}, p95Ms={samples[47]:F3}, " +
                $"positions={fixture.Queue.AI!.LastMetrics!.PositionsEvaluated}, centers={fixture.Queue.AI.LastMetrics.CentersEvaluated}");
        }
    }
}
