using System.IO.Compression;
using System.Text.Json;
using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.Framework;

namespace Milimoe.FunGameTesting.Tests;

/// <summary>
/// 回合档案（rounds_archive.zip）写入容错的回归测试。
/// <para/>
/// 覆盖 <see cref="FunGameSimulation.WriteRoundsToZip"/> 的两层保护：
/// ①正常档案的 JSON 形状不变、仍能被 <see cref="FunGameSimulation.ReadRoundsFromZip"/> 读回；
/// ②单个回合序列化失败只跳过该回合并记入 rounds_skipped.json，不污染主 JSON、不连带丢弃整局。
/// </summary>
public static class RoundArchiveTest
{
    private const int Total = 3;
    private static int _failures;

    public static int RunAllTests()
    {
        _failures = 0;
        Run("正常档案写入后可按原形状读回", NormalArchiveRoundTrip);
        Run("单个坏回合被跳过且不污染主 JSON", BadRoundIsSkipped);
        Run("全部回合失败时仍产出合法空档案", AllRoundsSkipped);
        Console.WriteLine($"RoundArchive: {Total - _failures}/{Total} passed");
        return _failures;
    }

    private static void NormalArchiveRoundTrip()
    {
        Character actor = new() { Name = "甲", Guid = Guid.NewGuid() };
        Skill first = new OpenSkill(6007, "应急装置", []);
        Skill second = new OpenSkill(1010, "金刚击", []);
        Dictionary<int, RoundRecord> rounds = new()
        {
            [1] = MakeRound(1, actor, first, "-81 EP"),
            [2] = MakeRound(2, actor, second, "-20 EP")
        };

        string zip = NewZipPath();
        try
        {
            List<(int Round, string Error)> skipped = FunGameSimulation.WriteRoundsToZip(rounds, zip);
            Check(skipped.Count == 0, $"正常回合被误跳过 {skipped.Count} 个");

            Dictionary<int, RoundRecord>? restored = FunGameSimulation.ReadRoundsFromZip(zip);
            Check(restored != null, "档案无法读回");
            Check(restored!.Count == 2 && restored.ContainsKey(1) && restored.ContainsKey(2), "回合条目不完整");
            Check(restored[1].Damages.Values.Single() == 10, "回合 1 的伤害记录丢失");
            Check(restored[2].SkillsCost.Keys.Single().GetIdName() == second.GetIdName(), "回合 2 的成本归属丢失");
            Check(restored[1].Actor?.Guid == actor.Guid, "角色引用丢失");
            Check(!ZipEntries(zip).Contains("rounds_skipped.json"), "没有坏回合却生成了 rounds_skipped.json");
        }
        finally { Cleanup(zip); }
    }

    private static void BadRoundIsSkipped()
    {
        Character actor = new() { Name = "甲", Guid = Guid.NewGuid() };
        Skill skill = new OpenSkill(6007, "应急装置", []);
        RoundRecord broken = MakeRound(2, actor, skill, "-81 EP");
        // 故障注入：目标列表为 null 会让引用写入在中途抛 NullReferenceException，
        // 用来验证「坏回合不会在主 JSON 里留下半截对象」。
        broken.Targets[CharacterActionType.CastSkill] = null!;
        Dictionary<int, RoundRecord> rounds = new()
        {
            [1] = MakeRound(1, actor, skill, "-81 EP"),
            [2] = broken,
            [3] = MakeRound(3, actor, skill, "-81 EP")
        };

        string zip = NewZipPath();
        try
        {
            List<(int Round, string Error)> skipped = FunGameSimulation.WriteRoundsToZip(rounds, zip);
            Check(skipped.Count == 1 && skipped[0].Round == 2, $"跳过记录不正确：{string.Join(",", skipped)}");
            Check(skipped[0].Error.Length > 0, "跳过原因缺失");

            string json = ReadEntry(zip, "rounds_data.json");
            Check(!json.Contains("\"2\":"), "坏回合在主 JSON 里留下了残缺对象");
            using (JsonDocument doc = JsonDocument.Parse(json))
            {
                Check(doc.RootElement.ValueKind == JsonValueKind.Object, "主 JSON 结构被破坏");
                Check(doc.RootElement.EnumerateObject().Select(p => p.Name).SequenceEqual(["1", "3"]), "好回合被连带丢弃");
            }

            string skippedJson = ReadEntry(zip, "rounds_skipped.json");
            using (JsonDocument doc = JsonDocument.Parse(skippedJson))
            {
                Check(doc.RootElement.GetArrayLength() == 1, "rounds_skipped.json 条数不正确");
                JsonElement item = doc.RootElement[0];
                Check(item.GetProperty("Round").GetInt32() == 2, "rounds_skipped.json 回合号不正确");
                Check(item.GetProperty("Error").GetString()!.Contains("Exception"), "rounds_skipped.json 缺少异常类型");
            }

            Dictionary<int, RoundRecord>? restored = FunGameSimulation.ReadRoundsFromZip(zip);
            Check(restored != null && restored.Count == 2 && !restored.ContainsKey(2), "跳过坏回合后其余回合不可读");
        }
        finally { Cleanup(zip); }
    }

    private static void AllRoundsSkipped()
    {
        Character actor = new() { Name = "甲", Guid = Guid.NewGuid() };
        RoundRecord broken1 = MakeRound(1, actor, new OpenSkill(6007, "应急装置", []), "-81 EP");
        broken1.Targets[CharacterActionType.NormalAttack] = null!;
        RoundRecord broken2 = MakeRound(2, actor, new OpenSkill(6007, "应急装置", []), "-81 EP");
        broken2.Targets[CharacterActionType.NormalAttack] = null!;
        Dictionary<int, RoundRecord> rounds = new() { [1] = broken1, [2] = broken2 };

        string zip = NewZipPath();
        try
        {
            List<(int Round, string Error)> skipped = FunGameSimulation.WriteRoundsToZip(rounds, zip);
            Check(skipped.Count == 2, $"全部回合都应被跳过，实际 {skipped.Count}");
            string json = ReadEntry(zip, "rounds_data.json");
            using (JsonDocument doc = JsonDocument.Parse(json))
            {
                Check(doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.EnumerateObject().Count() == 0, "主 JSON 不是合法空对象");
            }
            Dictionary<int, RoundRecord>? restored = FunGameSimulation.ReadRoundsFromZip(zip);
            Check(restored != null && restored.Count == 0, "空档案无法读回");
        }
        finally { Cleanup(zip); }
    }

    private static RoundRecord MakeRound(int round, Character actor, Skill skill, string cost)
    {
        RoundRecord record = new(round) { Actor = actor };
        record.AllCharacters.Add(actor);
        record.Damages[actor] = 10 * round;
        record.Skills[CharacterActionType.CastSkill] = skill;
        record.SkillsCost[skill] = cost;
        record.ActionTypes.Add(CharacterActionType.CastSkill);
        return record;
    }

    private static string NewZipPath()
        => Path.Combine(Path.GetTempPath(), $"fungame-rounds-{Guid.NewGuid():N}", "rounds_archive.zip");

    private static List<string> ZipEntries(string zip)
    {
        using FileStream stream = new(zip, FileMode.Open, FileAccess.Read);
        using ZipArchive archive = new(stream, ZipArchiveMode.Read);
        return [.. archive.Entries.Select(e => e.FullName)];
    }

    private static string ReadEntry(string zip, string name)
    {
        using FileStream stream = new(zip, FileMode.Open, FileAccess.Read);
        using ZipArchive archive = new(stream, ZipArchiveMode.Read);
        ZipArchiveEntry entry = archive.GetEntry(name) ?? throw new InvalidOperationException($"档案中缺少 {name}");
        using Stream entryStream = entry.Open();
        using StreamReader reader = new(entryStream);
        return reader.ReadToEnd();
    }

    private static void Cleanup(string zip)
    {
        try
        {
            string? directory = Path.GetDirectoryName(zip);
            if (!string.IsNullOrEmpty(directory) && Directory.Exists(directory)) Directory.Delete(directory, true);
        }
        catch { /* 临时目录清理失败不影响断言 */ }
    }

    private static void Run(string name, Action test)
    {
        try { test(); Console.WriteLine($"[PASS] {name}"); }
        catch (Exception ex) { _failures++; Console.WriteLine($"[FAIL] {name}: {ex}"); }
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
