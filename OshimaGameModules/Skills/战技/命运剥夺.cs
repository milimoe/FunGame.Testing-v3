using FunGame.Core.Api;
using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.EffectContext;

namespace Milimoe.FunGameTesting.OshimaGameModules.Skills
{
    /// <summary>
    /// 命运剥夺：应用【回合奖励】系统的「一次性移除」能力
    /// <para/>· 摧毁目标未来第 1 个行动回合的全部回合奖励（<see cref="FunGame.Core.Interface.Base.IGamingQueue.RemoveRoundRewards"/>）
    /// <para/>· 无论是否剥夺到奖励，都会造成魔法伤害，属于稳定的输出 + 反制手段
    /// </summary>
    public class 命运剥夺 : Skill
    {
        public override long Id => (long)SkillID.命运剥夺;
        public override string Name => "命运剥夺";
        public override string Description => Effects.Count > 0 ? Effects.First().Description : "";
        public override string DispelDescription => Effects.Count > 0 ? Effects.First().DispelDescription : "";
        public override double EPCost => 55;
        public override double CD => 40;
        public override double HardnessTime { get; set; } = 7;
        public override bool CanSelectSelf => false;
        public override bool CanSelectEnemy => true;
        public override bool CanSelectTeammate => false;
        public override int CanSelectTargetCount => 1;

        public 命运剥夺(Character? character = null) : base(SkillType.Skill, character)
        {
            CastRange = 6;
            Effects.Add(new 命运剥夺特效(this));
        }
    }

    public class 命运剥夺特效(Skill skill) : Effect(skill)
    {
        public override long Id => Skill.Id;
        public override string Name => Skill.Name;
        public override string Description =>
            $"摧毁{Skill.TargetDescription()}未来第 1 个行动回合的全部回合奖励，并对其造成 " +
            $"{伤害系数 * 100:0.##}% 攻击力 [ {Skill.Character?.BaseATK * 伤害系数:0.##} ] 点魔法伤害。";
        public override string DispelDescription => "被驱散性：不可驱散";
        public override DispelledType DispelledType => DispelledType.CannotBeDispelled;

        private double 伤害系数 => Level > 0 ? 1.0 + 0.2 * (Level - 1) : 1.0;

        public override void OnSkillCasted(SkillCastContext ctx)
        {
            if (ctx.Trigger is not Character caster) return;
            foreach (Character target in ctx.Targets)
            {
                if (target.HP <= 0) continue;

                if (GamingQueue is not null
                    && GamingQueue.RemoveRoundRewards(target, 1, out List<Skill> removed)
                    && removed.Count > 0)
                {
                    WriteLine($"[ {caster} ] 剥夺了 [ {target} ] 下个行动回合的回合奖励！");
                    foreach (Skill reward in removed)
                    {
                        WriteLine($"　└ 已摧毁 [ {reward.Name} ]");
                    }
                }
                else
                {
                    WriteLine($"[ {caster} ] 未能在 [ {target} ] 身上找到可剥夺的回合奖励。");
                }

                DamageToEnemy(caster, target, DamageType.Magical, MagicType.None, caster.ATK * 伤害系数);
            }
        }
    }
}
