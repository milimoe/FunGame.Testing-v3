using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using Milimoe.FunGameTesting.OshimaGameModules.Effects.SkillEffects;

namespace Milimoe.FunGameTesting.OshimaGameModules.Skills
{
    public class 霸王疾风 : Skill
    {
        public override long Id => (long)SkillID.霸王疾风;
        public override string Name => "霸王疾风";
        public override string Description => Effects.Count > 0 ? string.Join("", Effects.Select(e => e.Description)) : "";
        public override double EPCost => 60;
        public override double CD => 22;
        public override double HardnessTime { get; set; } = 8;

        public 霸王疾风(Character? character = null) : base(SkillType.Skill, character)
        {
            CastRange = 4;
            Effects.Add(new 基于攻击力的伤害_带基础伤害(this, 85, 70, 0.12, 0.06, DamageType.Physical));
        }
    }
}
