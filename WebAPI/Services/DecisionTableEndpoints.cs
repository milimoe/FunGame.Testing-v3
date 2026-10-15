using FunGame.Core.Api;
using FunGame.Core.Model.DecisionTable;
using Milimoe.FunGameTesting.Tests;

namespace FunGame.Testing.WebAPI.Services;

/// <summary>决策表编辑器的只读校验入口。</summary>
public static class DecisionTableEndpoints
{
    /// <summary>注册配置校验接口，不注册或绑定运行中的角色策略。</summary>
    /// <param name="app">Web 应用。</param>
    public static void MapDecisionTableEndpoints(this WebApplication app)
    {
        app.MapPost("/api/decision-tables/validate", (DecisionTableValidationRequest request) =>
            Results.Ok(Validate(request)));
    }

    /// <summary>使用 Core 解析、校验并编译编辑器配置。</summary>
    /// <param name="request">配置文本及资源校验选项。</param>
    /// <returns>校验结果。</returns>
    public static DecisionTableValidationResult Validate(DecisionTableValidationRequest request)
    {
        if (request.Json is null) return new(false, [new("$", "缺少 JSON 配置文本。")]);
        if (!DecisionTableParser.TryParse(request.Json, out DecisionTableConfig? config, out IReadOnlyList<DecisionDiagnostic> diagnostics))
            return new(false, diagnostics);
        DecisionTableCompiler compiler = request.CheckResources
            ? new(skills: FunGameService.AllSkills.Select(skill => skill.Id), items: FunGameService.AllItems.Select(item => item.Id))
            : new();
        diagnostics = compiler.Validate(config!);
        if (diagnostics.Count > 0) return new(false, diagnostics);
        compiler.Compile(config!);
        return new(true, []);
    }
}

/// <summary>编辑器校验请求。</summary>
/// <param name="Json">原始 JSON 配置。</param>
/// <param name="CheckResources">是否按当前模组目录校验技能与物品引用。</param>
public sealed record DecisionTableValidationRequest(string? Json, bool CheckResources = true);

/// <summary>编辑器校验结果。</summary>
/// <param name="Valid">是否可编译。</param>
/// <param name="Diagnostics">配置诊断。</param>
public sealed record DecisionTableValidationResult(bool Valid, IReadOnlyList<DecisionDiagnostic> Diagnostics);
