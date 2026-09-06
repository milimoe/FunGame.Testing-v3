using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.EffectContext;

namespace Milimoe.FunGameTesting.OshimaGameModules.Skills
{
    public class 回复原状 : Skill
    {
        public override long Id => (long)SkillID.回复原状;
        public override string Name => "回复原状";
        public override string Description => Effects.Count > 0 ? Effects.First().Description : "";
        public override double EPCost => 15;
        public override double CD => 20;
        public override double HardnessTime { get; set; } = 3;
        public override bool CanSelectSelf => true;
        public override bool CanSelectEnemy => false;
        public override bool CanSelectTeammate => false;

        public 回复原状(Character? character = null) : base(SkillType.Skill, character)
        {
            Effects.Add(new 回复原状特效(this));
        }
    }

    public class 回复原状特效(Skill skill) : Effect(skill)
    {
        public override long Id => Skill.Id;
        public override string Name => Skill.Name;
        public override string Description => "解除自身的导力装甲状态，并恢复到通常的战斗姿态。";

        public override void OnSkillCasted(SkillCastContext ctx)
        {
            if (ctx.Trigger is not Character caster) return;
            List<Effect> armored = [.. caster.Effects.Where(e => e.Skill?.Id == (long)SkillID.导力装甲).ToList()];
            if (armored.Count == 0)
            {
                WriteLine($"[ {caster} ] 当前并未处于导力装甲状态。");
                return;
            }
            foreach (Effect e in armored)
            {
                e.OnEffectLost(new HookContext(GamingQueue, caster));
                caster.Effects.Remove(e);
            }
            WriteLine($"[ {caster} ] 解除了导力装甲，恢复了通常的战斗姿态！");
        }
    }
}
