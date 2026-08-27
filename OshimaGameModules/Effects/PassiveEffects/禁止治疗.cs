using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.EffectContext;
using Milimoe.FunGameTesting.OshimaGameModules.Effects.OpenEffects;

namespace Milimoe.FunGameTesting.OshimaGameModules.Effects.PassiveEffects
{
    public class 禁止治疗 : Effect
    {
        public override long Id => (long)PassiveEffectID.禁止治疗;
        public override string Name => "禁止治疗";
        public override string Description => $"此角色已被禁止治疗{禁止类型}。来自：[ {Source} ] 的 [ {Skill.Name} ]";
        public override EffectType EffectType => EffectType.GrievousWound;
        public override Character Source => _sourceCharacter;
        public override bool Durative => _durative;
        public override double Duration => _duration;
        public override int DurationTurn => _durationTurn;

        public string 禁止类型
        {
            get
            {
                if (_allowRecovery && _allowLifeSteal && _allowHealing)
                {
                    return "";
                }
                List<string> strings = [];
                if (!_allowRecovery)
                {
                    strings.Add("自然回复");
                }
                if (!_allowLifeSteal)
                {
                    strings.Add("生命偷取");
                }
                if (!_allowHealing)
                {
                    strings.Add("应用治疗");
                }
                return $"（{string.Join("、", strings)}）";
            }
        }
        private readonly Character _sourceCharacter;
        private readonly bool _allowRecovery;
        private readonly bool _allowLifeSteal;
        private readonly bool _allowHealing;
        private readonly bool _durative;
        private readonly double _duration;
        private readonly int _durationTurn;

        public 禁止治疗(Skill skill, Character sourceCharacter, bool allowRecovery = false, bool allowLifeSteal = false, bool allowHealing = false, bool durative = false, double duration = 0, int durationTurn = 1) : base(skill)
        {
            GamingQueue = skill.GamingQueue;
            _sourceCharacter = sourceCharacter;
            _allowRecovery = allowRecovery;
            _allowLifeSteal = allowLifeSteal;
            _allowHealing = allowHealing;
            if (!_allowHealing)
            {
                _allowLifeSteal = false;
                _allowRecovery = false;
            }
            _durative = durative;
            _duration = duration;
            _durationTurn = durationTurn;
        }

        public override bool BeforeApplyRecoveryAtTimeLapsing(TimeLapseContext ctx)
        {
            return _allowRecovery;
        }

        public override bool BeforeLifesteal(LifestealContext ctx)
        {
            return _allowLifeSteal;
        }

        public override bool BeforeHealToTarget(HealContext ctx)
        {
            return _allowHealing;
        }

        public override void OnEffectGained(HookContext ctx)
        {
            if (ctx.Actor is not Character character) return;
            if (_allowRecovery && _allowLifeSteal && _allowHealing)
            {
                character.Effects.Remove(this);
                return;
            }
            if (_durative && RemainDuration == 0)
            {
                RemainDuration = Duration;
            }
            else if (RemainDurationTurn == 0)
            {
                RemainDurationTurn = DurationTurn;
            }
        }
    }
}
