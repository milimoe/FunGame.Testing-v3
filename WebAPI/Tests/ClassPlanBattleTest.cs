using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model;
using FunGame.Core.Model.Framework;
using FunGame.Core.Model.Queue;
using Milimoe.FunGameTesting.OshimaGameModules.Characters;
using Milimoe.FunGameTesting.OshimaGameModules.Classes;

namespace Milimoe.FunGameTesting.Tests
{
    /// <summary>
    /// 职业系统引擎回归：
    /// 规划器端到端（额度 / 选择权 / 数值提升 / 洗点）、存档快照往返、
    /// 以及规划产出的角色可入队战斗并保留职业计划与天赋加成。
    /// </summary>
    public class ClassPlanBattleTest
    {
        /// <summary>
        /// 失败计数
        /// </summary>
        private static int _failures = 0;

        /// <summary>
        /// 内容注册只做一次
        /// </summary>
        private static bool _registered = false;

        /// <summary>
        /// 运行全部职业系统引擎回归测试
        /// </summary>
        public static void RunAllTests()
        {
            _failures = 0;
            if (!_registered)
            {
                OshimaClasses.RegisterAll();
                _registered = true;
            }
            Console.WriteLine("=== 职业系统引擎回归（ClassPlanBattleTest）===");
            TestClassPlannerEndToEnd();
            TestPersistenceRoundTrip();
            TestSameRoleMultiTalent();
            TestForgetAndReplaceTalent();
            TestPlannedCharacterCanEnterQueueAndRespawn();
            TestTalentSwitchInsideBattle();
            Console.WriteLine($"职业系统引擎回归完成：{(_failures == 0 ? "全部通过" : $"{_failures} 个断言失败")}");
        }

        /// <summary>
        /// 场景1：规划器端到端——1 级初始分配额度与模板限值、升级发放选择权、选习技能、4 级数值提升、洗点撤销
        /// </summary>
        private static void TestClassPlannerEndToEnd()
        {
            Console.WriteLine("--- 场景1：职业规划端到端（额度 / 选择权 / 数值提升 / 洗点）---");
            Class classDef = OshimaClasses.Create剑士();
            Character hero = new OshimaShiya();
            hero.Level = 1;
            hero.Class.OnLevelUp();
            ClassPlanner planner = new(hero) { SkillSelectionEnabled = true };

            ClassPlanResult result = planner.SelectClass(classDef, OshimaClasses.Create剑豪(classDef));
            Check(result.Success && planner.Plan.Classes.Count == 1, "选择职业「剑士」与流派「剑豪」", result.Message);
            if (!result.Success)
            {
                return;
            }
            Class record = planner.Plan.Classes.First();
            ClassRewardLedger ledger = planner.Plan.RewardLedgers[record.GetIdName()];

            // 1 级初始分配：30 点属性 + 3.0 成长，且受职业模板上下限约束
            Check(ledger.InitialAllocationAvailable, "1 级发放初始分配权");
            Check(!planner.TakeInitialAllocation(record, new ClassAttributeAllocation(20, 20, 20, 0, 0, 0)).Success,
                "初始分配超出 30 点总额被拒绝");
            Check(!planner.TakeInitialAllocation(record, new ClassAttributeAllocation(30, 0, 0, 0, 0, 0)).Success,
                "初始分配超出职业模板力量上限（24）被拒绝");
            double initialSTR = hero.InitialSTR;
            double initialSTRGrowth = hero.STRGrowth;
            result = planner.TakeInitialAllocation(record, new ClassAttributeAllocation(20, 6, 4, 1.2, 1.2, 0.6));
            Check(result.Success && Math.Abs(hero.InitialSTR - initialSTR - 20) < 1e-9,
                "合法初始分配写入初始核心属性", result.Message);
            Check(!planner.TakeInitialAllocation(record, new ClassAttributeAllocation(1, 0, 0, 0, 0, 0)).Success,
                "初始分配权不可重复领取");

            // 角色升到 20 级取得职业点数（1/5/10/15/20 → 5 点）
            hero.Level = 20;
            hero.Class.OnLevelUp();
            int pointsBefore = planner.Plan.ClassPoints;

            result = planner.UpgradeClass(record);
            Check(result.Success && record.Level == 2 && planner.Plan.ClassPoints == pointsBefore - 1,
                "职业升至 2 级并消耗职业点数", result.Message);
            Check(ledger.PendingActiveSkillChoices == 2, "2 级发放 2 个职业技能选择权", $"剩余={ledger.PendingActiveSkillChoices}");

            // 选择权消耗与耗尽
            Skill first = record.Skills.ElementAt(0);
            Skill second = record.Skills.ElementAt(1);
            Skill third = record.Skills.ElementAt(2);
            result = planner.LearnClassSkill(record, first);
            Check(result.Success && ledger.PendingActiveSkillChoices == 1, "消耗选择权习得职业技能", result.Message);
            result = planner.LearnClassSkill(record, second);
            Check(result.Success && ledger.PendingActiveSkillChoices == 0, "消耗第 2 个选择权", result.Message);
            Check(!planner.LearnClassSkill(record, third).Success, "选择权耗尽后拒绝继续习得");
            Check(!planner.LearnClassSkill(record, record.PassiveSkills.First()).Success, "被动选择权不足时拒绝习得被动");

            // 物化：只挂已习得的技能
            planner.Plan.ApplyTo(hero);
            Check(hero.Skills.Any(s => s.Name == first.Name && s.Source == SkillSource.Class), "物化后已习得技能挂载且来源正确");
            Check(hero.Skills.All(s => s.Name != third.Name), "未习得技能不会被挂载");

            // 升到 4 级：1 次数值提升（9 点属性 + 0.9 成长，不受模板限值）
            planner.UpgradeClass(record);
            result = planner.UpgradeClass(record);
            Check(result.Success && record.Level == 4, "职业升至 4 级", result.Message);
            Check(ledger.PendingNumericBoosts >= 1, "4 级发放数值提升次数", $"剩余={ledger.PendingNumericBoosts}");
            Check(!planner.TakeNumericBoost(record, new ClassAttributeAllocation(10, 0, 0, 0, 0, 0)).Success,
                "数值提升超出 9 点总额被拒绝");
            double beforeBoost = hero.InitialSTR;
            result = planner.TakeNumericBoost(record, new ClassAttributeAllocation(9, 0, 0, 0.9, 0, 0));
            Check(result.Success && Math.Abs(hero.InitialSTR - beforeBoost - 9) < 1e-9,
                "数值提升写入初始属性（不受模板上限约束）", result.Message);
            Check(Math.Abs(hero.STRGrowth - initialSTRGrowth - 1.2 - 0.9) < 1e-9,
                "初始分配与数值提升的成长均累加", $"力量成长={hero.STRGrowth:0.##}");

            // 洗点：20 级起完全重选，属性全部扣回
            result = planner.ResetPlan();
            Check(result.Success, "洗点成功（角色已满 20 级）", result.Message);
            Check(Math.Abs(hero.InitialSTR - initialSTR) < 1e-9 && Math.Abs(hero.STRGrowth - initialSTRGrowth) < 1e-9,
                "洗点撤销全部初始属性与成长分配", $"力量={hero.InitialSTR:0.##} 成长={hero.STRGrowth:0.##}");
            Check(planner.Plan.Classes.Count == 0 && planner.Plan.RewardLedgers.Count == 0, "洗点清空职业与账本");
        }

        /// <summary>
        /// 场景2：职业计划快照导出 / 重建（存档往返）
        /// </summary>
        private static void TestPersistenceRoundTrip()
        {
            Console.WriteLine("--- 场景2：职业计划存档往返 ---");
            Character hero = BuildPlannedHero(out Skill learnedSkill);
            ClassPlanSnapshot snapshot = ClassPlanSnapshot.Capture(hero.Class);

            Character restored = new OshimaShiya();
            restored.Level = hero.Level;
            List<string> errors = snapshot.ApplyTo(restored.Class, restored);
            Check(errors.Count == 0, "快照重建无错误", string.Join("; ", errors));
            Check(restored.Class.Classes.Count == 1 && restored.Class.SubClasses.Count == 1,
                "重建职业与流派记录", $"职业={restored.Class.Classes.Count} 流派={restored.Class.SubClasses.Count}");
            Check(restored.Class.LearnedTalentCount == 2 && restored.Class.CombatTalent?.Name == "剑心通明",
                "重建已学与激活天赋", $"已学={restored.Class.LearnedTalentCount} 激活={restored.Class.CombatTalent?.Name}");
            Check(restored.Class.CombatTalentSwitchSkill?.Name == "转换战斗天赋", "重建【转换战斗天赋】战技");
            ClassRewardLedger? restoredLedger = restored.Class.RewardLedgers.GetValueOrDefault(restored.Class.Classes.First().GetIdName());
            Check(restoredLedger is { LearnedSkillIds.Count: 1 }, "重建奖励账本与已习得技能", $"已习得={restoredLedger?.LearnedSkillIds.Count ?? -1}");

            restored.Class.ApplyTo(restored);
            Check(restored.Skills.Any(s => s.Name == learnedSkill.Name),
                "重建后物化已习得职业技能",
                $"角色技能={string.Join("/", restored.Skills.Select(s => s.Name))} 账本键={string.Join("/", restored.Class.RewardLedgers.Keys)} 已习得={string.Join("/", restoredLedger?.LearnedSkillIds ?? [])} 池={string.Join("/", restored.Class.Classes.First().Skills.Select(s => s.GetIdName()))}");
            Check(restored.PrimaryRoleType == RoleType.Core && restored.SecondaryRoleTypes.Contains(RoleType.Vanguard),
                "重建主要 / 次要定位（主要跟随生效天赋，次要由流派推导）",
                $"主要={restored.PrimaryRoleType} 次要={string.Join("/", restored.SecondaryRoleTypes)}");
        }

        /// <summary>
        /// 场景3：同一定位掌握多个战斗天赋——转换战技前提按「天赋数」判定，同定位转换后定位与 MOV 不变
        /// </summary>
        private static void TestSameRoleMultiTalent()
        {
            Console.WriteLine("--- 场景3：同定位多天赋转换 ---");
            Class classDef = OshimaClasses.Create剑士();
            Character hero = new OshimaShiya();
            hero.Level = 10;
            hero.Class.OnLevelUp();
            ClassPlanner planner = new(hero);
            planner.SelectClass(classDef, OshimaClasses.Create剑豪(classDef));
            Class record = planner.Plan.Classes.First();

            List<Skill> coreTalents = [.. record.CombatTalents[RoleType.Core]];
            Check(coreTalents.Count >= 2, "剑士核心定位提供多个候选天赋", $"候选={coreTalents.Count}");
            if (coreTalents.Count < 2)
            {
                return;
            }

            ClassPlanResult result = planner.LearnCombatTalent(RoleType.Core, coreTalents[0]);
            Check(result.Success && !planner.Plan.HasCombatTalentSwitch,
                "只学 1 个天赋时不具备转换战技前提", $"已学={planner.Plan.LearnedTalentCount}");

            result = planner.LearnCombatTalent(RoleType.Core, coreTalents[1]);
            Check(result.Success && planner.Plan.LearnedTalentCount == 2, "同一定位可叠加掌握第 2 个天赋", result.Message);
            Check(planner.Plan.LearnedCombatTalents[RoleType.Core].Count == 2, "该定位下已存有两个天赋");
            Check(planner.Plan.HasCombatTalentSwitch,
                "已学天赋按「天赋数」≥ 2 即具备转换战技前提", $"已学={planner.Plan.LearnedTalentCount}");
            Check(planner.Plan.AllLearnedTalents.All(t => t.Character is null), "学习不挂载：未激活的天赋不在角色身上");
            Check(hero.PrimaryRoleType == RoleType.None && hero.MOV == 3,
                "未激活任何天赋时没有主要定位（MOV 取默认 3）", $"主要={hero.PrimaryRoleType} MOV={hero.MOV}");

            result = planner.ActivateCombatTalent(RoleType.Core);
            Skill first = planner.Plan.CombatTalent ?? coreTalents[0];
            Check(result.Success && hero.PrimaryRoleType == RoleType.Core && hero.MOV == hero.GameplayEquilibriumConstant.RoleMOV_Core,
                "激活核心天赋后主要定位为核心（MOV 3）", $"主要={hero.PrimaryRoleType} MOV={hero.MOV}");
            Check(planner.Plan.CombatTalent?.Level == 1, "激活的天赋为 1 级", $"等级={planner.Plan.CombatTalent?.Level}");

            Skill other = coreTalents.First(t => !ReferenceEquals(t, first));
            result = planner.ActivateCombatTalent(other);
            Check(result.Success && ReferenceEquals(planner.Plan.CombatTalent, other)
                && hero.PrimaryRoleType == RoleType.Core && hero.MOV == hero.GameplayEquilibriumConstant.RoleMOV_Core,
                "同定位转换成功且定位 / MOV 不变", $"生效={planner.Plan.CombatTalent?.Name} 主要={hero.PrimaryRoleType} MOV={hero.MOV}");
            Check(ReferenceEquals(other.Character, hero) && !ReferenceEquals(first.Character, hero),
                "只有当前激活的天赋挂在角色身上（切换时旧天赋被卸载）",
                $"激活归属={ReferenceEquals(other.Character, hero)} 旧天赋归属={ReferenceEquals(first.Character, hero)}");
        }

        /// <summary>
        /// 场景5：遗忘已学天赋与替换——上限只约束「同时掌握」，遗忘后名额释放；
        /// 遗忘生效天赋时自动接续，核心加成 / 定位 / MOV 随之同步，已学不足 2 个收回【转换战斗天赋】
        /// </summary>
        private static void TestForgetAndReplaceTalent()
        {
            Console.WriteLine("--- 场景5：遗忘天赋与替换 ---");
            Class classDef = OshimaClasses.Create剑士();
            Character hero = new OshimaShiya();
            hero.Level = 10;
            hero.Class.OnLevelUp();
            ClassPlanner planner = new(hero);
            planner.SelectClass(classDef, OshimaClasses.Create剑豪(classDef));
            Class record = planner.Plan.Classes.First();

            List<Skill> coreTalents = [.. record.CombatTalents[RoleType.Core]];
            List<Skill> vanguardTalents = [.. record.CombatTalents[RoleType.Vanguard]];
            List<Skill> guardianTalents = [.. record.CombatTalents[RoleType.Guardian]];
            if (coreTalents.Count < 2 || vanguardTalents.Count == 0 || guardianTalents.Count == 0)
            {
                Check(false, "内容未提供足够的候选天赋用于替换验证",
                    $"核心={coreTalents.Count} 先锋={vanguardTalents.Count} 近卫={guardianTalents.Count}");
                return;
            }

            // 学满「同时掌握」上限，再学第 4 个被拒绝
            planner.LearnCombatTalent(RoleType.Core, coreTalents[0]);
            planner.LearnCombatTalent(RoleType.Core, coreTalents[1]);
            ClassPlanResult result = planner.LearnCombatTalent(RoleType.Vanguard, vanguardTalents[0]);
            Check(result.Success && planner.Plan.LearnedTalentCount == CharacterClass.MaxLearnedTalentCount,
                $"可同时掌握 {CharacterClass.MaxLearnedTalentCount} 个天赋", $"已学={planner.Plan.LearnedTalentCount}");
            Check(!planner.LearnCombatTalent(RoleType.Guardian, guardianTalents[0]).Success,
                "达到同时掌握上限后拒绝继续学习");

            planner.SetCombatTalentSwitchSkill(OshimaClasses.Create转换战斗天赋());
            planner.ActivateCombatTalent(coreTalents[0]);
            Check(hero.NormalAttack.ExLevel == 1, "激活核心天赋后普攻 +1", $"普攻Ex={hero.NormalAttack.ExLevel}");

            // 遗忘生效的核心天赋 → 自动接续同定位的另一个已学天赋，核心加成不中断
            result = planner.ForgetCombatTalent(coreTalents[0]);
            Check(result.Success && planner.Plan.LearnedTalentCount == CharacterClass.MaxLearnedTalentCount - 1,
                "遗忘已学天赋后名额释放", result.Message);
            Check(!planner.Plan.HasLearnedTalent(coreTalents[0]) && coreTalents[0].Character is null,
                "被遗忘的天赋移出已学列表且从角色身上卸载");
            Check(ReferenceEquals(planner.Plan.CombatTalent, coreTalents[1]) && hero.NormalAttack.ExLevel == 1,
                "遗忘生效天赋后自动接续剩余天赋（核心加成保持）",
                $"生效={planner.Plan.CombatTalent?.Name} 普攻Ex={hero.NormalAttack.ExLevel}");
            Check(!planner.ForgetCombatTalent(coreTalents[0]).Success, "重复遗忘同一天赋被拒绝");

            // 再遗忘核心天赋 → 接续到先锋天赋，核心加成撤销、定位与 MOV 同步
            result = planner.ForgetCombatTalent(coreTalents[1]);
            Check(result.Success && planner.Plan.LearnedTalentCount == 1, "继续遗忘后仅剩 1 个已学天赋", result.Message);
            Check(ReferenceEquals(planner.Plan.CombatTalent, vanguardTalents[0]) && hero.NormalAttack.ExLevel == 0,
                "接续非核心天赋时核心等级加成被撤销", $"生效={planner.Plan.CombatTalent?.Name} 普攻Ex={hero.NormalAttack.ExLevel}");
            Check(hero.PrimaryRoleType == RoleType.Vanguard
                && hero.MOV == hero.GameplayEquilibriumConstant.RoleMOV_Vanguard,
                "定位与 MOV 随接续的天赋同步", $"主要={hero.PrimaryRoleType} MOV={hero.MOV}");
            Check(!hero.Skills.Any(s => s.Name == "转换战斗天赋"),
                "已学不足 2 个时【转换战斗天赋】被收回",
                $"角色技能={string.Join("/", hero.Skills.Select(s => s.Name))}");

            // 遗忘后可学新天赋替换，已学回到 2 个即重新授予【转换战斗天赋】
            result = planner.LearnCombatTalent(RoleType.Guardian, guardianTalents[0]);
            Check(result.Success && planner.Plan.LearnedTalentCount == 2, "遗忘后可学习新天赋完成替换", result.Message);
            Check(hero.Skills.Any(s => s.Name == "转换战斗天赋"), "替换后重新授予【转换战斗天赋】");
            Check(planner.ValidateState(out string? error), "遗忘与替换后计划状态一致", error ?? "");
        }

        /// <summary>
        /// 场景4：规划 + 物化的职业角色入队、队列可操作、复活后职业计划 / 技能 / 天赋加成全部存活
        /// </summary>
        private static void TestPlannedCharacterCanEnterQueueAndRespawn()
        {
            Console.WriteLine("--- 场景3：入队与复活 ---");
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
            Check(hero.Class.Classes.Count == 1 && hero.Class.LearnedTalentCount == 2 && hero.Class.CombatTalent?.Name == "剑心通明",
                "复活后职业计划存活", $"职业={hero.Class.Classes.Count} 已学={hero.Class.LearnedTalentCount} 激活={hero.Class.CombatTalent?.Name}");
            Skill? warSkill = hero.Skills.FirstOrDefault(s => s.Source == SkillSource.Class && s.SkillType == SkillType.Skill);
            Check(warSkill is { Character: { } c } && ReferenceEquals(c, hero),
                "复活后职业技能重挂且归属正确", $"技能={warSkill?.Name} 归属={warSkill?.Character == hero}");
            Check(hero.NormalAttack.ExLevel == 1 && warSkill?.ExLevel == 1,
                "复活后核心天赋加成保留（普攻与战技 +1）", $"普攻Ex={hero.NormalAttack.ExLevel} 战技Ex={warSkill?.ExLevel}");
        }

        /// <summary>
        /// 场景4：队列环境内的战斗天赋转换——ExLevel 配对与激活切换
        /// </summary>
        private static void TestTalentSwitchInsideBattle()
        {
            Console.WriteLine("--- 场景4：战斗内转换天赋 ---");
            Character hero = BuildPlannedHero(out _);
            XinYin foe = new();
            MixGamingQueue queue = CreateQueue([hero, foe]);

            Check(hero.Class.CombatTalent?.Name == "剑心通明" && hero.NormalAttack.ExLevel == 1,
                "入队时核心天赋已激活", $"激活={hero.Class.CombatTalent?.Name} 普攻Ex={hero.NormalAttack.ExLevel}");

            bool ok = hero.Class.SwitchCombatTalent(RoleType.Vanguard, out string? err);
            Check(ok && hero.Class.CombatTalent?.Name == "疾风剑势" && hero.NormalAttack.ExLevel == 0,
                "战斗中可转换天赋且撤销加成", $"ok={ok} err={err} 激活={hero.Class.CombatTalent?.Name} 普攻Ex={hero.NormalAttack.ExLevel}");
            Check(hero.PrimaryRoleType == RoleType.Vanguard && hero.MOV == hero.GameplayEquilibriumConstant.RoleMOV_Vanguard,
                "转换天赋后主要定位与 MOV 同步（先锋 6）",
                $"主要={hero.PrimaryRoleType} 次要={string.Join("/", hero.SecondaryRoleTypes)} MOV={hero.MOV}");

            ok = hero.Class.SwitchCombatTalent(RoleType.Core, out _);
            Check(ok && hero.Class.CombatTalent?.Name == "剑心通明" && hero.NormalAttack.ExLevel == 1,
                "转换回核心天赋加成恢复", $"ok={ok} 普攻Ex={hero.NormalAttack.ExLevel}");
            Check(hero.PrimaryRoleType == RoleType.Core && hero.MOV == hero.GameplayEquilibriumConstant.RoleMOV_Core,
                "转换回核心后主要定位与 MOV 同步（核心 3）",
                $"主要={hero.PrimaryRoleType} 次要={string.Join("/", hero.SecondaryRoleTypes)} MOV={hero.MOV}");

            Check(hero.Skills.Any(s => s.Name == "转换战斗天赋"),
                "具备次要定位时已授予【转换战斗天赋】战技",
                $"角色技能={string.Join("/", hero.Skills.Select(s => s.Name))} 已习得={string.Join("/", hero.Class.RewardLedgers.GetValueOrDefault(hero.Class.Classes.First().GetIdName())?.LearnedSkillIds ?? [])}");
        }

        /// <summary>
        /// 用规划器完整规划一个角色：剑士 2 级 + 核心 / 先锋双定位 + 双天赋 + 1 个已习得战技，并物化
        /// </summary>
        /// <param name="learnedSkill">职业记录中已习得的战技实例</param>
        private static Character BuildPlannedHero(out Skill learnedSkill)
        {
            Class classDef = OshimaClasses.Create剑士();
            Character hero = new OshimaShiya();
            hero.Level = 10;
            hero.Class.OnLevelUp();
            ClassPlanner planner = new(hero) { SkillSelectionEnabled = true };
            planner.SelectClass(classDef, OshimaClasses.Create剑豪(classDef));
            Class record = planner.Plan.Classes.First();
            planner.LearnCombatTalent(RoleType.Core, record.CombatTalents[RoleType.Core].First());
            planner.LearnCombatTalent(RoleType.Vanguard, record.CombatTalents[RoleType.Vanguard].First());
            planner.ActivateCombatTalent(RoleType.Core);
            planner.SetCombatTalentSwitchSkill(OshimaClasses.Create转换战斗天赋());
            planner.UpgradeClass(record);
            learnedSkill = record.Skills.First();
            planner.LearnClassSkill(record, learnedSkill);
            planner.Plan.ApplyTo(hero);
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
