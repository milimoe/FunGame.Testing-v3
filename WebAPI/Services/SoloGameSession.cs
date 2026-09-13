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
    /// <summary>挂起决策的元信息（重连时用于补发，避免玩家看不到待决策而永久卡住）</summary>
    private readonly ConcurrentDictionary<string, (string Kind, object Payload)> _pendingRequests = new();

    private GamingQueue? _queue;
    /// <summary>团队模式下的团队队列（用于读取红蓝两队与比分）</summary>
    private TeamGamingQueue? _teamQueue;
    private GameMap? _map;
    private Character? _player;
    /// <summary>当前正在行动的角色（供 UI 高亮；含 AI 回合）</summary>
    private volatile Character? _currentActor;
    private volatile IGameEventSink? _sink;
    private CancellationTokenSource _cts = new();
    private Thread? _thread;
    private int _round;
    private int _logSent;
    private bool _disposed;
    /// <summary>玩家决策已超时升级为 AI 托管（避免反复等满超时导致回合/游戏停滞）</summary>
    private volatile bool _aiEscalated;

    /// <summary>
    /// 暂停闸门：置位（Set）= 运行，复位（Reset）= 暂停。
    /// 游戏线程在「回合边界」与「等待玩家决策」两处阻塞于此；暂停期间不计入决策超时。
    /// </summary>
    private readonly ManualResetEventSlim _pauseGate = new(true);
    /// <summary>对局是否处于暂停态（用于快照与 UI）</summary>
    private volatile bool _paused;
    /// <summary>团队模式</summary>
    private volatile bool _teamMode;
    /// <summary>死亡竞赛夺冠人头数（0 = 非死亡竞赛）</summary>
    private volatile int _maxScoreToWin;
    /// <summary>玩家所在队伍名（团队模式恒为「蓝队」）</summary>
    private volatile string? _playerTeamName;

    // ---- 回合内决策次数护栏（外层限时强制结束回合）----
    // 引擎对「手动控制」角色的内层决策循环没有 cancelTimes 上限：一旦玩家给出的动作无法成立
    // （典型：普攻选了射程外的目标），decided 始终为 false，循环会无限向客户端重复索要同一类决策。
    // Core 不改，因此在宿主侧加护栏：同一回合内同类决策连续重复或总次数超阈值时，
    // 立即把玩家角色交 AI 托管，让本回合由 AI 收尾，保证对局一定能推进。
    private int _turnDecisionCount;
    private string? _lastDecisionKind;
    private int _sameKindRepeat;
    private const int MaxSameKindRepeat = 4;   // 同类决策连续出现 4 次 ⇒ 判定为打转
    private const int MaxDecisionsPerTurn = 16; // 单回合决策总数硬上限

    /// <summary>
    /// 本回合开始时，行动角色在引擎侧的 AI 托管判定（引擎在回合开头求值一次 isAI，
    /// 中途加入/移出 AI 集合都不会改变当前回合的局部值）。
    /// 用于识别"引擎认为它不是 AI"的角色：这类角色的内层决策循环无界，
    /// WebAPI 必须用 EndTurn 兜底，不能返回 None。
    /// </summary>
    private volatile bool _turnStartIsAI;

    /// <summary>
    /// 玩家角色在本回合【中途】被托管（决策超时/打转/断线）。
    /// Core 内层决策循环里的 isAI 是外层循环开头求值的局部变量：回合中途托管后局部 isAI 仍是 false，
    /// 引擎仍按"手动角色"走无界内层循环；此时若 WebAPI 的 OnDecideAction 返回 None（IsPlayer 已变 false），
    /// 引擎会落回 GetActionType 随机兜底——角色一旦无可行动作（无路可走/无人可打）就永久空转（100% CPU）。
    /// 对策：托管发生在回合中途时，对玩家角色一律回答 EndTurn（decided=true → 当前回合立即正常收尾）；
    /// 下个回合开始时引擎会以真实 isAI=true 驱动（AI 托管）或交还玩家，届时再恢复正常决策。
    /// </summary>
    private volatile bool _escalatedMidTurn;

    // ---- 临时诊断：回合看门狗（定位 AI 托管阶段的引擎内死循环；定位完成后删除）----
    private System.Threading.Timer? _diagTimer;
    private volatile Character? _diagActor;
    private long _diagTurnStartMs;

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
        // 若正处于暂停态，必须先放行游戏线程，否则它不会察觉取消而在闸门上一直等
        try { _pauseGate.Set(); } catch { /* 已释放则忽略 */ }
    }

    /// <summary>对局是否处于暂停态</summary>
    public bool Paused => _paused;

    /// <summary>
    /// 暂停 / 继续。暂停时游戏线程阻塞在闸门上：回合不再推进、决策也不会计时超时，
    /// 玩家可以慢慢研究技能与装备。恢复后从原地继续，剩余决策时间会被补偿回来。
    /// </summary>
    public void SetPaused(bool paused)
    {
        if (_paused == paused) return;
        _paused = paused;
        if (paused)
        {
            _pauseGate.Reset();
            WriteLine("--- 对局已暂停，引擎线程已挂起，恢复后从原地继续 ---");
        }
        else
        {
            _pauseGate.Set();
            WriteLine("--- 对局已继续 ---");
        }
        // 暂停/继续都是一次状态跃迁，立刻广播（PushState 会被节流，这里用 FlushState）
        FlushState();
    }

    /// <summary>阻塞直到恢复运行（被取消则抛出），返回值为 true 表示已恢复</summary>
    private bool WaitWhilePaused()
    {
        if (_pauseGate.IsSet) return true;
        try
        {
            _pauseGate.Wait(_cts.Token);
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
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
        // 重连后夺回玩家角色的控制权（此前断线/超时托管已交还 AI）
        ReleasePlayerFromAI("玩家重新连接");
        // 重连：补发完整快照（地图必须每次携带：前端棋子位置由 grid.characters 驱动）
        PushState();

        // 补发仍在等待的决策请求：否则重连后玩家看不到待办操作，对局会一直卡在这里
        foreach (KeyValuePair<string, (string Kind, object Payload)> kv in _pendingRequests)
        {
            try
            {
                _sink?.SendAsync(SoloMessageTypes.GamingRequest,
                    new { requestId = kv.Key, kind = kv.Value.Kind, payload = kv.Value.Payload },
                    CancellationToken.None).GetAwaiter().GetResult();
            }
            catch
            {
                /* 忽略 */
            }
        }
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
                // 必须同步置位，否则重连时 ReleasePlayerFromAI 会提前 return，导致玩家一直被 AI 托管
                _aiEscalated = true;
                _escalatedMidTurn = true; // 若断线发生在玩家回合中途，回答 EndTurn 结束本回合，避免 isAI 局部旧值空转
                WriteLine($"[托管] 玩家断线，[ {_player} ] 暂由 AI 托管，重连后自动夺回控制权。");
            }
            catch
            {
                /* 对局已结束则忽略 */
            }
        }
    }

    /// <summary>
    /// 玩家在线但决策超时（如 UI 未弹出菜单）→ 将角色交 AI 托管。
    /// 与旧版 Desktop 的「自动模式」等价：托管后 <see cref="IsPlayer"/> 立即返回 false，
    /// 引擎改由 AI 驱动该角色，本回合可正常收尾，不会卡死在手动玩家的无限决策循环里。
    /// 托管只持续到本回合结束，下一个玩家回合开始时由 <see cref="OnTurnStart"/> 自动夺回。
    /// </summary>
    private void EscalatePlayerToAI(string reason)
    {
        if (_aiEscalated) return;
        _aiEscalated = true;
        _escalatedMidTurn = true; // 视为"回合中途"托管：OnDecideAction 将回答 EndTurn 结束本回合，避免空转
        if (_player is not null && _queue is not null)
        {
            try
            {
                _queue.SetCharactersToAIControl(bySystem: true, cancel: false, [_player]);
                WriteLine($"[托管] 玩家决策超时（{reason}），[ {_player} ] 本回合暂由 AI 托管，下回合自动夺回控制权。");
            }
            catch
            {
                /* 对局已结束则忽略 */
            }
        }
        foreach (TaskCompletionSource<JsonElement?> tcs in _pending.Values)
        {
            tcs.TrySetResult(null);
        }
    }

    /// <summary>解除 AI 托管，把玩家角色交还给手动控制</summary>
    private void ReleasePlayerFromAI(string reason)
    {
        if (!_aiEscalated) return;
        _aiEscalated = false;
        _escalatedMidTurn = false;
        if (_player is not null && _queue is not null)
        {
            try
            {
                // cancel: true => 将玩家移出系统 AI 托管集合，夺回控制权
                _queue.SetCharactersToAIControl(bySystem: true, cancel: true, [_player]);
                WriteLine($"[托管解除] {reason}，玩家重新掌控 [ {_player} ]。");
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
        _pauseGate.Dispose();
        foreach (TaskCompletionSource<JsonElement?> tcs in _pending.Values) tcs.TrySetCanceled();
        _pending.Clear();
    }

    // ==================== 主流程 ====================

    private void RunGame(SoloGameOptions options)
    {
        // 回合看门狗诊断（默认关闭；由 SoloGameOptions.EnableTurnDiagnostics 开启）
        if (options.EnableTurnDiagnostics)
        {
            _diagTimer = new System.Threading.Timer(_ => DiagTick(), null, 3000, 2000);
            WriteLine("[诊断] 回合看门狗已启用（日志：bin 目录下 turn-diag.log）。");
        }
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

            // ---- 团队划分（5V5：玩家所在队固定命名「蓝队」，对方为「红队」） ----
            _teamMode = options.TeamMode;
            _maxScoreToWin = options.TeamMode ? Math.Max(1, options.MaxScoreToWin) : 0;
            List<Character> blue = [];
            List<Character> red = [];
            if (options.TeamMode)
            {
                (blue, red) = BuildTeams(player, candidates, options.TeamSize);
                _playerTeamName = BlueTeamName;
            }

            // ---- 构建队列与地图 ----
            // 团队模式使用 TeamGamingQueue（红蓝分组 + 团队计分）；混战模式保持 MixGamingQueue。
            GamingQueue queue = options.TeamMode
                ? new TeamGamingQueue(candidates, WriteLine, seed: options.Seed)
                {
                    MaxRespawnTimes = options.MaxRespawnTimes,
                    MaxScoreToWin = _maxScoreToWin
                }
                : new MixGamingQueue(candidates, WriteLine, seed: options.Seed)
                {
                    MaxRespawnTimes = options.MaxRespawnTimes
                };
            _queue = queue;
            _teamQueue = queue as TeamGamingQueue;
            if (_teamQueue is not null)
            {
                _teamQueue.AddTeam(BlueTeamName, blue);
                _teamQueue.AddTeam(RedTeamName, red);
                WriteLine("");
                WriteLine("=== 团队模式 5V5 · 死亡竞赛 ===");
                WriteLine($"你被随机分配到 [ {BlueTeamName} ]；率先取得 {_maxScoreToWin} 个人头的队伍获胜（无限复活）。");
                WriteLine($"[ {BlueTeamName} ]：{string.Join(" / ", blue.Select(c => c.ToString()))}");
                WriteLine($"[ {RedTeamName} ]：{string.Join(" / ", red.Select(c => c.ToString()))}");
                WriteLine("");
            }
            if (options.Seed is int seed) WriteLine($"[种子] 本局使用固定随机种子 {seed}（同种子对局可复现）。");
            queue.IsDebug = true;
            queue.LoadGameMap(new SoloMap());
            queue.UseQueueProtected = false;
            _map = queue.Map;

            if (queue.Map is not null)
            {
                GameMap map = queue.Map;
                // 按 X 排序后对半切开：蓝队占据地图一侧、红队占据另一侧，避免开局贴脸混战
                List<Grid> ordered = [.. map.Grids.Values.OrderBy(g => g.X).ThenBy(g => g.Y)];
                int half = Math.Max(1, ordered.Count / 2);
                List<Grid> lowHalf = [.. ordered.Take(half)];
                List<Grid> highHalf = [.. ordered.Skip(half)];
                bool teamSplit = _teamQueue is not null && blue.Count > 0 && red.Count > 0;

                HashSet<Grid> allocated = [];
                foreach (Character character in candidates)
                {
                    character.NormalAttack.GamingQueue = queue;
                    List<Grid> pool = !teamSplit ? ordered : blue.Contains(character) ? lowHalf : highHalf;
                    List<Grid> free = [.. pool.Where(g => !allocated.Contains(g))];
                    if (free.Count == 0) free = [.. ordered.Where(g => !allocated.Contains(g))];
                    if (free.Count == 0) free = ordered;
                    Grid grid = free[Random.Shared.Next(free.Count)];
                    allocated.Add(grid);
                    map.SetCharacterCurrentGrid(character, grid);
                }
            }

            BindEvents(queue);

            // ---- 空投 ----
            // 初始装备品质可由开局设置指定（0白 1绿 2蓝 3紫 4橙 5红，5 含红以上）；
            // 后续每 DropItemsIntervalSeconds 游戏秒再空投一轮并提升品质（见主循环），与 FunGameSimulation
            // 的 nextDropTime 计时方式一致（按游戏时间而非回合数）。
            int dropQuality = Math.Clamp(options.InitialItemQuality, 0, 5);
            double dropIntervalSec = Math.Clamp(options.DropItemsIntervalSeconds, 0, 7200);
            double nextDropAt = dropIntervalSec;
            WriteLine(dropIntervalSec > 0
                ? $"社区送温暖了，现在随机发放空投！！（初始装备品质：{QualityName(dropQuality)}，每 {dropIntervalSec:0} 游戏秒轮换一次）"
                : $"社区送温暖了，现在随机发放空投！！（初始装备品质：{QualityName(dropQuality)}）");
            FunGameSimulation.DropItems(queue, dropQuality, dropQuality, dropQuality, dropQuality, dropQuality);
            WriteLine("");

            queue.InitActionQueue();
            // Core 约定：只允许一级附属关系，且【所有 Master 角色若不由玩家控制，必须在开局显式加入 AI 托管】，
            // 否则其附属单位会因 Master 不在 AI 集合而被判定为非 AI（isAI=false），
            // 走进无界的手动决策循环（等同"被当成实际玩家运行"）。
            // 因此这里对队列中【全部】角色（含 Master 与附属单位）加入系统 AI 托管，再把玩家移出。
            queue.SetCharactersToAIControl(bySystem: true, cancel: false, [.. queue.AllCharacters]);
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
                // 暂停闸门：挂起时引擎线程阻塞在此，回合不再推进（被终止时返回 false）
                if (!WaitWhilePaused()) break;

                Character? actor = queue.NextCharacter();
                _currentActor = actor;
                PushState();

                if (actor is not null)
                {
                    // "孤儿角色"兜底：既非玩家可控、又不在任何 AI 托管集合中的角色（典型：雇佣兵/召唤物
                    // 未被加入 AI 集合）。引擎对 isAI=false 的角色内层决策循环无界，一旦它无法行动
                    // （无路可走/无可打击目标）就会 100% CPU 永久空转。此处在回合开始前补入 AI 托管，
                    // 让引擎以 isAI=true 正常驱动它。
                    if (!IsPlayer(actor) && !queue.IsCharacterInAIControlling(actor))
                    {
                        queue.SetCharactersToAIControl(bySystem: true, cancel: false, [actor]);
                        WriteLine($"[兜底] 角色 [ {actor} ] 既非玩家控制也未托管，已交由 AI 驱动。");
                    }

                    _round = i++;
                    WriteLine($"=== 回合 {_round} ===");
                    WriteLine($"现在是 [ {actor} ] 的回合！");

                    if (queue.Map is not null)
                    {
                        Grid? currentGrid = queue.Map.GetCharacterCurrentGrid(actor);
                        if (currentGrid is not null) queue.CustomData["currentGrid"] = currentGrid;
                    }

                    bool isGameEnd = false;
                    _diagActor = actor;
                    _diagTurnStartMs = Environment.TickCount64;
                    try
                    {
                        isGameEnd = queue.ProcessTurn(actor);
                    }
                    catch (Exception ex)
                    {
                        WriteLine(ex.ToString());
                    }
                    finally
                    {
                        _diagActor = null;
                    }

                    Send(SoloMessageTypes.GamingRound, new { gameId = Id, round = _round, actorGuid = actor.Guid.ToString() });

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

                // ---- 空投轮换：按游戏时间计时（对齐 FunGameSimulation 的 nextDropTime -= timeLapse），
                //      每满间隔秒再空投一次，品质逐步提升（FunGameSimulation.DropItems，addLevel 默认 true）----
                if (dropIntervalSec > 0 && totalTime >= nextDropAt && !queue.GameOver)
                {
                    if (dropQuality < 5) dropQuality++;
                    WriteLine($"社区送温暖了，现在随机发放空投！！（品质提升至 {QualityName(dropQuality)}）");
                    FunGameSimulation.DropItems(queue, dropQuality, dropQuality, dropQuality, dropQuality, dropQuality);
                    WriteLine("");
                    // 空投改变了全员的装备/物品，立即推送一次完整状态
                    nextDropAt = totalTime + dropIntervalSec;
                    FlushState();
                }

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
        finally
        {
            _diagTimer?.Dispose();
            _diagTimer = null;
            _diagActor = null;
        }
    }

    /// <summary>临时诊断：回合看门狗——检测 ProcessTurn 长时间不返回（引擎内死循环）并落盘角色状态</summary>
    private void DiagTick()
    {
        Character? actor = _diagActor;
        if (actor is null) return;
        long elapsedMs = Environment.TickCount64 - _diagTurnStartMs;
        if (elapsedMs < 15_000) return; // 前 15s 视为正常回合
        try
        {
            GamingQueue? queue = _queue;
            string line =
                $"[{DateTime.Now:HH:mm:ss}] ProcessTurn 已运行 {elapsedMs / 1000}s 未返回！角色=[ {actor} ] " +
                $"guid={actor.Guid} isAI={queue?.IsCharacterInAIControlling(actor)} " +
                $"bySystem={queue?.IsCharacterInAIControllingBySystem(actor)} byUser={queue?.IsCharacterInAIControllingByUser(actor)} " +
                $"state={actor.CharacterState} HP={actor.HP}/{actor.MaxHP} EP={actor.EP} " +
                $"grid={queue?.Map?.GetCharacterCurrentGrid(actor)?.Id} 死亡={queue?.Eliminated.Contains(actor)}";
            if (queue is not null && queue.CharacterDecisionPoints.TryGetValue(actor, out DecisionPoints? dp) && dp is not null)
            {
                line += $" DP={dp.CurrentDecisionPoints}/{dp.MaxDecisionPoints} 动作总数={dp.ActionsTaken} 动作类型数={dp.ActionTypes.Count}";
            }
            // 决策子系统状态：若存在挂起决策说明引擎在等客户端，否则说明在请求决策之前的区域空转
            lock (_logLock)
            {
                line += $" PlayerConnected={PlayerConnected} 挂起决策数={_pending.Count}";
                if (_pending.Count > 0)
                {
                    line += " 种类=[" + string.Join(",", _pending.Values.Select(_ => "?")) + "]";
                    foreach (KeyValuePair<string, TaskCompletionSource<JsonElement?>> kv in _pending.Take(3))
                    {
                        _pendingRequests.TryGetValue(kv.Key, out (string Kind, object Payload) r);
                        line += $" {kv.Key[..Math.Min(6, kv.Key.Length)]}:{r.Kind}";
                    }
                }
            }
            lock (_logLock)
            {
                try { File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "turn-diag.log"), line + "\n"); }
                catch { /* 磁盘/权限问题忽略 */ }
            }
        }
        catch
        {
            /* 诊断本身失败不影响对局 */
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

    /// <summary>装备品质中文名（QualityType 0-5；5=红，包含红以上），用于空投日志</summary>
    private static string QualityName(int q) => q switch
    {
        0 => "白",
        1 => "绿",
        2 => "蓝",
        3 => "紫",
        4 => "橙",
        _ => "红",
    };

    /// <summary>己方（玩家所在队）队名 —— 己方恒为蓝色</summary>
    public const string BlueTeamName = "蓝队";
    /// <summary>对方队名</summary>
    public const string RedTeamName = "红队";

    /// <summary>
    /// 把候选角色随机分成两支队伍。<para/>
    /// 玩家被随机「分配」进其中一支：除自己以外的 9 名角色随机洗牌，取 teamSize-1 人成为队友，
    /// 其余为对手。玩家所在队恒命名为「蓝队」（己方固定为蓝色），对方为「红队」。
    /// </summary>
    private static (List<Character> Blue, List<Character> Red) BuildTeams(
        Character player, List<Character> candidates, int teamSize)
    {
        int size = Math.Clamp(teamSize, 1, Math.Max(1, candidates.Count / 2));
        List<Character> others = [.. candidates
            .Where(c => !ReferenceEquals(c, player))
            .OrderBy(_ => Random.Shared.Next())];
        List<Character> mine = [player, .. others.Take(Math.Max(0, size - 1))];
        List<Character> theirs = [.. others.Skip(Math.Max(0, size - 1)).Take(size)];
        return (mine, theirs);
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
        // 记录本回合引擎侧的 AI 判定（引擎在回合开头求值一次，中途变更对当前回合无效）
        _turnStartIsAI = _queue is not null && ctx.Trigger is not null
            && _queue.IsCharacterInAIControlling(ctx.Trigger);
        // 回合边界：清除"回合中途托管"标记（下个回合引擎会以真实的 isAI 驱动角色）
        _escalatedMidTurn = false;
        // 玩家在线且上回合因超时/打转被 AI 托管 → 新回合自动夺回控制权，避免玩家被永久锁在托管状态。
        // 注意：断线（PlayerConnected=false）时【不】夺回——AI 应继续代打直至玩家重连（AttachSink 里才夺回）。
        if (_aiEscalated && PlayerConnected && _player is not null && ctx.Trigger is not null
            && (ReferenceEquals(ctx.Trigger, _player) || ReferenceEquals(ctx.Trigger.Master, _player)))
        {
            ReleasePlayerFromAI("新回合开始");
        }
        // 每个回合重置决策计数护栏
        _turnDecisionCount = 0;
        _lastDecisionKind = null;
        _sameKindRepeat = 0;
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

    /// <summary>
    /// 构建「可展示」的技能列表：引擎在回合开始会把 CD 中 / 资源不足 / 生效中的技能整体过滤掉
    /// （GamingQueue.GetTurnStartNeedyList），SelectionContext / TurnContext 里只剩下可用项。
    /// 这里把角色全部主动技能（含装备槽主动技）补回列表尾部，让客户端能勾选查看「不可用」的技能详情。
    /// 安全性：回执解析仍只认 ctx 里的引擎列表（FirstOrDefault 找不到即 null），不可用技能不可能被真正施放。
    /// </summary>
    private static List<Skill> MergeSelectableSkills(IReadOnlyList<Skill> engineSkills, Character actor)
    {
        List<Skill> merged = [.. engineSkills];
        List<Skill> all = [.. actor.Skills];
        GamingQueue.AddCharacterEquipSlotSkills(actor, all);
        foreach (Skill s in all)
        {
            if (s.SkillType == SkillType.Passive) continue;
            if (!merged.Contains(s)) merged.Add(s);
        }
        return merged;
    }

    /// <summary>
    /// 构建「可展示」的物品列表：同上，把引擎过滤掉但有主动效果的游戏内物品补回列表尾部
    /// （冷却中 / 生效中 / 资源不足的消耗品等），供客户端查看详情；回执解析仍只认引擎列表。
    /// </summary>
    private static List<Item> MergeSelectableItems(IReadOnlyList<Item> engineItems, Character actor)
    {
        List<Item> merged = [.. engineItems];
        foreach (Item i in actor.Items)
        {
            if (!i.IsActive || i.Skills.Active is null || !i.IsInGameItem) continue;
            if (!merged.Contains(i)) merged.Add(i);
        }
        return merged;
    }

    private CharacterActionType OnDecideAction(TurnContext ctx)
    {
        if (!IsPlayer(ctx.Trigger))
        {
            // 玩家角色在本回合中途被托管（超时/打转/断线）且 Core 的 isAI 局部值仍是 false：
            // 直接回答 EndTurn 让 decided=true 结束当前回合。若这里返回 None，引擎会落回
            // GetActionType 随机兜底，角色无可行动作时内层循环永久空转（见 _escalatedMidTurn 注释）。
            if (_escalatedMidTurn && _player is not null && ctx.Trigger is not null
                && (ReferenceEquals(ctx.Trigger, _player) || ReferenceEquals(ctx.Trigger.Master, _player)))
            {
                return CharacterActionType.EndTurn;
            }
            // 兜底：引擎本回合判定该角色【不是 AI】（isAI=false ⇒ 内层决策循环无界），
            // 且它又不受玩家控制 —— 若返回 None 引擎会落回 GetActionType 随机兜底，
            // 角色无可行动作时即 100% CPU 永久空转。统一用 EndTurn 收尾本回合。
            if (!_turnStartIsAI)
            {
                return CharacterActionType.EndTurn;
            }
            return CharacterActionType.None; // 交给 AI
        }
        Character actor = ctx.Trigger!;
        JsonElement? res = RequestDecision(DecisionKind.ActionType, new
        {
            actorGuid = actor.Guid.ToString(),
            actorName = actor.ToStringWithLevel(),
            teamName = TeamNameOf(actor),
            // 站位与射程：勾选「移动 / 普通攻击 / 技能」时地图立即黄色（攻击/施法）与绿色（移动）高亮
            actorGridId = _map?.GetCharacterCurrentGrid(actor)?.Id ?? -1,
            atr = actor.ATR,
            mov = actor.MOV,
            dp = SoloGameMapper.ToDP(ctx.DP),
            // 列表带全量（可用 + 不可用）：客户端对不可用项「可勾选查看详情、不可确认」
            skills = MergeSelectableSkills(ctx.Skills, actor).Select(s => SoloGameMapper.ToSkill(s, actor)).ToList(),
            items = MergeSelectableItems(ctx.Items, actor).Select(i => SoloGameMapper.ToItem(i, actor)).ToList(),
            enemys = ctx.Enemys.Select(c => c.Guid.ToString()).ToList(),
            teammates = ctx.Teammates.Select(c => c.Guid.ToString()).ToList(),
            enemyOptions = ctx.Enemys.Select(c => ToTargetOption(c, actor)).ToList(),
            teammateOptions = ctx.Teammates.Select(c => ToTargetOption(c, actor)).ToList()
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
            // 站位与射程：勾选具体技能时地图立刻黄色高亮其施法范围
            actorGridId = _map?.GetCharacterCurrentGrid(actor)?.Id ?? -1,
            atr = actor.ATR,
            mov = actor.MOV,
            // 带全量技能（可用 + 冷却/资源不足等不可用项），不可用项仅可查看；回执仍只认引擎可用列表
            skills = MergeSelectableSkills(ctx.Skills, actor).Select(s => SoloGameMapper.ToSkill(s, actor)).ToList()
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
            actorGridId = _map?.GetCharacterCurrentGrid(actor)?.Id ?? -1,
            atr = actor.ATR,
            mov = actor.MOV,
            // 带全量物品（可用 + 冷却/生效中/资源不足等不可用项），不可用项仅可查看；回执仍只认引擎可用列表
            items = MergeSelectableItems(ctx.Items, actor).Select(i => SoloGameMapper.ToItem(i, actor)).ToList()
        });
        if (res is null) return null;
        if (!res.Value.TryGetProperty("itemGuid", out JsonElement g)) return null;
        string guid = g.GetString() ?? "";
        return ctx.Items.FirstOrDefault(i => i.Guid.ToString() == guid);
    }

    private List<Character> OnSelectSkillTargets(SelectionContext ctx)
    {
        if (!IsPlayer(ctx.Trigger)) return [];
        (List<Character> selectable, int max, bool selectAll) = ResolveSelectable(ctx);
        if (selectable.Count == 0)
        {
            // 强制校验：射程内没有任何符合技能选择规则的目标时不发选目标决策，直接取消本次行动
            //（返回空列表 → 引擎跳过该动作并重新询问行动类型，玩家回到行动菜单）
            WriteLine($"[ {ctx.Trigger} ] 想要施放 [ {ctx.Skill?.Name ?? "技能"} ]，但射程内没有任何可选目标，行动已取消！");
            return [];
        }
        return RequestTargets(ctx, selectable, max, selectAll);
    }

    private List<Character> OnSelectNormalAttackTargets(SelectionContext ctx)
    {
        if (!IsPlayer(ctx.Trigger)) return [];
        (List<Character> selectable, int max, bool selectAll) = ResolveSelectable(ctx);
        if (selectable.Count == 0)
        {
            // 强制校验：攻击范围内没有任何可选目标时不发选目标决策，直接取消本次行动
            WriteLine($"[ {ctx.Trigger} ] 想要发起普通攻击，但攻击范围内没有任何可选目标，行动已取消！");
            return [];
        }
        return RequestTargets(ctx, selectable, max, selectAll);
    }

    /// <summary>
    /// 依据技能（或普攻）的选择规则计算可选目标与最大可选数量。
    /// <para>注意 <c>SelectAllEnemies</c> / <c>SelectAllTeammates</c>：这两个开关的优先级高于
    /// <c>CanSelectTargetCount</c>，数量必须按「场上实际可选的敌/友数量」动态计算。
    /// 是否包含施法者自身一律由 <c>CanSelectSelf</c> 决定，与引擎
    /// <see cref="NormalAttack.GetSelectableTargets"/> / <see cref="Skill.GetSelectableTargets"/> 的判定一致；
    /// <c>SelectAllTeammates</c> 不越权补自身（引擎的队友列表本就不含自己）。</para>
    /// <para>强制校验：可选目标只来自技能/普攻声明规则（CanSelect*）命中的角色，不做任何兜底填充——
    /// 尤其不允许默认把施法者自己塞进列表（那会让玩家「普攻自己」）。返回空列表时调用方必须
    /// 取消本次行动（不发选目标决策，引擎会重新询问行动类型），不得发出零选项的选目标请求。</para>
    /// </summary>
    private static (List<Character> Selectable, int Max, bool SelectAll) ResolveSelectable(SelectionContext ctx)
    {
        List<Character> selectable = [];
        int rawMax = 1;
        bool selectAll = false;

        if (ctx.Skill is Skill skill)
        {
            if (skill.CanSelectSelf && ctx.Trigger is not null) selectable.Add(ctx.Trigger);
            if (skill.CanSelectEnemy) selectable.AddRange(ctx.Enemys);
            if (skill.CanSelectTeammate) selectable.AddRange(ctx.Teammates);
            rawMax = Math.Max(1, skill.RealCanSelectTargetCount(ctx.Enemys, ctx.Teammates));
            selectAll = skill.SelectAllEnemies || skill.SelectAllTeammates;
            if (skill.SelectAllEnemies && selectable.Count == 0) selectable.AddRange(ctx.Enemys);
        }
        else if (ctx.NormalAttack is NormalAttack attack)
        {
            if (attack.CanSelectSelf && ctx.Trigger is not null) selectable.Add(ctx.Trigger);
            if (attack.CanSelectEnemy) selectable.AddRange(ctx.Enemys);
            if (attack.CanSelectTeammate) selectable.AddRange(ctx.Teammates);
            rawMax = Math.Max(1, attack.RealCanSelectTargetCount(ctx.Enemys, ctx.Teammates));
            selectAll = attack.SelectAllEnemies || attack.SelectAllTeammates;
            if (attack.SelectAllEnemies && selectable.Count == 0) selectable.AddRange(ctx.Enemys);
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

        // 不做兜底填充：这里若为空，调用方会直接取消本次行动（见 OnSelectSkillTargets /
        // OnSelectNormalAttackTargets），而不是伪造目标——伪造出的「自己」曾导致玩家普攻自己。

        // 上限不能超过实际可选人数（否则 UI 会显示一个永远达不到的「最多 N 个」）
        int max = distinct.Count > 0 ? Math.Clamp(rawMax, 1, distinct.Count) : 1;
        return (distinct, max, selectAll);
    }

    /// <summary>可选目标项（行动类型阶段的敌/友列表使用，供 UI 显示动态人数与名称）</summary>
    private object ToTargetOption(Character c, Character actor) => new
    {
        guid = c.Guid.ToString(),
        displayName = c.ToStringWithLevel(),
        hp = c.HP,
        maxHp = c.MaxHP,
        gridId = _map?.GetCharacterCurrentGrid(c)?.Id ?? -1,
        isSelf = ReferenceEquals(c, actor),
        isTeammate = _queue?.IsTeammate(actor, c) ?? false,
        isEliminated = _queue?.Eliminated.Contains(c) ?? false
    };

    private List<Character> RequestTargets(SelectionContext ctx, List<Character> selectable, int max, bool selectAll)
    {
        Character actor = ctx.Trigger!;
        // SelectionContext.Skill 是 ISkill，CastRange / CastAnywhere 只有具体 Skill 才有
        Skill? castSkill = ctx.Skill as Skill;
        JsonElement? res = RequestDecision(DecisionKind.Targets, new
        {
            actorGuid = actor.Guid.ToString(),
            skillName = ctx.Skill?.Name ?? ctx.NormalAttack?.Name ?? "",
            maxTargets = max,
            // selectAll：本技能/普攻是「选取全体」类，前端应默认替玩家勾选全部可选目标
            selectAll,
            // 攻击/施法距离（黄）：地图据此高亮可选范围；移动距离（绿）另在 TargetGrid 阶段下发
            range = castSkill?.CastAnywhere == true ? -1 : (castSkill?.CastRange ?? actor.ATR),
            attackRange = actor.ATR,
            moveRange = actor.MOV,
            actorGridId = _map?.GetCharacterCurrentGrid(actor)?.Id ?? -1,
            enemys = ctx.Enemys.Select(c => c.Guid.ToString()).ToList(),
            teammates = ctx.Teammates.Select(c => c.Guid.ToString()).ToList(),
            targets = selectable.Select(c => new
            {
                guid = c.Guid.ToString(),
                displayName = c.ToStringWithLevel(),
                hp = c.HP,
                maxHp = c.MaxHP,
                gridId = _map?.GetCharacterCurrentGrid(c)?.Id ?? -1,
                isSelf = ReferenceEquals(c, actor),
                isTeammate = ctx.Teammates.Contains(c)
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
        Skill? castSkill = ctx.Skill as Skill;

        JsonElement? res = RequestDecision(DecisionKind.TargetGrids, new
        {
            actorGuid = actor.Guid.ToString(),
            skillName = ctx.Skill?.Name ?? "",
            // 施法距离（黄）：CastAnywhere 时用 -1 表示「全图」
            range = castSkill?.CastAnywhere == true ? -1 : (castSkill?.CastRange ?? 0),
            actorGridId = _map.GetCharacterCurrentGrid(actor)?.Id ?? -1,
            // 选取形状（客户端据此做形状预览；服务端按同一形状权威展开）
            shapeRangeType = (castSkill?.SkillRangeType ?? SkillRangeType.Diamond).ToString(),
            shapeRadius = castSkill?.CanSelectTargetRange ?? 0,
            sectorAngle = castSkill?.SectorAngle ?? 90,
            includeCharacterGrid = castSkill?.SelectIncludeCharacterGrid ?? true,
            gridIds = ctx.CastRange.Select(g => g.Id).ToList()
        });
        if (res is null) return [];
        if (!res.Value.TryGetProperty("gridIds", out JsonElement arr) || arr.ValueKind != JsonValueKind.Array) return [];

        // 玩家只提交一个【中心格子】；受影响区域由服务端按技能形状（SkillRangeType + CanSelectTargetRange）
        // 权威展开（Skill.SelectNonDirectionalTargets，与 AI 选取口径完全一致），客户端不再手挑一片散格。
        Grid? center = null;
        foreach (JsonElement item in arr.EnumerateArray())
        {
            if (item.TryGetInt64(out long id) && _map.Grids.TryGetValue(id, out Grid? grid))
            {
                // 中心必须在施法范围内
                if (ctx.CastRange.Count > 0 && !ctx.CastRange.Contains(grid)) continue;
                center = grid;
                break;
            }
        }
        if (center is null) return [];

        if (castSkill is null) return [center];
        List<Grid> shaped = castSkill.SelectNonDirectionalTargets(actor, center, castSkill.SelectIncludeCharacterGrid);
        WriteLine($"[ {actor} ] 以 #{center.Id} 为中心选取{ShapeName(castSkill.SkillRangeType)}区域（半径 {castSkill.CanSelectTargetRange}，覆盖 {shaped.Count} 格）。");
        return shaped;
    }

    /// <summary>技能作用范围形状中文名（日志用）</summary>
    private static string ShapeName(SkillRangeType t) => t switch
    {
        SkillRangeType.Diamond => "菱形",
        SkillRangeType.Circle => "圆形",
        SkillRangeType.Square => "正方形",
        SkillRangeType.Line => "线段",
        SkillRangeType.LinePass => "贯穿直线",
        SkillRangeType.Sector => "扇形",
        _ => t.ToString(),
    };

    private Grid OnSelectTargetGrid(SelectionContext ctx)
    {
        if (!IsPlayer(ctx.Trigger) || _map is null) return Grid.Empty;
        Character actor = ctx.Trigger!;
        List<Grid> moveRange = ctx.MoveRange.Count > 0 ? ctx.MoveRange : [];

        JsonElement? res = RequestDecision(DecisionKind.TargetGrid, new
        {
            actorGuid = actor.Guid.ToString(),
            currentGridId = _map.GetCharacterCurrentGrid(actor)?.Id ?? -1,
            // 移动距离（绿）：moveRange 为格数，gridIds 为可达格子
            moveRange = actor.MOV,
            // 攻击距离（黄）：移动阶段也一并下发，方便在选格子时同时看到「移动后能打到谁」
            attackRange = actor.ATR,
            atr = actor.ATR,
            mov = actor.MOV,
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
        // 暂停中不下发新决策：等恢复后再问，避免玩家在暂停时收到倒计时压力
        if (!WaitWhilePaused()) return null;

        // ---- 回合内决策护栏：手动角色的决策循环在 Core 里没有次数上限，
        //      这里识别"同一类决策被反复索要"的打转，并把玩家交 AI 托管以强制结束本回合 ----
        if (kind == _lastDecisionKind) _sameKindRepeat++;
        else
        {
            _lastDecisionKind = kind;
            _sameKindRepeat = 1;
        }
        _turnDecisionCount++;

        if (_sameKindRepeat >= MaxSameKindRepeat || _turnDecisionCount > MaxDecisionsPerTurn)
        {
            WriteLine($"[护栏] 本回合决策打转（{kind} 连续 {_sameKindRepeat} 次 / 共 {_turnDecisionCount} 次），强制结束玩家回合。");
            EscalatePlayerToAI($"决策打转 {kind}");
            return null;
        }

        string requestId = Guid.NewGuid().ToString("N");
        TaskCompletionSource<JsonElement?> tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[requestId] = tcs;
        _pendingRequests[requestId] = (kind, payload);

        // 决策下发前先强制推送一次完整状态，保证 UI 处于最新
        FlushState();

        try
        {
            // 下发决策时携带超时时长，前端据此显示倒计时，玩家能明确知道"现在轮到我、还剩多久"
            _sink?.SendAsync(SoloMessageTypes.GamingRequest,
                new { requestId, kind, payload, timeoutMs = (int)DecisionTimeout.TotalMilliseconds }, _cts.Token)
                .GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            WriteLine($"下发决策请求失败：{ex.Message}");
        }

        try
        {
            // 托管中：IsPlayer 已为 false，理论上不会再走到这里；
            // 但仍保留一道短超时保险，避免任何边界情况下每个决策都空等一个完整超时。
            long timeoutMs = (long)(_aiEscalated ? TimeSpan.FromSeconds(3) : DecisionTimeout).TotalMilliseconds;
            long deadline = Environment.TickCount64 + timeoutMs;
            bool completed = false;
            while (true)
            {
                if (_cts.IsCancellationRequested) break;
                // 暂停期间不计入决策超时：阻塞在闸门上，恢复时把暂停时长补回截止时间
                if (!_pauseGate.IsSet)
                {
                    long pausedAt = Environment.TickCount64;
                    if (!WaitWhilePaused()) break;
                    deadline += Environment.TickCount64 - pausedAt;
                    continue;
                }
                if (tcs.Task.Wait(120)) { completed = true; break; }
                if (Environment.TickCount64 >= deadline) break;
            }

            if (!completed)
            {
                WriteLine($"[{kind}] 等待玩家决策超时，自动采用默认行为。");
                // 玩家在线但长时间未响应（如 UI 未弹出决策菜单）→ 升级为 AI 托管，
                // 避免后续每个决策都再等一个完整超时、回合迟迟不结束（2026-09-09）
                EscalatePlayerToAI(kind);
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
            _pendingRequests.TryRemove(requestId, out _);
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
        List<Character> all = _characters.Count > 0 ? [.. _characters] : [];
        // Core / 模组可能在开局后派生出额外单位（例：Oshima「雇佣兵团」召唤的雇佣兵），
        // 它们不在 WebAPI 自己创建的角色表里。若不下发：客户端地图上该格是空的、队伍列表与
        // 角色详情也查不到，但它们**仍是引擎承认的合法目标** —— 会变成「能选中却看不见」的幽灵目标。
        if (_queue is not null)
        {
            HashSet<string> known = [.. all.Select(c => c.Guid.ToString())];
            foreach (Character c in _queue.HardnessTime.Keys.Concat(_queue.AllCharacters))
            {
                if (known.Add(c.Guid.ToString())) all.Add(c);
            }
        }
        List<Character> eliminated = _queue?.Eliminated ?? [];
        string? playerGuid = _player?.Guid.ToString();

        List<QueueEntryDto> queueEntries = [];
        if (_queue is not null)
        {
            int order = 0;
            foreach (Character c in _queue.HardnessTime.OrderBy(kv => kv.Value).Select(kv => kv.Key))
            {
                // 已死亡（未复活）的角色不参与后续行动，不出现在行动顺序表中；复活后会重新入队并再次显示
                if (eliminated.Contains(c)) continue;
                _queue.HardnessTime.TryGetValue(c, out double ht);
                queueEntries.Add(new QueueEntryDto(
                    c.Guid.ToString(), c.ToStringWithLevel(), ht, order++,
                    c.Guid.ToString() == playerGuid, TeamNameOf(c)));
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
            [.. all.Select(c => SoloGameMapper.ToCharacter(c, _map, playerGuid, _queue, eliminated, TeamNameOf(c)))],
            queueEntries,
            SoloGameMapper.ToDP(dp),
            playerGuid,
            _currentActor?.Guid.ToString(),
            rewards,
            _aiEscalated,
            BuildTeamsSnapshot(),
            _teamMode,
            _maxScoreToWin,
            _paused);
    }

    /// <summary>角色所属队伍名（团队模式；混战返回 null）</summary>
    private string? TeamNameOf(Character c)
    {
        string? own = _teamQueue?.GetTeam(c)?.Name;
        if (own is not null) return own;
        // Core / 模组派生出来的单位（例：Oshima「雇佣兵团」召唤的雇佣兵）自身不在队伍名单里，
        // 按召唤者的队伍归属，否则 UI 会把它们显示成「无阵营」。
        Character? owner = c.Master;
        return owner is null ? null : _teamQueue?.GetTeam(owner)?.Name;
    }

    /// <summary>团队快照：己方恒为「蓝队」，含比分与存活人数</summary>
    private List<TeamDto>? BuildTeamsSnapshot()
    {
        TeamGamingQueue? tq = _teamQueue;
        if (tq is null || tq.Teams.Count == 0) return null;
        List<TeamDto> list = [];
        foreach (Team team in tq.Teams.Values)
        {
            list.Add(new TeamDto(
                team.Name,
                team.Score,
                team.GetActiveCharacters().Count,
                team.Count,
                team.Name == _playerTeamName,
                [.. team.Members.Select(c => c.Guid.ToString())]));
        }
        // 己方（蓝队）排在最前，方便 UI 直接取用
        list.Sort((a, b) => a.IsPlayerTeam == b.IsPlayerTeam ? string.CompareOrdinal(a.Name, b.Name) : a.IsPlayerTeam ? -1 : 1);
        return list;
    }

    public List<RankingDto> BuildRanking()
    {
        List<RankingDto> list = [];
        if (_queue is null) return list;

        HashSet<string> winners = [];
        foreach (RankingEntry entry in _queue.LastRound?.GameResult ?? [])
        {
            if (!entry.IsWinner) continue;
            if (entry.Character is not null) winners.Add(entry.Character.Guid.ToString());
            if (entry.Team is not null)
            {
                foreach (Character member in entry.Team.Members) winners.Add(member.Guid.ToString());
            }
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
                s.LiveRound, s.ActionTurn, s.LiveTime,
                TeamNameOf(c) ?? ""));
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
    /// <summary>最大复活次数：0 = 不复活；-1 = 无限复活（团队死亡竞赛用）</summary>
    public int MaxRespawnTimes { get; set; } = -1;
    /// <summary>团队模式（红蓝 5V5）。关闭则为原有混战模式</summary>
    public bool TeamMode { get; set; } = true;
    /// <summary>每队人数（团队模式下默认 5 ⇒ 5V5）</summary>
    public int TeamSize { get; set; } = 5;
    /// <summary>死亡竞赛夺冠人头数（团队比分先到者获胜；0 = 不用比分判定）</summary>
    public int MaxScoreToWin { get; set; } = 10;
    /// <summary>单个决策的等待上限。超时即把玩家角色交 AI 托管，保证回合一定能推进（外层限时）</summary>
    public int DecisionTimeoutSeconds { get; set; } = 30;
    public bool RequireContinue { get; set; } = false;
    public int RoundDelayMs { get; set; } = 250;
    /// <summary>初始装备品质（QualityType：0白 1绿 2蓝 3紫 4橙 5红，5=红及以上）。开局空投按此品质发放</summary>
    public int InitialItemQuality { get; set; } = 0;
    /// <summary>空投轮换间隔（游戏时间秒，与 FunGameSimulation 的 nextDropTime 计时一致）：每 N 秒再空投一次并把品质 +1（封顶 5）；0 = 关闭轮换空投</summary>
    public int DropItemsIntervalSeconds { get; set; } = 40;
    /// <summary>
    /// 回合看门狗诊断开关（默认关闭）。开启后，若某个回合的 ProcessTurn 超过 15s 未返回，
    /// 每 2s 把当前角色的引擎状态追加写入 bin 目录下的 turn-diag.log，用于定位引擎内死循环。
    /// 关闭时不会创建定时器、不写任何文件。
    /// </summary>
    public bool EnableTurnDiagnostics { get; set; } = false;
    /// <summary>随机种子；为 null 时引擎自动随机。指定后同种子可复现整局（便于复现偶发卡死）</summary>
    public int? Seed { get; set; } = null;
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

    /// <summary>
    /// 钳制过大的射程：本图仅 12×12，曼哈顿距离达到 (长-1)+(宽-1) 即可覆盖全图。
    /// 引擎默认实现按 O(range²) 遍历 —— 实测出现过 range=144（某物品/技能的"全图"射程），
    /// 单次调用约 8.4 万次迭代；该调用位于回合内层决策循环中，被高频重复时对局近乎停滞
    /// （看门狗实测 100+ 秒不返回，CPU 100%）。这里把射程上限压到"刚好覆盖全图"。
    /// </summary>
    public override List<Grid> GetGridsByRange(Grid grid, int range, bool includeCharacter = false)
    {
        int maxUseful = (Length - 1) + (Width - 1);
        return base.GetGridsByRange(grid, Math.Min(range, maxUseful), includeCharacter);
    }

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
