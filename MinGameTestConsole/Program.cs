using Milimoe.FunGameTesting.OshimaGameModules;
using Milimoe.FunGameTesting.Tests;

CharacterModule characterModule = new();
characterModule.Load();
SkillModule skillModule = new();
skillModule.Load();
ItemModule itemModule = new();
itemModule.Load();
FunGameService.InitFunGame();

while (true)
{
    int seed = 0;
    Console.WriteLine("Input a seed to start a simulation (empty for random) or 'quit' to exit:");
    string input = await Console.In.ReadLineAsync() ?? "";
    if (input == "quit")
    {
        break;
    }
    if (input != "" && !int.TryParse(input, out seed))
    {
        Console.WriteLine("Invalid seed.");
        continue;
    }

    try
    {
        FunGameSimulation.IsDebug = true;
        FunGameSimulation.SeedOverride = seed;

        DateTime start = DateTime.Now;

        await Task.Run(async () => await FunGameSimulation.StartSimulationGame(printout: true, isWeb: true, isTeam: true, deathMatchRoundDetail: false, hasMap: false));
        double elapsed = (DateTime.Now - start).TotalSeconds;

        Console.WriteLine($"Seed: {seed}; Total Cost: {elapsed} seconds");
    }
    catch (Exception e)
    {
        Console.WriteLine(e);
    }
}
