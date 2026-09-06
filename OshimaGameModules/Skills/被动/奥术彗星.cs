using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.EffectContext;

namespace Milimoe.FunGameTesting.OshimaGameModules.Skills
{
    public class 奥术彗星 : Skill
    {
        public override long Id => (long)PassiveID.奥术彗星;
        public override string Name => "奥术彗星";
        public override string Description => Effects.Count > 0 ? Effects.First().Description : "";
        public override string DispelDescription => Effects.Count > 0 ? Effects.First().DispelDescription : "";

        public 奥术彗星(Character? character = null) : base(SkillType.Passive, character)
        {
            Effects.Add(new 奥术彗星特效(this));
        }

        public override IEnumerable<Effect> AddPassiveEffectToCharacter()
        {
            return Effects;
        }
    }

    public class 奥术彗星特效(Skill skill) : Effect(skill)
    {
        public override long Id => Skill.Id;
        public override string Name => Skill.Name;
        public override string Description => $"技能命中敌人时，召唤奥术彗星造成 {彗星伤害:0.##} 点魔法伤害。彗星每 {冷却时间:0.##} {GameplayEquilibriumConstant.InGameTime}只能发动一次。";

        private double 剩余冷却 = 0;

        private double 冷却时间 => Skill.Character != null ? Math.Max(3, 8 - Skill.Character.Level * 0.05) : 8;
        private double 彗星伤害 => Skill.Character != null ? 70 + Skill.Character.Level * 6 + Skill.Character.PrimaryAttributeValue * 0.6 : 70;

        public override void AfterDamageCalculation(DamageContext ctx)
        {
            if (ctx.Trigger is not Character character || ctx.Enemy is not Character enemy) return;
            if (Skill.Character == null || Skill.Character != character) return;
            if (ctx.IsNormalAttack) return;
            if (ctx.DamageResult != DamageResult.Normal && ctx.DamageResult != DamageResult.Critical) return;
            if (剩余冷却 > 0) return;
            剩余冷却 = 冷却时间;
            WriteLine($"[ {character} ] 发动了奥术彗星！对 [ {enemy} ] 造成了 {彗星伤害:0.##} 点魔法伤害！");
            DamageToEnemy(character, enemy, DamageType.Magical, ctx.MagicType, 彗星伤害, new(character)
            {
                TriggerEffects = false
            });
        }

        public override void OnTimeElapsed(TimeLapseContext ctx)
        {
            if (ctx.Trigger is not Character character) return;
            if (剩余冷却 > 0)
            {
                剩余冷却 -= ctx.Elapsed;
            }
        }
    }
}
