using FunGame.Core.Entity;
using FunGame.Core.Model.EffectContext;
using FunGame.Core.Model.Queue;
using Milimoe.FunGameTesting.OshimaGameModules;
using Milimoe.FunGameTesting.OshimaGameModules.Characters;
using Milimoe.FunGameTesting.OshimaGameModules.Effects.PassiveEffects;
using Milimoe.FunGameTesting.OshimaGameModules.Skills;

namespace Milimoe.FunGameTesting.Tests
{
    /// <summary>
    /// 特效自动记录测试：
    /// 开发者重写 Effect 钩子后，框架在调用钩子前自动把所属技能记录到 RoundRecord.Effects，开发者无需手动记录。
    /// 验证：技能自带特效 / 角色状态栏特效 / DoT / 未重写不记录 / 只重写部分钩子时按需记录。
    /// </summary>
    public class EffectAutoRecordTest
    {
        /// <summary>
        /// 失败计数
        /// </summary>
        private static int _failures = 0;

        /// <summary>
        /// 运行全部特效自动记录测试
        /// </summary>
        public static void RunAllTests()
        {
            Console.WriteLine("=== 特效自动记录测试（RoundRecord.Effects）===");
            TestSkillEffectOnSkillCasted();
            TestCharacterEffectOnDamage();
            TestDotOnTimeElapsed();
            TestNotOverriddenNotRecorded();
            TestOnlyOverriddenRecorded();
            TestSameIdUnitsRecordedSeparately();
            Console.WriteLine($"特效自动记录测试完成：{(_failures == 0 ? "全部通过" : $"{_failures} 个断言失败")}");
        }

        /// <summary>
        /// 场景6：同 Id 单位（雇佣兵复制体）在回合记录中各自独立记录（实体相等性基于 Guid）
        /// </summary>
        private static void TestSameIdUnitsRecordedSeparately()
        {
            OshimaShiya master = new();
            OshimaShiya healer = new();
            // 两个同 Id/Name（Id=0, Name=雇佣兵）的不同实例
            雇佣兵 unitA = new(master, "A");
            雇佣兵 unitB = new(master, "B");
            MixGamingQueue queue = CreateQueue([master, healer, unitA, unitB]);
            unitA.HP = unitA.MaxHP - 1;
            unitB.HP = unitB.MaxHP - 1;
            queue.HealToTarget(healer, unitA, 10, false, true);
            queue.HealToTarget(healer, unitB, 20, false, true);
            // 关键断言：两个同 Id 单位应产生两个独立条目（改造前 GetIdName 相等会合并为一条）
            queue.LastRound.Heals.TryGetValue(unitA, out double a);
            queue.LastRound.Heals.TryGetValue(unitB, out double b);
            bool separate = queue.LastRound.Heals.Count == 2 && a > 0 && b > 0;
            Check(separate, "同 Id 单位（雇佣兵）在回合记录中各自独立记录",
                $"Heals.Count={queue.LastRound.Heals.Count} / A={a} / B={b}");
        }

        /// <summary>
        /// 场景1：技能自带特效（重写 OnSkillCasted）被触发时，自动记录 [施法者 -> 技能]
        /// </summary>
        private static void TestSkillEffectOnSkillCasted()
        {
            OshimaShiya caster = new();
            XinYin target = new();
            MixGamingQueue queue = CreateQueue([caster, target]);
            冰霜攻击 skill = new();
            skill.Level = 1;
            skill.OnSkillCasted(queue, caster, [target], []);
            Check(queue.LastRound.Effects.TryGetValue(caster, out Skill? recorded) && ReferenceEquals(recorded, skill),
                "技能自带特效触发时自动记录", $"Effects[{caster}] = {recorded?.Name}");
        }

        /// <summary>
        /// 场景2：角色状态栏特效（重写 AlterActualDamageAfterCalculation）被伤害链触发时自动记录；
        /// key 优先取技能持有者（Skill.Character）
        /// </summary>
        private static void TestCharacterEffectOnDamage()
        {
            OshimaShiya actor = new();
            XinYin enemy = new();
            MixGamingQueue queue = CreateQueue([actor, enemy]);
            强攻 qiangGong = new();
            qiangGong.Level = 1;
            qiangGong.AddSkillToCharacter(actor);
            queue.DamageToEnemy(actor, enemy, 100, true);
            Check(queue.LastRound.Effects.TryGetValue(actor, out Skill? recorded) && ReferenceEquals(recorded, qiangGong),
                "角色状态栏特效（强攻）触发时自动记录", $"Effects[{actor}] = {recorded?.Name}");
        }

        /// <summary>
        /// 场景3：DoT 特效（重写 OnTimeElapsed）随 TimeLapse 触发时自动记录；
        /// key 取特效所在状态栏的角色（即使技能绑定了施法者，也归特效挂载的角色）
        /// </summary>
        private static void TestDotOnTimeElapsed()
        {
            OshimaShiya caster = new();
            XinYin target = new();
            MixGamingQueue queue = CreateQueue([caster, target]);
            冰霜攻击 skill = new();
            skill.Level = 1;
            skill.Character = caster;
            持续伤害 dot = new(skill, target, caster, durative: true, duration: 100, durationTurn: 0, isPercentage: false, durationDamage: 10);
            target.Effects.Add(dot);
            queue.TimeLapse();
            Check(queue.LastRound.Effects.TryGetValue(target, out Skill? recorded) && ReferenceEquals(recorded, skill),
                "持续伤害 OnTimeElapsed 触发时自动记录", $"Effects[{target}] = {recorded?.Name}");
        }

        /// <summary>
        /// 场景4：未重写钩子的特效不产生记录（含只重写了其他钩子的情况）
        /// </summary>
        private static void TestNotOverriddenNotRecorded()
        {
            OshimaShiya actor = new();
            XinYin enemy = new();
            MixGamingQueue queue = CreateQueue([actor, enemy]);
            PlainEffect plain = new();
            OnlyOnTurnStartEffect onlyTurnStart = new();
            // 无参构造的特效技能 Level 为 0（IsInEffect 为 false），需要设置为 1 才会被框架触发
            plain.Skill.Level = 1;
            onlyTurnStart.Skill.Level = 1;
            actor.Effects.Add(plain);
            actor.Effects.Add(onlyTurnStart);
            queue.TimeLapse();
            Check(!queue.LastRound.Effects.Values.Any(s => ReferenceEquals(s, plain.Skill)),
                "未重写任何钩子的特效不记录");
            Check(!queue.LastRound.Effects.Values.Any(s => ReferenceEquals(s, onlyTurnStart.Skill)),
                "未重写该钩子（OnTimeElapsed）的特效不记录");
        }

        /// <summary>
        /// 场景5：只重写 OnTurnStart 的特效，在回合开始时被自动记录
        /// </summary>
        private static void TestOnlyOverriddenRecorded()
        {
            OshimaShiya actor = new();
            XinYin enemy = new();
            MixGamingQueue queue = CreateQueue([actor, enemy]);
            OnlyOnTurnStartEffect onlyTurnStart = new();
            onlyTurnStart.Skill.Level = 1;
            actor.Effects.Add(onlyTurnStart);
            bool found = false;
            for (int i = 0; i < 50 && !found; i++)
            {
                Character? character = queue.NextCharacter();
                if (character == null)
                {
                    break;
                }
                queue.ProcessTurn(character);
                if (queue.LastRound.Effects.TryGetValue(actor, out Skill? recorded) && ReferenceEquals(recorded, onlyTurnStart.Skill))
                {
                    found = true;
                }
                queue.TimeLapse();
            }
            Check(found, "只重写 OnTurnStart 的特效在回合开始时被自动记录");
        }

        /// <summary>
        /// 创建混战模式队列
        /// </summary>
        private static MixGamingQueue CreateQueue(List<Character> characters)
        {
            foreach (Character c in characters)
            {
                // 角色初始等级会重算属性，HP 需要显式初始化（与 Level setter 重算一致）
                c.Level = 10;
                c.HP = c.MaxHP;
                c.MP = c.MaxMP;
            }
            MixGamingQueue queue = new(characters, s => { })
            {
                MaxRespawnTimes = 1,
                UseQueueProtected = false
            };
            queue.InitActionQueue();
            queue.SetCharactersToAIControl(false, characters);
            return queue;
        }

        /// <summary>
        /// 断言检查
        /// </summary>
        private static void Check(bool condition, string name, string detail = "")
        {
            string status = condition ? "PASS" : "FAIL";
            Console.WriteLine($"[{status}] {name}" + (detail != "" ? $"（{detail}）" : ""));
            if (!condition)
            {
                _failures++;
            }
        }
    }

    /// <summary>
    /// 不重写任何钩子的特效（用于反向验证）
    /// </summary>
    public class PlainEffect : Effect
    {
    }

    /// <summary>
    /// 只重写 OnTurnStart 钩子的特效（用于验证按需记录）
    /// </summary>
    public class OnlyOnTurnStartEffect : Effect
    {
        public override void OnTurnStart(TurnContext ctx)
        {
        }
    }
}
