using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using Milimoe.FunGameTesting.OshimaGameModules.Effects.SkillEffects;

namespace Milimoe.FunGameTesting.OshimaGameModules.Skills
{
    public class 灾难一掷 : Skill
    {
        public override long Id => (long)SkillID.灾难一掷;
        public override string Name => "灾难一掷";
        public override string Description => Effects.Count > 0 ? string.Join("", Effects.Select(e => e.Description)) : "";
        public override string DispelDescription => Effects.Count > 0 ? Effects.First(e => e is 施加概率负面).DispelDescription : "";
        public override string ExemptionDescription => Effects.Count > 0 ? Effects.First(e => e is 施加概率负面).ExemptionDescription : "";
        public override double EPCost => 70;
        public override double CD => 28;
        public override double HardnessTime { get; set; } = 9;

        public 灾难一掷(Character? character = null) : base(SkillType.Skill, character)
        {
            CastRange = 6;
            Effects.Add(new 基于攻击力的伤害_带基础伤害(this, 80, 65, 0.11, 0.055, DamageType.Physical));
            Effects.Add(new 施加概率负面(this, EffectType.Cripple, false, 0, 1, 0, 0.35, 0.03));
        }
    }
}
