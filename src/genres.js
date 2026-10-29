// 武器のジャンル。武器を選ぶ画面・ずかん・バトルの表示でアイコンと色で見分けられるようにする。
// ジャンルとは別に「育ち方」の印がある:
//   🌱 進化     … 当てた回数で姿が変わる武器(bloom: true)
//   📈 大器晩成 … 数値どおりに伸び、その仕組みのせいで後半に化ける武器(late: true。雷・爆弾など、増えるほど増え方も速くなる)

export const GENRES = {
  slash: { name: '刃', icon: '⚔️', color: '#e8484d' },
  blunt: { name: '打撃', icon: '🔨', color: '#8d6e63' },
  shoot: { name: '射撃', icon: '🏹', color: '#2f7de1' },
  magic: { name: '魔法', icon: '✨', color: '#8b3fe0' },
  blast: { name: '爆発', icon: '💥', color: '#ff7a1a' },
  nature: { name: '自然', icon: '🌪️', color: '#16a3a3' },
  summon: { name: '召喚', icon: '👻', color: '#5d6d7e' },
  beast: { name: '生き物', icon: '🐾', color: '#2fa84f' },
  body: { name: '体術', icon: '👊', color: '#e0a600' },
  trick: { name: 'トリック', icon: '🎩', color: '#ff3d9a' },
};

const LIST = {
  slash: 'sword dagger spear axe katana scythe trident lance greatsword dual kusarigama saber spirit kamaitachi chainsaw iai knight forge moon ashigaru drill',
  blunt: 'whip hammer flail shield squeaky wrecking yoyo pinball rocketFist bowling anvil hammerThrow umbrella harisen bat broom fryingPan spinner jumpRope gears',
  shoot: 'crossbow bow boomerang shuriken gatling saw ricochet knives javelin revolver axethrow danmaku sakura urchin chakram sniperRifle darts slingshot soccer taketombo paperPlane ringToss ninjaKid',
  magic: 'orb orbital spellbook curse prism plasma holyPillar shrinkRay blackhole sonic laser star scepter vampire apprentice conductor bulb',
  blast: 'fission potion bomb cluster mine meteor missile rocket fireworks firecracker sticky timebomb cannon balloon bubbleGum waterBalloon',
  nature: 'wildfire avalanche chainBolt wand ice flame gas lightning tornado blizzard snowball lava storm quake tesla vine cactus iceSpike tsunami frostCircle windBarrier fan water volcano typhoon ember sparky snowman seed',
  summon: 'slime clone skeleton drones golem ghost phoenix robot ufo',
  beast: 'mice cell bees bats snake shark frog butterfly turtle scorpion octopus penguin chameleon egg puppy beetle hermit goldfish',
  body: 'comboFist drum unarmed spike counter giant charger spring kungfu sumo judo spinKick boxer palm lariat bearhug ironBody rush wrestler monk pebble hero muscle statue vehicle',
  trick: 'compound copycat swap mirror clock magnet gravity rewind dice slot magician cards decoy pie banana hook lasso web pingpong splitter bumper eraser trampoline vacuum soapBubble shadow clown piggy pawn mimic',
};

export const GENRE_OF = {};
for (const [g, ids] of Object.entries(LIST)) for (const id of ids.split(' ')) GENRE_OF[id] = g;

// 📈 大器晩成: 当てるほど数や連鎖が増え、増え方そのものも速くなる武器
export const LATE = new Set('lightning bomb cluster splitter bees storm fireworks danmaku sakura urchin bats missile mine meteor saw'.split(' '));

export function genreOf(def) {
  return GENRES[def.genre] || GENRES[def.kind === 'ranged' ? 'shoot' : def.kind === 'body' ? 'body' : 'slash'];
}
