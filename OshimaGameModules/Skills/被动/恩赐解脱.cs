using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.EffectContext;
using Milimoe.FunGameTesting.OshimaGameModules.Effects.OpenEffects;

namespace Milimoe.FunGameTesting.OshimaGameModules.Skills
{
    public class 恩赐解脱 : Skill
    {
        public override long Id => (long)PassiveID.恩赐解脱;
        public override string Name => "恩赐解脱";
        public override string Description => Effects.Count > 0 ? Effects.First().Description : "";
        public override string DispelDescription => Effects.Count > 0 ? Effects.First().DispelDescription : "";

        public 恩赐解脱(Character? character = null) : base(SkillType.Passive, character)
        {
            Effects.Add(new 恩赐解脱特效(this));
        }

        public override IEnumerable<Effect> AddPassiveEffectToCharacter()
        {
            return Effects;
        }
    }

    public class 恩赐解脱特效(Skill skill) : Effect(skill)
    {
        public override long Id => Skill.Id;
        public override string Name => Skill.Name;
        public override string Description => $"攻击敌人时，有 {触发概率 * 100:0.##}% 概率提升 {暴击伤害提升 * 100:0.##}% 暴击伤害，持续 {持续时间:0.##} {GameplayEquilibriumConstant.InGameTime}。";

        private double 触发概率 => Skill.Character != null ? Math.Min(0.45, 0.2 + Skill.Character.Level * 0.005) : 0.2;
        private double 暴击伤害提升 => Skill.Character != null ? 0.25 + Skill.Character.Level * 0.002 : 0.25;
        private double 持续时间 => Skill.Character != null ? 4 + Skill.Character.Level * 0.05 : 4;

        public override void AfterDamageCalculation(DamageContext ctx)
        {
            if (ctx.Trigger is not Character character || ctx.Enemy is not Character enemy) return;
            if (Skill.Character == null || Skill.Character != character) return;
            if (ctx.DamageResult != DamageResult.Normal && ctx.DamageResult != DamageResult.Critical) return;
            if (Random.NextDouble() > 触发概率) return;
            // 刷新自身暴击伤害提升
            List<Effect> olds = character.Effects.Where(e => e is DynamicsEffect && e.Name == nameof(恩赐解脱) + "·暴伤").ToList();
            foreach (Effect e in olds)
            {
                character.Effects.Remove(e);
                e.OnEffectLost(new HookContext(GamingQueue, character));
            }
            WriteLine($"[ {character} ] 发动了恩赐解脱！暴击伤害提升了 {暴击伤害提升 * 100:0.##}%！");
            Effect buff = new DynamicsEffect(Skill, new Dictionary<string, object>()
            {
                { "excrd", 暴击伤害提升 }
            }, character)
            {
                Name = nameof(恩赐解脱) + "·暴伤",
                Durative = true,
                Duration = 持续时间
            };
            character.Effects.Add(buff);
            buff.OnEffectGained(new HookContext(GamingQueue, character));
        }
    }
}
