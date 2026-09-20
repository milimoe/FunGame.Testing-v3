using FunGame.Core.Api;
using FunGame.Core.Entity;
using FunGame.Core.Model.Framework;
using FunGame.Testing.WebAPI.Services;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.FileProviders;
using Milimoe.FunGameTesting.OshimaGameModules;
using Milimoe.FunGameTesting.OshimaGameModules.Classes;
using Milimoe.FunGameTesting.Tests;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

// ============ 初始化游戏模块（与 Testing-v3 的 Program.cs Main 一致，进程内直接调用模拟类） ============
CharacterModule characterModule = new();
characterModule.Load();
SkillModule skillModule = new();
skillModule.Load();
ItemModule itemModule = new();
itemModule.Load();
FunGameService.InitFunGame();
// 注册职业内容（职业 / 流派 / 转换战斗天赋战技），供职业规划与存档重建使用
OshimaClasses.RegisterAll();
// 筽祀牻世界观职业：3 职业 × 2 流派（铎京导械师 / META🐴熵噬者 / 深海同盟深潮行者）
OshimaWorldClasses.RegisterAll();

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
builder.Services.AddSingleton<SoloGameRegistry>();
builder.Services.AddSingleton<ClassPlanStore>();
builder.Services.AddSingleton<ClassPlanSessionStore>();
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

// ============ 反代支持：nginx 终止 TLS 后把 X-Forwarded-* 透传进来 ============
// 只信任回环来源（nginx 与应用同机），因此不需要额外配置 KnownProxies。
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor
        | ForwardedHeaders.XForwardedHost
        | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 2;
});

WebApplication app = builder.Build();
app.UseForwardedHeaders();
app.UseCors();
app.UseWebSockets();

// ============ 职业规划端点（/api/classplan/*） ============
app.MapClassPlanEndpoints();

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
        CollectTeams(last),
        // 本局随机种子：由队列在每回合记录中写入（旧存档为 0 表示未记录）；字典顺序无保证，取回合号最小的一条
        rounds[rounds.Keys.Min()].Seed
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
            record.Effects.Sum(kv => kv.Value.Count) + record.ApplyEffects.Sum(kv => kv.Value.Count),
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
app.MapPost("/api/simulate/team", async (IConfiguration config, IWebHostEnvironment env, ArchiveStore store, CancellationToken ct, int? seed = null) =>
{
    if (!await simulateLock.WaitAsync(0, ct))
    {
        return Results.Conflict(new { error = "已有模拟正在进行中，请稍候" });
    }

    try
    {
        FunGameSimulation.IsDebug = true;
        // 传入 seed 则固定本局随机种子（同种子 + 同参数可复现整局）；不传则每局自动随机。
        // 每次显式赋值：避免上一次指定的种子被后续调用沿用
        FunGameSimulation.SeedOverride = seed;

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
        // 回传本局实际使用的种子（未指定时是自动生成的随机值），供前端回填以便复现
        return Results.Ok(new { ok = true, roundCount = rounds.Count, elapsedSeconds = Math.Round(elapsed, 1), seed = FunGameSimulation.Seed });
    }
    finally
    {
        simulateLock.Release();
    }
});

// ============ 单人模式：WebSocket 对局端点（协议对齐 Server-v3 的 gaming.*） ============
// 服务端权威计算：Core 战斗全部在本进程内完成，客户端只负责渲染与回传玩家决策。
app.Map("/ws/solo", async (HttpContext context, SoloGameRegistry registry) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsync("仅支持 WebSocket 连接");
        return;
    }

    using WebSocket socket = await context.WebSockets.AcceptWebSocketAsync();
    SoloWebSocketSink sink = new(socket);
    // 注意：此处不再无条件挂载仍在运行的旧会话。
    // 否则「上一局未停止」时，新连接会先收到旧局的状态与结算（gaming.over），
    // 造成「人还没选完、背后已经跑完并弹出结算」的串台现象。
    // 真要重连接管，由客户端显式发送 gaming.resume。
    SoloGameSession? session = null;

    byte[] buffer = new byte[64 * 1024];
    try
    {
        while (socket.State == WebSocketState.Open)
        {
            WebSocketReceiveResult result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), context.RequestAborted);
            if (result.MessageType == WebSocketMessageType.Close) break;

            JsonElement envelope;
            try
            {
                JsonElement? parsed = JsonSerializer.Deserialize<JsonElement>(Encoding.UTF8.GetString(buffer, 0, result.Count));
                if (parsed is null) continue;
                envelope = parsed.Value;
            }
            catch
            {
                continue;
            }

            string type = envelope.TryGetProperty("t", out JsonElement t) ? t.GetString() ?? "" : "";
            JsonElement data = envelope.TryGetProperty("d", out JsonElement d) ? d : default;

            switch (type)
            {
                case SoloMessageTypes.GamingStart:
                {
                    SoloGameOptions options = new();
                    if (data.ValueKind == JsonValueKind.Object)
                    {
                        if (data.TryGetProperty("characterCount", out JsonElement v)) options.CharacterCount = v.GetInt32();
                        if (data.TryGetProperty("level", out v)) options.Level = v.GetInt32();
                        if (data.TryGetProperty("skillLevel", out v)) options.SkillLevel = v.GetInt32();
                        if (data.TryGetProperty("normalAttackLevel", out v)) options.NormalAttackLevel = v.GetInt32();
                        if (data.TryGetProperty("maxRound", out v)) options.MaxRound = v.GetInt32();
                        if (data.TryGetProperty("maxRespawnTimes", out v)) options.MaxRespawnTimes = v.GetInt32();
                        if (data.TryGetProperty("teamMode", out v)) options.TeamMode = v.GetBoolean();
                        if (data.TryGetProperty("teamSize", out v)) options.TeamSize = v.GetInt32();
                        if (data.TryGetProperty("maxScoreToWin", out v)) options.MaxScoreToWin = v.GetInt32();
                        if (data.TryGetProperty("decisionTimeoutSeconds", out v)) options.DecisionTimeoutSeconds = v.GetInt32();
                        if (data.TryGetProperty("requireContinue", out v)) options.RequireContinue = v.GetBoolean();
                        if (data.TryGetProperty("roundDelayMs", out v)) options.RoundDelayMs = v.GetInt32();
                        if (data.TryGetProperty("initialItemQuality", out v)) options.InitialItemQuality = v.GetInt32();
                        if (data.TryGetProperty("dropItemsIntervalSeconds", out v)) options.DropItemsIntervalSeconds = v.GetInt32();
                        if (data.TryGetProperty("enableTurnDiagnostics", out v)) options.EnableTurnDiagnostics = v.GetBoolean();
                        if (data.TryGetProperty("seed", out v) && v.ValueKind == JsonValueKind.Number) options.Seed = v.GetInt32();
                    }
                    session = registry.Create(options);
                    session.Start(sink, options);
                    break;
                }

                case SoloMessageTypes.GamingAction:
                {
                    if (session is null) break;
                    if (!data.TryGetProperty("requestId", out JsonElement rid)) break;
                    JsonElement? payload = data.TryGetProperty("payload", out JsonElement p)
                        && p.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined) ? p : null;
                    session.TryResolve(rid.GetString() ?? "", payload);
                    break;
                }

                case SoloMessageTypes.GamingResume:
                {
                    // 重连：接管仍在运行的对局并补发完整快照
                    SoloGameSession? running = registry.Current;
                    if (running is { Running: true })
                    {
                        session = running;
                        running.AttachSink(sink);
                    }
                    else
                    {
                        await sink.SendAsync(SoloMessageTypes.Notice, new { message = "当前没有进行中的对局" }, context.RequestAborted);
                    }
                    break;
                }

                case SoloMessageTypes.GamingEnd:
                    session?.Stop();
                    registry.Stop();
                    break;

                case SoloMessageTypes.GamingPause:
                {
                    // 暂停 / 继续：暂停时引擎线程阻塞，回合不推进、决策也不计时超时
                    SoloGameSession? target = session ?? registry.Current;
                    bool paused = !data.TryGetProperty("paused", out JsonElement pv) || pv.ValueKind != JsonValueKind.False;
                    target?.SetPaused(paused);
                    break;
                }

                case SoloMessageTypes.Ping:
                    await sink.SendAsync(SoloMessageTypes.Pong, new { ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }, context.RequestAborted);
                    break;
            }
        }
    }
    catch
    {
        /* 连接中断 */
    }
    finally
    {
        // 断线不终止对局：交由 AI 托管并等待重连（/api/solo/stop 或 gaming.end 才会真正停止）
        session?.MarkDisconnected();
    }
});

// ============ 单人模式：REST 辅助端点（状态查询 / 停止 / 结算） ============
app.MapGet("/api/solo/state", (SoloGameRegistry registry) =>
{
    SoloGameSession? session = registry.Current;
    if (session is null) return Results.NotFound(new { error = "当前没有进行中的单人局" });
    try
    {
        return Results.Ok(new { gameId = session.Id, running = session.Running, finished = session.Finished, state = session.Snapshot() });
    }
    catch (Exception ex)
    {
        // 游戏线程正在推进，快照读取竞争失败时返回状态提示（REST 仅为诊断用途）
        return Results.Ok(new { gameId = session.Id, running = session.Running, finished = session.Finished, state = default(GameStateDto), note = ex.Message });
    }
});

app.MapPost("/api/solo/stop", (SoloGameRegistry registry) =>
{
    registry.Stop();
    return Results.Ok(new { ok = true });
});

// 暂停 / 继续（REST 备用入口；主通道是 WebSocket 的 gaming.pause）
app.MapPost("/api/solo/pause", (SoloGameRegistry registry, bool? paused) =>
{
    SoloGameSession? session = registry.Current;
    if (session is null) return Results.NotFound(new { error = "当前没有进行中的单人局" });
    session.SetPaused(paused ?? true);
    return Results.Ok(new { ok = true, paused = session.Paused });
});

app.MapGet("/api/solo/ranking", (SoloGameRegistry registry) =>
{
    SoloGameSession? session = registry.Current;
    if (session is null) return Results.NotFound(new { error = "当前没有进行中的单人局" });
    return Results.Ok(session.BuildRanking());
});

// ============ 可选：托管前端构建产物（npm run build 之后可单后端部署） ============
// 三个独立前端项目，各挂各的子路径：
//   webui/dist         → 挂在根路径 /        （回合回放 + 职业规划）
//   webui-client/dist  → 挂在子路径 /client/ （Server 端点测试客户端）
//   webui-solo/dist    → 挂在子路径 /solo/   （单人模式，竖版手游版式）
// 开发环境取仓库内目录；发布环境取发布目录内的同名目录（发布脚本会复制）。
string? ResolveDist(string project)
{
    string dev = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", project, "dist"));
    string pub = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, project, "dist"));
    return Directory.Exists(dev) ? dev : Directory.Exists(pub) ? pub : null;
}

string? uiDist = ResolveDist("webui");
string? clientDist = ResolveDist("webui-client");
string? soloDist = ResolveDist("webui-solo");

if (uiDist is not null)
{
    app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(uiDist) });
}
if (clientDist is not null)
{
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(clientDist),
        RequestPath = "/client",
    });
}
if (soloDist is not null)
{
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(soloDist),
        RequestPath = "/solo",
    });
}
// 只注册一个兜底路由：按 URL 前缀回各自前端的 index.html。
// 三个前端都用 hash 路由，所以这里主要是为了让 /client/、/solo/ 这些入口可达。
if (uiDist is not null || clientDist is not null || soloDist is not null)
{
    app.MapFallback(async context =>
    {
        static bool HasIndex(string? dist) => dist is not null && File.Exists(Path.Combine(dist, "index.html"));

        string? preferred;
        if (context.Request.Path.StartsWithSegments("/solo")) preferred = soloDist;
        else if (context.Request.Path.StartsWithSegments("/client")) preferred = clientDist;
        else preferred = uiDist;

        // 目标前端没构建出来时，依次回落到其它已构建的入口，保证入口始终可达
        string? target = HasIndex(preferred) ? preferred
            : HasIndex(uiDist) ? uiDist
            : HasIndex(clientDist) ? clientDist
            : HasIndex(soloDist) ? soloDist
            : null;

        if (target is null)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }
        context.Response.ContentType = "text/html; charset=utf-8";
        await context.Response.SendFileAsync(Path.Combine(target, "index.html"));
    });
}

app.Run();

// ============ DTO（输出时自动 camelCase） ============
record CharacterRefDto(string Guid, string Name, string FirstName, string NickName, string UserName);
record TeamDto(string Id, string Name, double Score, bool IsWinner, List<CharacterRefDto> Members);
record MetaDto(int RoundCount, double TotalTime, string Mode, DateTime ZipUpdated, List<CharacterRefDto> Characters, List<TeamDto> Teams, int Seed);
record RoundSummaryDto(int Round, string ActorGuid, string ActorName, bool HasKill, double DamageTotal, double HealTotal, int ActionCount, int EffectCount, bool HasCheckpoint, double TotalTime);
record StatRowDto(string Guid, string Name, string NickName, string TeamName, double Rating, int Kills, int Deaths, int Assists, double TotalDamage, double TotalHeal, double TotalShield, double Winrate, int MVPs, int LastRank, double AvgRank, int LiveRound, int TotalEarnedMoney, double DamagePerRound, double DamagePerSecond, double ControlTime);
record StatsDto(int RoundCount, double TotalTime, string Mode, string MvpName, double MvpRating, List<StatRowDto> Rows, List<TeamDto> Teams);

// ===== 游戏数据字典（AllSkills / AllItems / Characters 的 Id -> 名称与描述，供前端按 id 匹配显示说明）=====
record GameDataEntryDto(long Id, string Name, string Description);
record GameDataDto(List<GameDataEntryDto> Skills, List<GameDataEntryDto> Items, List<GameDataEntryDto> Characters);
