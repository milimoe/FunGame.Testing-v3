using System.Collections.Concurrent;
using System.Text.Json;
using FunGame.Core.Entity;
using FunGame.Core.Interface.Base;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.EffectContext;
using FunGame.Core.Model.Framework;
using FunGame.Core.Model.Queue;
using Milimoe.FunGameTesting.OshimaGameModules.Effects.OpenEffects;
using Milimoe.FunGameTesting.Tests;

namespace FunGame.Testing.WebAPI.Services;

/// <summary>
/// 服务器权威的单人局会话。
/// <para>进程内直接驱动 FunGame.Core v3 的 <see cref="MixGamingQueue"/>（1 名人类 + N 名 AI），
/// 所有战斗计算发生在服务端；当轮到玩家决策时，游戏线程在 <see cref="RequestDecision"/> 上阻塞，
/// 等待客户端通过 <c>gaming.action</c> 回传结果。</para>
/// <para>注意：Core 的事件是同步委托，因此本会话运行在专属后台线程上，
/// 阻塞等待不会占用线程池请求线程。</para>
/// </summary>
public sealed class SoloGameSession : IDisposable
{
    public const string ModeName = "solo";

    public string Id { get; } = Guid.NewGuid().ToString("N")[..8];
    public string Mode => ModeName;
    public bool Running { get; private set; }
    public bool Finished { get; private set; }

    private readonly List<Character> _characters = [];
    private readonly List<string> _log = [];
    private readonly object _logLock = new();
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement?>> _pending = new();

    private MixGamingQueue? _queue;
    private GameMap? _map;
    private Character? _player;
    private volatile IGameEventSink? _sink;
    private CancellationTokenSource _cts = new();
    private Thread? _thread;
    private int _round;
    private int _logSent;
    private bool _disposed;

    // 状态广播节流：战斗事件很密集，但只需 ~8-10 次/秒的刷新率即可流畅渲染
    private readonly System.Diagnostics.Stopwatch _pushClock = System.Diagnostics.Stopwatch.StartNew();
    private long _lastPushMs = -10_000;
    private const int PushMinIntervalMs = 120;
    private const int PushMaxIntervalMs = 1000;

    /// <summary>玩家客户端是否在线（离线时由 AI 托管玩家角色，避免决策等待挂死）</summary>
    public volatile bool PlayerConnected = true;

    public TimeSpan DecisionTimeout { get; set; } = TimeSpan.FromSeconds(120);
    public bool RequireContinue { get; set; } = false;
    public int RoundDelayMs { get; set; } = 250;

    // ==================== 生命周期 ====================

    public void Start(IGameEventSink sink, SoloGameOptions options)
    {
        if (Running) return;
        _sink = sink;
        DecisionTimeout = TimeSpan.FromSeconds(Math.Clamp(options.DecisionTimeoutSeconds, 5, 600));
        RequireContinue = options.RequireContinue;
        RoundDelayMs = Math.Clamp(options.RoundDelayMs, 0, 5000);
        Running = true;
        _thread = new Thread(() => RunGame(options)) { IsBackground = true, Name = $"solo-{Id}" };
        _thread.Start();
    }

    public void Stop()
    {
        try { _cts.Cancel(); } catch { /* 忽略 */ }
    }

    /// <summary>客户端回传决策结果</summary>
    public bool TryResolve(string requestId, JsonElement? data)
    {
        if (_pending.TryRemove(requestId, out TaskCompletionSource<JsonElement?>? tcs))
        {
            tcs.TrySetResult(data);
            return true;
        }
        return false;
    }

    public void AttachSink(IGameEventSink sink)
    {
        PlayerConnected = true;
        _sink = sink;
        // 重连后夺回玩家角色的控制权（此前断线时已交还 AI）
        if (_player is not null && _queue is not null)
        {
            try
            {
                // cancel: true => 将玩家移出系统 AI 托管集合，夺回控制权
                _queue.SetCharactersToAIControl(bySystem: true, cancel: true, [_player]);
            }
            catch
            {
                /* 对局已结束则忽略 */
            }
        }
        // 重连：补发完整快照
        PushState();
    }

    /// <summary>玩家断开：取消所有挂起的决策（按各自兜底策略执行），并将玩家角色交给 AI 托管</summary>
    public void MarkDisconnected()
    {
        PlayerConnected = false;
        foreach (TaskCompletionSource<JsonElement?> tcs in _pending.Values)
        {
            tcs.TrySetResult(null);
        }
        if (_player is not null && _queue is not null)
        {
            try
            {
                // cancel: false => 将玩家加入系统 AI 托管集合（断线时由 AI 接管，避免决策等待挂死）
                _queue.SetCharactersToAIControl(bySystem: true, cancel: false, [_player]);
            }
            catch
            {
                /* 对局已结束则忽略 */
            }
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Stop();
        _cts.Dispose();
        foreach (TaskCompletionSource<JsonElement?> tcs in _pending.Values) tcs.TrySetCanceled();
        _pending.Clear();
    }

    // ==================== 主流程 ====================

    private void RunGame(SoloGameOptions options)
    {
        try
        {
            List<Character> candidates = [.. FunGameService.Characters
                .Select(c => c.Copy())
                .OrderBy(_ => Random.Shared.Next())
                .Take(Math.Clamp(options.CharacterCount, 2, Math.Min(10, FunGameService.Characters.Count)))];
            PrepareCharacters(candidates, options.Level, options.SkillLevel, options.NormalAttackLevel);
            _characters.AddRange(candidates);

            WriteLine("--- 游戏开始 ---");
            foreach (Character c in candidates) WriteLine($"角色编号：{c.Id}\r\n{c.GetInfo(false, false)}");
            PushState();

            Character? player = RequestCharacterSelection(candidates);
            if (player is null)
            {
                WriteLine("未选择角色，游戏结束。");
                Finish(null);
                return;
            }

            _player = player;
            player.Promotion = 200;
            WriteLine($"选择了 [ {player} ]！");

            // ---- 构建队列与地图 ----
            MixGamingQueue queue = new(candidates, WriteLine) { MaxRespawnTimes = options.MaxRespawnTimes };
            _queue = queue;
            queue.IsDebug = true;
            queue.LoadGameMap(new SoloMap());
            queue.UseQueueProtected = false;
            _map = queue.Map;

            if (queue.Map is not null)
            {
                GameMap map = queue.Map;
                HashSet<Grid> allocated = [];
                List<Grid> allGrids = [.. map.Grids.Values];
                foreach (Character character in candidates)
                {
                    character.NormalAttack.GamingQueue = queue;
                    Grid grid = Grid.Empty;
                    int guard = 0;
                    do
                    {
                        grid = allGrids[Random.Shared.Next(allGrids.Count)];
                    }
                    while (allocated.Contains(grid) && guard++ < allGrids.Count * 2);
                    allocated.Add(grid);
                    map.SetCharacterCurrentGrid(character, grid);
                }
            }

            BindEvents(queue);

            // ---- 空投 ----
            WriteLine("社区送温暖了，现在随机发放空投！！");
            FunGameSimulation.DropItems(queue, 0, 0, 0, 0, 0);
            WriteLine("");

            queue.InitActionQueue();
            // AI 托管全部角色（系统集合），随后仅将玩家移出托管
            queue.SetCharactersToAIControl(bySystem: true, cancel: false, candidates);
            queue.SetCharactersToAIControl(bySystem: true, cancel: true, [player]);
            queue.CustomData["player"] = player;
            queue.DisplayQueue();

            // ---- 回合奖励 ----
            Dictionary<long, bool> effects = [];
            foreach (EffectID id in FunGameService.RoundRewards.Keys)
            {
                long effectID = (long)id;
                effects.Add(effectID, effectID > (long)EffectID.Active_Start);
            }
            int maxRound = options.MaxRound;
            queue.InitRoundRewards(maxRound, 1, effects, id => FunGameService.RoundRewards[(EffectID)id]);

            Send(SoloMessageTypes.GamingStart, new
            {
                gameId = Id,
                mode = Mode,
                playerGuid = player.Guid.ToString(),
                state = Snapshot()
            });

            // ---- 主循环 ----
            int i = 1;
            double totalTime = 0;
            while (i < maxRound && !_cts.IsCancellationRequested)
            {
                Character? actor = queue.NextCharacter();
                PushState();

                if (actor is not null)
                {
                    _round = i++;
                    WriteLine($"=== 回合 {_round} ===");
                    WriteLine($"现在是 [ {actor} ] 的回合！");

                    if (queue.Map is not null)
                    {
                        Grid? currentGrid = queue.Map.GetCharacterCurrentGrid(actor);
                        if (currentGrid is not null) queue.CustomData["currentGrid"] = currentGrid;
                    }

                    bool isGameEnd = false;
                    try
                    {
                        isGameEnd = queue.ProcessTurn(actor);
                    }
                    catch (Exception ex)
                    {
                        WriteLine(ex.ToString());
                    }

                    Send(SoloMessageTypes.GamingRound, new { round = _round, actorGuid = actor.Guid.ToString() });

                    if (isGameEnd)
                    {
                        totalTime = queue.TotalTime;
                        FlushState();
                        break;
                    }
                    FlushState();
                }

                totalTime += queue.TimeLapse();
                PushState();

                if (queue.GameOver) break;

                if (RoundDelayMs > 0)
                {
                    Thread.Sleep(RoundDelayMs);
                }
            }

            if (_cts.IsCancellationRequested)
            {
                WriteLine("对局已被终止。");
                Finish(null);
                return;
            }

            // ---- 结算 ----
            FunGameService.GetCharacterRating(queue.CharacterStatistics, false, []);
            Character? winner = queue.CharacterStatistics
                .OrderByDescending(kv => kv.Value.Rating)
                .Select(kv => kv.Key)
                .FirstOrDefault();
            WriteLine("--- 游戏结束 ---");
            WriteLine($"总游戏时长：{totalTime:0.##} {General.GameplayEquilibriumConstant.InGameTime}");
            if (winner is not null) WriteLine($"[ {winner} ] 成为了天选之人！！");
            Finish(winner);
        }
        catch (Exception ex)
        {
            WriteLine(ex.ToString());
            Finish(null);
        }
    }

    private void Finish(Character? winner)
    {
        Running = false;
        Finished = true;
        FlushState();
        Send(SoloMessageTypes.GamingOver, new
        {
            gameId = Id,
            mode = Mode,
            totalRound = _round,
            totalTime = _queue?.TotalTime ?? 0,
            winnerGuid = winner?.Guid.ToString(),
            winnerName = winner?.ToStringWithLevel(),
            ranking = BuildRanking()
        });
    }

    private static void PrepareCharacters(List<Character> characters, int level, int skillLevel, int attackLevel)
    {
        foreach (Character c in characters)
        {
            c.Level = level;
            c.NormalAttack.Level = attackLevel;
            FunGameService.AddCharacterSkills(c, 1, skillLevel, skillLevel);

            foreach (Skill s in FunGameService.Skills.OrderBy(_ => Random.Shared.Next()).Take(3))
            {
                Skill copy = s.Copy();
                copy.Character = c;
                copy.Level = skillLevel;
                c.Skills.Add(copy);
            }
            foreach (Skill p in FunGameService.CommonPassiveSkills.OrderBy(_ => Random.Shared.Next()).Take(3))
            {
                Skill copy = p.Copy();
                copy.Character = c;
                copy.Level = 1;
                c.Skills.Add(copy);
            }
            foreach (Skill s in FunGameService.CommonSuperSkills.OrderBy(_ => Random.Shared.Next()).Take(3))
            {
                Skill copy = s.Copy();
                copy.Character = c;
                copy.Level = skillLevel;
                c.Skills.Add(copy);
            }
            c.EP = 100;
        }
    }

    // ==================== 事件绑定 ====================

    private void BindEvents(GamingQueue queue)
    {
        queue.TurnStartEvent += OnTurnStart;
        queue.DecideActionEvent += OnDecideAction;
        queue.SelectSkillEvent += OnSelectSkill;
        queue.SelectItemEvent += OnSelectItem;
        queue.SelectSkillTargetsEvent += OnSelectSkillTargets;
        queue.SelectNormalAttackTargetsEvent += OnSelectNormalAttackTargets;
        queue.SelectNonDirectionalSkillTargetsEvent += OnSelectNonDirectionalSkillTargets;
        queue.SelectTargetGridEvent += OnSelectTargetGrid;
        queue.CharacterInquiryEvent += OnCharacterInquiry;
        queue.CharacterMoveEvent += OnCharacterMove;
        queue.CharacterActionTakenEvent += OnActionTaken;
        queue.QueueUpdatedEvent += OnQueueUpdated;
        queue.TurnEndEvent += OnTurnEnd;
    }

    private bool IsPlayer(Character? c) =>
        PlayerConnected
        && _player is not null && c is not null
        && (ReferenceEquals(c, _player) || ReferenceEquals(c.Master, _player))
        && _queue is not null && !_queue.IsCharacterInAIControlling(c);

    private bool OnTurnStart(TurnContext ctx)
    {
        PushState();
        return true;
    }

    private void OnTurnEnd(TurnContext ctx)
    {
        PushState();
        if (!RequireContinue || !IsPlayer(ctx.Trigger)) return;
        RequestDecision(DecisionKind.Continue, new
        {
            actorGuid = ctx.Trigger?.Guid.ToString(),
            message = "本回合已结束，查看日志后点击继续. . ."
        });
    }

    private CharacterActionType OnDecideAction(TurnContext ctx)
    {
        if (!IsPlayer(ctx.Trigger)) return CharacterActionType.None; // 交给 AI

        Character actor = ctx.Trigger!;
        JsonElement? res = RequestDecision(DecisionKind.ActionType, new
        {
            actorGuid = actor.Guid.ToString(),
            dp = SoloGameMapper.ToDP(ctx.DP),
            skills = ctx.Skills.Select(s => SoloGameMapper.ToSkill(s, actor)).ToList(),
            items = ctx.Items.Select(i => SoloGameMapper.ToItem(i, actor)).ToList(),
            enemys = ctx.Enemys.Select(c => c.Guid.ToString()).ToList(),
            teammates = ctx.Teammates.Select(c => c.Guid.ToString()).ToList()
        });

        if (res is not null && res.Value.TryGetProperty("actionType", out JsonElement a))
        {
            string? typeName = a.ValueKind == JsonValueKind.String ? a.GetString() : null;
            if (typeName is not null && Enum.TryParse(typeName, true, out CharacterActionType parsed)) return parsed;
        }
        return CharacterActionType.EndTurn; // 超时兜底
    }

    private Skill? OnSelectSkill(SelectionContext ctx)
    {
        if (!IsPlayer(ctx.Trigger)) return null;
        Character actor = ctx.Trigger!;
        JsonElement? res = RequestDecision(DecisionKind.Skill, new
        {
            actorGuid = actor.Guid.ToString(),
            skills = ctx.Skills.Select(s => SoloGameMapper.ToSkill(s, actor)).ToList()
        });
        if (res is null) return null;
        if (!res.Value.TryGetProperty("skillGuid", out JsonElement g)) return null;
        string guid = g.GetString() ?? "";
        return ctx.Skills.FirstOrDefault(s => s.Guid.ToString() == guid);
    }

    private Item? OnSelectItem(SelectionContext ctx)
    {
        if (!IsPlayer(ctx.Trigger)) return null;
        Character actor = ctx.Trigger!;
        JsonElement? res = RequestDecision(DecisionKind.Item, new
        {
            actorGuid = actor.Guid.ToString(),
            items = ctx.Items.Select(i => SoloGameMapper.ToItem(i, actor)).ToList()
        });
        if (res is null) return null;
        if (!res.Value.TryGetProperty("itemGuid", out JsonElement g)) return null;
        string guid = g.GetString() ?? "";
        return ctx.Items.FirstOrDefault(i => i.Guid.ToString() == guid);
    }

    private List<Character> OnSelectSkillTargets(SelectionContext ctx)
    {
        if (!IsPlayer(ctx.Trigger)) return [];
        (List<Character> selectable, int max) = ResolveSelectable(ctx);
        return RequestTargets(ctx, selectable, max);
    }

    private List<Character> OnSelectNormalAttackTargets(SelectionContext ctx)
    {
        if (!IsPlayer(ctx.Trigger)) return [];
        (List<Character> selectable, int max) = ResolveSelectable(ctx);
        return RequestTargets(ctx, selectable, max);
    }

    /// <summary>依据技能（或普攻）的选择规则计算可选目标与最大可选数量</summary>
    private static (List<Character> Selectable, int Max) ResolveSelectable(SelectionContext ctx)
    {
        List<Character> selectable = [];
        int max = 1;

        if (ctx.Skill is Skill skill)
        {
            if (skill.CanSelectEnemy) selectable.AddRange(ctx.Enemys);
            if (skill.CanSelectTeammate) selectable.AddRange(ctx.Teammates);
            if (skill.CanSelectSelf && ctx.Trigger is not null) selectable.Add(ctx.Trigger);
            max = Math.Max(1, skill.RealCanSelectTargetCount(ctx.Enemys, ctx.Teammates));
        }
        else if (ctx.NormalAttack is NormalAttack attack)
        {
            if (attack.CanSelectEnemy) selectable.AddRange(ctx.Enemys);
            if (attack.CanSelectTeammate) selectable.AddRange(ctx.Teammates);
            if (attack.CanSelectSelf && ctx.Trigger is not null) selectable.Add(ctx.Trigger);
            max = Math.Max(1, attack.RealCanSelectTargetCount(ctx.Enemys, ctx.Teammates));
        }
        else
        {
            selectable.AddRange(ctx.Enemys);
        }

        // 去重并保持顺序
        List<Character> distinct = [];
        HashSet<Character> seen = [];
        foreach (Character c in selectable)
        {
            if (seen.Add(c)) distinct.Add(c);
        }
        return (distinct, max);
    }

    private List<Character> RequestTargets(SelectionContext ctx, List<Character> selectable, int max)
    {
        Character actor = ctx.Trigger!;
        JsonElement? res = RequestDecision(DecisionKind.Targets, new
        {
            actorGuid = actor.Guid.ToString(),
            skillName = ctx.Skill?.Name ?? ctx.NormalAttack?.Name ?? "",
            maxTargets = max,
            targets = selectable.Select(c => new
            {
                guid = c.Guid.ToString(),
                displayName = c.ToStringWithLevel(),
                hp = c.HP,
                maxHp = c.MaxHP,
                gridId = _map?.GetCharacterCurrentGrid(c)?.Id ?? -1
            }).ToList()
        });

        if (res is null) return [];
        if (!res.Value.TryGetProperty("targetGuids", out JsonElement arr) || arr.ValueKind != JsonValueKind.Array) return [];

        List<Character> picked = [];
        foreach (JsonElement item in arr.EnumerateArray())
        {
            string guid = item.GetString() ?? "";
            Character? hit = selectable.FirstOrDefault(c => c.Guid.ToString() == guid);
            if (hit is not null && !picked.Contains(hit)) picked.Add(hit);
            if (picked.Count >= max) break;
        }
        return picked;
    }

    private List<Grid> OnSelectNonDirectionalSkillTargets(SelectionContext ctx)
    {
        if (!IsPlayer(ctx.Trigger) || _map is null) return [];
        Character actor = ctx.Trigger!;

        JsonElement? res = RequestDecision(DecisionKind.TargetGrids, new
        {
            actorGuid = actor.Guid.ToString(),
            skillName = ctx.Skill?.Name ?? "",
            gridIds = ctx.CastRange.Select(g => g.Id).ToList()
        });
        if (res is null) return [];
        if (!res.Value.TryGetProperty("gridIds", out JsonElement arr) || arr.ValueKind != JsonValueKind.Array) return [];

        List<Grid> picked = [];
        foreach (JsonElement item in arr.EnumerateArray())
        {
            if (item.TryGetInt64(out long id) && _map.Grids.TryGetValue(id, out Grid? grid) && !picked.Contains(grid))
            {
                picked.Add(grid);
            }
        }
        return picked;
    }

    private Grid OnSelectTargetGrid(SelectionContext ctx)
    {
        if (!IsPlayer(ctx.Trigger) || _map is null) return Grid.Empty;
        Character actor = ctx.Trigger!;
        List<Grid> moveRange = ctx.MoveRange.Count > 0 ? ctx.MoveRange : [];

        JsonElement? res = RequestDecision(DecisionKind.TargetGrid, new
        {
            actorGuid = actor.Guid.ToString(),
            currentGridId = _map.GetCharacterCurrentGrid(actor)?.Id ?? -1,
            gridIds = moveRange.Select(g => g.Id).ToList()
        });
        if (res is null) return Grid.Empty;
        if (!res.Value.TryGetProperty("gridId", out JsonElement g)) return Grid.Empty;
        if (g.TryGetInt64(out long id) && _map.Grids.TryGetValue(id, out Grid? grid))
        {
            return grid;
        }
        return Grid.Empty;
    }

    private InquiryResponse OnCharacterInquiry(InquiryContext ctx)
    {
        if (!IsPlayer(ctx.Trigger)) return new InquiryResponse(ctx.Options);

        JsonElement? res = RequestDecision(DecisionKind.Inquiry, new
        {
            actorGuid = ctx.Trigger?.Guid.ToString(),
            topic = ctx.Options.Topic,
            description = ctx.Options.Description,
            inquiryType = ctx.Options.InquiryType.ToString(),
            choices = ctx.Options.Choices.Select(kv => new { key = kv.Key, text = kv.Value }).ToList(),
            defaultChoice = ctx.Options.DefaultChoice,
            canCancel = ctx.Options.CanCancel,
            minNumber = ctx.Options.MinNumberValue,
            maxNumber = ctx.Options.MaxNumberValue,
            defaultNumber = ctx.Options.DefaultNumberValue
        });

        InquiryResponse response = new(ctx.Options);
        if (res is null)
        {
            response.Cancel = true;
            return response;
        }
        if (res.Value.TryGetProperty("cancel", out JsonElement c) && c.GetBoolean())
        {
            response.Cancel = true;
            return response;
        }
        if (res.Value.TryGetProperty("choices", out JsonElement arr) && arr.ValueKind == JsonValueKind.Array)
        {
            response.Choices.Clear();
            foreach (JsonElement item in arr.EnumerateArray())
            {
                string? s = item.GetString();
                if (!string.IsNullOrEmpty(s)) response.Choices.Add(s);
            }
        }
        if (res.Value.TryGetProperty("number", out JsonElement n) && n.TryGetDouble(out double num))
        {
            response.NumberResult = num;
        }
        if (res.Value.TryGetProperty("text", out JsonElement t))
        {
            response.TextResult = t.GetString() ?? "";
        }
        return response;
    }

    private void OnCharacterMove(MoveContext ctx) => PushState();

    private void OnActionTaken(ActionContext ctx) => PushState();

    private void OnQueueUpdated(QueueUpdatedContext ctx)
    {
        Send(SoloMessageTypes.GamingQueue, new
        {
            guid = ctx.Trigger?.Guid.ToString(),
            reason = ctx.Reason.ToString(),
            hardnessTime = ctx.HardnessTime,
            message = ctx.Message
        });
        PushState();
    }

    // ==================== 决策闸门 ====================

    private Character? RequestCharacterSelection(List<Character> candidates)
    {
        JsonElement? res = RequestDecision(DecisionKind.SelectCharacter, new
        {
            characters = candidates.Select(SoloGameMapper.ToOption).ToList()
        });
        if (res is null) return null;
        if (!res.Value.TryGetProperty("characterGuid", out JsonElement g)) return null;
        string guid = g.GetString() ?? "";
        return candidates.FirstOrDefault(c => c.Guid.ToString() == guid);
    }

    /// <summary>
    /// 向客户端请求一次决策并阻塞游戏线程，直到收到 <c>gaming.action</c> 或超时。
    /// 超时返回 null，各调用方按兜底策略处理。
    /// </summary>
    private JsonElement? RequestDecision(string kind, object payload)
    {
        if (_cts.IsCancellationRequested) return null;

        string requestId = Guid.NewGuid().ToString("N");
        TaskCompletionSource<JsonElement?> tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[requestId] = tcs;

        // 决策下发前先强制推送一次完整状态，保证 UI 处于最新
        FlushState();

        try
        {
            _sink?.SendAsync(SoloMessageTypes.GamingRequest, new { requestId, kind, payload }, _cts.Token)
                .GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            WriteLine($"下发决策请求失败：{ex.Message}");
        }

        try
        {
            bool completed = tcs.Task.Wait(DecisionTimeout);
            if (!completed)
            {
                WriteLine($"[{kind}] 等待玩家决策超时，自动采用默认行为。");
                return null;
            }
            return tcs.Task.Result;
        }
        catch (Exception)
        {
            return null;
        }
        finally
        {
            _pending.TryRemove(requestId, out _);
        }
    }

    // ==================== 输出 ====================

    private void WriteLine(string line = "")
    {
        lock (_logLock)
        {
            _log.Add(line);
            if (_log.Count > 5000) _log.RemoveRange(0, 1000);
        }
    }

    private void Send(string type, object data)
    {
        IGameEventSink? sink = _sink;
        if (sink is null) return;
        try
        {
            sink.SendAsync(type, data, CancellationToken.None).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            lock (_logLock) _log.Add($"[广播失败] {ex.Message}");
        }
    }

    /// <summary>节流推送（战斗事件密集时合并；日志按游标增量，不会丢失）</summary>
    private void PushState()
    {
        if (_sink is null) return;
        lock (_logLock)
        {
            if (_pushClock.ElapsedMilliseconds - _lastPushMs < PushMinIntervalMs) return;
            _lastPushMs = _pushClock.ElapsedMilliseconds;
        }
        SendState();
    }

    /// <summary>强制推送（决策下发前 / 每回合结算 / 对局结束时调用）</summary>
    private void FlushState()
    {
        if (_sink is null) return;
        lock (_logLock)
        {
            _lastPushMs = _pushClock.ElapsedMilliseconds;
        }
        SendState();
    }

    private void SendState()
    {
        List<string> newLines;
        lock (_logLock)
        {
            newLines = _log.Skip(_logSent).ToList();
            _logSent = _log.Count;
        }
        Send(SoloMessageTypes.GamingState, new { state = Snapshot(), log = newLines });
    }

    // ==================== 快照 ====================

    public GameStateDto Snapshot()
    {
        List<Character> all = _characters.Count > 0 ? _characters : (_queue?.AllCharacters ?? []);
        List<Character> eliminated = _queue?.Eliminated ?? [];
        string? playerGuid = _player?.Guid.ToString();

        List<QueueEntryDto> queueEntries = [];
        if (_queue is not null)
        {
            int order = 0;
            foreach (Character c in _queue.HardnessTime.OrderBy(kv => kv.Value).Select(kv => kv.Key))
            {
                _queue.HardnessTime.TryGetValue(c, out double ht);
                queueEntries.Add(new QueueEntryDto(
                    c.Guid.ToString(), c.ToStringWithLevel(), ht, order++,
                    c.Guid.ToString() == playerGuid));
            }
        }

        DecisionPoints? dp = null;
        if (_player is not null && _queue is not null)
        {
            _queue.CharacterDecisionPoints.TryGetValue(_player, out dp);
        }

        Dictionary<string, List<string>> rewards = [];
        if (_queue is not null)
        {
            foreach (KeyValuePair<int, List<Skill>> kv in _queue.RoundRewards)
            {
                rewards[kv.Key.ToString()] = [.. kv.Value.Select(s => s.Name.Replace("[R]", "").Trim())];
            }
        }

        return new GameStateDto(
            Id, Mode, _round, _queue?.TotalTime ?? 0, Running, Finished || (_queue?.GameOver ?? false),
            SoloGameMapper.ToMap(_map),
            [.. all.Select(c => SoloGameMapper.ToCharacter(c, _map, playerGuid, _queue, eliminated))],
            queueEntries,
            SoloGameMapper.ToDP(dp),
            playerGuid,
            null,
            rewards);
    }

    public List<RankingDto> BuildRanking()
    {
        List<RankingDto> list = [];
        if (_queue is null) return list;

        HashSet<string> winners = [];
        foreach (RankingEntry entry in _queue.LastRound?.GameResult ?? [])
        {
            if (entry.IsWinner && entry.Character is not null) winners.Add(entry.Character.Guid.ToString());
        }

        int rank = 1;
        foreach (KeyValuePair<Character, CharacterStatistics> kv in _queue.CharacterStatistics
                     .OrderByDescending(kv => kv.Value.Rating))
        {
            Character c = kv.Key;
            CharacterStatistics s = kv.Value;
            string guid = c.Guid.ToString();
            list.Add(new RankingDto(
                rank++, guid, c.ToStringWithLevel(), guid == _player?.Guid.ToString(),
                winners.Count == 0 ? rank == 2 : winners.Contains(guid),
                s.Rating, s.Kills, s.Deaths, s.Assists,
                s.TotalDamage, s.TotalHeal, s.TotalShield,
                s.LiveRound, s.ActionTurn, s.LiveTime, ""));
        }
        return list;
    }
}

/// <summary>单人局启动参数</summary>
public sealed class SoloGameOptions
{
    public int CharacterCount { get; set; } = 10;
    public int Level { get; set; } = 60;
    public int SkillLevel { get; set; } = 6;
    public int NormalAttackLevel { get; set; } = 8;
    public int MaxRound { get; set; } = 999;
    public int MaxRespawnTimes { get; set; } = 1;
    public int DecisionTimeoutSeconds { get; set; } = 120;
    public bool RequireContinue { get; set; } = false;
    public int RoundDelayMs { get; set; } = 250;
}

/// <summary>单人模式专用地图（12 x 12 平面，与 WPF GameMapTesting 的 TestMap 一致）</summary>
public sealed class SoloMap : GameMap
{
    public override string Name => "SoloMap";
    public override string Description => "单人模式测试地图";
    public override string Version => "1.0.0";
    public override string Author => "FunGame Testing";
    public override int Length => 12;
    public override int Width => 12;
    public override int Height => 1;
    public override float Size => 32;

    public override GameMap InitGamingQueue(IGamingQueue queue)
    {
        GameMap map = new SoloMap();
        map.Load();
        if (queue is GamingQueue gq)
        {
            gq.WriteLine($"地图 {map.Name} 已加载。");
        }
        return map;
    }
}
