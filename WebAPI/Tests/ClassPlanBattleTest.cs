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
                OshimaWorldClasses.RegisterAll();
                _registered = true;
            }
            Console.WriteLine("=== 职业系统引擎回归（ClassPlanBattleTest）===");
            TestClassPlannerEndToEnd();
            TestClassSkillRoadmapLeveling();
            TestDraftLevelAdjustment();
            TestApplyCommitsAndBudgetReclaim();
            TestNumericBoostMutualExclusion();
            TestPersistenceRoundTrip();
            TestWorldClassRegistration();
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
        /// 场景1b：职业技能提级——未习得的池技能随路线图提升，后学技能自动补到当前水位
        /// <para/>设定：职业被动恒为 1 级；职业技能（战技/爆发技 +1，魔法额外 +1）按「职业池」提级，
        /// 不区分是否已习得，因此后学到的技能与先学到的同级
        /// </summary>
        private static void TestClassSkillRoadmapLeveling()
        {
            Console.WriteLine("--- 场景1b：职业技能提级（池提级 + 后学补水位）---");
            // 注入一个魔法技能池，用于校验「魔法额外 +1」（剑士职业本身只有战技与被动）
            Class defA = OshimaClasses.Create剑士();
            defA.Magics.Add(new OpenSkill(990001, "测试魔法", []) { SkillType = SkillType.Magic, Level = 1 });

            Character heroA = new OshimaShiya();
            heroA.Level = 55;
            heroA.Class.OnLevelUp();
            ClassPlanner plannerA = new(heroA) { SkillSelectionEnabled = true };
            ClassPlanResult result = plannerA.SelectClass(defA, OshimaClasses.Create剑豪(defA));
            Check(result.Success, "角色A 选择职业「剑士」与流派「剑豪」", result.Message);
            if (!result.Success)
            {
                return;
            }
            Class recordA = plannerA.Plan.Classes.First();
            ClassRewardLedger ledgerA = plannerA.Plan.RewardLedgers[recordA.GetIdName()];

            Skill lateSkill = recordA.Skills.First(s => s.Name == "金刚击");
            Skill lateMagic = recordA.Magics.First();
            Skill passive = recordA.PassiveSkills.First();

            // 一个技能都还没学，只升职业到 5 级（3 / 5 级各有提级 +1，魔法额外 +1）
            for (int i = 0; i < 4; i++)
            {
                plannerA.UpgradeClass(recordA);
            }
            Check(recordA.Level == 5 && ledgerA.SettledToLevel == 5,
                "职业升至 5 级且结算水位同步", $"等级={recordA.Level} 水位={ledgerA.SettledToLevel}");
            Check(lateSkill.Level == 3, "未习得的池战技随路线图提升", $"等级={lateSkill.Level}");
            Check(lateMagic.Level == 5, "未习得的池魔法随路线图提升（含魔法额外 +1）", $"等级={lateMagic.Level}");
            Check(passive.Level == 1, "职业被动恒为 1 级", $"等级={passive.Level}");

            // 现在才习得：应直接继承水位，而不是落到 1 级
            result = plannerA.LearnClassSkill(recordA, lateSkill);
            Check(result.Success && lateSkill.Level == 3, "后学战技自动补到当前水位", $"等级={lateSkill.Level}");
            result = plannerA.LearnClassSkill(recordA, lateMagic);
            Check(result.Success && lateMagic.Level == 5, "后学魔法自动补到当前水位", $"等级={lateMagic.Level}");

            // 对照组：角色B 在职业 2 级就习得（此时路线图还没给提级），到 5 级应与后学的同级
            Class defB = OshimaClasses.Create剑士();
            Character heroB = new OshimaShiya();
            heroB.Level = 55;
            heroB.Class.OnLevelUp();
            ClassPlanner plannerB = new(heroB) { SkillSelectionEnabled = true };
            result = plannerB.SelectClass(defB, OshimaClasses.Create剑豪(defB));
            Check(result.Success, "角色B 选择职业「剑士」与流派「剑豪」", result.Message);
            if (!result.Success)
            {
                return;
            }
            Class recordB = plannerB.Plan.Classes.First();
            plannerB.UpgradeClass(recordB);
            Skill earlySkill = recordB.Skills.First(s => s.Name == "金刚击");
            result = plannerB.LearnClassSkill(recordB, earlySkill);
            Check(result.Success && earlySkill.Level == 1, "早学战技此时为 1 级", $"等级={earlySkill.Level}");
            for (int i = 0; i < 3; i++)
            {
                plannerB.UpgradeClass(recordB);
            }
            Check(earlySkill.Level == 3, "早学战技随升级到 3 级", $"等级={earlySkill.Level}");
            Check(earlySkill.Level == lateSkill.Level, "先学与后学技能在职业 5 级同级",
                $"先学={earlySkill.Level} 后学={lateSkill.Level}");

            // 升到 10 级：最终等级由技能类型上限钳制
            for (int i = 0; i < 5; i++)
            {
                plannerA.UpgradeClass(recordA);
            }
            Check(recordA.Level == 10 && lateSkill.Level == 6,
                "职业 10 级：战技封顶 MaxSkillLevel", $"等级={lateSkill.Level}");
            Check(lateMagic.Level == 8, "职业 10 级：魔法封顶 MaxMagicLevel", $"等级={lateMagic.Level}");
            Check(passive.Level == 1, "职业被动仍为 1 级", $"等级={passive.Level}");
        }

        /// <summary>
        /// 场景1c：草稿态调级（暂存调整可升可降、绝对对齐不重复叠加）+ 提交确认后不可下调
        /// <para/>以及 SyncRewards 对「水位高于职业等级」的显式拒绝（不静默洗点式撤销）
        /// </summary>
        private static void TestDraftLevelAdjustment()
        {
            Console.WriteLine("--- 场景1c：草稿态调级与提交锁定 ---");
            Class def = OshimaClasses.Create剑士();
            def.Magics.Add(new OpenSkill(990001, "测试魔法", []) { SkillType = SkillType.Magic, Level = 1 });
            Character hero = new OshimaShiya();
            hero.Level = 55;
            hero.Class.OnLevelUp();
            ClassPlanner planner = new(hero) { SkillSelectionEnabled = true };
            ClassPlanResult result = planner.SelectClass(def, OshimaClasses.Create剑豪(def));
            Check(result.Success, "选择职业「剑士」与流派「剑豪」", result.Message);
            if (!result.Success)
            {
                return;
            }
            Class record = planner.Plan.Classes.First();
            ClassRewardLedger ledger = planner.Plan.RewardLedgers[record.GetIdName()];
            Skill skill = record.Skills.First(s => s.Name == "金刚击");
            Skill magic = record.Magics.First();
            Check(ledger.CommittedLevel < 0, "新选职业处于草稿态（未确认）", $"已确认={ledger.CommittedLevel}");

            // 草稿态一次性调到 10 级：不消耗职业点数
            int pointsBefore = planner.Plan.ClassPoints;
            result = planner.SetClassLevel(record, 10);
            Check(result.Success && record.Level == 10, "草稿态直接设定为 10 级", result.Message);
            Check(planner.Plan.ClassPoints == pointsBefore, "草稿调级不消耗职业点数", $"点数={planner.Plan.ClassPoints}");
            Check(skill.Level == 6 && magic.Level == 8, "池技能随草稿等级封顶（战技 6 / 魔法 8）", $"战技={skill.Level} 魔法={magic.Level}");
            Check(ledger.SettledToLevel == 10, "账本水位随草稿等级同步", $"水位={ledger.SettledToLevel}");

            // 来回调整：每次都是绝对对齐，不会因为升降多次而重复叠加
            result = planner.SetClassLevel(record, 5);
            Check(result.Success && record.Level == 5 && skill.Level == 3 && magic.Level == 5,
                "下调回 5 级并正确回退池等级（战技 3 / 魔法 5）", $"等级={record.Level} 战技={skill.Level} 魔法={magic.Level}");
            result = planner.SetClassLevel(record, 7);
            Check(result.Success && skill.Level == 4 && magic.Level == 7,
                "再升到 7 级只补该区间，无重复叠加（战技 4 / 魔法 7）", $"战技={skill.Level} 魔法={magic.Level}");
            result = planner.SetClassLevel(record, 4);
            Check(result.Success && skill.Level == 2 && magic.Level == 3,
                "再降回 4 级仍精确（战技 2 / 魔法 3）", $"战技={skill.Level} 魔法={magic.Level}");

            // 配额随调级同步回收：10 级 active 8 / passive 3 / numeric 3，回到 5 级应剩 4 / 1 / 1
            planner.SetClassLevel(record, 10);
            Check(ledger.PendingActiveSkillChoices == 8 && ledger.PendingPassiveChoices == 3 && ledger.PendingNumericBoosts == 3,
                "10 级待选配额正确", $"主动={ledger.PendingActiveSkillChoices} 被动={ledger.PendingPassiveChoices} 数值={ledger.PendingNumericBoosts}");
            planner.SetClassLevel(record, 5);
            Check(ledger.PendingActiveSkillChoices == 4 && ledger.PendingPassiveChoices == 1 && ledger.PendingNumericBoosts == 1,
                "下调到 5 级同步回收该区间的配额", $"主动={ledger.PendingActiveSkillChoices} 被动={ledger.PendingPassiveChoices} 数值={ledger.PendingNumericBoosts}");

            // 已花掉的选择权无法自动追回：整体拒绝下调，且不改动任何状态
            Class def2 = OshimaClasses.Create剑士();
            Character hero2 = new OshimaShiya();
            hero2.Level = 55;
            hero2.Class.OnLevelUp();
            ClassPlanner planner2 = new(hero2) { SkillSelectionEnabled = true };
            result = planner2.SelectClass(def2, OshimaClasses.Create剑豪(def2));
            Check(result.Success, "第二个角色选择职业与流派", result.Message);
            if (!result.Success)
            {
                return;
            }
            Class record2 = planner2.Plan.Classes.First();
            ClassRewardLedger ledger2 = planner2.Plan.RewardLedgers[record2.GetIdName()];
            Check(planner2.SetClassLevel(record2, 2).Success && ledger2.PendingActiveSkillChoices == 2,
                "草稿升至 2 级发放 2 个职业技能选择权", $"待选={ledger2.PendingActiveSkillChoices}");
            Check(planner2.LearnClassSkill(record2, record2.Skills.ElementAt(0)).Success, "花掉第 1 个选择权");
            Check(planner2.LearnClassSkill(record2, record2.Skills.ElementAt(1)).Success, "花掉第 2 个选择权");
            result = planner2.SetClassLevel(record2, 1);
            Check(!result.Success && record2.Level == 2 && ledger2.SettledToLevel == 2,
                "选择权已使用后拒绝下调，且等级 / 水位均未变", result.Message);

            // 提交：按净增级数扣职业点数，之后不可下调但仍可上调
            Class def3 = OshimaClasses.Create剑士();
            Character hero3 = new OshimaShiya();
            hero3.Level = 55;
            hero3.Class.OnLevelUp();
            ClassPlanner planner3 = new(hero3) { SkillSelectionEnabled = true };
            result = planner3.SelectClass(def3, OshimaClasses.Create剑豪(def3));
            Check(result.Success, "第三个角色选择职业与流派", result.Message);
            if (!result.Success)
            {
                return;
            }
            Class record3 = planner3.Plan.Classes.First();
            ClassRewardLedger ledger3 = planner3.Plan.RewardLedgers[record3.GetIdName()];
            planner3.SetClassLevel(record3, 4);
            int pointsBeforeCommit = planner3.Plan.ClassPoints;
            result = planner3.CommitClassLevel(record3);
            Check(result.Success && ledger3.CommittedLevel == 4, "提交确认职业为 4 级", result.Message);
            Check(planner3.Plan.ClassPoints == pointsBeforeCommit - 3,
                "提交按净增 3 级扣 3 点职业点数（1 级由选职业覆盖）", $"点数={planner3.Plan.ClassPoints}");
            result = planner3.SetClassLevel(record3, 3);
            Check(!result.Success && record3.Level == 4, "提交后拒绝下调", result.Message);
            result = planner3.SetClassLevel(record3, 6);
            Check(result.Success && record3.Level == 6, "提交后仍可上调", result.Message);

            // 升级即确认：UpgradeClass 后同样不可下调
            result = planner3.UpgradeClass(record3);
            Check(result.Success && ledger3.CommittedLevel == 7, "升级同时确认等级", $"已确认={ledger3.CommittedLevel}");
            result = planner3.SetClassLevel(record3, 6);
            Check(!result.Success && record3.Level == 7, "升级确认后拒绝下调", result.Message);

            // SyncRewards：不一致时显式拒绝，且不静默清空账本 / 卸载已学技能
            int learnedBefore = ledger2.LearnedSkillIds.Count;
            record2.Level = 1; // 模拟外部把职业等级改小（水位 2 > 等级 1）
            result = planner2.SyncRewards();
            Check(!result.Success, "水位高于职业等级时对账被显式拒绝", result.Message);
            Check(record2.Level == 1 && ledger2.SettledToLevel == 2, "拒绝后不修改等级与水位", $"等级={record2.Level} 水位={ledger2.SettledToLevel}");
            Check(ledger2.LearnedSkillIds.Count == learnedBefore,
                "拒绝后未清空已习得技能（未触发洗点式 Revoke）", $"已习得={ledger2.LearnedSkillIds.Count}");
            Check(!planner2.ValidateState(out string? invalid),
                "不一致状态可被 ValidateState 检出", invalid ?? "（未检出）");
        }

        /// <summary>
        /// 场景1d：物化即确认（apply 后不可下调）+ 数值提升额度覆盖随等级升降回收
        /// </summary>
        private static void TestApplyCommitsAndBudgetReclaim()
        {
            Console.WriteLine("--- 场景1d：物化即确认 与 数值提升额度回收 ---");
            // 用角色独立的平衡常数注入「路线图单级自带数值提升额度」，避免污染全局
            EquilibriumConstant eq = new();
            eq.ClassLevelUpRewards[4] = new ClassLevelUpReward(4, passiveChoices: 1, canNumericBoost: true, numericBoost: new ClassAttributeBudget(5, 0.5));
            eq.ClassLevelUpRewards[9] = new ClassLevelUpReward(9, passiveChoices: 2, canNumericBoost: true, numericBoost: new ClassAttributeBudget(12, 1.2));

            Class def = OshimaClasses.Create剑士();
            Character hero = new OshimaShiya();
            hero.GameplayEquilibriumConstant = eq;
            hero.Level = 55;
            hero.Class.OnLevelUp();
            ClassPlanner planner = new(hero) { SkillSelectionEnabled = true };
            ClassPlanResult result = planner.SelectClass(def, OshimaClasses.Create剑豪(def));
            Check(result.Success, "选择职业「剑士」与流派「剑豪」（独立平衡常数）", result.Message);
            if (!result.Success)
            {
                return;
            }
            Class record = planner.Plan.Classes.First();
            ClassRewardLedger ledger = planner.Plan.RewardLedgers[record.GetIdName()];

            // 额度覆盖取「已结算等级区间内最高一档」，并随等级升降回收
            Check(planner.SetClassLevel(record, 4).Success && ledger.NumericBoostBudget is { AttributePoints: 5, GrowthPoints: 0.5 },
                "4 级取得该档自带数值提升额度（5 / 0.5）", ledger.NumericBoostBudget?.Describe() ?? "null");
            Check(planner.SetClassLevel(record, 9).Success && ledger.NumericBoostBudget is { AttributePoints: 12, GrowthPoints: 1.2 },
                "9 级切换到更高一档的额度（12 / 1.2）", ledger.NumericBoostBudget?.Describe() ?? "null");
            Check(planner.SetClassLevel(record, 5).Success && ledger.NumericBoostBudget is { AttributePoints: 5, GrowthPoints: 0.5 },
                "下调到 5 级回落到 4 级档的额度（未被保留）", ledger.NumericBoostBudget?.Describe() ?? "null");
            Check(planner.SetClassLevel(record, 3).Success && ledger.NumericBoostBudget is null,
                "下调到 3 级回收额度覆盖（回落平衡常数默认）", ledger.NumericBoostBudget?.Describe() ?? "null");

            // 物化即确认
            planner.SetClassLevel(record, 6);
            Check(ledger.CommittedLevel < 0, "物化前仍是草稿态", $"已确认={ledger.CommittedLevel}");
            Skill learned = record.Skills.First();
            Check(planner.LearnClassSkill(record, learned).Success, "物化前先习得一个职业技能", learned.Name);
            int pointsBeforeApply = planner.Plan.ClassPoints;
            result = planner.ApplyToCharacter(hero);
            Check(result.Success, "物化成功", result.Message);
            Check(ledger.CommittedLevel == 6, "物化即确认职业等级", $"已确认={ledger.CommittedLevel}");
            Check(planner.Plan.ClassPoints == pointsBeforeApply - 5,
                "物化按净增级数扣点（基准 1 级 → 6 级 = 5 点）", $"点数={planner.Plan.ClassPoints}");
            result = planner.SetClassLevel(record, 5);
            Check(!result.Success && record.Level == 6, "物化确认后拒绝下调", result.Message);
            Check(hero.Skills.Any(s => s.Name == learned.Name && s.Source == SkillSource.Class),
                "物化后已习得职业技能挂载且来源正确",
                $"角色技能={string.Join("/", hero.Skills.Select(s => $"{s.Name}(Lv{s.Level})"))}");
        }

        /// <summary>
        /// 场景1e：数值提升与被动「严格互斥」——4 / 9 级发放的是同一份份额，禁止同一份额取两次
        /// </summary>
        private static void TestNumericBoostMutualExclusion()
        {
            Console.WriteLine("--- 场景1e：数值提升与被动严格互斥 ---");
            Class def = OshimaClasses.Create剑士();
            Character hero = new OshimaShiya();
            hero.Level = 55;
            hero.Class.OnLevelUp();
            ClassPlanner planner = new(hero) { SkillSelectionEnabled = true };
            ClassPlanResult result = planner.SelectClass(def, OshimaClasses.Create剑豪(def));
            Check(result.Success, "选择职业「剑士」与流派「剑豪」", result.Message);
            if (!result.Success)
            {
                return;
            }
            Class record = planner.Plan.Classes.First();
            ClassRewardLedger ledger = planner.Plan.RewardLedgers[record.GetIdName()];
            planner.SetClassLevel(record, 9);
            Check(ledger.PendingPassiveChoices == 3 && ledger.PendingNumericBoosts == 3,
                "9 级共享份额 3 / 3（4 级 1 + 9 级 2）", $"被动={ledger.PendingPassiveChoices} 数值={ledger.PendingNumericBoosts}");

            // 学掉 2 个被动，再把剩下的被动份额换成 1 次数值提升 → 被动 0、数值提升仍有剩余
            foreach (Skill passive in record.PassiveSkills.Take(2))
            {
                Check(planner.LearnClassSkill(record, passive).Success, $"习得被动【{passive.Name}】");
            }
            Check(ledger.PendingPassiveChoices == 1 && ledger.PendingNumericBoosts == 3,
                "学被动只占被动份额", $"被动={ledger.PendingPassiveChoices} 数值={ledger.PendingNumericBoosts}");
            ClassAttributeAllocation small = new(9, 0, 0, 0.9, 0, 0);
            Check(planner.TakeNumericBoost(record, small).Success, "兑换 1 次数值提升");
            Check(ledger.PendingPassiveChoices == 0 && ledger.PendingNumericBoosts == 2,
                "同时扣掉 1 次被动份额", $"被动={ledger.PendingPassiveChoices} 数值={ledger.PendingNumericBoosts}");
            Check(!planner.TakeNumericBoost(record, small).Success,
                "被动份额用尽后拒绝再兑换数值提升（严格互斥，禁止同一份额取两次）");
            Check(ledger.PendingPassiveChoices == 0 && ledger.PendingNumericBoosts == 2,
                "被拒时账本未被改动", $"被动={ledger.PendingPassiveChoices} 数值={ledger.PendingNumericBoosts}");
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
        /// 场景：筽祀牻世界观职业（3 职业 × 2 流派）的注册与技能池校验
        /// <para/>技能池一律取自模组通用战技 / 通用被动，故校验其 Id 落在通用号段内（战技 2001–2099 / 被动 4001–4048）
        /// </summary>
        private static void TestWorldClassRegistration()
        {
            Console.WriteLine("--- 场景：筽祀牻世界观职业注册（3 职业 × 2 流派）---");

            (Func<Class> ClassFactory, Func<Class, SubClass> SubFactory, string ClassName, string SubName)[] pairs =
            [
                (OshimaWorldClasses.Create导械师, OshimaWorldClasses.Create晶枢术士, "导械师", "晶枢术士"),
                (OshimaWorldClasses.Create导械师, OshimaWorldClasses.Create铳械猎手, "导械师", "铳械猎手"),
                (OshimaWorldClasses.Create熵噬者, OshimaWorldClasses.Create熵灭剑徒, "熵噬者", "熵灭剑徒"),
                (OshimaWorldClasses.Create熵噬者, OshimaWorldClasses.Create实验体, "熵噬者", "实验体"),
                (OshimaWorldClasses.Create深潮行者, OshimaWorldClasses.Create潮汐守卫, "深潮行者", "潮汐守卫"),
                (OshimaWorldClasses.Create深潮行者, OshimaWorldClasses.Create深渊猎手, "深潮行者", "深渊猎手")
            ];

            foreach ((Func<Class> classFactory, Func<Class, SubClass> subFactory, string className, string subName) in pairs)
            {
                Class classDef = classFactory();
                SubClass subDef = subFactory(classDef);
                string key = $"「{className}·{subName}」";

                // 注册表可按 IdName 重建（存档读档依赖此路径）
                Check(ClassDefinitionRegistry.CreateClass(classDef.GetIdName()) is not null, $"{key} 职业已注册，可按 IdName 重建");
                Check(ClassDefinitionRegistry.CreateSubClass(subDef.GetIdName(), classDef) is not null, $"{key} 流派已注册，可按 IdName 重建");

                // 技能池：10 战技 + 4 被动，且全部来自通用号段
                Check(classDef.Skills.Count == 10, $"{key} 战技池 10 个", $"实际={classDef.Skills.Count}");
                Check(classDef.PassiveSkills.Count == 4, $"{key} 被动池 4 个", $"实际={classDef.PassiveSkills.Count}");
                Check(classDef.Skills.All(s => s.Level == 1 && s.Id is >= 2001 and <= 2099), $"{key} 战技均为通用战技且基础 1 级");
                Check(classDef.PassiveSkills.All(s => s.Level == 1 && s.Id is >= 4001 and <= 4048), $"{key} 被动均为通用被动且基础 1 级");
                Check(classDef.Skills.All(s => s.SkillType == SkillType.Skill), $"{key} 战技池不含非战技类型");
                Check(classDef.PassiveSkills.All(s => s.SkillType == SkillType.Passive), $"{key} 被动池不含非被动类型");

                // 天赋池 4 个定位；流派开放的定位必须能在职业天赋池中找到对应天赋
                Check(classDef.CombatTalents.Count == 4, $"{key} 战斗天赋覆盖 4 个定位", $"实际={classDef.CombatTalents.Count}");
                Check(subDef.RoleTypes.Count > 0 && subDef.RoleTypes.All(r => classDef.CombatTalents.ContainsKey(r)),
                    $"{key} 流派定位均能在职业天赋池中找到对应天赋", $"定位={string.Join("/", subDef.RoleTypes)}");

                // 固有被动：1 级与 6 级各 1 个
                Check(subDef.InherentPassives.ContainsKey(1) && subDef.InherentPassives[1].Count == 1, $"{key} 1 级固有被动 1 个");
                Check(subDef.InherentPassives.ContainsKey(6) && subDef.InherentPassives[6].Count == 1, $"{key} 6 级固有被动 1 个");

                // 职业模板属性上下限
                Check(classDef.AttributeLimit is not null, $"{key} 已配置职业模板属性上下限");
            }

            // 端到端：导械师 + 晶枢术士 走一遍规划器，确认技能池可正常习得并物化
            Class def = OshimaWorldClasses.Create导械师();
            Character hero = new OshimaShiya();
            hero.Level = 20;
            hero.Class.OnLevelUp();
            ClassPlanner planner = new(hero) { SkillSelectionEnabled = true };
            ClassPlanResult result = planner.SelectClass(def, OshimaWorldClasses.Create晶枢术士(def));
            Check(result.Success, "导械师 + 晶枢术士：选择职业与流派", result.Message);
            if (!result.Success)
            {
                return;
            }
            Class rec = planner.Plan.Classes.First();
            for (int i = 0; i < 3; i++)
            {
                planner.UpgradeClass(rec);
            }
            Check(rec.Level == 4, "导械师升至 4 级", $"实际={rec.Level}");
            Check(planner.LearnClassSkill(rec, rec.Skills.First()).Success, "可从通用战技池习得战技");
            planner.Plan.ApplyTo(hero);
            Check(hero.Skills.Any(s => s.Source == SkillSource.Class), "物化后职业技能挂载到角色");
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
