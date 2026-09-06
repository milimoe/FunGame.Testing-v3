using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.Framework;
using FunGame.Core.Model.Queue;
using Milimoe.FunGameTesting.OshimaGameModules.Characters;

namespace Milimoe.FunGameTesting.Tests
{
    /// <summary>
    /// 职业系统引擎回归（#153 S9）：
    /// 规划产出的职业角色可进入 MixGamingQueue 并在队列环境中存活——
    /// 初始化快照带计划 / 队列内可操作 / 复活后职业计划与天赋加成不丢 / 战斗内可转换天赋。
    /// </summary>
    public class ClassPlanBattleTest
    {
        /// <summary>
        /// 失败计数
        /// </summary>
        private static int _failures = 0;

        /// <summary>
        /// 运行全部职业系统引擎回归测试
        /// </summary>
        public static void RunAllTests()
        {
            Console.WriteLine("=== 职业系统引擎回归（ClassPlanBattleTest）===");
            TestPlannedCharacterCanEnterQueueAndRespawn();
            TestTalentSwitchInsideBattle();
            Console.WriteLine($"职业系统引擎回归完成：{(_failures == 0 ? "全部通过" : $"{_failures} 个断言失败")}");
        }

        /// <summary>
        /// 场景1：规划 + 物化的职业角色入队、队列可操作、复活后职业计划 / 技能 / 天赋加成全部存活
        /// </summary>
        private static void TestPlannedCharacterCanEnterQueueAndRespawn()
        {
            Character hero = BuildPlannedHero(out _);
            XinYin foe = new();

            MixGamingQueue queue = CreateQueue([hero, foe]);
            Check(queue.Original.TryGetValue(hero.Guid, out Character? original) && original.Class.Classes.Count == 1,
                "队列初始化快照携带职业计划", $"快照职业数={original?.Class.Classes.Count}");

            // 队列环境内可操作：造成伤害 + 时间流逝，不抛异常且有回合记录
            double before = foe.HP;
            queue.DamageToEnemy(hero, foe, 25, true);
            queue.TimeLapse();
            Check(foe.HP < before, "队列内可正常造成伤害", $"HP {before:0.#} -> {foe.HP:0.#}");

            // 模拟队列复活：快照（_original）→ Respawn
            hero.HP = 1;
            hero.Respawn(queue.Original[hero.Guid]);
            Check(hero.HP >= hero.MaxHP * 0.99, "复活后数值恢复", $"HP={hero.HP:0.#}/{hero.MaxHP:0.#}");
            Check(hero.Class.Classes.Count == 1 && hero.Class.LearnedCombatTalents.Count == 2 && hero.Class.CombatTalent?.Name == "核心天赋",
                "复活后职业计划存活", $"职业={hero.Class.Classes.Count} 已学={hero.Class.LearnedCombatTalents.Count} 激活={hero.Class.CombatTalent?.Name}");
            Skill? warSkill = hero.Skills.FirstOrDefault(s => s.Name == "测试战技");
            Check(warSkill is { Source: SkillSource.Class, Character: { } c } && ReferenceEquals(c, hero),
                "复活后职业技能重挂且来源正确", $"来源={warSkill?.Source} 归属角色={warSkill?.Character == hero}");
            Check(hero.NormalAttack.ExLevel == 1 && warSkill?.ExLevel == 1,
                "复活后核心天赋加成保留（战技 7 / 普攻 9 不丢）", $"普攻Ex={hero.NormalAttack.ExLevel} 战技Ex={warSkill?.ExLevel} 战技Level={warSkill?.Level}");
        }

        /// <summary>
        /// 场景2：队列环境内的战斗天赋转换（S8 转换战技同路径）——ExLevel 配对与激活切换
        /// </summary>
        private static void TestTalentSwitchInsideBattle()
        {
            Character hero = BuildPlannedHero(out _);
            XinYin foe = new();
            MixGamingQueue queue = CreateQueue([hero, foe]);

            // 当前激活核心天赋（ExLevel +1）
            Check(hero.Class.CombatTalent?.Name == "核心天赋" && hero.NormalAttack.ExLevel == 1,
                "入队时核心天赋已激活", $"激活={hero.Class.CombatTalent?.Name} 普攻Ex={hero.NormalAttack.ExLevel}");

            // 战斗中转换到先锋天赋（非核心）：加成撤销
            bool ok = hero.Class.SwitchCombatTalent(RoleType.Vanguard, out string? err);
            Check(ok && hero.Class.CombatTalent?.Name == "先锋天赋" && hero.NormalAttack.ExLevel == 0,
                "战斗中可转换天赋且撤销加成", $"ok={ok} err={err} 激活={hero.Class.CombatTalent?.Name} 普攻Ex={hero.NormalAttack.ExLevel}");

            // 转换回核心天赋：加成恢复
            ok = hero.Class.SwitchCombatTalent(RoleType.Core, out _);
            Check(ok && hero.Class.CombatTalent?.Name == "核心天赋" && hero.NormalAttack.ExLevel == 1,
                "转换回核心天赋加成恢复", $"ok={ok} 普攻Ex={hero.NormalAttack.ExLevel}");
        }

        /// <summary>
        /// 在模板角色上完成职业规划并物化：职业 1 级 + 双定位（核心/先锋）+ 双天赋 + 激活核心
        /// </summary>
        /// <param name="slash">职业记录中的测试战技实例（已学习）</param>
        private static Character BuildPlannedHero(out Skill slash)
        {
            // 定义：职业 + 流派（提供核心/先锋定位）
            Class classDef = new() { Id = 5001, Name = "测试职业" };
            Skill warDef = new OpenSkill(5002, "测试战技", []) { SkillType = SkillType.Skill, Level = 0 };
            classDef.Skills.Add(warDef);
            classDef.CombatTalents[RoleType.Core] = [new OpenSkill(5010, "核心天赋", []) { SkillType = SkillType.Passive, Level = 1 }];
            classDef.CombatTalents[RoleType.Vanguard] = [new OpenSkill(5011, "先锋天赋", []) { SkillType = SkillType.Passive, Level = 1 }];
            SubClass specDef = new(classDef) { Id = 6001, Name = "测试流派" };
            specDef.RoleTypes.Add(RoleType.Core);
            specDef.RoleTypes.Add(RoleType.Vanguard);

            Character hero = new OshimaShiya();
            Class rec = classDef.Copy(); // 职业记录副本（技能实例与定义隔离）
            rec.Level = 1;
            slash = rec.Skills.First();
            slash.Level = 1; // 规划：学习测试战技
            SubClass spec = specDef.Copy(rec);
            hero.Class.Classes.Add(rec);
            hero.Class.SubClasses.Add(spec);
            Skill coreTalent = rec.CombatTalents[RoleType.Core].First();
            Skill vanguardTalent = rec.CombatTalents[RoleType.Vanguard].First();
            hero.Class.LearnedCombatTalents[RoleType.Core] = coreTalent;
            hero.Class.LearnedCombatTalents[RoleType.Vanguard] = vanguardTalent;
            hero.Class.CombatTalent = coreTalent;
            hero.Class.ApplyTo(hero); // 物化
            return hero;
        }

        /// <summary>
        /// 构造混战队列（角色初始等级会重算属性，HP 需要显式初始化）
        /// </summary>
        private static MixGamingQueue CreateQueue(List<Character> characters)
        {
            foreach (Character c in characters)
            {
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
}
