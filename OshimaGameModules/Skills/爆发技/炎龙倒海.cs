using FunGame.Core.Api;
using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.EffectContext;
using FunGame.Core.Model.Framework;
using FunGame.Core.Model.PrefabricatedEntity;

namespace Milimoe.FunGameTesting.OshimaGameModules.Skills
{
    public class 炎龙倒海 : SoulboundSkill
    {
        public override long Id => (long)SuperSkillID.炎龙倒海;
        public override string Name => "炎龙倒海";
        public override string Description => Effects.Count > 0 ? Effects.First().Description : "";
        public override string DispelDescription => Effects.Count > 0 ? Effects.First().DispelDescription : "";
        public override double CD => 75;
        public override double HardnessTime { get; set; } = 12;
        public override bool SelectAllEnemies => true;

        public 炎龙倒海(Character? character = null) : base(character)
        {
            Effects.Add(new 炎龙倒海特效(this));
        }
    }

    public class 炎龙倒海特效(SoulboundSkill skill) : SoulboundEffect(skill)
    {
        public override long Id => Skill.Id;
        public override string Name => Skill.Name;
        public override string Description => $"基于{Skill.SkillOwner()}的 {ATKCoefficient * 100:0.##}% 攻击力 [ {Damage:0.##} ] 对{Skill.TargetDescription()}造成{CharacterSet.GetDamageTypeName(DamageType.Magical)}" +
            (Improvement > 0 ? $"，灵魂绑定伤害加成： {Improvement * 100:0.##}% [ {ImprovementDamage:0.##} ] 点，总伤害 {Damage + ImprovementDamage:0.##} 点；" : "；") +
            $"造成伤害后，削减每个目标 {EnergySteal:0.##} 点能量值，并施加灼焰迟滞 {持续时间:0.##} {GameplayEquilibriumConstant.InGameTime}：行动速度降低 {ActionSpeedReductionPercent * 100:0.##}%、加速系数降低 {AccelerationReductionPercent * 100:0.##}%，且当前行动被推迟 {HardnessDelayPercent * 100:0.##}%。";

        public double ATKCoefficient => 0.45 + 0.1 * (Skill.Level - 1);
        public double Damage => (Skill.Character?.ATK ?? 0) * ATKCoefficient;
        public double ImprovementDamage => Improvement > 0 ? Damage * Improvement : 0;
        public double EnergySteal => 15 + 10 * (Skill.Level - 1);
        public double 持续时间 => 8 + 2 * (Skill.Level - 1);
        public double ActionSpeedReductionPercent => 0.2 + 0.03 * (Skill.Level - 1);
        public double AccelerationReductionPercent => 0.1 + 0.02 * (Skill.Level - 1);
        public double HardnessDelayPercent => 0.25 + 0.05 * (Skill.Level - 1);

        public override void OnSkillCasted(SkillCastContext ctx)
        {
            if (ctx.Trigger is not Character caster) return;
            List<Character> targets = ctx.Targets;
            List<Grid> grids = ctx.Grids;
            Dictionary<string, object> others = ctx.Others;
            foreach (Character target in targets)
            {
                DamageCalculationOptions options = new(caster);
                if (DamageToEnemy(caster, target, DamageType.Magical, MagicType.None, Damage + ImprovementDamage, options).ActualDamage > 0)
                {
                    double reduce = Math.Min(EnergySteal, target.EP);
                    if (reduce > 0)
                    {
                        target.EP -= reduce;
                        WriteLine($"[ {caster} ] 发动了炎龙倒海！[ {target} ] 的能量值被削减了 {reduce:0.##} 点！现有能量：{target.EP:0.##}。");
                    }
                    灼焰迟滞 e = new(Skill, target, caster, 持续时间, ActionSpeedReductionPercent, AccelerationReductionPercent);
                    if (!CheckExemption(caster, target, e))
                    {
                        GamingQueue?.ChangeCharacterHardnessTime(target, HardnessDelayPercent, true, false);
                        WriteLine($"[ {caster} ] 对 [ {target} ] 施加了灼焰迟滞 {持续时间:0.##} {GameplayEquilibriumConstant.InGameTime}，并推迟了其当前行动！");
                        e.AddToCharacter(target);
                        GamingQueue?.AddApplyEffects(target, e.EffectType);
                    }
                }
            }
        }
    }

    public class 灼焰迟滞 : Effect
    {
        public override long Id => Skill.Id;
        public override string Name => Skill.Name + "·灼焰迟滞";
        public override string Description => $"此角色处于灼焰迟滞状态，行动速度降低 {_actionSpeedReductionPercent * 100:0.##}%，加速系数降低 {_accelerationReductionPercent * 100:0.##}%。来自：[ {Source} ] 的 [ {Skill.Name} ]";
        public override EffectType EffectType => EffectType.Slow;
        public override DispelledType DispelledType => DispelledType.Weak;
        public override bool IsDebuff => true;
        public override bool ExemptDuration => true;
        public override Character Source => _sourceCharacter;
        public override bool Durative => _durative;
        public override double Duration => _duration;
        public override int DurationTurn => _durationTurn;

        private readonly Character _targetCharacter;
        private readonly Character _sourceCharacter;
        private readonly bool _durative;
        private readonly double _duration;
        private readonly int _durationTurn;
        private readonly double _actionSpeedReductionPercent;
        private readonly double _accelerationReductionPercent;
        private double _spdValue = 0;
        private double _accValue = 0;

        public 灼焰迟滞(Skill skill, Character targetCharacter, Character sourceCharacter, double duration = 0, double actionSpeedReductionPercent = 0, double accelerationReductionPercent = 0, int durationTurn = 0) : base(skill)
        {
            GamingQueue = skill.GamingQueue;
            _targetCharacter = targetCharacter;
            _sourceCharacter = sourceCharacter;
            _durative = duration > 0;
            _duration = duration;
            _durationTurn = durationTurn;
            _actionSpeedReductionPercent = actionSpeedReductionPercent;
            _accelerationReductionPercent = accelerationReductionPercent;
        }

        public override void OnEffectGained(HookContext ctx)
        {
            if (ctx.Trigger is not Character character) return;
            if (_durative && RemainDuration == 0)
            {
                RemainDuration = Duration;
            }
            else if (RemainDurationTurn == 0)
            {
                RemainDurationTurn = DurationTurn;
            }
            if (character == _targetCharacter)
            {
                _spdValue = character.SPD * _actionSpeedReductionPercent;
                _accValue = _accelerationReductionPercent;
                character.ExSPD -= _spdValue;
                character.ExAccelerationCoefficient -= _accValue;
            }
            AddEffectTypeToCharacter(character, [EffectType.Slow]);
        }

        public override void OnEffectLost(HookContext ctx)
        {
            if (ctx.Trigger is not Character character) return;
            if (character == _targetCharacter)
            {
                character.ExSPD += _spdValue;
                character.ExAccelerationCoefficient += _accValue;
            }
            RemoveEffectTypesFromCharacter(character);
        }
    }
}
