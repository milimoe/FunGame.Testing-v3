using FunGame.Core.Entity;
using Milimoe.FunGameTesting.OshimaGameModules;
using Milimoe.FunGameTesting.Tests;

Console.WriteLine("Hello, World!");

CharacterModule cm = new();
cm.Load();
SkillModule sm = new();
sm.Load();
ItemModule im = new();
im.Load();

FunGameService.InitFunGame();

Console.WriteLine("读取 rounds_archive.zip");
string zipFileName = "rounds_archive.zip";
Dictionary<int, FunGame.Core.Model.Framework.RoundRecord> record = FunGameSimulation.ReadRoundsFromZip(zipFileName) ?? [];
if (record.Count > 0)
{
    foreach (int i in record.Keys)
    {
        Console.WriteLine(record[i]);
    }
    Console.WriteLine($"=== 赛后数据 ===");
    Dictionary<Character, CharacterStatistics> characterStatistics = record.Values.Last().CharacterStatistics;
    foreach (Character statCharacter in characterStatistics
        .OrderBy(kv => kv.Value.Deaths)
        .ThenByDescending(kv => kv.Value.Rating)
        .ThenByDescending(kv => kv.Value.Kills).Select(kv => kv.Key))
    {
        CharacterStatistics stats = characterStatistics[statCharacter];
        Console.WriteLine($"[ {stats.Rating:0.0#} ]  {statCharacter}（{stats.Kills} / {stats.Assists} / {stats.Deaths}）");
    }
}

Console.WriteLine("上一次战斗记录加载完毕");
Console.ReadLine();

while (true)
{
    FunGameSimulation.IsDebug = true;
    DateTime start = DateTime.Now;
    await FunGameSimulation.StartSimulationGame(true, false, true, false, useStore: false, hasMap: false);
    DateTime end = DateTime.Now;
    Console.WriteLine("模拟时长" + (end - start).TotalSeconds + "秒");
    ConsoleKeyInfo key = Console.ReadKey();
    if (key.Key == ConsoleKey.Escape)
    {
        break;
    }
    await Task.Delay(1);
    start = DateTime.Now;
    await FunGameSimulation.StartSimulationGame(true, false, false, false, hasMap: false);
    end = DateTime.Now;
    Console.WriteLine("模拟时长" + (end - start).TotalSeconds + "秒");
    key = Console.ReadKey();
    if (key.Key == ConsoleKey.Escape)
    {
        break;
    }
    //await FunGameSimulation.StartSimulationGame(false, false, true, false, useStore: false, hasMap: false);
    //await Task.Delay(1);
    //await FunGameSimulation.StartSimulationGame(false, false, false, false, hasMap: false);
}
