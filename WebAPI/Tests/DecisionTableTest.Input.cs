using FunGame.Core.Api;
using FunGame.Core.Entity;
using FunGame.Core.Interface;
using FunGame.Core.Model.DecisionTable;
using Milimoe.FunGameTesting.OshimaGameModules.Skills;

namespace Milimoe.FunGameTesting.Tests;

public static partial class DecisionTableTest
{
    private static void CheckLoaderDiagnostics()
    {
        Fixture fixture = new();
        Skill skill = fixture.Learn(new 回复弹());
        fixture.Patient.HP = fixture.Patient.MaxHP * .4;
        double hp = fixture.Patient.HP;
        fixture.Use(HealerConfig());
        IDecisionPolicy policy = fixture.Actor.DecisionPolicy!;
        foreach (string path in new[] { "", "bad\0name.json" })
        {
            IReadOnlyList<DecisionDiagnostic> errors = fixture.Loader.Load(path);
            Check(errors.Count == 1 && errors[0].Path == path, "路径格式错误没有转换为诊断。");
        }
        DecisionTableConfig invalid = DecisionTableParser.Parse("""{"id":"oshima:test-healer","rules":null}""");
        Check(fixture.Loader.Register(invalid).Any(error => error.Path == "rules" && error.Message.Contains("允许空表")),
            "null 规则列表没有准确诊断。");
        Check(fixture.Loader.Register(HealerConfig()).Any(error => error.Path == "id"), "重复配置未返回标识诊断。");
        Check(ReferenceEquals(policy, fixture.Loader.Get(fixture.Actor.DecisionTableId!)), "失败加载或重复配置替换了已有策略。");
        Bind(fixture.Loader, fixture.Actor, fixture.Actor.DecisionTableId!);
        fixture.RunActor();
        Check(fixture.Patient.HP > hp && fixture.Hits.Contains("heal-patient"), "输入错误后原有治疗策略未继续执行。");
        Check(fixture.Queue.LastRound.Actions.Any(action => action.Skill == skill && action.IsSuccess &&
            action.Heals.GetValueOrDefault(fixture.Patient) > 0), "输入错误后缺少真实回复弹结算。");
    }
}
