using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.EffectContext;
using FunGame.Core.Model.EffectResult;

namespace Milimoe.FunGameTesting.OshimaGameModules.Skills
{
    public class 海妖外壳 : Skill
    {
        public override long Id => (long)PassiveID.海妖外壳;
        public override string Name => "海妖外壳";
        public override string Description => Effects.Count > 0 ? Effects.First().Description : "";
        public override string DispelDescription => Effects.Count > 0 ? Effects.First().DispelDescription : "";

        public 海妖外壳(Character? character = null) : base(SkillType.Passive, character)
        {
            Effects.Add(new 海妖外壳特效(this));
        }

        public override IEnumerable<Effect> AddPassiveEffectToCharacter()
        {
            return Effects;
        }
    }

    public class 海妖外壳特效(Skill skill) : Effect(skill)
    {
        public override long Id => Skill.Id;
        public override string Name => Skill.Name;
        public override string Description => $"每 {再生间隔:0.##} {GameplayEquilibriumConstant.InGameTime}生成一次 {护盾值:0.##} 点混合护盾（自身护盾破碎后才再生）；护盾破碎时，立即强驱散自身身上的减益效果。";

        private double 剩余再生 = 0;
        private bool 有壳 = false;

        private double 再生间隔 => Skill.Character != null ? 12 - Skill.Character.Level * 0.1 : 12;
        private double 护盾值 => Skill.Character != null ? 120 + Skill.Character.Level * 12 : 120;

        public override void OnEffectGained(HookContext ctx)
        {
            if (ctx.Trigger is not Character character) return;
            if (Skill.Character == null || Skill.Character != character) return;
            剩余再生 = 再生间隔;
        }

        public override void OnTimeElapsed(TimeLapseContext ctx)
        {
            if (ctx.Trigger is not Character character) return;
            if (Skill.Character == null || Skill.Character != character) return;
            剩余再生 -= ctx.Elapsed;
            if (剩余再生 <= 0 && !有壳)
            {
                有壳 = true;
                剩余再生 = 再生间隔;
                WriteLine($"[ {character} ] 的海妖外壳生成了一层 {护盾值:0.##} 点混合护盾！");
                character.Shield.Mix += 护盾值;
                GamingQueue?.AddApplyEffects(character, EffectType.Shield);
            }
        }

        public override OnShieldBrokenResult OnShieldBroken(ShieldContext ctx)
        {
            if (ctx.Trigger is not Character character) return default;
            if (Skill.Character == null || Skill.Character != character) return default;
            if (!有壳) return default;
            有壳 = false;
            // 强驱散：清除自身所有减益
            List<Effect> debuffs = character.Effects.Where(e => e != this && e.IsDebuff && !ReferenceEquals(e.Skill, Skill)).ToList();
            foreach (Effect e in debuffs)
            {
                character.Effects.Remove(e);
                e.OnEffectLost(new HookContext(GamingQueue, character));
            }
            WriteLine($"[ {character} ] 的海妖外壳破碎了，减益效果被清除！");
            return default;
        }
    }
}
