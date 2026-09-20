using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.EffectContext;
using FunGame.Core.Model.Queue;
using Milimoe.FunGameTesting.OshimaGameModules;
using Milimoe.FunGameTesting.OshimaGameModules.Characters;
using Milimoe.FunGameTesting.OshimaGameModules.Effects.OpenEffects;

namespace Milimoe.FunGameTesting.Tests
{
    /// <summary>
    /// 回合奖励引擎回归测试：双表（回合绑定 / 角色绑定）、被动奖励挂载与回收、吟唱回合顺延、offset 语义的查询/增加/移除/夺取、召唤物折算到 Master。
    /// <para/>对应变更：修复「被动回合奖励只加入 Skills、特效从不挂载」的既有缺陷；<c>InitRoundRewards</c> 去掉 maxRound / maxRewardsInRound。
    /// </summary>
    public class RoundRewardTest
    {
        private static int _failures = 0;

        public static void RunAllTests()
        {
            Console.WriteLine("=== 回合奖励引擎回归测试（RoundRewardTest）===");
            TestPassiveRewardMountedAndRecycled();
            TestCastingRoundCarryOver();
            TestCharacterBoundTableApi();
            TestSummonRewardRedirectToMaster();
            Console.WriteLine($"回合奖励回归测试完成：{(_failures == 0 ? "全部通过" : $"{_failures} 个断言失败")}");
        }

        /// <summary>
        /// 场景1：被动奖励必须真正挂载特效到 character.Effects（修复前恒为 0 挂载），且回合结束全部回收
        /// </summary>
        private static void TestPassiveRewardMountedAndRecycled()
        {
            OshimaShiya hero = new();
            XinYin rival = new();
            MixGamingQueue queue = CreateQueue([hero, rival]);

            int passiveSkills = 0;
            int mounted = 0;
            HashSet<Skill> gained = [];
            HashSet<Skill> lost = [];
            queue.RoundRewardGainedAfterEvent += (RoundRewardContext ctx) =>
            {
                Character owner = ctx.Trigger!;
                foreach (Skill s in ctx.Skills)
                {
                    gained.Add(s);
                    if (s.IsActive) continue;
                    passiveSkills++;
                    if (s.Effects.Count > 0 && s.Effects.All(e => owner.Effects.Contains(e)))
                    {
                        mounted++;
                    }
                }
            };
            queue.RoundRewardLostAfterEvent += (RoundRewardContext ctx) =>
            {
                foreach (Skill s in ctx.Skills)
                {
                    lost.Add(s);
                }
            };

            queue.InitRoundRewards(new() { { (long)EffectID.ExATK, false } }, false, id => new() { { "exatk", 60d } });
            RunTurns(queue, 2000);

            Check(passiveSkills > 0, "存在被动奖励发放", $"被动奖励数={passiveSkills}");
            Check(passiveSkills > 0 && mounted == passiveSkills, "被动奖励的特效已挂载到 character.Effects",
                $"完整挂载={mounted}/{passiveSkills}");
            Check(gained.Count - lost.Count == 0, "回合奖励无泄漏（全部被回收）",
                $"发放={gained.Count} 移除={lost.Count}");
        }

        /// <summary>
        /// 场景2：回合以吟唱结束时，被动奖励顺延到结算回合并在该回合结束清除（IsCarryOver）
        /// <para/>注入点：<see cref="GamingQueue.CharacterDecisionCompletedEvent"/> 位于回合结束回收奖励之前，
        /// 在此把状态置为吟唱态即等价于「该回合以一次吟唱操作结束」；回合开始事件里还原，避免污染后续回合。
        /// </summary>
        private static void TestCastingRoundCarryOver()
        {
            OshimaShiya caster = new();
            XinYin dummy = new();
            MixGamingQueue queue = CreateQueue([caster, dummy]);

            int injected = 0;
            queue.CharacterDecisionCompletedEvent += ctx =>
            {
                if (ReferenceEquals(ctx.Trigger, caster))
                {
                    caster.CharacterState = CharacterState.Casting;
                    injected++;
                }
            };
            queue.TurnStartEvent += ctx =>
            {
                if (ReferenceEquals(ctx.Trigger, caster) && caster.CharacterState == CharacterState.Casting)
                {
                    caster.CharacterState = CharacterState.Actionable;
                }
                return true;
            };

            int carryOverRemoved = 0;
            HashSet<Skill> gained = [];
            HashSet<Skill> lost = [];
            queue.RoundRewardGainedAfterEvent += (RoundRewardContext ctx) =>
            {
                foreach (Skill s in ctx.Skills)
                {
                    gained.Add(s);
                }
            };
            queue.RoundRewardLostAfterEvent += (RoundRewardContext ctx) =>
            {
                foreach (Skill s in ctx.Skills)
                {
                    lost.Add(s);
                    if (ctx.IsCarryOver)
                    {
                        carryOverRemoved++;
                    }
                }
            };

            queue.InitRoundRewards(new() { { (long)EffectID.ExATK, false } }, false, id => new() { { "exatk", 60d } });
            RunTurns(queue, 600);

            Check(injected > 0, "成功构造「回合以吟唱结束」的局面", $"注入回合数={injected}");
            Check(carryOverRemoved > 0, "被动奖励在吟唱回合顺延，并在结算回合以 IsCarryOver 移除",
                $"顺延移除={carryOverRemoved}");
            Check(gained.Count - lost.Count == 0, "顺延链路无残留", $"发放={gained.Count} 移除={lost.Count}");
        }

        /// <summary>
        /// 场景3：角色绑定表的对外 API（offset 语义、真只读暴露、null 校验、夺取的合并与引用转移）
        /// </summary>
        private static void TestCharacterBoundTableApi()
        {
            OshimaShiya a = new();
            OshimaShiya b = new();
            MixGamingQueue queue = CreateQueue([a, b]);
            queue.InitRoundRewards(new() { { (long)EffectID.ExATK, false } }, true, id => new() { { "exatk", 60d } });

            Check(queue.CharacterRoundRewards.Count > 0, "启用角色绑定时为参战角色生成奖励表",
                $"角色表数={queue.CharacterRoundRewards.Count}");

            OshimaShiya c = new();
            MixGamingQueue plain = CreateQueue([c]);
            plain.InitRoundRewards(new() { { (long)EffectID.ExATK, false } }, false, id => new() { { "exatk", 60d } });
            Check(plain.CharacterRoundRewards.Count == 0, "默认不启用角色绑定：不生成角色表");

            IReadOnlyList<Skill> at0 = queue.QueryRoundRewards(a, 0);
            IReadOnlyList<Skill> at1 = queue.QueryRoundRewards(a, 1);
            Check(at0.SequenceEqual(at1), "offset 夹取为 >= 1");

            Skill sample = queue.RoundRewards.Values.SelectMany(v => v).First();
            int offset = -1;
            for (int off = 1; off <= 60; off++)
            {
                if (queue.QueryRoundRewards(b, off).Count > 0)
                {
                    offset = off;
                    break;
                }
            }
            Check(offset > 0, "角色绑定表在 1000 窗口内存在奖励", $"命中 offset={offset}");
            if (offset <= 0) return;

            queue.AddRoundReward(b, offset, sample);
            bool addAgain = queue.AddRoundReward(b, offset, sample);
            Check(!addAgain, "同一实例重复追加返回 false");

            bool rm1 = queue.RemoveRoundReward(b, offset, sample, out Skill? removed);
            bool rm2 = queue.RemoveRoundReward(b, offset, sample, out _);
            Check(rm1 && ReferenceEquals(removed, sample) && !rm2, "移除奖励：命中成功、重复移除失败");

            bool threw = false;
            try
            {
                queue.AddRoundReward(b, offset, null!);
            }
            catch (ArgumentNullException)
            {
                threw = true;
            }
            Check(threw, "skill 参数为 null 时抛 ArgumentNullException");

            queue.AddRoundReward(b, offset, sample);
            queue.AddRoundReward(b, offset, queue.RoundRewards.Values.SelectMany(v => v).Skip(1).First());
            int beforeTarget = queue.QueryRoundRewards(b, offset).Count;
            int beforeThief = queue.QueryRoundRewards(a, 1).Count;
            bool stolen = queue.StealRoundReward(b, offset, a, 1, out List<Skill> stolenItems);
            Check(stolen && beforeTarget >= 2 && queue.QueryRoundRewards(b, offset).Count == 0
                && queue.QueryRoundRewards(a, 1).Count == beforeThief + stolenItems.Count,
                "夺取：目标键位全部夺取 + 源键位移除 + 与夺取者目标键位合并",
                $"夺取 {stolenItems.Count} 条");
            Check(stolenItems.All(s => ReferenceEquals(s.Character, a)), "夺取后改写 Skill.Character 为夺取者");
            Check(!queue.StealRoundReward(b, offset, a, 1, out _), "源键位已空，重复夺取返回 false");

            // 一次性移除该键位的全部奖励（与「按技能移除一条」相对）
            Skill all1 = queue.RoundRewards.Values.SelectMany(v => v).First();
            Skill all2 = queue.RoundRewards.Values.SelectMany(v => v).Skip(1).First();
            queue.AddRoundReward(a, 2, all1);
            queue.AddRoundReward(a, 2, all2);
            int beforeRemoveAll = queue.QueryRoundRewards(a, 2).Count;
            bool removeAll = queue.RemoveRoundRewards(a, 2, out List<Skill> removedAll);
            Check(removeAll && beforeRemoveAll >= 2 && removedAll.Count == beforeRemoveAll
                && queue.QueryRoundRewards(a, 2).Count == 0,
                "一次性移除该键位的全部奖励（键位多条一并清除）",
                $"移除前={beforeRemoveAll} 移除={removedAll.Count}");
            Check(!queue.RemoveRoundRewards(a, 2, out _), "键位已空时一次性移除返回 false");

            // offset 夹取：0 / 负数按最小偏移 1 处理
            queue.AddRoundReward(a, 1, all1);
            bool clampedRemove = queue.RemoveRoundRewards(a, 0, out List<Skill> clampedRemoved);
            Check(clampedRemove && clampedRemoved.Any(s => ReferenceEquals(s, all1)),
                "一次性移除的 offset 夹取为 >= 1");

            // 窗口滚动：查询跨过 1000 窗口末尾应惰性物化下一窗口（键继续按稀疏步进生成）
            int maxKeyBefore = queue.CharacterRoundRewards[a].Keys.Max();
            queue.QueryRoundRewards(a, MixGamingQueue.RoundRewardWindowSize + 5);
            int maxKeyAfter = queue.CharacterRoundRewards[a].Keys.Max();
            Check(maxKeyBefore <= MixGamingQueue.RoundRewardWindowSize && maxKeyAfter > MixGamingQueue.RoundRewardWindowSize,
                "奖励表跨过 1000 窗口末尾后继续惰性物化",
                $"窗口上界 {MixGamingQueue.RoundRewardWindowSize}，最大键 {maxKeyBefore}->{maxKeyAfter}");
        }

        /// <summary>
        /// 场景4：召唤物（Master 非空）不享受角色绑定奖励，追加与夺取全部折算到其 Master
        /// </summary>
        private static void TestSummonRewardRedirectToMaster()
        {
            OshimaShiya master = new();
            雇佣兵 summon = new(master, "S1");
            MixGamingQueue queue = CreateQueue([master, summon]);
            queue.InitRoundRewards(new() { { (long)EffectID.ExATK, false } }, true, id => new() { { "exatk", 60d } });

            Check(!queue.CharacterRoundRewards.ContainsKey(summon), "召唤物不单独生成角色绑定表");

            Skill sample = queue.RoundRewards.Values.SelectMany(v => v).First();
            queue.AddRoundReward(summon, 3, sample);
            bool onMaster = queue.QueryRoundRewards(master, 3).Any(s => ReferenceEquals(s, sample));
            bool onSummon = queue.QueryRoundRewards(summon, 3).Any(s => ReferenceEquals(s, sample));
            Check(onMaster && onSummon, "对召唤物追加的奖励折算到其 Master");

            bool stolen = queue.StealRoundReward(summon, 3, master, 5, out List<Skill> fromSummon);
            Check(stolen && fromSummon.Any(s => ReferenceEquals(s, sample)) && queue.QueryRoundRewards(summon, 3).Count == 0,
                "召唤物侧的夺取折算到 Master");

            // 移除不折算 Master：对召唤物的移除只作用于召唤物自身的键位，不会误删 Master 的奖励
            Skill another = queue.RoundRewards.Values.SelectMany(v => v).Skip(1).First();
            queue.AddRoundReward(summon, 4, another);
            bool removeOneOnSummon = queue.RemoveRoundReward(summon, 4, another, out _);
            bool removeAllOnSummon = queue.RemoveRoundRewards(summon, 4, out _);
            bool masterKept = queue.QueryRoundRewards(master, 4).Any(s => ReferenceEquals(s, another));
            Check(!removeOneOnSummon && !removeAllOnSummon && masterKept,
                "移除不折算 Master：对召唤物的移除返回 false 且不误删 Master 的奖励",
                $"removeOne={removeOneOnSummon} removeAll={removeAllOnSummon} masterKept={masterKept}");

            bool removeOneOnMaster = queue.RemoveRoundReward(master, 4, another, out Skill? removedOnMaster);
            Check(removeOneOnMaster && ReferenceEquals(removedOnMaster, another)
                && !queue.QueryRoundRewards(master, 4).Any(s => ReferenceEquals(s, another)),
                "对 Master 自身调用移除正常生效");
        }

        /// <summary>
        /// 推进回合直到游戏结束或达到上限
        /// </summary>
        private static void RunTurns(MixGamingQueue queue, int maxTurns)
        {
            int turns = 0;
            while (turns < maxTurns && !queue.GameOver)
            {
                Character? actor = queue.NextCharacter();
                if (actor is null) break;
                queue.ProcessTurn(actor);
                turns++;
            }
        }

        /// <summary>
        /// 创建混战模式队列（全角色 AI 托管）
        /// </summary>
        private static MixGamingQueue CreateQueue(List<Character> characters)
        {
            foreach (Character c in characters)
            {
                // 角色初始等级会重算属性，HP/MP 需要显式初始化（与 Level setter 重算一致）
                c.Level = 10;
                c.HP = c.MaxHP;
                c.MP = c.MaxMP;
            }
            MixGamingQueue queue = new(characters, _ => { })
            {
                MaxRespawnTimes = 1,
                UseQueueProtected = false
            };
            queue.InitActionQueue();
            queue.SetCharactersToAIControl(false, characters);
            return queue;
        }

        private static void Check(bool condition, string name, string detail = "")
        {
            Console.WriteLine($"[{(condition ? "PASS" : "FAIL")}] {name}{(detail != "" ? $"（{detail}）" : "")}");
            if (!condition)
            {
                _failures++;
            }
        }
    }
}
