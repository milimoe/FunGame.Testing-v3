using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.EffectContext;
using Milimoe.FunGameTesting.OshimaGameModules.Effects.OpenEffects;

namespace Milimoe.FunGameTesting.OshimaGameModules.Skills
{
    public class 导力装甲 : Skill
    {
        public override long Id => (long)SkillID.导力装甲;
        public override string Name => "导力装甲";
        public override string Description => Effects.Count > 0 ? Effects.First().Description : "";
        public override string DispelDescription => Effects.Count > 0 ? Effects.First().DispelDescription : "";
        public override double EPCost => 80;
        public override double CD => 60;
        public override double HardnessTime { get; set; } = 6;
        public override bool CanSelectSelf => true;
        public override bool CanSelectEnemy => false;
        public override bool CanSelectTeammate => false;

        public 导力装甲(Character? character = null) : base(SkillType.Skill, character)
        {
            Effects.Add(new 导力装甲特效(this));
        }
    }

    public class 导力装甲特效(Skill skill) : Effect(skill)
    {
        public override long Id => Skill.Id;
        public override string Name => Skill.Name;
        public override string Description => $"启动导力装甲：提升自身 {攻击提升 * 100:0.##}% 攻击力、{护甲提升 * 100:0.##}% 物理护甲和{魔抗提升 * 100:0.##}% 魔法抗性，并立即缩短自身 35% 的行动等待时间，持续 {持续回合} 回合。装甲期间自身的行动硬直大幅缩短。";
        public override string DispelDescription => "被驱散性：不可驱散";
        public override DispelledType DispelledType => DispelledType.CannotBeDispelled;
        public override EffectType EffectType => EffectType.DefenseBoost;

        private double 攻击提升 => Level > 0 ? 0.35 + 0.05 * (Level - 1) : 0.35;
        private double 护甲提升 => Level > 0 ? 0.35 + 0.05 * (Level - 1) : 0.35;
        private double 魔抗提升 => Level > 0 ? 0.35 + 0.05 * (Level - 1) : 0.35;
        private int 持续回合 => 4;

        public override void OnSkillCasted(SkillCastContext ctx)
        {
            if (ctx.Trigger is not Character caster) return;
            if (caster.Effects.Any(e => e.Skill?.Id == Skill.Id && e is ExATK2 or ExDEF2 or ExMDF)) return;
            WriteLine($"[ {caster} ] 启动了导力装甲！");
            ExATK2 atk = new(Skill, new() { { "exatk", 攻击提升 } }, caster)
            {
                Name = Name,
                Durative = false,
                Duration = 0,
                DurationTurn = 持续回合,
                EffectType = EffectType.DamageBoost,
                DispelledType = DispelledType.CannotBeDispelled
            };
            caster.Effects.Add(atk);
            atk.OnEffectGained(new HookContext(GamingQueue, caster));
            GamingQueue?.AddApplyEffects(caster, EffectType.DamageBoost);
            ExDEF2 def = new(Skill, new() { { "exdef", 护甲提升 } }, caster)
            {
                Name = Name,
                Durative = false,
                Duration = 0,
                DurationTurn = 持续回合,
                EffectType = EffectType.DefenseBoost,
                DispelledType = DispelledType.CannotBeDispelled
            };
            caster.Effects.Add(def);
            def.OnEffectGained(new HookContext(GamingQueue, caster));
            GamingQueue?.AddApplyEffects(caster, EffectType.DefenseBoost);
            ExMDF mdf = new(Skill, new() { { "mdftype", 0 }, { "mdfvalue", 魔抗提升 } }, caster)
            {
                Name = Name,
                Durative = false,
                Duration = 0,
                DurationTurn = 持续回合,
                EffectType = EffectType.DefenseBoost,
                DispelledType = DispelledType.CannotBeDispelled
            };
            caster.Effects.Add(mdf);
            mdf.OnEffectGained(new HookContext(GamingQueue, caster));
            GamingQueue?.AddApplyEffects(caster, EffectType.DefenseBoost);
            GamingQueue?.ChangeCharacterHardnessTime(caster, -0.35, true, false);
        }
    }
}
