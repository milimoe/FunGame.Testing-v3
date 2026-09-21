using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.EffectContext;
using FunGame.Core.Model.Framework;
using FunGame.Core.Model.Queue;
using Milimoe.FunGameTesting.OshimaGameModules;
using Milimoe.FunGameTesting.OshimaGameModules.Characters;
using Milimoe.FunGameTesting.OshimaGameModules.Effects.OpenEffects;
using Milimoe.FunGameTesting.OshimaGameModules.Effects.PassiveEffects;
using Milimoe.FunGameTesting.OshimaGameModules.Skills;

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
            TestSummonDoesNotConsumeCharacterReward();
            TestFateSkillsAndEventStream();
            Console.WriteLine($"回合奖励回归测试完成：{(_failures == 0 ? "全部通过" : $"{_failures} 个断言失败")}");
        }

        /// <summary>
        /// 场景6：【命运XX】+【强运】—— 模组侧对回合奖励 API 的实际用法，以及事件流是否把每一步都记全
        /// <para/>覆盖：命运馈赠（绑定角色奖励）→ 抢夺命运（夺取）→ 命运剥夺（整键位摧毁）→ 十二宫星环【强运】（回合结束生成）
        /// → 调度到实际发放（抢来的奖励在夺取者行动时到手）</para>
        /// <para/>这些技能在大池子里随机分配、CD 又长，随机模拟里基本撞不上，必须在此确定性覆盖</para>
        /// </summary>
        private static void TestFateSkillsAndEventStream()
        {
            OshimaShiya caster = new();
            XinYin target = new();
            List<string> log = [];
            MixGamingQueue queue = CreateQueue([caster, target], log);
            queue.InitRoundRewards(new() { { (long)EffectID.ExATK, false } }, true, id => new() { { "exatk", 60d } });

            // ---- 1) 命运馈赠：为目标绑定一份「命运之赐」到其未来第 1 个行动回合 ----
            命运馈赠 gift = new();
            gift.OnSkillCasted(queue, caster, [target], []);
            Check(queue.QueryRoundRewards(target, 1).Any(s => s is 命运之赐), "命运馈赠：目标下一行动回合已绑定奖励");
            Check(!queue.LastRound.RoundRewardEvents.Any(e => e.Kind == RoundRewardEventKind.Gained),
                "调度（AddRoundReward）不产生「获得」事件，避免同一条奖励被记两次");

            // ---- 2) 抢夺命运：把目标那份奖励夺过来 ----
            抢夺命运 steal = new();
            steal.OnSkillCasted(queue, caster, [target], []);
            bool targetLost = !queue.QueryRoundRewards(target, 1).Any(s => s is 命运之赐);
            bool thiefGot = queue.QueryRoundRewards(caster, 1).Any(s => s is 命运之赐);
            RoundRewardRecord? stolenEvent = queue.LastRound.RoundRewardEvents.LastOrDefault(e => e.Kind == RoundRewardEventKind.Stolen);
            Check(targetLost && thiefGot, "抢夺命运：奖励已从目标转移到夺取者下个行动回合");
            Check(stolenEvent is not null
                && ReferenceEquals(stolenEvent.Character, target)
                && ReferenceEquals(stolenEvent.Counterpart, caster)
                && stolenEvent.Skills.Any(s => s is 命运之赐),
                "事件流：夺取事件记录了原持有者、夺取者与被夺奖励");

            // ---- 3) 调度 → 实际发放：夺取者行动时，抢来的奖励真正到手（主动奖励被立即释放） ----
            queue.LastRound.RoundRewardEvents.Clear();
            queue.ProcessTurn(caster);
            Check(queue.LastRound.RoundRewardEvents.Any(e => e.Kind == RoundRewardEventKind.Gained && e.Skills.Any(s => s is 命运之赐)),
                "调度到发放：夺取者行动时抢来的奖励被发放（产生获得事件）");

            // ---- 4) 命运剥夺：一次性清空目标该键位的全部奖励 ----
            命运馈赠 gift2 = new();
            gift2.OnSkillCasted(queue, caster, [target], []);
            int beforeDeprive = queue.QueryRoundRewards(target, 1).Count;
            queue.LastRound.RoundRewardEvents.Clear();
            命运剥夺 deprive = new();
            deprive.OnSkillCasted(queue, caster, [target], []);
            Check(beforeDeprive > 0 && queue.QueryRoundRewards(target, 1).Count == 0,
                "命运剥夺：目标该键位的奖励被整键位清除", $"剥夺前 {beforeDeprive} 条");
            Check(queue.LastRound.RoundRewardEvents.Any(e => e.Kind == RoundRewardEventKind.Lost),
                "事件流：剥夺产生了移除事件");

            // ---- 5) 十二宫星环【强运】：目标回合结束时随机生成 2~3 份绑定自身的奖励 ----
            // 注意必须给技能设等级：Effect.IsInEffect => Level > 0，等级为 0 时【强运】会被回合结束钩子跳过
            十二宫星环 zodiac = new() { Level = 1 };
            zodiac.OnSkillCasted(queue, caster, [target], []);
            Check(target.Effects.Any(e => e is 强运), "十二宫星环：已为目标附加【强运】");
            HashSet<Skill> beforeLuck = [.. queue.QueryRoundRewards(target, 1)];
            log.Clear();
            queue.ProcessTurn(target);
            List<Skill> luckAdded = [.. queue.QueryRoundRewards(target, 1).Where(s => !beforeLuck.Contains(s))];
            bool luckLogged = log.Any(l => l.Contains("受到强运眷顾"));
            Check(luckLogged, "强运：目标回合结束时确实触发了奖励生成");
            Check(luckAdded.Count >= 强运.最小生成数量 && luckAdded.Count <= 强运.最大生成数量 + 1,
                "强运：生成了 2~3 份绑定目标自身的奖励（+1 容差为队列自身的稀疏生成）", $"新增 {luckAdded.Count} 份");
        }

        /// <summary>
        /// 场景5：召唤物入队行动时，不得重复领取 Master 的角色绑定奖励<para/>
        /// 召唤物的行动回合序号不独立计数，若在其回合查询角色绑定表，会读到 Master 尚未推进的同一序号，
        /// 把 Master 已领取的那条奖励重复发放给召唤物
        /// </summary>
        private static void TestSummonDoesNotConsumeCharacterReward()
        {
            OshimaShiya master = new();
            XinYin enemy = new();
            雇佣兵 summon = new(master, "S1");
            MixGamingQueue queue = CreateQueue([master, enemy, summon]);
            // 把召唤物显式放进行动队列（模拟实战中派生单位入队）
            queue.AddCharacter(summon, 1, false);
            // 全员结束回合：保证没人死亡、回合持续推进，使召唤物有充分机会行动
            queue.DecideActionEvent += _ => CharacterActionType.EndTurn;

            HashSet<Skill> grantedOnce = [];
            int duplicated = 0;
            int grantedToSummon = 0;
            queue.RoundRewardGainedAfterEvent += (RoundRewardContext ctx) =>
            {
                Character owner = ctx.Trigger!;
                foreach (Skill s in ctx.Skills)
                {
                    if (!grantedOnce.Add(s))
                    {
                        duplicated++;
                    }
                    if (ctx.Binding == RoundRewardBinding.Character && owner.Master is not null)
                    {
                        grantedToSummon++;
                    }
                }
            };

            queue.InitRoundRewards(new() { { (long)EffectID.ExATK, false } }, true, id => new() { { "exatk", 60d } });
            RunTurns(queue, 400);

            Check(summon.IsUnit && grantedOnce.Count > 0, "召唤物已入队行动并产生了奖励发放", $"发放实例={grantedOnce.Count}");
            Check(duplicated == 0, "同一奖励实例不会被重复发放（召唤物不重复领取 Master 的奖励）", $"重复={duplicated}");
            Check(grantedToSummon == 0, "角色绑定奖励不会发放给召唤物", $"发给召唤物={grantedToSummon}");
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
        /// <param name="characters">参战角色</param>
        /// <param name="log">可选：收集队列日志（用于断言技能侧的提示文案）</param>
        private static MixGamingQueue CreateQueue(List<Character> characters, List<string>? log = null)
        {
            foreach (Character c in characters)
            {
                // 角色初始等级会重算属性，HP/MP 需要显式初始化（与 Level setter 重算一致）
                c.Level = 10;
                c.HP = c.MaxHP;
                c.MP = c.MaxMP;
            }
            MixGamingQueue queue = new(characters, log is null ? _ => { } : log.Add)
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
