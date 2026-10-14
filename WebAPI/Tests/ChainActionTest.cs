using System.Reflection;
using FunGame.Core.Api;
using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.Framework;
using FunGame.Core.Model.Queue;
using Milimoe.FunGameTesting.OshimaGameModules;
using Milimoe.FunGameTesting.OshimaGameModules.Characters;
using Milimoe.FunGameTesting.OshimaGameModules.Effects.OpenEffects;
using Milimoe.FunGameTesting.OshimaGameModules.Effects.PassiveEffects;
using Milimoe.FunGameTesting.OshimaGameModules.Items;
using Milimoe.FunGameTesting.OshimaGameModules.Skills;

namespace Milimoe.FunGameTesting.Tests;

/// <summary>通过 WebAPI 的完整模组初始化入口运行协同行动集成测试。</summary>
public static class ChainActionTest
{
    public static int RunAllTests()
    {
        var tests = new (string Name, Action Test)[]
        {
            ("完整模组数据已加载", () =>
            {
                Check(FunGameService.Characters.Count >= 18, "真实角色不足");
                Check(FunGameService.AllSkills.Count > 80 && FunGameService.AllItems.Count > 20, "完整技能/物品库未加载");
                Console.WriteLine($"  characters={FunGameService.Characters.Count}, skills={FunGameService.AllSkills.Count}, items={FunGameService.AllItems.Count}");
            }),
            ("手动回合收到 AI 队友申请，忽略申请不执行", () =>
            {
                Fixture f = new();
                f.Q.SetCharactersToAIControl(false, false, [f.B]);
                bool received = false;
                f.Q.DecideActionEvent += ctx =>
                {
                    Check(ctx.ChainActions.Any(request => request.Actor == f.B && request.TurnActor == f.A), "玩家选择行动前没有 AI 队友申请");
                    received = true;
                    return CharacterActionType.EndTurn;
                };
                f.Run(f.A);
                Check(received, "没有进入手动行动决策");
                Equal(7, f.Q.CharacterDecisionPoints[f.B].CurrentDecisionPoints, "忽略申请不消耗队友 DP");
                Check(!f.Q.LastRound.Actions.Any(action => action.Actor == f.B), "忽略申请仍执行了队友动作");
            }),
            ("协同展示使用实际配置费用", () =>
            {
                Fixture f = new();
                f.Q.GameplayEquilibriumConstant = new() { DecisionPointsCostChainAction = 2, ChainActionHardnessTime = 4 };
                foreach (DecisionPoints points in f.Q.CharacterDecisionPoints.Values)
                    points.GameplayEquilibriumConstant = f.Q.GameplayEquilibriumConstant;
                f.During(f.A, () =>
                {
                    ChainActionRequest request = Submit(f, f.A, f.B, CharacterActionType.NormalAttack, [f.D]);
                    FunGame.Testing.WebAPI.Services.ChainApplicationDto application = FunGame.Testing.WebAPI.Services.SoloGameMapper.ToChainApplication(request, f.Q);
                    Equal(1, application.ActorDecisionPointsCost, "协作方动作费用");
                    Equal(2, application.ConfirmationDecisionPointsCost, "配置的确认费用");
                    Equal(4, application.ConfirmationHardnessTime, "配置的确认硬直");
                    Equal(0, application.CastTime, "即时动作没有吟唱");
                    var quota = FunGame.Testing.WebAPI.Services.SoloGameMapper.ToDP(f.Q.CharacterDecisionPoints[f.A])!.Quotas.Single(q => q.ActionType == "ChainAction");
                    Equal(2, quota.DecisionPointCost, "菜单确认费用");
                });
            }),
            ("手动回合主动确认 AI 队友申请", () =>
            {
                Fixture f = new();
                f.Q.SetCharactersToAIControl(false, false, [f.B]);
                int decisions = 0;
                f.Q.DecideActionEvent += ctx => ++decisions == 1
                    ? CharacterActionType.ChainAction : CharacterActionType.EndTurn;
                Guid? selected = null;
                f.Q.SelectChainActionEvent += (_, pending) => selected = pending.Single(request => request.Actor == f.B).Id;
                f.Run(f.A);
                Check(selected is not null, "玩家没有选择申请");
                ActionRecord execution = f.Q.LastRound.Actions.Single(action => action.Actor == f.B);
                Check(execution.TurnActor == f.A && execution.ChainActionRequestId == selected, "执行归属或申请 ID 不匹配");
                Equal(7 - execution.DecisionPointsCost, f.Q.CharacterDecisionPoints[f.B].CurrentDecisionPoints, "确认后扣队友动作成本");
            }),
            ("AI 回合不替手动队友代选动作", () =>
            {
                Fixture f = new();
                f.Q.SetCharactersToAIControl(false, false, [f.A]);
                f.Q.DecideActionEvent += ctx =>
                {
                    Check(ctx.ChainActions.Count == 0, "手动队友被自动提交申请");
                    return CharacterActionType.EndTurn;
                };
                f.Run(f.A);
                Equal(7, f.Q.CharacterDecisionPoints[f.B].CurrentDecisionPoints, "手动队友的预算被消耗");
            }),
            ("真实普攻的伤害归属、双方硬直和确认公式", () =>
            {
                Fixture f = new();
                ChainActionRequest? request = null;
                f.Q.TurnStartEvent += ctx => { request = Submit(f, f.A, f.B, CharacterActionType.NormalAttack, [f.D]); return true; };
                int decisions = 0;
                f.Q.DecideActionEvent += ctx => ++decisions switch
                { 1 => CharacterActionType.NormalAttack, 2 => CharacterActionType.ChainAction, _ => CharacterActionType.EndTurn };
                f.Q.SelectNormalAttackTargetsEvent += ctx => [f.D];
                f.Q.SelectChainActionEvent += (actor, pending) => request?.Id;
                double bHardness = f.B.NormalAttack.RealHardnessTime, aHardness = f.A.NormalAttack.RealHardnessTime;
                f.Run(f.A);
                Equal(Calculation.Round2Digits(.5 + bHardness), f.Q.HardnessTime[f.B], "协作方即时硬直");
                Equal(Calculation.Round2Digits(Math.Max(aHardness, 3) + 2), f.Q.LastRound.HardnessTime, "确认参与最大硬直公式");
                var execution = f.Q.LastRound.Actions.Single(a => a.Actor == f.B);
                Check(execution.Damages.GetValueOrDefault(f.D) > 0, "真实普攻未记录 B 的伤害");
                Check(execution.TurnActor == f.A, "回合归属丢失");
                Equal(1, execution.DecisionPointsCost, "B 成本");
            }),
            ("真实战技金刚击的伤害、EP、冷却与特效记录", () =>
            {
                Fixture f = new();
                Skill skill = f.Learn(new 金刚击(f.B));
                double ep = f.B.EP, cost = skill.RealEPCost, hp = f.D.HP;
                double epAtRelease = double.NaN;
                f.Q.CharacterCastSkillEvent += ctx => { if (ctx.Skill == skill) epAtRelease = f.B.EP; };
                f.During(f.A, () =>
                {
                    var request = Submit(f, f.A, f.B, CharacterActionType.CastSkill, [f.D], skill);
                    var result = f.Q.ConfirmChainAction(f.A, request.Id);
                    Check(result.IsSuccess, result.FailReason);
                    Equal(cost, result.Record!.EPCost, "战技 EP 记录");
                    Equal(ep - cost, epAtRelease, "战技效果触发前的 EP 扣费（伤害可恢复能量）");
                    Equal(skill.RealCD, skill.CurrentCD, "战技冷却");
                    Check(f.D.HP < hp && result.Record!.Damages.GetValueOrDefault(f.D) > 0, "模组伤害未执行");
                    Check(f.Q.LastRound.Effects[f.B].Contains(skill), "实际执行者的模组特效记录缺失");
                });
            }),
            ("真实回复弹作用于当前角色，治疗贡献归 B", () =>
            {
                Fixture f = new();
                Skill skill = f.Learn(new 回复弹(f.B));
                f.A.HP -= 1000;
                double hp = f.A.HP;
                f.During(f.A, () =>
                {
                    var result = f.Q.ConfirmChainAction(f.A, Submit(f, f.A, f.B, CharacterActionType.CastSkill, [f.A], skill).Id);
                    Check(result.IsSuccess && f.A.HP > hp, "真实治疗未作用到出队的 A");
                    Check(result.Record!.Heals.GetValueOrDefault(f.A) > 0, "治疗记录缺失");
                    Check(f.Q.CharacterStatistics[f.B].TotalHeal > 0, "治疗贡献未归 B");
                    Equal(0, f.Q.CharacterStatistics[f.A].TotalHeal, "A 不承担 B 的治疗贡献");
                });
            }),
            ("真实爆发极寒渴望消耗 2 DP 并挂载自身增益", () =>
            {
                Fixture f = new();
                Skill skill = f.Learn(new 极寒渴望(f.B));
                int dp = f.Q.CharacterDecisionPoints[f.B].CurrentDecisionPoints;
                double lifesteal = f.B.Lifesteal;
                f.During(f.A, () =>
                {
                    var result = f.Q.ConfirmChainAction(f.A, Submit(f, f.A, f.B, CharacterActionType.CastSuperSkill, [f.B], skill).Id);
                    Check(result.IsSuccess, result.FailReason);
                    Equal(dp - 2, f.Q.CharacterDecisionPoints[f.B].CurrentDecisionPoints, "协同爆发 DP");
                    Equal(0, f.B.EP, "真实爆发 EP 消耗");
                    Check(f.B.Effects.Any(e => e is 极寒渴望特效) && f.B.Lifesteal > lifesteal, "模组增益未挂载");
                });
            }),
            ("真实小回复药扣次数并记录治疗", () =>
            {
                Fixture f = new();
                Item item = new 小回复药();
                item.Skills.Active!.Character = f.B;
                f.B.Items.Add(item);
                f.A.HP -= 2000;
                f.During(f.A, () =>
                {
                    var request = f.Q.SubmitChainAction(f.A, f.B, CharacterActionType.UseItem, [f.A], out string reason, item: item);
                    Check(request != null, reason);
                    var result = f.Q.ConfirmChainAction(f.A, request!.Id);
                    Check(result.IsSuccess && result.Record!.Heals.GetValueOrDefault(f.A) > 0, "模组物品效果未执行");
                    Equal(0, item.RemainUseTimes, "物品使用次数");
                    Check(!f.B.Items.Contains(item), "耗尽物品未移除");
                });
            }),
            ("真实冰霜攻击保留预算、冻结硬直与释放扣 MP", () =>
            {
                Fixture f = new();
                Skill skill = f.Learn(new 冰霜攻击(f.B));
                double mp = f.B.MP, castTime = skill.RealCastTime;
                int originalDP = f.Q.CharacterDecisionPoints[f.B].CurrentDecisionPoints;
                Guid requestId = Guid.Empty;
                f.During(f.A, () =>
                {
                    var request = Submit(f, f.A, f.B, CharacterActionType.PreCastSkill, [f.D], skill);
                    requestId = request.Id;
                    Check(f.Q.ConfirmChainAction(f.A, request.Id).IsCasting, "未开始真实魔法吟唱");
                    Equal(mp, f.B.MP, "吟唱开始不扣 MP");
                    Equal(Calculation.Round2Digits(castTime), f.Q.HardnessTime[f.B], "真实吟唱时间");
                    Check(!f.Q.AssistDetails[f.A].NotDamageAssistLastTime.ContainsKey(f.B), "开始吟唱不能计助攻");
                });
                f.OnlyNext(f.B);
                f.Run(f.B);
                Equal(Calculation.Round2Digits(.5 + skill.RealHardnessTime), f.Q.LastRound.HardnessTime, "冻结原硬直恢复");
                Equal(originalDP - 2, f.Q.CharacterDecisionPoints[f.B].CurrentDecisionPoints, "释放不补 DP");
                Equal(mp - skill.RealMPCost, f.B.MP, "真实魔法释放扣费");
                var action = f.Q.LastRound.Actions.Single();
                Check(action.IsSuccess && action.Damages.GetValueOrDefault(f.D) > 0, "真实魔法伤害未执行");
                Check(action.ChainActionRequestId == requestId && action.TurnActor == f.A, "吟唱归属丢失");
                RoundRecord decoded = JsonService.GetObject<RoundRecord>(JsonService.GetString(f.Q.LastRound.Snapshot()))!;
                Check(decoded.Actions.Single().ChainActionRequestId == requestId, "完整回合 JSON 关联丢失");
            }),
            ("真实金刚击打断协同魔法", () =>
            {
                Fixture f = new();
                Skill magic = f.Learn(new 冰霜攻击(f.B));
                Skill interrupt = new 金刚击(f.D) { Level = 1 };
                f.During(f.A, () =>
                {
                    f.Q.ConfirmChainAction(f.A, Submit(f, f.A, f.B, CharacterActionType.PreCastSkill, [f.D], magic).Id);
                    double remaining = f.Q.HardnessTime[f.B];
                    interrupt.OnSkillCasted(f.Q, f.D, [f.B], []);
                    Check(f.B.CharacterState != CharacterState.Casting, "真实打断特效没有终止吟唱");
                    Equal(.5 + remaining, f.Q.HardnessTime[f.B], "打断还原原硬直并保留剩余吟唱时间");
                    Check(!f.Q.AssistDetails[f.A].NotDamageAssistLastTime.ContainsKey(f.B), "打断不产生有效辅助");
                });
            }),
            ("协同吟唱结算领取并回收角色回合奖励", () =>
            {
                Fixture f = new();
                f.Q.InitRoundRewards(new() { { (long)EffectID.ExATK, false } }, true, id => new() { { "exatk", 60d } });
                Skill reward = Factory.OpenFactory.GetInstance<Skill>((long)EffectID.ExATK, "", []);
                f.Q.AddRoundReward(f.B, 1, reward);
                Skill magic = f.Learn(new 冰霜攻击(f.B));
                f.During(f.A, () => f.Q.ConfirmChainAction(f.A, Submit(f, f.A, f.B, CharacterActionType.PreCastSkill, [f.D], magic).Id));
                f.OnlyNext(f.B);
                f.Run(f.B);
                Check(f.Q.LastRound.RoundRewards.Contains(reward), "结算回合未领取角色回合奖励");
                Check(f.Q.LastRound.RoundRewardEvents.Any(r => r.Kind == RoundRewardEventKind.Gained && r.Skills.Contains(reward)), "奖励发放事件缺失");
                Check(f.Q.LastRound.RoundRewardEvents.Any(r => r.Kind == RoundRewardEventKind.Lost && r.Skills.Contains(reward)), "奖励回收事件缺失");
                Check(!f.B.Skills.Contains(reward) && !f.Q.QueryRoundRewards(f.B, 1).Contains(reward), "已结算的奖励未回收");
            }),
            ("模组雇佣兵提交及作为回合角色", () =>
            {
                Fixture f = new();
                雇佣兵 unit = new(f.A, "协同") { Level = 10 };
                unit.Recovery(100d);
                f.Q.AddCharacter(unit, .25, false);
                f.During(f.A, () =>
                {
                    var request = Submit(f, f.A, unit, CharacterActionType.NormalAttack, [f.D]);
                    Check(f.Q.ConfirmChainAction(f.A, request.Id).IsSuccess, "真实雇佣兵协作失败");
                });
                f.Q.AddCharacter(unit, 0, false);
                f.Q.ChangeCharacterHardnessTime(f.B, .5 - f.Q.HardnessTime[f.B], false, false);
                f.During(unit, () => Check(f.Q.GetAvailableChainActors(unit).Contains(f.B), "雇佣兵回合未识别主人队友"));
            }),
            ("真实战技跨队友回合消耗延续预算", () =>
            {
                Fixture f = new();
                Skill skill = f.Learn(new 金刚击(f.B));
                var dp = f.Q.CharacterDecisionPoints[f.B];
                int budget = dp.CurrentDecisionPoints;
                f.During(f.A, () => f.Q.ConfirmChainAction(f.A, Submit(f, f.A, f.B, CharacterActionType.NormalAttack, [f.D]).Id));
                f.Q.AddCharacter(f.C, 0, false);
                f.Q.ChangeCharacterHardnessTime(f.B, .5 - f.Q.HardnessTime[f.B], false, false);
                f.During(f.C, () => Check(f.Q.ConfirmChainAction(f.C, Submit(f, f.C, f.B, CharacterActionType.CastSkill, [f.D], skill).Id).IsSuccess, "跨回合协作失败"));
                Equal(budget - 3, dp.CurrentDecisionPoints, "两种动作延续扣减");
                Equal(1, dp.ActionTypes[CharacterActionType.NormalAttack], "普通攻击配额延续");
                Equal(1, dp.ActionTypes[CharacterActionType.CastSkill], "战技配额扣减");
            }),
            ("真实魔法资源不足后保留预算重新决策", () =>
            {
                Fixture f = new();
                Skill magic = f.Learn(new 冰霜攻击(f.B));
                f.During(f.A, () => f.Q.ConfirmChainAction(f.A, Submit(f, f.A, f.B, CharacterActionType.PreCastSkill, [f.D], magic).Id));
                f.B.MP = 0;
                f.Q.CharacterDecisionPoints[f.B].CurrentDecisionPoints = 3;
                int decisions = 0;
                f.Q.DecideActionEvent += ctx => ++decisions == 1 ? CharacterActionType.NormalAttack : CharacterActionType.EndTurn;
                f.Q.SelectNormalAttackTargetsEvent += ctx => [f.D];
                f.Q.AddCharacter(f.B, 0, false);
                f.Run(f.B);

                Check(decisions == 2, "释放失败后没有继续决策");
                Check(f.Q.CharacterDecisionPoints[f.B].CurrentDecisionPoints == 2, "失败后恢复了预算或重复扣费");
                ActionRecord failure = f.Q.LastRound.Actions.Single(a => !a.IsSuccess);
                Equal(f.Q.GameplayEquilibriumConstant.CastFailureHardnessTime, failure.HardnessTime, "失败尝试补偿硬直");
                Check(f.Q.LastRound.Actions.Any(a => a.ActionType == CharacterActionType.NormalAttack && a.IsSuccess), "后续真实普攻未执行");
            }),
            ("真实控制特效终止吟唱并保留控制状态", () =>
            {
                Fixture f = new();
                Skill magic = f.Learn(new 冰霜攻击(f.B));
                f.During(f.A, () => f.Q.ConfirmChainAction(f.A, Submit(f, f.A, f.B, CharacterActionType.PreCastSkill, [f.D], magic).Id));
                Skill source = new 金刚击(f.D) { Level = 1, GamingQueue = f.Q };
                new 完全行动不能("眩晕", EffectType.Stun, source, f.D).AddToCharacter(f.B);

                Check(f.B.CharacterState == CharacterState.NotActionable, "终止入口覆盖了真实控制状态");
                Check(f.Q.LastRound.Actions.Any(a => a.Actor == f.B && !a.IsSuccess), "控制打断缺少施法者失败记录");
            }),
            ("真实疾风步使普通魔法丢失全部目标", () =>
            {
                Fixture f = new();
                Skill magic = f.Learn(new 冰霜攻击(f.B));
                f.Q.AddCharacter(f.A, 10, false);
                f.Q.AddCharacter(f.B, 0, false);
                GamingQueue.DecideActionEventHandler decide = ctx => CharacterActionType.PreCastSkill;
                f.Q.DecideActionEvent += decide;
                f.Q.SelectSkillEvent += ctx => magic;
                f.Q.SelectSkillTargetsEvent += ctx => [f.D];
                f.Run(f.B);
                f.Q.DecideActionEvent -= decide;
                Skill wind = new 疾风步(f.D) { Level = 1, GamingQueue = f.Q };
                wind.OnSkillCasted(f.Q, f.D, [f.D], []);

                Check(f.D.IsUnselectable, "真实疾风步未施加不可选中");
                Check(f.B.CharacterState != CharacterState.Casting, "普通魔法未终止");
                Check(f.Q.LastRound.Actions.Any(a => a.Actor == f.B && !a.IsSuccess), "目标丢失缺少施法者失败记录");
            }),
            ("固定种子完整模组团队战斗与协同 AI", () =>
            {
                int totalChains = 0;
                foreach (int seed in new[] { 20261012, 20261013, 20261014 }) totalChains += RunModuleBattle(seed);
                Check(totalChains > 0, "完整对局未执行协同行动");
            }),
            ("现有回合奖励回归", () => RunExisting(typeof(RoundRewardTest), RoundRewardTest.RunAllTests)),
            ("现有特效自动记录回归", () => RunExisting(typeof(EffectAutoRecordTest), EffectAutoRecordTest.RunAllTests))
        };
        int failures = 0;
        foreach (var test in tests)
        {
            try { test.Test(); Console.WriteLine($"[PASS] {test.Name}"); }
            catch (Exception ex) { failures++; Console.WriteLine($"[FAIL] {test.Name}: {ex}"); }
        }
        Console.WriteLine($"ChainAction integration: {tests.Length - failures}/{tests.Length} passed");
        return failures == 0 ? 0 : 1;
    }

    private static int RunModuleBattle(int seed)
    {
        Random random = new(seed);
        List<Character> characters = [.. FunGameService.Characters.OrderBy(_ => random.Next()).Take(8).Select(c => c.Copy())];
        foreach (Character c in characters)
        {
            c.Level = 10;
            FunGameService.AddCharacterSkills(c, 1, 2, 2);
            foreach (Skill template in FunGameService.Skills.OrderBy(_ => random.Next()).Take(2))
            {
                Skill skill = template.Copy();
                skill.Level = 2;
                skill.AddSkillToCharacter(c);
            }
            c.Recovery(100d);
        }
        TeamGamingQueue queue = new(characters, _ => { }, seed: seed);
        queue.AddTeam("蓝队", characters.Take(4));
        queue.AddTeam("红队", characters.Skip(4));
        queue.InitActionQueue();
        queue.SetCharactersToAIControl(false, false, characters);
        queue.TurnStartEvent += ctx =>
        {
            Character owner = ctx.Trigger!;
            foreach (Character actor in queue.GetAvailableChainActors(owner))
            {
                List<Character> enemies = queue.GetEnemies(actor).Where(e => queue.Queue.Contains(e) && !e.IsUnselectable).ToList();
                List<Character> friends = queue.GetTeammates(actor).Where(e => queue.Queue.Contains(e) && !e.IsUnselectable).ToList();
                var options = actor.Skills.Where(s => s.IsActive && s.Level > 0).OrderBy(_ => random.Next()).ToList();
                bool submitted = false;
                foreach (Skill skill in options)
                {
                    CharacterActionType type = skill.SkillType switch
                    {
                        SkillType.Skill => CharacterActionType.CastSkill,
                        SkillType.SuperSkill => CharacterActionType.CastSuperSkill,
                        SkillType.Magic => CharacterActionType.PreCastSkill,
                        _ => CharacterActionType.None
                    };
                    List<Character> targets = skill.GetSelectableTargets(actor, enemies, friends, enemies, friends);
                    if (targets.Count == 0) continue;
                    targets = targets.Take(skill.RealCanSelectTargetCount(enemies, friends)).ToList();
                    if (queue.SubmitChainAction(owner, actor, type, targets, out _, skill) != null) { submitted = true; break; }
                }
                if (!submitted && enemies.Count > 0) queue.SubmitChainAction(owner, actor, CharacterActionType.NormalAttack, [enemies[0]], out _);
            }
            return true;
        };
        int turns = 0, chains = 0, actions = 0;
        // 上限 1500：Core #194（AI 自主提交/确认协同 + DP 判定改为 >=）后 seed 20261012 的对局
        // 由 <600 回合拉长到 1021 回合，属正常的消耗战而非卡死（HP 持续衰减直至分出胜负）。
        while (!queue.GameOver && turns < 1500 && queue.NextCharacter() is Character actor)
        {
            queue.ProcessTurn(actor);
            turns++;
            actions += queue.LastRound.Actions.Count;
            chains += queue.LastRound.Actions.Count(a => a.ActionType == CharacterActionType.ChainAction && a.IsSuccess);
            // 长局进度探针：只有超过 200 回合的对局才会打印，用于区分「变长」与「卡死」
            if (turns % 200 == 0)
            {
                double hp = characters.Sum(c => Math.Max(0, c.HP));
                Console.WriteLine($"    [probe] seed={seed} turn={turns} hpSum={hp:0} actions={actions} chains={chains}");
            }
            Check(queue.HardnessTime.Values.All(t => double.IsFinite(t) && t >= 0), "真实对局硬直无效");
            Check(queue.CharacterDecisionPoints.Values.All(dp => dp.CurrentDecisionPoints >= 0), "真实对局出现负预算");
        }
        Console.WriteLine($"  seed={seed}, turns={turns}, actions={actions}, chains={chains}, finished={queue.GameOver}");
        Check(queue.GameOver, $"种子 {seed} 在 1500 回合内没有正常结束");
        Check(actions > 0, "没有实际战斗记录");
        return chains;
    }

    private static void RunExisting(Type type, Action run)
    {
        FieldInfo failures = type.GetField("_failures", BindingFlags.NonPublic | BindingFlags.Static)!;
        failures.SetValue(null, 0);
        run();
        Check((int)failures.GetValue(null)! == 0, $"{type.Name} 存在失败断言");
    }
    private static ChainActionRequest Submit(Fixture f, Character owner, Character actor, CharacterActionType type, List<Character> targets, Skill? skill = null)
        => f.Q.SubmitChainAction(owner, actor, type, targets, out string reason, skill) ?? throw new InvalidOperationException(reason);
    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
    private static void Equal(double expected, double actual, string message)
        => Check(Math.Abs(expected - actual) < .001, $"{message}: expected {expected:0.####}, actual {actual:0.####}");

    private sealed class Fixture
    {
        public Character A { get; } = new OshimaShiya();
        public Character B { get; } = new NanGanYu();
        public Character C { get; } = new Yang();
        public Character D { get; } = new XinYin();
        public TeamGamingQueue Q { get; }
        public Fixture()
        {
            foreach (Character c in new[] { A, B, C, D })
            {
                c.Level = 10;
                c.InitialHP = 5000;
                c.InitialMP = 1000;
                c.ER = 0;
                c.Recovery(100d);
            }
            Q = new([A, B, C, D], _ => { }, seed: 20261012);
            Q.AddTeam("T1", [A, B, C]);
            Q.AddTeam("T2", [D]);
            Q.AddCharacter(A, 0, false);
            Q.AddCharacter(B, .5, false);
            Q.AddCharacter(D, .8, false);
            Q.AddCharacter(C, 1.2, false);
            foreach (DecisionPoints dp in Q.CharacterDecisionPoints.Values) dp.CurrentDecisionPoints = 7;
        }
        public Skill Learn(Skill skill)
        {
            skill.Level = 1;
            skill.AddSkillToCharacter(B);
            return skill;
        }
        public void Run(Character expected)
        {
            Character? actor = Q.NextCharacter();
            Check(actor == expected, $"应轮到 {expected}，实际 {actor}");
            Q.ProcessTurn(actor!);
        }
        public void During(Character owner, Action action)
        {
            GamingQueue.TurnStartEventHandler start = ctx =>
            {
                action();
                // 直接确认的协调方硬直由宿主入账。
                foreach (ActionRecord confirmation in Q.LastRound.Actions.Where(a => a.Actor == owner && a.ActionType == CharacterActionType.ChainAction && a.IsSuccess))
                {
                    confirmation.HardnessTime = Q.GameplayEquilibriumConstant.ChainActionHardnessTime;
                    Q.CharacterDecisionPoints[owner].ActionsHardnessTime.Add(confirmation.HardnessTime);
                }
                return true;
            };
            GamingQueue.DecideActionEventHandler decide = ctx => CharacterActionType.EndTurn;
            Q.TurnStartEvent += start;
            Q.DecideActionEvent += decide;
            try { Run(owner); }
            finally { Q.TurnStartEvent -= start; Q.DecideActionEvent -= decide; }
        }
        public void OnlyNext(Character actor)
        {
            foreach (Character other in Q.Queue.Where(c => c != actor).ToArray()) Q.RemoveCharacterFromQueue(other);
        }
    }
}
