using FunGame.Core.Api;
using FunGame.Core.Entity;
using FunGame.Core.Model.Framework;
using FunGame.Testing.WebAPI.Services;
using Milimoe.FunGameTesting.OshimaGameModules;
using Milimoe.FunGameTesting.Tests;
using Microsoft.Extensions.FileProviders;

// ============ 初始化游戏模块（与 Testing-v3 的 Program.cs Main 一致，进程内直接调用模拟类） ============
CharacterModule characterModule = new();
characterModule.Load();
SkillModule skillModule = new();
skillModule.Load();
ItemModule itemModule = new();
itemModule.Load();
FunGameService.InitFunGame();

// ============ 辅助方法（局部函数） ============
static CharacterRefDto ToRef(Character character) =>
    new(character.Guid.ToString(), character.Name, character.FirstName, character.NickName, character.User?.Username ?? "");

static List<CharacterRefDto> CollectCharacters(IEnumerable<RoundRecord> rounds)
{
    Dictionary<string, CharacterRefDto> map = [];
    foreach (RoundRecord round in rounds)
    {
        foreach (Character character in round.AllCharacters)
        {
            if (character.Guid != Guid.Empty && !map.ContainsKey(character.Guid.ToString()))
            {
                map[character.Guid.ToString()] = ToRef(character);
            }
        }
    }
    return [.. map.Values];
}

static List<TeamDto> CollectTeams(RoundRecord last)
{
    List<TeamDto> teams = [];
    foreach (RankingEntry entry in last.GameResult)
    {
        // 注意：存档中队伍 Id 可能为空 Guid，这里按队伍名去重
        if (entry.IsTeam && entry.Team is not null && teams.All(t => t.Name != entry.Team.Name))
        {
            teams.Add(new(entry.Team!.Id.ToString(), entry.Team.Name, entry.Team.Score, entry.Team.IsWinner,
                [.. entry.Team.Members.Select(ToRef)]));
        }
    }
    return teams;
}

/// <summary>
/// StartSimulationGame 把 rounds_archive.zip 写到进程工作目录，此处将其归位到存档路径
/// </summary>
static void MoveSimulationZipIfNeeded(string targetZipPath)
{
    string cwdZip = Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "rounds_archive.zip"));
    if (!File.Exists(cwdZip))
    {
        return;
    }
    string? directory = Path.GetDirectoryName(targetZipPath);
    if (!string.IsNullOrEmpty(directory))
    {
        Directory.CreateDirectory(directory);
    }
    File.Move(cwdZip, targetZipPath, overwrite: true);
}

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<ArchiveStore>();
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

WebApplication app = builder.Build();
app.UseCors();

// ============ 游戏数据字典（AllSkills / AllItems / Characters），供前端按 id 匹配显示描述 ============
app.MapGet("/api/gamedata", () =>
{
    List<GameDataEntryDto> skills = [.. FunGameService.AllSkills
        .GroupBy(s => s.Id)
        .Select(g => new GameDataEntryDto(g.Key, g.First().Name, g.First().Description ?? ""))];
    List<GameDataEntryDto> items = [.. FunGameService.AllItems
        .GroupBy(i => i.Id)
        .Select(g => new GameDataEntryDto(g.Key, g.First().Name, g.First().Description ?? ""))];
    List<GameDataEntryDto> characters = [.. FunGameService.Characters
        .Select(c => new GameDataEntryDto(c.Id, c.Name, ""))];
    return Results.Ok(new GameDataDto(skills, items, characters));
});

// ============ 存档元信息 ============
app.MapGet("/api/meta", async (ArchiveStore store, CancellationToken ct) =>
{
    Dictionary<int, RoundRecord> rounds = await store.GetRoundsAsync(ct);
    if (rounds.Count == 0)
    {
        return Results.NotFound(new { error = "存档中没有回合数据" });
    }
    RoundRecord last = rounds.Values.Last();
    bool isTeam = last.GameResult.Any(e => e.IsTeam);
    return Results.Ok(new MetaDto(
        rounds.Count,
        last.TotalTime,
        isTeam ? "团队" : "混战",
        store.LastWriteTime,
        CollectCharacters(rounds.Values),
        CollectTeams(last)
    ));
});

// ============ 回合摘要列表（轻量，供时间轴渲染） ============
app.MapGet("/api/rounds/summary", async (int? from, int? to, ArchiveStore store, CancellationToken ct) =>
{
    Dictionary<int, RoundRecord> rounds = await store.GetRoundsAsync(ct);
    if (rounds.Count == 0)
    {
        return Results.NotFound(new { error = "存档中没有回合数据" });
    }
    int fromN = Math.Clamp(from ?? 1, 1, rounds.Count);
    int toN = Math.Clamp(to ?? rounds.Count, fromN, rounds.Count);

    List<RoundSummaryDto> list = new(toN - fromN + 1);
    for (int n = fromN; n <= toN; n++)
    {
        RoundRecord record = rounds[n];
        list.Add(new RoundSummaryDto(
            record.Round,
            record.Actor?.Guid.ToString() ?? "",
            record.Actor?.NickName ?? record.Actor?.Name ?? "",
            record.HasKill,
            Math.Round(record.Damages.Values.Sum(), 2),
            Math.Round(record.Heals.Values.Sum(), 2),
            record.Actions?.Count ?? 0,
            record.Effects.Count + record.ApplyEffects.Count,
            record.Checkpoint is { Count: > 0 },
            record.TotalTime
        ));
    }
    return Results.Ok(list);
});

// ============ 单回合完整数据（与存档一致的 JSON 格式） ============
app.MapGet("/api/rounds/{n:int}", async (int n, ArchiveStore store, CancellationToken ct) =>
{
    Dictionary<int, RoundRecord> rounds = await store.GetRoundsAsync(ct);
    if (!rounds.TryGetValue(n, out RoundRecord? record))
    {
        return Results.NotFound(new { error = $"回合 {n} 不存在，有效范围 1 ~ {rounds.Count}" });
    }
    return Results.Json(record, JsonTool.JsonSerializerOptions);
});

// ============ 最终统计（Rating 排行榜 + 队伍结果） ============
app.MapGet("/api/statistics", async (ArchiveStore store, CancellationToken ct) =>
{
    Dictionary<int, RoundRecord> rounds = await store.GetRoundsAsync(ct);
    if (rounds.Count == 0)
    {
        return Results.NotFound(new { error = "存档中没有回合数据" });
    }
    RoundRecord last = rounds.Values.Last();
    bool isTeam = last.GameResult.Any(e => e.IsTeam);
    Dictionary<Character, CharacterStatistics> statsMap = last.CharacterStatistics ?? [];
    Dictionary<Guid, string> teamMap = last.TeamMap ?? [];

    List<StatRowDto> rows = statsMap
        .Select(kv => new StatRowDto(
            kv.Key.Guid.ToString(),
            kv.Key.Name,
            kv.Key.NickName,
            teamMap.TryGetValue(kv.Key.Guid, out string? team) ? team : "",
            kv.Value.Rating,
            kv.Value.Kills,
            kv.Value.Deaths,
            kv.Value.Assists,
            kv.Value.TotalDamage,
            kv.Value.TotalHeal,
            kv.Value.TotalShield,
            kv.Value.Winrate,
            kv.Value.MVPs,
            kv.Value.LastRank,
            kv.Value.AvgRank,
            kv.Value.LiveRound,
            kv.Value.TotalEarnedMoney,
            kv.Value.DamagePerRound,
            kv.Value.DamagePerSecond,
            kv.Value.ControlTime
        ))
        .OrderByDescending(r => r.Rating)
        .ToList();

    StatRowDto? mvp = rows.FirstOrDefault();
    return Results.Ok(new StatsDto(
        rounds.Count,
        last.TotalTime,
        isTeam ? "团队" : "混战",
        mvp?.NickName ?? "",
        mvp?.Rating ?? 0,
        rows,
        CollectTeams(last)
    ));
});

// ============ 手动重载存档（模拟跑完一局后刷新） ============
app.MapPost("/api/reload", async (ArchiveStore store, CancellationToken ct) =>
{
    Dictionary<int, RoundRecord> rounds = await store.ReloadAsync(ct);
    return Results.Ok(new { ok = true, roundCount = rounds.Count });
});

// ============ 触发一局团队模拟（进程内调用静态模拟类，立即输出存档） ============
// 直接调用 FunGameSimulation.StartSimulationGame（与 Testing-v3 同进程），
// 模拟数据仅存在于方法作用域内，返回后由 GC 回收，不残留任何数据。
using SemaphoreSlim simulateLock = new(1, 1);
app.MapPost("/api/simulate/team", async (IConfiguration config, IWebHostEnvironment env, ArchiveStore store, CancellationToken ct) =>
{
    if (!await simulateLock.WaitAsync(0, ct))
    {
        return Results.Conflict(new { error = "已有模拟正在进行中，请稍候" });
    }

    try
    {
        FunGameSimulation.IsDebug = true;

        string zipPath = store.ZipPath;
        DateTime before = File.Exists(zipPath) ? new FileInfo(zipPath).LastWriteTimeUtc : DateTime.MinValue;
        DateTime start = DateTime.Now;

        // 模拟方法内部无真实 await（同步 CPU 密集），用 Task.Run 释放请求线程
        List<string> messages = await Task.Run(async () => await FunGameSimulation.StartSimulationGame(false, false, true, false, hasMap: false), ct);
        double elapsed = (DateTime.Now - start).TotalSeconds;

        // 模拟把 rounds_archive.zip 写到了进程工作目录，归位到存档路径
        MoveSimulationZipIfNeeded(zipPath);

        bool changed = File.Exists(zipPath) && new FileInfo(zipPath).LastWriteTimeUtc != before;
        if (!changed)
        {
            return Results.Problem($"模拟未产生新存档：\n{string.Join("\n", messages)}");
        }

        // 存档已更新，强制重载缓存
        Dictionary<int, RoundRecord> rounds = await store.ReloadAsync(ct);
        return Results.Ok(new { ok = true, roundCount = rounds.Count, elapsedSeconds = Math.Round(elapsed, 1) });
    }
    finally
    {
        simulateLock.Release();
    }
});

// ============ 可选：托管前端构建产物（npm run build 之后可单后端部署） ============
// 开发环境：仓库内 webui/dist；发布环境：发布目录内 webui/dist（发布脚本会复制）
string devDist = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "webui", "dist"));
string pubDist = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "webui", "dist"));
string? uiDist = Directory.Exists(devDist) ? devDist : Directory.Exists(pubDist) ? pubDist : null;
if (uiDist is not null)
{
    PhysicalFileProvider fileProvider = new(uiDist);
    app.UseStaticFiles(new StaticFileOptions { FileProvider = fileProvider });
    app.MapFallbackToFile("index.html", new StaticFileOptions { FileProvider = fileProvider });
}

app.Run();

// ============ DTO（输出时自动 camelCase） ============
record CharacterRefDto(string Guid, string Name, string FirstName, string NickName, string UserName);
record TeamDto(string Id, string Name, double Score, bool IsWinner, List<CharacterRefDto> Members);
record MetaDto(int RoundCount, double TotalTime, string Mode, DateTime ZipUpdated, List<CharacterRefDto> Characters, List<TeamDto> Teams);
record RoundSummaryDto(int Round, string ActorGuid, string ActorName, bool HasKill, double DamageTotal, double HealTotal, int ActionCount, int EffectCount, bool HasCheckpoint, double TotalTime);
record StatRowDto(string Guid, string Name, string NickName, string TeamName, double Rating, int Kills, int Deaths, int Assists, double TotalDamage, double TotalHeal, double TotalShield, double Winrate, int MVPs, int LastRank, double AvgRank, int LiveRound, int TotalEarnedMoney, double DamagePerRound, double DamagePerSecond, double ControlTime);
record StatsDto(int RoundCount, double TotalTime, string Mode, string MvpName, double MvpRating, List<StatRowDto> Rows, List<TeamDto> Teams);

// ===== 游戏数据字典（AllSkills / AllItems / Characters 的 Id -> 名称与描述，供前端按 id 匹配显示说明）=====
record GameDataEntryDto(long Id, string Name, string Description);
record GameDataDto(List<GameDataEntryDto> Skills, List<GameDataEntryDto> Items, List<GameDataEntryDto> Characters);
