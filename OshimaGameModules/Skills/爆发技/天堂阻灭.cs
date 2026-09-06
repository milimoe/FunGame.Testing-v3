using FunGame.Core.Api;
using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.EffectContext;
using FunGame.Core.Model.Framework;
using FunGame.Core.Model.PrefabricatedEntity;

namespace Milimoe.FunGameTesting.OshimaGameModules.Skills
{
    public class 天堂阻灭 : SoulboundSkill
    {
        public override long Id => (long)SuperSkillID.天堂阻灭;
        public override string Name => "天堂阻灭";
        public override string Description => Effects.Count > 0 ? Effects.First().Description : "";
        public override string DispelDescription => Effects.Count > 0 ? Effects.First().DispelDescription : "";
        public override double CD => 120;
        public override double HardnessTime { get; set; } = 16;

        public 天堂阻灭(Character? character = null) : base(character)
        {
            Effects.Add(new 天堂阻灭特效(this));
        }
    }

    public class 天堂阻灭特效(SoulboundSkill skill) : SoulboundEffect(skill)
    {
        public override long Id => Skill.Id;
        public override string Name => Skill.Name;
        public override string Description => $"对{Skill.TargetDescription()}造成 " +
            $"{(Skill.Character != null ? CharacterSet.GetPrimaryAttributeName(Skill.Character.PrimaryAttribute) : "核心属性")} {PACoefficient * 100:0.##}% [ {PADamage:0.##} ] + {GeneralDamage:0.##} 点{CharacterSet.GetDamageTypeName(DamageType.True)}。" +
            (Improvement > 0 ? $"灵魂绑定伤害加成： {Improvement * 100:0.##}% [ {ImprovementDamage:0.##} ] 点，" : "") + $"总伤害 {Damage + ImprovementDamage:0.##} 点。天堂阻灭无视护甲与魔抗，造成巨额伤害。";

        public double PACoefficient => 0.75 + 0.25 * (Skill.Level - 1);
        public double PADamage => (Skill.Character?.PrimaryAttributeValue ?? 0) * PACoefficient;
        public double GeneralDamage => 100 * Skill.Level;
        public double Damage => GeneralDamage + PADamage;
        public double ImprovementDamage => Improvement > 0 ? Damage * Improvement : 0;

        public override void OnSkillCasted(SkillCastContext ctx)
        {
            if (ctx.Trigger is not Character caster) return;
            List<Character> targets = ctx.Targets;
            foreach (Character target in targets)
            {
                DamageCalculationOptions options = new(caster);
                DamageToEnemy(caster, target, DamageType.True, MagicType.None, Damage + ImprovementDamage, options);
            }
        }
    }
}
