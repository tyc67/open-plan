import { createId } from './ids.js';
import { migrateV1 } from './migrate-v1.js';
import type { DimensionChain, Furniture, Material, PlanV1, PlanV2, Point, Rect, Room } from './types.js';
import { CHILD_POLYGON, LAUNDRY_POLYGON } from './v1-document.js';

// The sample apartment, adapted from reference/floorplan-3d.html. Units: mm. It is defined in the v1 shape and
// migrated, so there is one source for its geometry (roadmap A1).
const WALLS: [number, number, number, number, string][] = [
  // 頂部外牆
  [1580,-240,2120,0,'b'],[1580,0,1820,300,'b'],[2120,-240,4580,0,'e'],[4580,-240,5140,0,'e'],
  [5760,-240,6050,0,'e'],[6050,-240,6600,0,'b'],[6360,0,6600,300,'b'],[6600,-240,9960,0,'e'],
  [9960,-240,10510,0,'b'],[10270,0,10510,300,'b'],
  // 右側外牆
  [10270,300,10510,800,'e'],[10270,2600,10510,3090,'e'],[10270,3090,10510,4260,'b'],
  [10270,5740,10510,6370,'b'],[9960,6370,10510,6610,'b'],[10270,6610,10510,7400,'b'],
  [10270,9770,10510,10560,'b'],[9960,10560,10510,10800,'b'],
  // 底部 / 陽臺
  [4580,10560,9960,10800,'e'],[10510,10560,12090,10800,'e'],[11850,9960,12090,10560,'e'],
  // 客廳左牆（入戶門兩側）
  [4580,9200,4820,10560,'e'],[4580,7960,4820,8310,'e'],
  // 餐廳 / 廚房外牆
  [3620,7960,4580,8200,'e'],[2180,7960,3620,8200,'b'],[2180,7590,2420,7960,'b'],[2180,7400,2420,7590,'n'],
  [-240,7960,2180,8200,'e'],[-240,3610,0,7960,'e'],
  // 洗衣陽臺
  [0,4950,200,5190,'n'],[200,4950,1275,5190,'low'],[1580,3370,2420,3825,'b'],
  [2180,4430,2420,5796,'n'],[2090,4950,2180,5190,'n'],
  // 客衛
  [2420,4950,4580,5190,'n'],[4580,3280,4820,4075,'n'],[4580,4860,4820,5190,'n'],[2420,3370,4580,3610,'n'],
  // 小孩房 / 主衛
  [4580,0,4820,2400,'n'],[4820,2080,6360,2320,'n'],[6360,300,6600,1198,'n'],[6360,1983,6600,2400,'n'],
  // 過道 / 主臥 / 子女房
  [6083,3370,6600,3707,'b'],[6360,3280,6600,3370,'n'],[6600,3370,9960,3610,'n'],[9960,3370,10270,3610,'b'],
  [6083,4600,6323,6610,'n'],[6323,6370,9960,6610,'n'],
];
// 窗
const WINS: Rect[] = [
  [5140,-240,5760,0],[1580,300,1820,3370],[-240,3370,1580,3610],[2180,3825,2420,4430],
  [10510,6370,12090,6610],[11850,6610,12090,9960],
  // 飄窗（主臥 / 子女房）
  [10510,660,11130,760],[11030,760,11130,2650],[10510,2650,11130,2750],
  [10510,4110,11130,4210],[11030,4210,11130,5785],[10510,5785,11130,5885],
];
// 平開門：洞口、鉸點、關閉方向、開啟方向、門寬
const DOORS: { name: string; rect: Rect; h: Point; c: Point; o: Point; len: number; entry?: boolean }[] = [
  {name:'小孩房門',rect:[4580,2400,4820,3280],h:[4580,3280],c:[0,-1],o:[-1,0],len:880},
  {name:'主臥門',rect:[6360,2400,6600,3280],h:[6600,3280],c:[0,-1],o:[1,0],len:880},
  {name:'主衛門',rect:[6360,1198,6600,1983],h:[6360,1198],c:[0,1],o:[-1,0],len:785},
  {name:'客衛門',rect:[4580,4075,4820,4860],h:[4580,4860],c:[0,-1],o:[-1,0],len:785},
  {name:'子女房門',rect:[6083,3707,6323,4600],h:[6323,4600],c:[0,-1],o:[1,0],len:893},
  {name:'入戶門',rect:[4580,8310,4820,9200],h:[4820,9200],c:[0,-1],o:[1,0],len:890,entry:true},
];
// 推拉門
const SLIDES: { rect: Rect; v: boolean }[] = [
  {rect:[10270,7400,10510,9770],v:true},
  {rect:[1275,4950,2090,5190],v:false},
];
const R = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const ROOMS: Room[] = [
  {id:'master', name:'主臥室', poly:R(6600,0,10270,3370), mat:'wood', at:[8435,2420]},
  {id:'mbath', name:'主衛浴', poly:R(4820,0,6360,2080), mat:'antislip', at:[5980,1780]},
  {id:'kid', name:'小孩房', poly:R(1820,0,4580,3370), mat:'wood', at:[3380,2330]},
  {id:'gbath', name:'客衛浴', poly:R(2420,3610,4580,4950), mat:'antislip', at:[3760,4620]},
  {id:'laundry', name:'洗衣陽臺', poly:LAUNDRY_POLYGON, mat:'antislip', at:[1250,4330]},
  {id:'child', name:'子女房', poly:CHILD_POLYGON, mat:'wood', at:[8850,4850]},
  {id:'kitchen', name:'廚房', poly:R(0,5190,2180,7960), mat:'tile600', at:[1300,6500]},
  {id:'dining', name:'餐廳', poly:[[2420,5190],[4820,5190],[4820,7960],[2420,7960],[2420,7400],[2180,7400],[2180,5796],[2420,5796]], mat:'tile800', at:[3900,5520]},
  {id:'hall', name:'過道', poly:[[4820,2320],[6360,2320],[6360,3370],[6083,3370],[6083,6610],[4820,6610]], mat:'tile800', at:[5450,4450]},
  {id:'living', name:'客廳', poly:R(4820,6610,10270,10560), mat:'tile800', at:[7600,7560]},
  {id:'balcony', name:'休閒陽臺', poly:R(10510,6610,11850,10560), mat:'walnut', at:[11180,9450]},
  {id:'bay1', name:'主臥飄窗', poly:[[10270,800],[10510,800],[10510,760],[11030,760],[11030,2650],[10510,2650],[10510,2600],[10270,2600]], mat:'marble', counted:false},
  {id:'bay2', name:'子女房飄窗', poly:[[10270,4260],[10510,4260],[10510,4210],[11030,4210],[11030,5785],[10510,5785],[10510,5740],[10270,5740]], mat:'marble', counted:false},
];
export const SAMPLE_MATERIALS: Record<string, Material> = {
  wood:    {name:'橡木地板', price:320, sw:'#d8b88a'},
  walnut:  {name:'胡桃木地板', price:380, sw:'#9b7250'},
  tile800: {name:'800 地磚', price:220, sw:'#ebe6dc'},
  tile600: {name:'600 地磚', price:160, sw:'#dfe3e1'},
  marble:  {name:'大理石', price:650, sw:'#f1eee8'},
  antislip:{name:'300 防滑磚', price:140, sw:'#d3d8d4'},
  terrazzo:{name:'水磨石', price:280, sw:'#e6dfd3'},
  carpet:  {name:'滿鋪地毯', price:200, sw:'#c9c3d3'},
};

// Apartment perimeter dimensions from the reference.
const REFERENCE_DIMENSIONS: DimensionChain[] = [
  { horizontal: true, at: -750, start: 0, segments: [1580, 240, 2760, 240, 1540, 240, 3670] },
  { horizontal: true, at: -1250, start: 0, segments: [10270] },
  { horizontal: true, at: 11350, start: 0, segments: [2180, 240, 2160, 240, 5450, 240, 1340] },
  { horizontal: true, at: 11850, start: 0, segments: [11850] },
  { horizontal: false, at: -800, start: 0, segments: [3370, 1580, 240, 2770, 240, 2360] },
  { horizontal: false, at: -1300, start: 0, segments: [10560] },
  { horizontal: false, at: 12750, start: 0, segments: [3370, 240, 2760, 240, 3950] },
  { horizontal: false, at: 13250, start: 0, segments: [10560] },
];

// Default colour of each furniture type in the sample: the colour of the first item of that type in the web
// furniture library. Fixed here, so the sample does not depend on the library.
const TYPE_COLORS: Record<string, string> = {
  bed: '#c9d6df', nightstand: '#e8dccb', wardrobe: '#efe6d8', baycushion: '#e7dccd', shower: '#e4edf2', toilet: '#ffffff',
  vanity: '#eef1f3', desk: '#e2cfb4', chair: '#cfc6b8', bookshelf: '#e2cfb4', washer: '#e6ebee', counter: '#e9e5de',
  stove: '#dcdcdc', ksink: '#e1e6ea', fridge: '#dfe4e8', table: '#e2cfb4', cabinet: '#efe6d8', rug: '#d9cbb8',
  tvstand: '#e2cfb4', sofa: '#b7c4b0', coffeetable: '#e8dccb', armchair: '#d6b99a', shoecab: '#efe6d8', plant: '#a9c39b',
  roundtable: '#e2cfb4',
};

// Sample furniture ids are fixed (sample-f1, sample-f2, ...): the 3D model details are seeded from the id, so every
// new sample looks the same.
function sampleFurniture(): Furniture[] {
  let n = 0;
  const F = (type: string, name: string, cx: number, cy: number, w: number, d: number, rot = 0, color?: string): Furniture =>
    ({ id: `sample-f${++n}`, type, name, cx, cy, w, d, rot, color: color || TYPE_COLORS[type] || '#eee' });
  return [
  // 主臥
  F('bed','雙人床',8300,1000,1800,2000,0,'#c9d6df'), F('nightstand','床頭櫃',7150,220,450,400), F('nightstand','床頭櫃',9450,220,450,400),
  F('wardrobe','衣櫃',8800,3070,2400,600,180), F('baycushion','飄窗墊',10770,1705,520,1800),
  // 主衛
  F('shower','淋浴房',5270,450,900,900), F('toilet','馬桶',5170,1500,400,700,270), F('vanity','浴室櫃',6110,700,800,500,90),
  // 小孩房
  F('bed','單人床',2420,1000,1200,2000,0,'#e8d5b5'), F('desk','書桌',2120,2700,1200,600,270), F('chair','椅子',2700,2700,450,480,90),
  F('wardrobe','衣櫃',4280,1000,1600,600,90), F('bookshelf','書架',3500,150,800,300),
  // 客衛
  F('shower','淋浴區',2870,4280,900,1340), F('toilet','馬桶',3560,3960,400,700), F('vanity','浴室櫃',4150,3850,700,480),
  // 洗衣陽臺
  F('washer','洗衣機',300,3960,600,600,270), F('vanity','洗衣池',250,4600,600,500,270),
  // 廚房
  F('counter','櫥櫃檯面',300,6575,2770,600,270), F('counter','櫥櫃檯面',1390,7660,1580,600,180),
  F('stove','瓦斯爐',300,6200,750,450,270), F('ksink','水槽',1400,7680,800,450,180),
  // 餐廳
  F('fridge','冰箱',2770,5540,700,700), F('table','餐桌',3600,6650,1400,800,90),
  F('chair','餐椅',2940,6320,450,480,270), F('chair','餐椅',2940,6980,450,480,270),
  F('chair','餐椅',4260,6320,450,480,90), F('chair','餐椅',4260,6980,450,480,90),
  F('cabinet','餐邊櫃',3500,7785,1600,350,180),
  // 客廳
  F('rug','地毯',7600,8950,2600,1800), F('tvstand','電視櫃',7600,6810,2400,400), F('sofa','三人沙發',7600,10110,3000,900,180),
  F('coffeetable','茶几',7600,8900,1300,650), F('armchair','單人沙發',9500,8900,850,850,90),
  F('shoecab','鞋櫃',4995,9900,1000,350,270), F('plant','綠植',9950,10250,500,500), F('plant','綠植',5250,7050,500,500),
  // 子女房
  F('bed','雙人床',7323,5500,1500,2000,270,'#d8c7dc'), F('wardrobe','衣櫃',8500,3910,2000,600),
  F('desk','書桌',9500,6070,1200,600,180), F('chair','椅子',9500,5480,450,480), F('baycushion','飄窗墊',10770,4997,520,1575),
  // 休閒陽臺
  F('roundtable','茶桌',11180,8200,600,600), F('armchair','休閒椅',11180,7520,750,750,0,'#d6b99a'),
  F('armchair','休閒椅',11180,8880,750,750,180,'#d6b99a'), F('plant','綠植',11550,10250,500,500),
];
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** The sample apartment in the v1 shape. `id` defaults to a new random id. */
export function createSamplePlanV1(id: string = createId()): PlanV1 {
  return {
    schemaVersion: 1, id, name: 'Apartment plan', units: 'mm', locale: 'zh-TW',
    walls: WALLS.map(([x0, y0, x1, y1, type], i) => ({ id: `wall-${i}`, rect: [x0, y0, x1, y1], type })),
    openings: [
      ...WINS.map((rect, i) => ({ id: `window-${i}`, type: 'window' as const, rect })),
      ...DOORS.map((door, i) => ({ ...door, id: `door-${i}`, type: 'door' as const })),
      ...SLIDES.map((door, i) => ({ ...door, id: `slide-${i}`, type: 'sliding-door' as const })),
    ],
    rooms: copy(ROOMS), materials: copy(SAMPLE_MATERIALS),
    furniture: sampleFurniture(), measurements: [], dimensions: copy(REFERENCE_DIMENSIONS),
  };
}

/** The sample apartment as a v2 plan. `id` defaults to a new random id. */
export const createSamplePlan = (id?: string): PlanV2 => migrateV1(createSamplePlanV1(id)).plan;

/** A plan with no content. It keeps the sample's floor materials, so rooms added later have materials to use. */
export function createEmptyPlan(id: string = createId()): PlanV2 {
  return {
    schemaVersion: 2, id, name: '未命名平面圖', units: 'mm', locale: 'zh-TW', ceilingHeight: 2800,
    walls: [], openings: [], rooms: [], materials: copy(SAMPLE_MATERIALS), furniture: [], measurements: [], dimensions: [],
  };
}
