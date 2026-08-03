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
