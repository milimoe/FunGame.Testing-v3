using System.Text;
using FunGame.Core.Api;
using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using Milimoe.FunGameTesting.OshimaGameModules.Characters;
using Milimoe.FunGameTesting.OshimaGameModules.Effects.OpenEffects;
using Milimoe.FunGameTesting.OshimaGameModules.Items;
using Milimoe.FunGameTesting.OshimaGameModules.Skills;
using Milimoe.FunGameTesting.Others;

namespace Milimoe.FunGameTesting.Tests
{
    public class FunGameService
    {
        public static List<Character> Characters { get; } = [];
        public static List<Skill> Skills { get; } = [];
        public static List<Skill> PassiveSkills { get; } = [];
        public static List<Skill> CommonPassiveSkills { get; } = [];
        public static List<Skill> SuperSkills { get; } = [];
        public static List<Skill> CommonSuperSkills { get; } = [];
        public static List<Skill> Magics { get; } = [];
        public static List<Item> Equipment { get; } = [];
        public static List<Item> Items { get; } = [];
        public static List<Skill> ItemSkills { get; } = [];
        public static List<Item> AllItems { get; } = [];
        public static List<Skill> AllSkills { get; } = [];

        public static void InitFunGame()
        {
            Characters.Add(new OshimaShiya());
            Characters.Add(new XinYin());
            Characters.Add(new Yang());
            Characters.Add(new NanGanYu());
            Characters.Add(new NiuNan());
            Characters.Add(new DokyoMayor());
            Characters.Add(new MagicalGirl());
            Characters.Add(new QingXiang());
            Characters.Add(new QWQAQW());
            Characters.Add(new ColdBlue());
            Characters.Add(new Dddovo());
            Characters.Add(new Quduoduo());
            Characters.Add(new ShiYu());
            Characters.Add(new XReouni());
            Characters.Add(new Neptune());
            Characters.Add(new CHAOS());
            Characters.Add(new Ryuko());
            Characters.Add(new TheGodK());

            Skills.AddRange([new 疾风步(), new 助威(), new 挑拨(), new 绞丝棍(), new 金刚击(), new 旋风轮(), new 双连击(), new 绝影(), new 胧(), new 魔眼(),
                new 天堂之吻(), new 回复弹(), new 养命功(), new 镜花水月(), new 剑风闪(), new 鲨鱼锚击(), new 疾走(), new 闪现()]);

            SuperSkills.AddRange([new 极寒渴望(), new 身心一境(), new 绝对领域(), new 零式灭杀(), new 三相灵枢(), new 变幻之心(), new 熵灭极诣(), new 残香凋零(), new 饕餮盛宴(),
                new 宿命时律(), new 千羽瞬华(), new 咒怨洪流(), new 放监(), new 归元环(), new 海王星的野望(), new 全军出击(), new 宿命之潮(), new 神之因果()]);

            PassiveSkills.AddRange([new META马(), new 心灵之弦(), new 蚀魂震击(), new 灵能反射(), new 双生流转(), new 零式崩解(), new 少女绮想(), new 暗香疏影(), new 破釜沉舟(),
                new 累积之压(), new 银隼之赐(), new 弱者猎手(), new 开宫(), new 八卦阵(), new 深海之戟(), new 雇佣兵团(), new 不息之流(), new 概念之骰()]);

            CommonPassiveSkills.AddRange([new 征服者(), new 致命节奏(), new 强攻(), new 电刑(), new 黑暗收割(), new 迅捷步法(), new 贪欲猎手()]);

            CommonSuperSkills.AddRange([new 樱花无双击(), new 漆黑之牙(), new 女王之怒(), new 裁决塔罗(), new 光明之环(), new 圣星光旋()]);

            Magics.AddRange([new 冰霜攻击(), new 火之矢(), new 水之矢(), new 风之轮(), new 石之锤(), new 心灵之霞(), new 次元上升(), new 暗物质(),
                new 回复术(), new 治愈术(), new 复苏术(), new 圣灵术(), new 时间加速(), new 时间减速(), new 反魔法领域(), new 沉默十字(), new 虚弱领域(), new 混沌烙印(), new 凝胶稠絮(),
                new 大地之墙(), new 盖亚之盾(), new 风之守护(), new 结晶防护(), new 强音之力(), new 神圣祝福(), new 根源屏障(), new 灾难冲击波(), new 银色荆棘(), new 等离子之波(),
                new 地狱之门(), new 钻石星尘(), new 死亡咆哮(), new 鬼魅之痛(), new 导力停止(), new 冰狱冥嚎(), new 火山咆哮(), new 水蓝轰炸(), new 岩石之息(), new 弧形日珥(), new 苍白地狱(), new 破碎虚空(),
                new 弧光消耗(), new 回复术改(), new 回复术复(), new 治愈术复(), new 风之守护复(), new 强音之力复(), new 结晶防护复(), new 神圣祝福复(), new 时间加速改(), new 时间减速改(), new 时间加速复(), new 时间减速复()]);

            Dictionary<string, Item> exItems = Factory.GetGameModuleInstances<Item>(OshimaGameModuleConstant.General, OshimaGameModuleConstant.Item);
            Equipment.AddRange(exItems.Values.Where(i => (int)i.ItemType >= 0 && (int)i.ItemType < 5));
            Equipment.AddRange([new 攻击之爪10(), new 攻击之爪25(), new 攻击之爪40(), new 攻击之爪55(), new 攻击之爪70(), new 攻击之爪85(), new 糖糖一周年纪念武器(),
                new 糖糖一周年纪念防具(), new 糖糖一周年纪念鞋子(), new 糖糖一周年纪念饰品1(), new 糖糖一周年纪念饰品2()]);

            Items.AddRange(exItems.Values.Where(i => (int)i.ItemType > 4));
            Items.AddRange([new 小经验书(), new 中经验书(), new 大经验书(), new 升华之印(), new 流光之印(), new 永恒之印(), new 技能卷轴(), new 智慧之果(), new 奥术符文(), new 混沌之核(),
                new 小回复药(), new 中回复药(), new 大回复药(), new 魔力填充剂1(), new 魔力填充剂2(), new 魔力填充剂3(), new 能量饮料1(), new 能量饮料2(), new 能量饮料3(), new 年夜饭(), new 蛇年大吉(), new 新春快乐(), new 毕业礼包(),
                new 复苏药1(), new 复苏药2(), new 复苏药3(), new 全回复药(), new 魔法卡礼包(), new 奖券(), new 十连奖券(), new 改名卡(), new 原初之印(), new 创生之印(), new 法则精粹(), new 大师锻造券(),
                new 一周年纪念礼包(), new 一周年纪念套装(), new 冬至快乐(), new 圣诞礼包(), new 元旦快乐()
            ]);

            AllItems.AddRange(Equipment);
            AllItems.AddRange(Items);

            Skill?[] activeSkills = [.. Equipment.Select(i => i.Skills.Active), .. Items.Select(i => i.Skills.Active)];
            foreach (Skill? skill in activeSkills)
            {
                if (skill != null)
                {
                    ItemSkills.Add(skill);
                }
            }
            ItemSkills.AddRange([.. Equipment.SelectMany(i => i.Skills.Passives), .. Items.SelectMany(i => i.Skills.Passives)]);

            AllSkills.AddRange(Magics);
            AllSkills.AddRange(Skills);
            AllSkills.AddRange(PassiveSkills);
            AllSkills.AddRange(CommonPassiveSkills);
            AllSkills.AddRange(ItemSkills);
            AllSkills.AddRange(SuperSkills);
            AllSkills.AddRange(CommonSuperSkills);
        }

        public static void Reload()
        {
            Characters.Clear();
            Equipment.Clear();
            Skills.Clear();
            SuperSkills.Clear();
            CommonSuperSkills.Clear();
            PassiveSkills.Clear();
            CommonPassiveSkills.Clear();
            Magics.Clear();
            AllItems.Clear();
            ItemSkills.Clear();
            AllSkills.Clear();
            InitFunGame();
        }

        public static void AddCharacterSkills(Character character, int passiveLevel, int skillLevel, int superLevel)
        {
            long id = character.Id;
            Math.Sign(skillLevel);
            if (id == 1)
            {
                Skill META马 = new META马(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(META马);

                Skill 熵灭极诣 = new 熵灭极诣(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(熵灭极诣);
            }

            if (id == 2)
            {
                Skill 心灵之弦 = new 心灵之弦(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(心灵之弦);

                Skill 千羽瞬华 = new 千羽瞬华(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(千羽瞬华);
            }

            if (id == 3)
            {
                Skill 蚀魂震击 = new 蚀魂震击(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(蚀魂震击);

                Skill 咒怨洪流 = new 咒怨洪流(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(咒怨洪流);
            }

            if (id == 4)
            {
                Skill 灵能反射 = new 灵能反射(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(灵能反射);

                Skill 三相灵枢 = new 三相灵枢(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(三相灵枢);
            }

            if (id == 5)
            {
                Skill 双生流转 = new 双生流转(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(双生流转);

                Skill 变幻之心 = new 变幻之心(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(变幻之心);
            }

            if (id == 6)
            {
                Skill 零式崩解 = new 零式崩解(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(零式崩解);

                Skill 零式灭杀 = new 零式灭杀(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(零式灭杀);
            }

            if (id == 7)
            {
                Skill 少女绮想 = new 少女绮想(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(少女绮想);

                Skill 绝对领域 = new 绝对领域(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(绝对领域);
            }

            if (id == 8)
            {
                Skill 暗香疏影 = new 暗香疏影(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(暗香疏影);

                Skill 残香凋零 = new 残香凋零(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(残香凋零);
            }

            if (id == 9)
            {
                Skill 破釜沉舟 = new 破釜沉舟(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(破釜沉舟);

                Skill 宿命时律 = new 宿命时律(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(宿命时律);
            }

            if (id == 10)
            {
                Skill 累积之压 = new 累积之压(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(累积之压);

                Skill 极寒渴望 = new 极寒渴望(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(极寒渴望);
            }

            if (id == 11)
            {
                Skill 银隼之赐 = new 银隼之赐(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(银隼之赐);

                Skill 身心一境 = new 身心一境(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(身心一境);
            }

            if (id == 12)
            {
                Skill 弱者猎手 = new 弱者猎手(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(弱者猎手);

                Skill 饕餮盛宴 = new 饕餮盛宴(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(饕餮盛宴);
            }

            if (id == 13)
            {
                Skill 开宫 = new 开宫(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(开宫);

                Skill 放监 = new 放监(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(放监);
            }

            if (id == 14)
            {
                Skill 八卦阵 = new 八卦阵(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(八卦阵);

                Skill 归元环 = new 归元环(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(归元环);
            }

            if (id == 15)
            {
                Skill 深海之戟 = new 深海之戟(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(深海之戟);

                Skill 海王星的野望 = new 海王星的野望(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(海王星的野望);
            }

            if (id == 16)
            {
                Skill 雇佣兵团 = new 雇佣兵团(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(雇佣兵团);

                Skill 全军出击 = new 全军出击(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(全军出击);
            }

            if (id == 17)
            {
                Skill 不息之流 = new 不息之流(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(不息之流);

                Skill 宿命之潮 = new 宿命之潮(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(宿命之潮);
            }

            if (id == 18)
            {
                Skill 概念之骰 = new 概念之骰(character)
                {
                    Level = passiveLevel
                };
                character.Skills.Add(概念之骰);

                Skill 神之因果 = new 神之因果(character)
                {
                    Level = superLevel
                };
                character.Skills.Add(神之因果);
            }
        }

        public static List<Item> GenerateMagicCards(int count, QualityType? qualityType = null, long[]? magicIds = null, (int str, int agi, int intelligence)[]? values = null)
        {
            List<Item> items = [];

            for (int i = 0; i < count; i++)
            {
                long magicId = 0;
                if (magicIds != null && magicIds.Length > i) magicId = magicIds[i];
                (int str, int agi, int intelligence) = (0, 0, 0);
                if (values != null && values.Length > i)
                {
                    str = values[i].str;
                    agi = values[i].agi;
                    intelligence = values[i].intelligence;
                }
                items.Add(GenerateMagicCard(qualityType, magicId, str, agi, intelligence));
            }

            return items;
        }

        public static Item GenerateMagicCard(QualityType? qualityType = null, long magicId = 0, int str = 0, int agi = 0, int intelligence = 0)
        {
            Item item = new()
            {
                Id = Convert.ToInt64("16" + Verification.CreateVerifyCode(VerifyCodeType.NumberVerifyCode, 8)),
                Name = GenerateRandomChineseName(),
                ItemType = ItemType.MagicCard,
                RemainUseTimes = 1
            };

            GenerateAndAddSkillToMagicCard(item, qualityType, magicId, str, agi, intelligence);

            return item;
        }

        public static void GenerateAndAddSkillToMagicCard(Item item, QualityType? qualityType = null, long magicId = 0, int str = 0, int agi = 0, int intelligence = 0)
        {
            int total = str + agi + intelligence;
            if (total == 0)
            {
                if (qualityType != null)
                {
                    item.QualityType = qualityType.Value;
                    if (item.QualityType > QualityType.Gold) item.QualityType = QualityType.Gold;
                    total = item.QualityType switch
                    {
                        QualityType.Green => Random.Shared.Next(7, 13),
                        QualityType.Blue => Random.Shared.Next(13, 19),
                        QualityType.Purple => Random.Shared.Next(19, 25),
                        QualityType.Orange => Random.Shared.Next(25, 31),
                        QualityType.Red => Random.Shared.Next(31, 37),
                        QualityType.Gold => Random.Shared.Next(37, 43),
                        _ => Random.Shared.Next(1, 7)
                    };
                }
                else total = Random.Shared.Next(1, 43);

                // 随机决定将多少个属性赋给其中一个属性，确保至少一个不为零
                int nonZeroAttributes = Random.Shared.Next(1, Math.Min(4, total + 1)); // 随机决定非零属性的数量，确保在 total = 1 时最多只有1个非零属性

                // 根据非零属性数量分配属性点
                if (nonZeroAttributes == 1)
                {
                    // 只有一个属性不为零
                    int attribute = Random.Shared.Next(0, 3);
                    if (attribute == 0) str = total;
                    else if (attribute == 1) agi = total;
                    else intelligence = total;
                }
                else if (nonZeroAttributes == 2 && total >= 2)
                {
                    // 两个属性不为零
                    int first = Random.Shared.Next(1, total); // 第一个属性的值
                    int second = total - first; // 第二个属性的值

                    int attribute = Random.Shared.Next(0, 3);
                    if (attribute == 0)
                    {
                        str = first;
                    }
                    else if (attribute == 1)
                    {
                        agi = first;
                    }
                    else
                    {
                        intelligence = first;
                    }

                    attribute = Random.Shared.Next(0, 3);
                    while ((attribute == 0 && str > 0) || (attribute == 1 && agi > 0) || (attribute == 2 && intelligence > 0))
                    {
                        attribute = Random.Shared.Next(0, 3);
                    }

                    if (attribute == 0)
                    {
                        str = second;
                    }
                    else if (attribute == 1)
                    {
                        agi = second;
                    }
                    else
                    {
                        intelligence = second;
                    }
                }
                else if (total >= 3)
                {
                    // 三个属性都不为零
                    str = Random.Shared.Next(1, total - 1); // 第一个属性的值
                    agi = Random.Shared.Next(1, total - str); // 第二个属性的值
                    intelligence = total - str - agi; // 剩下的值给第三个属性
                }
            }

            if (item.QualityType == QualityType.White)
            {
                if (total > 6 && total <= 12)
                {
                    item.QualityType = QualityType.Green;
                }
                else if (total > 12 && total <= 18)
                {
                    item.QualityType = QualityType.Blue;
                }
                else if (total > 18 && total <= 24)
                {
                    item.QualityType = QualityType.Purple;
                }
                else if (total > 24 && total <= 30)
                {
                    item.QualityType = QualityType.Orange;
                }
                else if (total > 30 && total <= 36)
                {
                    item.QualityType = QualityType.Red;
                }
                else if (total > 36)
                {
                    item.QualityType = QualityType.Gold;
                }
            }

            Skill? magic = null;
            if (magicId != 0)
            {
                magic = Magics.FirstOrDefault(m => m.Id == magicId);
            }
            magic ??= Magics[Random.Shared.Next(Magics.Count)].Copy();
            magic.Guid = item.Guid;
            magic.Level = (int)item.QualityType switch
            {
                2 => 2,
                3 => 2,
                4 => 3,
                5 => 4,
                6 => 5,
                _ => 1
            };
            if (magic.Level > 1)
            {
                item.Name += $" +{magic.Level - 1}";
            }
            item.Skills.Active = magic;

            Skill skill = Factory.OpenFactory.GetInstance<Skill>(item.Id, "动态矩阵", []);
            GenerateAndAddEffectsToMagicCard(skill, str, agi, intelligence);

            skill.Level = 1;
            List<string> strings = [];
            if (str > 0) strings.Add($"{str:0.##} 点力量");
            if (agi > 0) strings.Add($"{agi:0.##} 点敏捷");
            if (intelligence > 0) strings.Add($"{intelligence:0.##} 点智力");
            item.Description = $"包含魔法：{item.Skills.Active.Name + (item.Skills.Active.Level > 1 ? $" +{item.Skills.Active.Level - 1}" : "")}\r\n" +
                $"增加角色属性：{string.Join("，", strings)}";
            item.Skills.Passives.Add(skill);
        }

        public static void GenerateAndAddEffectsToMagicCard(Skill skill, int str, int agi, int intelligence)
        {
            if (str > 0)
            {
                skill.Effects.Add(Factory.OpenFactory.GetInstance<Effect>((long)EffectID.ExSTR, "", new()
                    {
                        { "skill", skill },
                        {
                            "values", new Dictionary<string, object>()
                            {
                                { "exstr", str }
                            }
                        }
                    }));
            }

            if (agi > 0)
            {
                skill.Effects.Add(Factory.OpenFactory.GetInstance<Effect>((long)EffectID.ExAGI, "", new()
                    {
                        { "skill", skill },
                        {
                            "values", new Dictionary<string, object>()
                            {
                                { "exagi", agi }
                            }
                        }
                    }));
            }

            if (intelligence > 0)
            {
                skill.Effects.Add(Factory.OpenFactory.GetInstance<Effect>((long)EffectID.ExINT, "", new()
                    {
                        { "skill", skill },
                        {
                            "values", new Dictionary<string, object>()
                            {
                                { "exint", intelligence }
                            }
                        }
                    }));
            }
        }

        public static Item? ConflateMagicCardPack(IEnumerable<Item> magicCards)
        {
            if (magicCards.Any())
            {
                List<Skill> magics = [.. magicCards.Where(i => i.Skills.Active != null).Select(i => i.Skills.Active!)];
                List<Skill> passives = [.. magicCards.SelectMany(i => i.Skills.Passives)];
                Item item = new()
                {
                    Id = Convert.ToInt64("10" + Verification.CreateVerifyCode(VerifyCodeType.NumberVerifyCode, 8)),
                    Name = GenerateRandomChineseName(),
                    ItemType = ItemType.MagicCardPack
                };
                double str = 0, agi = 0, intelligence = 0;
                foreach (Skill skill in passives)
                {
                    Skill newSkill = skill.Copy();
                    foreach (Effect effect in newSkill.Effects)
                    {
                        switch ((EffectID)effect.Id)
                        {
                            case EffectID.ExSTR:
                                if (effect is ExSTR exstr)
                                {
                                    str += exstr.Value;
                                }
                                break;
                            case EffectID.ExAGI:
                                if (effect is ExAGI exagi)
                                {
                                    agi += exagi.Value;
                                }
                                break;
                            case EffectID.ExINT:
                                if (effect is ExINT exint)
                                {
                                    intelligence += exint.Value;
                                }
                                break;
                        }
                    }
                    newSkill.Level = skill.Level;
                    newSkill.Item = item;
                    item.Skills.Passives.Add(newSkill);
                }
                List<string> strings = [];
                if (str > 0) strings.Add($"{str:0.##} 点力量");
                if (agi > 0) strings.Add($"{agi:0.##} 点敏捷");
                if (intelligence > 0) strings.Add($"{intelligence:0.##} 点智力");
                foreach (Skill skill in magics)
                {
                    IEnumerable<Skill> has = item.Skills.Magics.Where(m => m.Id == skill.Id);
                    if (has.Any() && has.First() is Skill s)
                    {
                        s.Level += skill.Level;
                        if (s.Level > 1) s.Name = s.Name.Split(' ')[0] + $" +{s.Level - 1}";
                    }
                    else
                    {
                        Skill magic = skill.Copy();
                        magic.Guid = item.Guid;
                        magic.Level = skill.Level;
                        item.Skills.Magics.Add(magic);
                    }
                }
                item.Description = $"包含魔法：{string.Join("，", item.Skills.Magics.Select(m => m.Name + (m.Level > 1 ? $" +{m.Level - 1}" : "")))}\r\n" +
                    $"增加角色属性：{string.Join("，", strings)}";
                double total = str + agi + intelligence;
                if (total > 18 && total <= 36)
                {
                    item.QualityType = QualityType.Green;
                }
                else if (total > 36 && total <= 54)
                {
                    item.QualityType = QualityType.Blue;
                }
                else if (total > 54 && total <= 72)
                {
                    item.QualityType = QualityType.Purple;
                }
                else if (total > 72 && total <= 90)
                {
                    item.QualityType = QualityType.Orange;
                }
                else if (total > 90 && total <= 108)
                {
                    item.QualityType = QualityType.Red;
                }
                else if (total > 108)
                {
                    item.QualityType = QualityType.Gold;
                }
                return item;
            }
            return null;
        }

        public static Item? GenerateMagicCardPack(int magicCardCount, QualityType? qualityType = null, long[]? magicIds = null, (int str, int agi, int intelligence)[]? values = null)
        {
            List<Item> magicCards = GenerateMagicCards(magicCardCount, qualityType, magicIds, values);
            Item? magicCardPack = ConflateMagicCardPack(magicCards);
            return magicCardPack;
        }

        public static double CalculateRating(CharacterStatistics stats, Team? team = null, CharacterStatistics[]? allStats = null)
        {
            double k = stats.Kills;
            double a = stats.Assists;
            double d = Math.Max(0, stats.Deaths);
            double dmg = stats.TotalDamage + (stats.TotalTrueDamage * 0.2);
            double heal = stats.TotalHeal + stats.TotalShield;
            double cc = stats.ControlTime;
            double taken = stats.TotalTakenDamage;
            double live = stats.LiveTime;

            if (team != null)
            {
                double teamTotalDmg = allStats?.Sum(s => s.TotalDamage + s.TotalTrueDamage * 0.2) ?? dmg;
                double teamTotalHeal = allStats?.Sum(s => s.TotalHeal + s.TotalShield) ?? heal;
                int playerCount = allStats?.Length ?? 1;

                double dmgShare = dmg / Math.Max(2.3, teamTotalDmg);
                double healShare = heal / Math.Max(1, teamTotalHeal);
                double roleContribution = Math.Max(dmgShare, healShare) * playerCount * 0.6;
                double roleScore = Math.Min(1.0, roleContribution);

                double kdaRatio = (k * 1.4 + a * 0.2) / (d + 1.8);
                double kdaScore = Math.Min(1.0, (kdaRatio / 3.0) * 0.4);

                double ccScore = Math.Min(0.10, (cc / 60.0) * 0.05);
                double tankScore = Math.Min(0.10, (taken / (d + 1) / 10000.0) * 0.1);

                double totalRating = roleScore + kdaScore + ccScore + tankScore;

                double avgDeaths = allStats?.Average(s => s.Deaths) ?? d;
                if (d > avgDeaths && kdaRatio < 1.0) totalRating *= 0.75;

                return Math.Round(Math.Max(0.01, totalRating), 4);
            }
            else
            {
                int rank = stats.LastRank;
                int totalPlayers = allStats?.Length ?? 10;
                double maxKills = allStats?.Max(s => s.Kills) ?? k;
                double maxDmg = allStats?.Max(s => s.TotalDamage + s.TotalTrueDamage * 0.2) ?? dmg;

                double rankScore = ((totalPlayers - rank + 1.0) / totalPlayers) * 0.8;

                double killPart = (k * 1.7 + a * 0.1) / Math.Max(1, maxKills + 1);
                double dmgPart = (dmg / Math.Max(1, maxDmg * 1.8)) * 0.1;
                double combatScore = Math.Min(0.8, killPart * 0.4 + dmgPart);

                double utilityScore = Math.Min(0.2, (cc / 60.0) * 0.04 + (heal / Math.Max(1, maxDmg)) * 0.05);

                double totalRating = rankScore + combatScore + utilityScore;

                if (k == 0)
                {
                    totalRating *= 0.6;
                }

                if (rank == 1 && k > 0)
                {
                    if (k >= maxKills) totalRating += 0.15;
                }

                if (rank > 5 && k >= maxKills * 0.8 && k > 0)
                {
                    totalRating += 0.15;
                }

                return Math.Round(Math.Max(0.01, totalRating), 4);
            }
        }

        public static void GetCharacterRating(Dictionary<Character, CharacterStatistics> statistics, bool isTeam, List<Team> teams)
        {
            foreach (Character character in statistics.Keys)
            {
                Team? team = null;
                CharacterStatistics[]? teammateStats = null;
                if (isTeam)
                {
                    team = teams.FirstOrDefault(t => t.IsOnThisTeam(character));
                    if (team != null)
                    {
                        teammateStats = [.. statistics.Where(kv => team.Members.Contains(kv.Key)).Select(kv => kv.Value)];
                    }
                }
                statistics[character].Rating = CalculateRating(statistics[character], team, teammateStats);
            }
        }

        public static string[] GreekAlphabet { get; } = ["α", "β", "γ", "δ", "ε", "ζ", "η", "θ", "ι", "κ", "λ", "μ", "ν", "ξ", "ο", "π", "ρ", "σ", "τ", "υ", "φ", "χ", "ψ", "ω"];

        public static string[] CommonSurnames { get; } = [
            "顾", "沈", "陆", "楚", "白", "苏", "叶", "萧", "莫", "司马", "欧阳",
            "上官", "慕容", "尉迟", "司徒", "轩辕", "端木", "南宫", "长孙", "百里",
            "东方", "西门", "独孤", "公孙", "令狐", "宇文", "夏侯", "赫连", "皇甫",
            "北堂", "安陵", "东篱", "花容", "夜", "柳", "云", "凌", "寒", "龙",
            "凤", "蓝", "冷", "华", "蓝夜", "叶南", "墨", "君", "月", "子车",
            "澹台", "钟离", "公羊", "闾丘", "仲孙", "司空", "羊舌", "亓官", "公冶",
            "濮阳", "独月", "南风", "凤栖", "南门", "姬", "闻人", "花怜", "若",
            "紫", "卿", "微", "清", "易", "月华", "霜", "兰", "岑", "语", "雪",
            "夜阑", "梦", "洛", "江", "黎", "夜北", "唐", "水", "韩", "庄",
            "夜雪", "夜凌", "君临", "青冥", "漠然", "林", "青", "岑", "容",
            "墨", "柏", "安", "晏", "尉", "南", "轩", "竹", "晨", "桓", "晖",
            "瑾", "溪", "汐", "沐", "玉", "汀", "归", "羽", "颜", "辰", "琦",
            "芷", "尹", "施", "原", "孟", "尧", "荀", "单", "简", "植", "傅",
            "司", "钟", "方", "谢",
            "赵", "钱", "孙", "李", "周", "吴", "郑", "王", "冯", "陈", "卫", "蒋", "沈", "韩",
            "杨", "朱", "秦", "许", "何", "吕", "张", "孔", "曹", "严", "华", "金", "魏", "陶",
            "姜", "谢", "罗", "徐", "林", "范", "方", "唐", "柳", "宋", "元", "萧", "程", "陆",
            "顾", "楚", "白", "苏", "叶", "萧", "莫", "凌", "寒", "龙", "凤", "蓝", "冷", "华",
            "唐", "韩", "庄", "青", "安", "晏", "尹", "施", "孟", "荀", "傅", "钟", "方", "谢",
            "司马", "欧阳", "上官", "慕容", "尉迟", "司徒", "轩辕", "端木", "南宫", "长孙",
            "百里", "东方", "西门", "独孤", "公孙", "令狐", "宇文", "夏侯", "赫连", "皇甫",
            "墨", "君", "月", "紫", "卿", "微", "清", "易", "霜", "兰", "语", "雪", "璃",
            "镜", "弦", "珏", "瑾", "璇", "绯", "霁", "溟", "澈", "归", "羽", "辰", "芷",
            "风", "花", "江", "河", "湖", "海", "山", "川", "松", "竹", "梅", "菊", "枫",
            "梧", "泉", "溪", "岚", "雾", "露", "霓", "霰", "星", "辰",
            "沧", "溟", "无", "绝", "孤", "隐", "斩", "破", "惊", "鸿", "御", "玄", "冥",
            "烬", "夙", "离",
            "东篱", "南笙", "西楼", "北冥", "九歌", "长离", "扶摇", "青丘", "凌霄", "重光",
            "子车", "亓官", "巫马", "拓跋", "叱干", "斛律", "沮渠", "秃发", "万俟", "仆固"
        ];

        public static string CommonChineseCharacters { get; } =
                "云星宝灵梦龙花雨风叶山川月石羽水竹金" +
                "玉海火雷光天地凤虎虹珠华霞鹏雪银沙松桃兰青霜鸿康骏波泉河湖江泽洋林枫" +
                "梅桂樱桐晴韵凌若悠碧涛渊壁剑影霖玄承珍雅耀瑞鹤烟燕霏翼翔璃绮纱绫绣锦" +
                "瑜琼瑾璇璧琳琪瑶瑛芝杏茜荷莉莹菡莲诗瑰翠椒槐榆槿柱梧曜曙晶暖智煌熙霓" +
                "熠嘉琴曼菁蓉菲淑妙惠秋涵映巧慧茹荣菱曦容芬玲澜清湘澄泓润珺晨翠涟洁悠" +
                "霏淑绮润东南西北云山川风月溪雪雨雷天云海霜柏芳春秋夏冬温景寒和竹阳溪" +
                "溪飞风峰阳一乙二十丁厂七卜八人入儿匕几九刁了刀力乃又三干于亏工土士才" +
                "下寸大丈与万上小口山巾千乞川亿个夕久么勺凡丸及广亡门丫义之尸己已巳弓" +
                "子卫也女刃飞习叉马乡丰王开井天夫元无云专丐扎艺木五支厅不犬太区历歹友" +
                "尤匹车巨牙屯戈比互切瓦止少曰日中贝冈内水见午牛手气毛壬升夭长仁什片仆" +
                "化仇币仍仅斤爪反介父从仑今凶分乏公仓月氏勿欠风丹匀乌勾凤六文亢方火为" +
                "斗忆计订户认冗讥心尺引丑巴孔队办以允予邓劝双书幻玉刊未末示击打巧正扑" +
                "卉扒功扔去甘世艾古节本术可丙左厉石右布夯戊龙平灭轧东卡北占凸卢业旧帅" +
                "归旦目且叶甲申叮电号田由只叭史央兄叽叼叫叩叨另叹冉皿凹囚四生矢失乍禾" +
                "丘付仗代仙们仪白仔他斥瓜乎丛令用甩印尔乐句匆册卯犯外处冬鸟务包饥主市" +
                "立冯玄闪兰半汁汇头汉宁穴它讨写让礼训议必讯记永司尼民弗弘出辽奶奴召加" +
                "皮边孕发圣对台矛纠母幼丝邦式迂刑戎动扛寺吉扣考托老巩圾执扩扫地场扬耳" +
                "芋共芒亚芝朽朴机权过臣吏再协西压厌戌在百有存而页匠夸夺灰达列死成夹夷" +
                "轨邪尧划迈毕至此贞师尘尖劣光当早吁吐吓虫曲团吕同吊吃因吸吗吆屿屹岁帆" +
                "回岂则刚网肉年朱先丢廷舌竹迁乔迄伟传乒乓休伍伏优臼伐延仲件任伤价伦份" +
                "华仰仿伙伪自伊血向似后行舟全会杀合兆企众爷伞创肌肋朵杂危旬旨旭负匈名" +
                "各多争色壮冲妆冰庄庆亦刘齐交衣次产决亥充妄闭问闯羊并关米灯州汗污江汛" +
                "池汝汤忙兴宇守宅字安讲讳军讶许讹论讼农讽设访诀寻那迅尽导异弛孙阵阳收" +
                "阶阴防奸如妇妃好她妈戏羽观欢买红驮纤驯约级纪驰纫巡寿弄麦玖玛形进戒吞" +
                "远违韧运扶抚坛技坏抠扰扼拒找批址扯走抄贡汞坝攻赤折抓扳抡扮抢孝坎均抑" +
                "抛投坟坑抗坊抖护壳志块扭声把报拟却抒劫芙芜苇芽花芹芥芬苍芳严芦芯劳克" +
                "芭苏杆杠杜材村杖杏杉巫极李杨求甫匣更束吾豆两酉丽医辰励否还尬歼来连轩" +
                "步卤坚肖旱盯呈时吴助县里呆吱吠呕园旷围呀吨足邮男困吵串员呐听吟吩呛吻" +
                "吹呜吭吧邑吼囤别吮岖岗帐财针钉牡告我乱利秃秀私每兵估体何佐佑但伸佃作" +
                "伯伶佣低你住位伴身皂伺佛囱近彻役返余希坐谷妥含邻岔肝肛肚肘肠龟甸免狂" +
                "犹狈角删条彤卵灸岛刨迎饭饮系言冻状亩况床库庇疗吝应这冷庐序辛弃冶忘闰" +
                "闲间闷判兑灶灿灼弟汪沐沛汰沥沙汽沃沦汹泛沧没沟沪沈沉沁怀忧忱快完宋宏" +
                "牢究穷灾良证启评补初社祀识诈诉罕诊词译君灵即层屁尿尾迟局改张忌际陆阿" +
                "陈阻附坠妓妙妖姊妨妒努忍劲矣鸡纬驱纯纱纲纳驳纵纷纸纹纺驴纽奉玩环武青" +
                "责现玫表规抹卦坷坯拓拢拔坪拣坦担坤押抽拐拖者拍顶拆拎拥抵拘势抱拄垃拉" +
                "拦幸拌拧拂拙招坡披拨择抬拇拗其取茉苦昔苛若茂苹苗英苟苑苞范直茁茄茎苔" +
                "茅枉林枝杯枢柜枚析板松枪枫构杭杰述枕丧或画卧事刺枣雨卖郁矾矿码厕奈奔" +
                "奇奋态欧殴垄妻轰顷转斩轮软到非叔歧肯齿些卓虎虏肾贤尚旺具味果昆国哎咕" +
                "昌呵畅明易咙昂迪典固忠呻咒咋咐呼鸣咏呢咄咖岸岩帖罗帜帕岭凯败账贩贬购" +
                "贮图钓制知迭氛垂牧物乖刮秆和季委秉佳侍岳供使例侠侥版侄侦侣侧凭侨佩货" +
                "侈依卑的迫质欣征往爬彼径所舍金刹命肴斧爸采觅受乳贪念贫忿肤肺肢肿胀朋" +
                "股肮肪肥服胁周昏鱼兔狐忽狗狞备饰饱饲变京享庞店夜庙府底疟疙疚剂卒郊庚" +
                "废净盲放刻育氓闸闹郑券卷单炬炒炊炕炎炉沫浅法泄沽河沾泪沮油泊沿泡注泣" +
                "泞泻泌泳泥沸沼波泼泽治怔怯怖性怕怜怪怡学宝宗定宠宜审宙官空帘宛实试郎" +
                "诗肩房诚衬衫视祈话诞诡询该详建肃录隶帚屉居届刷屈弧弥弦承孟陋陌孤陕降" +
                "函限妹姑姐姓妮始姆迢驾叁参艰线练组绅细驶织驹终驻绊驼绍绎经贯契贰奏春" +
                "帮玷珍玲珊玻毒型拭挂封持拷拱项垮挎城挟挠政赴赵挡拽哉挺括垢拴拾挑垛指" +
                "垫挣挤拼挖按挥挪拯某甚荆茸革茬荐巷带草茧茵茶荒茫荡荣荤荧故胡荫荔南药" +
                "标栈柑枯柄栋相查柏栅柳柱柿栏柠树勃要柬咸威歪研砖厘厚砌砂泵砚砍面耐耍" +
                "牵鸥残殃轴轻鸦皆韭背战点虐临览竖省削尝昧盹是盼眨哇哄哑显冒映星昨咧昭" +
                "畏趴胃贵界虹虾蚁思蚂虽品咽骂勋哗咱响哈哆咬咳咪哪哟炭峡罚贱贴贻骨幽钙" +
                "钝钞钟钢钠钥钦钧钩钮卸缸拜看矩毡氢怎牲选适秒香种秋科重复竿段便俩贷顺" +
                "修俏保促俄俐侮俭俗俘信皇泉鬼侵禹侯追俊盾待徊衍律很须叙剑逃食盆胚胧胆" +
                "胜胞胖脉胎勉狭狮独狰狡狱狠贸怨急饵饶蚀饺饼峦弯将奖哀亭亮度迹庭疮疯疫" +
                "疤咨姿亲音帝施闺闻闽阀阁差养美姜叛送类迷籽娄前首逆兹总炼炸烁炮炫烂剃" +
                "洼洁洪洒柒浇浊洞测洗活派洽染洛浏济洋洲浑浓津恃恒恢恍恬恤恰恼恨举觉宣" +
                "宦室宫宪突穿窃客诫冠诬语扁袄祖神祝祠误诱诲说诵垦退既屋昼屏屎费陡逊眉" +
                "孩陨除险院娃姥姨姻娇姚娜怒架贺盈勇怠癸蚤柔垒绑绒结绕骄绘给绚骆络绝绞" +
                "骇统耕耘耗耙艳泰秦珠班素匿蚕顽盏匪捞栽捕埂捂振载赶起盐捎捍捏埋捉捆捐" +
                "损袁捌都哲逝捡挫换挽挚热恐捣壶捅埃挨耻耿耽聂恭莽莱莲莫莉荷获晋恶莹莺" +
                "真框梆桂桔栖档桐株桥桦栓桃格桩校核样根索哥速逗栗贾酌配翅辱唇夏砸砰砾" +
                "础破原套逐烈殊殉顾轿较顿毙致柴桌虑监紧党逞晒眠晓哮唠鸭晃哺晌剔晕蚌畔" +
                "蚣蚊蚪蚓哨哩圃哭哦恩鸯唤唁哼唧啊唉唆罢峭峨峰圆峻贼贿赂赃钱钳钻钾铁铃" +
                "铅缺氧氨特牺造乘敌秤租积秧秩称秘透笔笑笋债借值倚俺倾倒倘俱倡候赁俯倍" +
                "倦健臭射躬息倔徒徐殷舰舱般航途拿耸爹舀爱豺豹颁颂翁胰脆脂胸胳脏脐胶脑" +
                "脓逛狸狼卿逢鸵留鸳皱饿馁凌凄恋桨浆衰衷高郭席准座症病疾斋疹疼疲脊效离" +
                "紊唐瓷资凉站剖竞部旁旅畜阅羞羔瓶拳粉料益兼烤烘烦烧烛烟烙递涛浙涝浦酒" +
                "涉消涡浩海涂浴浮涣涤流润涧涕浪浸涨烫涩涌悖悟悄悍悔悯悦害宽家宵宴宾窍" +
                "窄容宰案请朗诸诺读扇诽袜袖袍被祥课冥谁调冤谅谆谈谊剥恳展剧屑弱陵祟陶" +
                "陷陪娱娟恕娥娘通能难预桑绢绣验继骏球琐理琉琅捧堵措描域捺掩捷排焉掉捶" +
                "赦堆推埠掀授捻教掏掐掠掂培接掷控探据掘掺职基聆勘聊娶著菱勒黄菲萌萝菌" +
                "萎菜萄菊菩萍菠萤营乾萧萨菇械彬梦婪梗梧梢梅检梳梯桶梭救曹副票酝酗厢戚" +
                "硅硕奢盔爽聋袭盛匾雪辅辆颅虚彪雀堂常眶匙晨睁眯眼悬野啪啦曼晦晚啄啡距" +
                "趾啃跃略蚯蛀蛇唬累鄂唱患啰唾唯啤啥啸崖崎崭逻崔帷崩崇崛婴圈铐铛铝铜铭" +
                "铲银矫甜秸梨犁秽移笨笼笛笙符第敏做袋悠偿偶偎偷您售停偏躯兜假衅徘徙得" +
                "衔盘舶船舵斜盒鸽敛悉欲彩领脚脖脯豚脸脱象够逸猜猪猎猫凰猖猛祭馅馆凑减" +
                "毫烹庶麻庵痊痒痕廊康庸鹿盗章竟商族旋望率阎阐着羚盖眷粘粗粒断剪兽焊焕" +
                "清添鸿淋涯淹渠渐淑淌混淮淆渊淫渔淘淳液淤淡淀深涮涵婆梁渗情惜惭悼惧惕" +
                "惟惊惦悴惋惨惯寇寅寄寂宿窒窑密谋谍谎谐袱祷祸谓谚谜逮敢尉屠弹隋堕随蛋" +
                "隅隆隐婚婶婉颇颈绩绪续骑绰绳维绵绷绸综绽绿缀巢琴琳琢琼斑替揍款堪塔搭" +
                "堰揩越趁趋超揽堤提博揭喜彭揣插揪搜煮援搀裁搁搓搂搅壹握搔揉斯期欺联葫" +
                "散惹葬募葛董葡敬葱蒋蒂落韩朝辜葵棒棱棋椰植森焚椅椒棵棍椎棉";

        public static string GenerateRandomChineseName()
        {
            // 随机生成名字长度，2到5个字
            int nameLength = Random.Shared.Next(2, 6);
            StringBuilder name = new();

            for (int i = 0; i < nameLength; i++)
            {
                // 从常用汉字集中随机选择一个汉字
                char chineseCharacter = CommonChineseCharacters[Random.Shared.Next(CommonChineseCharacters.Length)];
                name.Append(chineseCharacter);
            }

            return name.ToString();
        }

        public static string GenerateRandomChineseUserName()
        {
            StringBuilder name = new();

            // 随机姓
            string lastname = CommonSurnames[Random.Shared.Next(CommonSurnames.Length)];
            name.Append(lastname);

            // 随机生成名字长度，2到5个字
            int nameLength = Random.Shared.Next(1, 2);

            for (int i = 0; i < nameLength; i++)
            {
                // 从常用汉字集中随机选择一个汉字
                char chineseCharacter = CommonChineseCharacters[Random.Shared.Next(CommonChineseCharacters.Length)];
                name.Append(chineseCharacter);
            }

            return name.ToString();
        }

        public static Dictionary<EffectID, Dictionary<string, object>> RoundRewards => new()
        {
            {
                EffectID.ExATK,
                new()
                {
                    { "exatk", Random.Shared.Next(40, 80) }
                }
            },
            {
                EffectID.ExCritRate,
                new()
                {
                    { "excr", Math.Clamp(Random.Shared.NextDouble(), 0.25, 0.5) }
                }
            },
            {
                EffectID.ExCritDMG,
                new()
                {
                    { "excrd", Math.Clamp(Random.Shared.NextDouble(), 0.5, 1) }
                }
            },
            {
                EffectID.ExATK2,
                new()
                {
                    { "exatk", Math.Clamp(Random.Shared.NextDouble(), 0.15, 0.3) }
                }
            },
            {
                EffectID.ExMaxMP2,
                new()
                {
                    { "exmp", 5 }
                }
            },
            {
                EffectID.AccelerationCoefficient,
                new()
                {
                    { "exacc", 1 }
                }
            },
            {
                EffectID.IgnoreEvade,
                new()
                {
                    { "p", 1 }
                }
            },
            {
                EffectID.RecoverHP,
                new()
                {
                    { "hp", Random.Shared.Next(160, 640) }
                }
            },
            {
                EffectID.RecoverMP,
                new()
                {
                    { "mp", Random.Shared.Next(140, 490) }
                }
            },
            {
                EffectID.RecoverHP2,
                new()
                {
                    { "hp", Math.Clamp(Random.Shared.NextDouble(), 0.04, 0.08) }
                }
            },
            {
                EffectID.RecoverMP2,
                new()
                {
                    { "mp", Math.Clamp(Random.Shared.NextDouble(), 0.09, 0.18) }
                }
            },
            {
                EffectID.GetEP,
                new()
                {
                    { "ep", Random.Shared.Next(20, 40) }
                }
            }
        };
    }
}
