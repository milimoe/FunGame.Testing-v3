using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;

namespace Milimoe.FunGameTesting.OshimaGameModules.Items
{
    public class 创生之印() : Item(ItemType.SpecialItem)
    {
        public override long Id => (long)SpecialItemID.创生之印;
        public override string Name => "创生之印";
        public override string Description => "角色突破等阶必备的终级材料。";
        public override QualityType QualityType => QualityType.Orange;
    }
}
