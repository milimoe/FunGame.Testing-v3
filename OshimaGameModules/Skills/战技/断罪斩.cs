using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using Milimoe.FunGameTesting.OshimaGameModules.Effects.SkillEffects;

namespace Milimoe.FunGameTesting.OshimaGameModules.Skills
{
    /// <summary>
    /// 【技能制作示范】断罪斩 —— 单目标物理战技
    /// <para>制作一个技能只需三步：
    /// ① 在 <see cref="SkillID"/> 分配一个 Id；
    /// ② 继承 <see cref="Skill"/>，按需 override Id/Name/消耗/冷却/硬直等数值属性；
    /// ③ 在构造里把效果（Effect 子类）加入 <see cref="Skill.Effects"/>，技能的效果与描述即生效。
    /// 数值公式沿用 Oshima 惯例：随 <see cref="Skill.Level"/> 成长（Level 为 0 时视为未学习，用基础值）。</para>
    /// </summary>
    public class 断罪斩 : Skill
    {
        public override long Id => (long)SkillID.断罪斩;
        public override string Name => "断罪斩";
        public override string Description => Effects.Count > 0 ? Effects.First().Description : "";
        public override double MPCost => 20 + 10 * (Level - 1); // 法力随等级成长
        public override double CD => 20;
        public override double CastTime => 3;
        public override double HardnessTime { get; set; } = 5;

        /// <summary>
        /// 继承此构造：传入角色后即可 AddSkillToCharacter 加入战斗
        /// </summary>
        /// <param name="character"></param>
        public 断罪斩(Character? character = null) : base(SkillType.Skill, character)
        {
            // 复用现成的「基于攻击力的伤害」效果（带基础伤害 + 攻击力系数，物理伤害型）
            Effects.Add(new 基于攻击力的伤害_带基础伤害(this, 120, 60, 0.5, 0.2, DamageType.Physical));
        }
    }
}
