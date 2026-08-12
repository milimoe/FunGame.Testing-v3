using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FunGame.Core.Api;
using FunGame.Core.Entity;
using FunGame.Core.Model.Framework;
using FunGame.Core.Model.Queue;
using Milimoe.FunGameTesting.OshimaGameModules.Skills;

namespace Milimoe.FunGameTesting.Tests
{
    /// <summary>
    /// 即时主动 POST 外发数据包（DefaultRoundRecordSink）测试
    /// 使用 HttpListener 启动本地模拟服务器，验证握手签名、intents 过滤与各事件的外发格式
    /// </summary>
    public class RoundRecordSinkTest
    {
        /// <summary>
        /// 失败计数
        /// </summary>
        private static int _failures = 0;

        /// <summary>
        /// 本地模拟服务器（接收 POST 并记录 RoundRecordPayload）
        /// </summary>
        private class MockServer : IDisposable
        {
            public HttpListener Listener { get; }
            public int Port { get; }
            public string Url { get; }
            public List<RoundRecordPayload> Payloads { get; } = [];
            public List<string> Authorizations { get; } = [];
            public string Secret { get; set; } = "";
            public bool RespondCorrectHash { get; set; } = true;

            private readonly Lock _lock = new();
            private readonly Task _loop;
            private bool _disposed = false;

            public MockServer()
            {
                Port = Random.Shared.Next(20000, 60000);
                Url = $"http://127.0.0.1:{Port}/";
                Listener = new HttpListener();
                Listener.Prefixes.Add(Url);
                Listener.Start();
                _loop = Task.Run(ListenLoop);
            }

            public void WaitForPayloads(int count, int timeoutMs = 10000)
            {
                DateTime start = DateTime.Now;
                while (Payloads.Count < count)
                {
                    if ((DateTime.Now - start).TotalMilliseconds > timeoutMs)
                    {
                        break;
                    }
                    Thread.Sleep(20);
                }
            }

            private async Task ListenLoop()
            {
                while (!_disposed)
                {
                    HttpListenerContext context;
                    try
                    {
                        context = await Listener.GetContextAsync();
                    }
                    catch
                    {
                        // 监听器已停止
                        break;
                    }
                    _ = Handle(context);
                }
            }

            private async Task Handle(HttpListenerContext context)
            {
                try
                {
                    using StreamReader reader = new(context.Request.InputStream, Encoding.UTF8);
                    string body = await reader.ReadToEndAsync();
                    RoundRecordPayload? payload = JsonSerializer.Deserialize<RoundRecordPayload>(body, JsonService.GeneralOptions);
                    if (payload != null)
                    {
                        lock (_lock)
                        {
                            Payloads.Add(payload);
                        }
                    }
                    lock (_lock)
                    {
                        Authorizations.Add(context.Request.Headers["Authorization"] ?? "");
                    }

                    // 签名验证事件：返回期望哈希
                    if (payload?.E == RoundRecordSinkEventIds.VerifySignature && payload.D is JsonElement element && element.ValueKind == JsonValueKind.String)
                    {
                        string d = element.GetString() ?? "";
                        string key = d[..10] + d[^10..] + payload.T;
                        string expected = Convert.ToHexStringLower(HMACSHA512.HashData(Encoding.UTF8.GetBytes(key), Encoding.UTF8.GetBytes(Secret)));
                        byte[] response = Encoding.UTF8.GetBytes(RespondCorrectHash ? expected : "wrong-hash");
                        context.Response.StatusCode = 200;
                        context.Response.ContentType = "text/plain";
                        await context.Response.OutputStream.WriteAsync(response);
                    }
                    else
                    {
                        context.Response.StatusCode = 200;
                    }
                    context.Response.Close();
                }
                catch
                {
                    try
                    {
                        context.Response.StatusCode = 500;
                        context.Response.Close();
                    }
                    catch
                    {
                    }
                }
            }

            public void Dispose()
            {
                if (_disposed)
                {
                    return;
                }
                _disposed = true;
                Listener.Stop();
                Listener.Close();
            }
        }

        /// <summary>
        /// 运行全部测试
        /// </summary>
        public static async Task RunAllTests()
        {
            _failures = 0;
            Console.WriteLine("=== RoundRecordSink 测试开始 ===");
            await TestNoSecret();
            await TestHandshakeSuccess();
            await TestHandshakeRetry();
            await TestIntentsFilter();
            await TestAccessToken();
            await TestTeamMode();
            Console.WriteLine($"=== RoundRecordSink 测试结束（失败 {_failures} 项） ===");
        }

        /// <summary>
        /// 测试 1：secret 为空时不握手，直接外发，s 为空字符串
        /// </summary>
        private static async Task TestNoSecret()
        {
            Console.WriteLine("--- 测试 1：secret 为空 ---");
            using MockServer server = new();
            using DefaultRoundRecordSink sink = new(server.Url,
            [
                RoundRecordSinkEventIds.Action, RoundRecordSinkEventIds.Round, RoundRecordSinkEventIds.CheckpointRound,
                RoundRecordSinkEventIds.QueueData, RoundRecordSinkEventIds.EliminatedCharacters, RoundRecordSinkEventIds.CharacterStatistics,
                RoundRecordSinkEventIds.Characters, RoundRecordSinkEventIds.Teams, RoundRecordSinkEventIds.EliminatedTeams
            ]);

            List<Character> characters = CreateCharacters();
            MixGamingQueue queue = CreateMixQueue(characters);
            queue.CheckpointInterval = 3;
            queue.RoundRecordSink = sink;
            Guid queueGuid = queue.Guid;

            await RunGame(queue, 24);
            server.WaitForPayloads(1);
            await Task.Delay(500);

            Check(server.Payloads.Count == 0 || !server.Payloads.Any(p => p.E == RoundRecordSinkEventIds.VerifySignature), "secret 为空时不发送事件 13");
            Check(server.Payloads.Count > 0, "secret 为空时事件直接外发", $"收到 {server.Payloads.Count} 个 payload");
            Check(server.Payloads.All(p => p.S == ""), "s 属性为空字符串");
            Check(server.Payloads.All(p => p.G == queueGuid), "g 属性为 GamingQueue 的 Guid");
            Check(server.Payloads.All(p => p.T > 0), "t 属性为有效时间戳");
            Check(server.Payloads.Any(p => p.E == RoundRecordSinkEventIds.Action), "收到操作事件 0");
            Check(server.Payloads.Any(p => p.E == RoundRecordSinkEventIds.Round), "收到当前回合数据事件 1");
            Check(server.Payloads.Any(p => p.E == RoundRecordSinkEventIds.QueueData), "收到行动顺序表事件 6");
            Check(server.Payloads.Any(p => p.E == RoundRecordSinkEventIds.EliminatedCharacters), "收到淘汰角色名单事件 7");
            Check(server.Payloads.Any(p => p.E == RoundRecordSinkEventIds.CharacterStatistics), "收到统计数据事件 3");
            Check(server.Payloads.Any(p => p.E == RoundRecordSinkEventIds.Characters), "收到全角色事件 4");
            Check(server.Payloads.Any(p => p.E == RoundRecordSinkEventIds.Teams), "收到团队事件 5（非团队模式为空数组）");
            Check(server.Payloads.Any(p => p.E == RoundRecordSinkEventIds.CheckpointRound), "收到检查点回合事件 2（CheckpointInterval=3）");

            // 数据格式抽查
            RoundRecordPayload? action = server.Payloads.FirstOrDefault(p => p.E == RoundRecordSinkEventIds.Action);
            Check(action?.D is JsonElement a && a.ValueKind == JsonValueKind.Object && a.TryGetProperty("Round", out _) && a.TryGetProperty("ActionType", out _), "事件 0 的 d 为 ActionRecord 结构");
            RoundRecordPayload? queueData = server.Payloads.FirstOrDefault(p => p.E == RoundRecordSinkEventIds.QueueData);
            Check(queueData?.D is JsonElement q && q.ValueKind == JsonValueKind.Object, "事件 6 的 d 为行动顺序表对象");
            RoundRecordPayload? eliminated = server.Payloads.FirstOrDefault(p => p.E == RoundRecordSinkEventIds.EliminatedCharacters);
            Check(eliminated?.D is JsonElement e7 && e7.ValueKind == JsonValueKind.Array, "事件 7 的 d 为角色 Guid 数组");
            RoundRecordPayload? stats = server.Payloads.FirstOrDefault(p => p.E == RoundRecordSinkEventIds.CharacterStatistics);
            Check(stats?.D is JsonElement s3 && s3.ValueKind == JsonValueKind.Object, "事件 3 的 d 为统计数据字典");
            RoundRecordPayload? charactersPayload = server.Payloads.FirstOrDefault(p => p.E == RoundRecordSinkEventIds.Characters);
            Check(charactersPayload?.D is JsonElement c4 && c4.ValueKind == JsonValueKind.Array && c4.GetArrayLength() == characters.Count, "事件 4 的 d 为全部角色数组");
            RoundRecordPayload? teams = server.Payloads.FirstOrDefault(p => p.E == RoundRecordSinkEventIds.Teams);
            Check(teams?.D is JsonElement t5 && t5.ValueKind == JsonValueKind.Array && t5.GetArrayLength() == 0, "非团队模式事件 5 的 d 为空数组");
            RoundRecordPayload? checkpoint = server.Payloads.FirstOrDefault(p => p.E == RoundRecordSinkEventIds.CheckpointRound);
            Check(checkpoint?.D is JsonElement cp && cp.ValueKind == JsonValueKind.Object && cp.TryGetProperty("Checkpoint", out _), "事件 2 的 d 为附带检查点的回合记录");

            queue.RoundRecordSink = null;
        }

        /// <summary>
        /// 测试 2：secret 非空且服务器返回正确哈希时，先握手成功，后续事件携带签名
        /// </summary>
        private static async Task TestHandshakeSuccess()
        {
            Console.WriteLine("--- 测试 2：签名验证握手成功 ---");
            const string secret = "test-secret-123";
            using MockServer server = new() { Secret = secret };
            using DefaultRoundRecordSink sink = new(server.Url, [RoundRecordSinkEventIds.Action, RoundRecordSinkEventIds.Round, RoundRecordSinkEventIds.VerifySignature])
            {
                Secret = secret,
                HandshakeRetryIntervalSeconds = 1
            };

            List<Character> characters = CreateCharacters();
            MixGamingQueue queue = CreateMixQueue(characters);
            queue.RoundRecordSink = sink;

            await RunGame(queue, 20);
            server.WaitForPayloads(1);
            await Task.Delay(500);

            RoundRecordPayload? first = server.Payloads.FirstOrDefault();
            Check(first != null && first.E == RoundRecordSinkEventIds.VerifySignature, "第一个事件为签名验证事件 13");
            if (first != null && first.D is JsonElement d && d.ValueKind == JsonValueKind.String)
            {
                string expectedD = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(secret)));
                Check(d.GetString() == expectedD, "事件 13 的 d 为 secret 的 SHA256 哈希值");
                Check(first.S == "", "事件 13 的 s 为空字符串");
                // 期望签名：HMAC-SHA512(key = d 前 10 + 后 10 字符 + t 值, message = secret)
                string key = expectedD[..10] + expectedD[^10..] + first.T;
                string expected = Convert.ToHexStringLower(HMACSHA512.HashData(Encoding.UTF8.GetBytes(key), Encoding.UTF8.GetBytes(secret)));
                Check(server.Payloads.Skip(1).All(p => p.S == expected), "握手成功后的事件 s 携带协议签名");
            }
            Check(server.Payloads.Count(p => p.E == RoundRecordSinkEventIds.VerifySignature) == 1, "握手成功后不再重发事件 13", $"收到 {server.Payloads.Count(p => p.E == RoundRecordSinkEventIds.VerifySignature)} 个");
            Check(server.Payloads.Any(p => p.E == RoundRecordSinkEventIds.Action), "握手成功后外发操作事件 0");
            Check(server.Payloads.Any(p => p.E == RoundRecordSinkEventIds.Round), "握手成功后外发当前回合数据事件 1");
            Check(!server.Payloads.Any(p => p.E == RoundRecordSinkEventIds.QueueData), "intents 未包含的事件 6 不外发");

            queue.RoundRecordSink = null;
        }

        /// <summary>
        /// 测试 3：服务器返回错误哈希时，其他事件不外发，并按间隔重发事件 13，直到成功
        /// </summary>
        private static async Task TestHandshakeRetry()
        {
            Console.WriteLine("--- 测试 3：签名验证失败重试 ---");
            const string secret = "retry-secret";
            using MockServer server = new() { Secret = secret, RespondCorrectHash = false };
            using DefaultRoundRecordSink sink = new(server.Url, [RoundRecordSinkEventIds.Action, RoundRecordSinkEventIds.VerifySignature])
            {
                Secret = secret,
                HandshakeRetryIntervalSeconds = 1
            };

            List<Character> characters = CreateCharacters();
            MixGamingQueue queue = CreateMixQueue(characters);
            queue.RoundRecordSink = sink;

            await RunGame(queue, 10);
            server.WaitForPayloads(3);
            Check(server.Payloads.Count(p => p.E == RoundRecordSinkEventIds.VerifySignature) >= 3, "验证失败后按间隔重发事件 13", $"收到 {server.Payloads.Count(p => p.E == RoundRecordSinkEventIds.VerifySignature)} 个");
            Check(!server.Payloads.Any(p => p.E == RoundRecordSinkEventIds.Action), "验证成功前其他事件不外发");

            // 服务器恢复正确响应，等待下一次握手重试成功后再继续跑游戏
            server.RespondCorrectHash = true;
            await Task.Delay(2000);
            int rounds2 = await RunGame(queue, 10);
            server.WaitForPayloads(server.Payloads.Count + 1);
            DateTime start = DateTime.Now;
            while (!server.Payloads.Any(p => p.E == RoundRecordSinkEventIds.Action) && (DateTime.Now - start).TotalMilliseconds < 8000)
            {
                await Task.Delay(50);
            }
            Check(server.Payloads.Any(p => p.E == RoundRecordSinkEventIds.Action), "握手成功后恢复外发其他事件", $"第二轮跑了 {rounds2} 回合，GameOver={queue.GameOver}");
            Check(server.Payloads.Where(p => p.E == RoundRecordSinkEventIds.Action).All(p => p.S != ""), "握手成功后的事件携带签名");

            queue.RoundRecordSink = null;
        }

        /// <summary>
        /// 测试 4：intents 过滤只外发指定事件
        /// </summary>
        private static async Task TestIntentsFilter()
        {
            Console.WriteLine("--- 测试 4：intents 过滤 ---");
            using MockServer server = new();
            using DefaultRoundRecordSink sink = new(server.Url, [RoundRecordSinkEventIds.Action]);

            List<Character> characters = CreateCharacters();
            MixGamingQueue queue = CreateMixQueue(characters);
            queue.RoundRecordSink = sink;

            await RunGame(queue, 15);
            server.WaitForPayloads(1);
            await Task.Delay(500);

            Check(server.Payloads.Count > 0, "配置的事件 0 正常外发", $"收到 {server.Payloads.Count} 个");
            Check(server.Payloads.All(p => p.E == RoundRecordSinkEventIds.Action), "仅外发 intents 指定的事件 0");

            queue.RoundRecordSink = null;
        }

        /// <summary>
        /// 测试 5：accessToken 以 Bearer 方式随请求发送
        /// </summary>
        private static async Task TestAccessToken()
        {
            Console.WriteLine("--- 测试 5：accessToken ---");
            const string token = "my-access-token";
            using MockServer server = new();
            using DefaultRoundRecordSink sink = new(server.Url, [RoundRecordSinkEventIds.Action])
            {
                AccessToken = token
            };

            List<Character> characters = CreateCharacters();
            MixGamingQueue queue = CreateMixQueue(characters);
            queue.RoundRecordSink = sink;

            await RunGame(queue, 10);
            server.WaitForPayloads(1);
            await Task.Delay(500);

            Check(server.Authorizations.Count > 0 && server.Authorizations.All(a => a == $"Bearer {token}"), "POST 请求携带 Bearer accessToken", $"Authorization 示例：{server.Authorizations.FirstOrDefault()}");

            queue.RoundRecordSink = null;
        }

        /// <summary>
        /// 测试 6：团队模式下事件 5 外发团队完整数据
        /// </summary>
        private static async Task TestTeamMode()
        {
            Console.WriteLine("--- 测试 6：团队模式 ---");
            using MockServer server = new();
            using DefaultRoundRecordSink sink = new(server.Url, [RoundRecordSinkEventIds.Teams, RoundRecordSinkEventIds.EliminatedTeams, RoundRecordSinkEventIds.Characters]);

            List<Character> characters = CreateCharacters();
            TeamGamingQueue queue = CreateTeamQueue(characters);
            queue.RoundRecordSink = sink;

            await RunGame(queue, 20);
            server.WaitForPayloads(1);
            await Task.Delay(500);

            RoundRecordPayload? teams = server.Payloads.FirstOrDefault(p => p.E == RoundRecordSinkEventIds.Teams);
            Check(teams?.D is JsonElement t && t.ValueKind == JsonValueKind.Array && t.GetArrayLength() == 2, "团队模式事件 5 的 d 为两个团队的完整数据");
            if (teams?.D is JsonElement t2 && t2.ValueKind == JsonValueKind.Array && t2.GetArrayLength() > 0)
            {
                JsonElement first = t2[0];
                Check(first.TryGetProperty("Name", out _) && first.TryGetProperty("Members", out _), "团队数据包含 Name 与 Members");
            }
            RoundRecordPayload? eliminatedTeams = server.Payloads.FirstOrDefault(p => p.E == RoundRecordSinkEventIds.EliminatedTeams);
            Check(eliminatedTeams?.D is JsonElement et && et.ValueKind == JsonValueKind.Array, "事件 8 的 d 为团队 Name 数组");

            queue.RoundRecordSink = null;
        }

        /// <summary>
        /// 创建测试用角色（10 级、2 级技能）
        /// </summary>
        private static List<Character> CreateCharacters()
        {
            List<Character> list = [.. FunGameService.Characters.Select(c => c.Copy())];
            List<Character> characters = [.. list.OrderBy(o => Random.Shared.Next()).Take(8)];
            foreach (Character c in characters)
            {
                c.Level = 10;
                c.NormalAttack.Level = 2;
                FunGameService.AddCharacterSkills(c, 1, 2, 2);
                foreach (Skill skillLoop in FunGameService.Skills.Where(s => s is not 疾走).OrderBy(o => Random.Shared.Next()).Take(2))
                {
                    Skill skill = skillLoop.Copy();
                    skill.Character = c;
                    skill.Level = 2;
                    c.Skills.Add(skill);
                }
                foreach (Skill skillLoop in FunGameService.CommonPassiveSkills.OrderBy(o => Random.Shared.Next()).Take(2))
                {
                    Skill passive = skillLoop.Copy();
                    passive.Character = c;
                    passive.Level = 1;
                    c.Skills.Add(passive);
                }
                foreach (Skill skillLoop in FunGameService.CommonSuperSkills.OrderBy(o => Random.Shared.Next()).Take(2))
                {
                    Skill super = skillLoop.Copy();
                    super.Character = c;
                    super.Level = 2;
                    c.Skills.Add(super);
                }
            }
            return characters;
        }

        /// <summary>
        /// 创建混战模式队列
        /// </summary>
        private static MixGamingQueue CreateMixQueue(List<Character> characters)
        {
            MixGamingQueue queue = new(characters, s => { })
            {
                MaxRespawnTimes = 1,
                UseQueueProtected = false
            };
            queue.InitActionQueue();
            queue.SetCharactersToAIControl(false, characters);
            return queue;
        }

        /// <summary>
        /// 创建团队模式队列（随机分成两个团队）
        /// </summary>
        private static TeamGamingQueue CreateTeamQueue(List<Character> characters)
        {
            TeamGamingQueue queue = new(characters, s => { })
            {
                MaxRespawnTimes = -1,
                MaxScoreToWin = 30,
                UseQueueProtected = false
            };
            queue.InitActionQueue();
            queue.SetCharactersToAIControl(false, characters);
            List<Character> group1 = [];
            List<Character> group2 = [];
            for (int index = 0; index < characters.Count; index++)
            {
                if (index % 2 == 0)
                {
                    group1.Add(characters[index]);
                }
                else
                {
                    group2.Add(characters[index]);
                }
            }
            queue.AddTeam($"{group1.First()}的小队", group1);
            queue.AddTeam($"{group2.First()}的小队", group2);
            return queue;
        }

        /// <summary>
        /// 运行有限回合的游戏模拟
        /// </summary>
        private static async Task<int> RunGame(GamingQueue queue, int maxRound)
        {
            int round = 0;
            while (round < maxRound && !queue.GameOver)
            {
                Character? character = queue.NextCharacter();
                if (character == null)
                {
                    break;
                }
                queue.ProcessTurn(character);
                queue.TimeLapse();
                round++;
                if (round % 5 == 0)
                {
                    await Task.Delay(50);
                }
            }
            return round;
        }

        /// <summary>
        /// 断言检查
        /// </summary>
        private static void Check(bool condition, string name, string detail = "")
        {
            string status = condition ? "PASS" : "FAIL";
            Console.WriteLine($"[{status}] {name}" + (detail != "" ? $"（{detail}）" : ""));
            if (!condition)
            {
                _failures++;
            }
        }
    }
}
