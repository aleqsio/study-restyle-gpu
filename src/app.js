// The study restyle planner, drawn with TypeGPU Kit. The planner's settings, objects, links and
// panels are the same as the three.js version's; the room is drawn by gpu.ts, placed by
// pieces.ts and looked at through camera.ts.
import { loadRoom } from "./glb.ts";
import { buildWorld } from "./world.ts";
import { createGpu, MAX_MATS, beforeTone } from "./gpu.ts";
import { createPieces, srgbHexToLinear, lampBase } from "./pieces.ts";
import { Rig, V3 } from "./camera.ts";
import { createGizmo } from "./gizmo.ts";

// Room size in metres (Blender: x east, y north, z up -> GPU and three.js: x, z, -y)
const W = 2.762, D = 3.336, H = 2.70;
const toThree = (x, y, z) => new V3(x, z, -y);
const fmt = (n) => (n >= 1000 ? (n / 1000).toLocaleString("en", { maximumFractionDigits: 1 }) + "k" : String(n));
const range = (lo, hi) => (hi ? `${fmt(lo)}–${fmt(hi)} zł` : "0 zł");
const deg = (d) => (d * Math.PI) / 180;
const radToDeg = (r) => (r * 180) / Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hexToLinear = (hex) => srgbHexToLinear(typeof hex === "string" ? parseInt(hex.replace("#", ""), 16) : hex);
const linearToHex = (c) => "#" + c.slice(0, 3).map((v) => {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(clamp(s, 0, 1) * 255).toString(16).padStart(2, "0");
}).join("");

// ================================================================ whole-room settings
const wood = (base, dark, opts = {}) => ({ wood: [base, dark, opts] });
const conc = (base, opts = {}) => ({ conc: [base, opts] });
const STYLES = {
  green: {
    name: "Mid-century, green", lo: 0, hi: 0, sw: ["#5f8f78", "#8a5459", "#b8862f"],
    note: "Your room as it is: sage on the wardrobe wall and ceiling, white on the other walls, oak floor, mauve wardrobe.",
    mats: {},
  },
  white: {
    name: "Mid-century, warm white", lo: 600, hi: 1500, sw: ["#ebe3d5", "#6b4429", "#8a5459"],
    note: "Warm white walls and ceiling with walnut-toned skirting. The mauve wardrobe, walnut and textiles carry the colour.",
    mats: {
      "Wall Green": { c: "#ebe3d5" }, "Shaft": { c: "#ebe3d5" }, "Wall White": { c: "#ebe3d5" },
      "Ceiling": { c: "#f4f0e9" }, "Skirting Black": { c: "#5a3a24" },
    },
  },
  brutal: {
    name: "Brutalist", lo: 8000, hi: 18000, sw: ["#9e9b95", "#3b3a38", "#7a4424"],
    note: "Microcement on walls and ceiling, a concrete floor finish, charcoal wardrobe, smoked oak, blackened steel, cognac leather. The surfaces need a specialist.",
    mats: {
      "Wall Green": conc("#a29f99"), "Shaft": conc("#a29f99"), "Wall White": conc("#a29f99"),
      "Ceiling": conc("#97948e"), "Oak Floor": conc("#86827c", { polished: true }),
      "Skirting Black": { c: "#86827c" }, "Wardrobe Mauve": { c: "#3b3a38", rough: 0.8 },
      "Walnut": wood("#3c2c22", "#22180f"), "Light Oak": wood("#7b6a57", "#4f4234"), "Reeded Oak": wood("#5c4c3e", "#3a2f25"),
      "Brass": { c: "#2b2b2b", metal: 0.7, rough: 0.4 },
      "Rug Rust": { c: "#3d3b39" }, "Rug Mustard": { c: "#d6cdbd" }, "Rug Cream": { c: "#8a3a22" }, "Rug Ink": { c: "#d6cdbd" },
      "Armchair Mustard Wool": { c: "#7a4424", rough: 0.55 }, "Linen Curtain": { c: "#a8a39a" },
    },
  },
  japandi: {
    name: "Japandi", lo: 1200, hi: 3000, sw: ["#e4ddd0", "#c4a57e", "#cdbfa9"],
    note: "Limewashed greige walls, pale oak and ash, a sand-coloured wardrobe, oatmeal bouclé and a muted rug.",
    mats: {
      "Wall Green": conc("#e2dace", { lime: true }), "Shaft": conc("#e2dace", { lime: true }), "Wall White": conc("#e2dace", { lime: true }),
      "Ceiling": { c: "#f2eee6" }, "Oak Floor": wood("#c9a878", "#a3814f", { planks: 22, streak: 900, size: 2048 }),
      "Skirting Black": { c: "#e2dace" }, "Wardrobe Mauve": { c: "#cdbfa9" },
      "Walnut": wood("#c4a57e", "#9c7f58"), "Light Oak": wood("#d4b78e", "#a88a60"), "Reeded Oak": wood("#cfb48b", "#a3875e"),
      "Brass": { c: "#5d5b56", metal: 0.6, rough: 0.4 }, "Desk Black Ash": wood("#c4a57e", "#9c7f58"),
      "Rug Rust": { c: "#d9d0c1" }, "Rug Mustard": { c: "#8a7b66" }, "Rug Cream": { c: "#b9ab95" }, "Rug Ink": { c: "#6f655a" },
      "Armchair Mustard Wool": { c: "#ddd4c4" }, "Linen Curtain": { c: "#e6dfd2" },
    },
  },
};
const PAINT = {
  today: { name: "As the style", lo: 0, hi: 0 },
  ceilwhite: { name: "White ceiling", lo: 300, hi: 700, mats: { "Ceiling": { c: "#f4f0e9" } } },
  twotone: { name: "Two-tone", lo: 400, hi: 900 },
  drench: { name: "Colour-drench", lo: 600, hi: 1500, mats: { "Wardrobe Mauve": { c: "#5f8f78" }, "Door White": { c: "#5f8f78" }, "Skirting Black": { c: "#5f8f78" } } },
  doorolive: { name: "Olive door wall", lo: 400, hi: 900, mats: { "Wall Door": { c: "#5d6339" }, "Wall Green": { c: "#ebe3d5" }, "Shaft": { c: "#ebe3d5" }, "Ceiling": { c: "#f2eee6" } } },
  limewash: { name: "Sage limewash", lo: 500, hi: 1200, mats: { "Wall Green": conc("#5f8f78", { lime: true }), "Shaft": conc("#5f8f78", { lime: true }) } },
  shaft: { name: "Mustard shaft", lo: 100, hi: 300, mats: { "Shaft": { c: "#c9932c" } } },
};
const FINISH = {
  none: { name: "Plain", lo: 0, hi: 0 },
  grass: { name: "Grasscloth", lo: 1200, hi: 2500, mats: { "Wall Green": conc("#b9a77e", { grass: true }) } },
  rail: { name: "Picture rail", lo: 300, hi: 800 },
};
const LIGHTS = {
  today: { name: "Black plafon", lo: 0, hi: 0 },
  globe: { name: "Opal globe", lo: 300, hi: 800 },
  lantern: { name: "Paper lantern", lo: 400, hi: 1500 },
  ph: { name: "Layered shades", lo: 800, hi: 3500 },
  track: { name: "Track spots", lo: 600, hi: 1500 },
  rattan: { name: "Rattan shade", lo: 200, hi: 600 },
};
// Wall colours you can set by hand; they win over the style and paint. Order only ever grows (links).
const WALLS = {
  west: { name: "Wardrobe wall", mat: "Wall Green" },
  south: { name: "Window wall", mat: "Wall White" },
  east: { name: "Wall opposite the desk", mat: "Wall East" },
  north: { name: "Door wall", mat: "Wall Door" },
  shaft: { name: "Shaft column", mat: "Shaft" },
  ceiling: { name: "Ceiling", mat: "Ceiling" },
};
const WALL_KEYS = Object.keys(WALLS);
const WALL_OF_MAT = Object.fromEntries(WALL_KEYS.map((k) => [WALLS[k].mat, k]));
const WALL_PAINT = [150, 400]; // rough cost of repainting one surface yourself
// Things fixed to the room (window, radiator, door, ceiling, floor)
const ROOM_ADDONS = {
  pelmet: { name: "Wooden pelmet over the blind", lo: 600, hi: 1500 },
  sill: { name: "Deeper oak sill", lo: 400, hi: 900 },
  film: { name: "Reeded window film", lo: 100, hi: 250 },
  colrad: { name: "Black column radiator", lo: 3000, hi: 6000 },
  trv: { name: "Smart radiator valve", lo: 200, hi: 400 },
  nightlight: { name: "Motion night light", lo: 50, hi: 150 },
  uplight: { name: "Uplight on the shaft", lo: 100, hi: 300 },
  excluder: { name: "Draught excluder", lo: 50, hi: 150 },
  abovedoor: { name: "Cabinet above the door", lo: 800, hi: 2000 },
  projector: { name: "Projector and pull-down screen", lo: 1500, hi: 4000 },
  darkfloor: { name: "Re-oil the floor darker", lo: 3000, hi: 6000, mats: { "Oak Floor": wood("#7a4f2a", "#4a2e14", { planks: 22, streak: 900, size: 2048 }) } },
};

// ================================================================ objects
// Families: one template whose version you pick per object. Option values: [label, lo, hi].
const FAMILIES = {
  desk: {
    name: "Desk", cat: "Desks & tables",
    options: [
      { key: "top", label: "Top", tag: "desk", values: { today: ["Black, white legs", 0, 0], walnut: ["Walnut, black legs", 1000, 2500], oak: ["Light oak", 800, 2000], l: ["L-shaped walnut", 2000, 4500], long: ["275 cm walnut", 2500, 5000] } },
      { key: "len", label: "Length", values: { l120: ["120 cm", 0, 0], l130: ["130 cm", 700, 1800], l140: ["140 cm", 750, 2000], l150: ["150 cm", 800, 2200], l160: ["160 cm", 850, 2400] },
        when: (o) => ["today", "walnut", "oak"].includes(o.top), free: (o) => o.top !== "today" },
      { key: "lamp", label: "Desk lamp", tag: "desklamp", values: { today: ["Arm + bulb lamps", 0, 0], mushroom: ["Mushroom", 300, 900], angle: ["Anglepoise", 400, 1500] } },
      { key: "pc", label: "PC tower", tag: "pc", values: { today: ["On the floor", 0, 0], caddy: ["Wheeled caddy", 150, 300], mount: ["Under-desk mount", 150, 400] } },
    ],
    addons: { bias: ["Monitor bias light", 80, 300], monarm: ["Monitor arm", 200, 600], screen2: ["Vertical second monitor", 800, 2000], riser: ["Walnut monitor riser", 150, 400],
      pad: ["Felt desk pad", 80, 250], acc: ["Teak and brass accessories", 150, 500], charger: ["Wireless charger", 100, 300], mic: ["Mic arm", 150, 500],
      spine: ["Cable spine", 60, 150], pedestal: ["Drawer pedestal", 400, 1200], rack: ["10-inch home-lab rack", 600, 2000], perch: ["Standing perch stool", 300, 900] },
  },
  chair: {
    name: "Desk chair", cat: "Seating",
    options: [{ key: "model", label: "Model", tag: "chair", values: { today: ["IKEA MARKUS", 0, 0], ag: ["Aluminium Group", 5000, 9000], kneel: ["Kneeling", 800, 2500], cantilever: ["Cantilever", 700, 2000] } }],
    addons: { sheepskin: ["Sheepskin", 150, 400], chairmat: ["Felt chair mat", 100, 300] },
  },
  wardrobe: {
    name: "Wardrobe", cat: "Storage",
    options: [{ key: "v", label: "Fronts", tag: "wardrobe", values: { today: ["Mauve", 0, 0], reeded: ["Reeded oak", 6000, 10000], sage: ["Painted sage", 300, 800], shoji: ["Shoji fronts", 2500, 6000], bookcase: ["Open bookcase", 3000, 7000] } }],
  },
  shelves: {
    name: "Wall shelves", cat: "Storage",
    options: [{ key: "v", label: "Style", tag: "shelf", values: { string: ["String rails", 1200, 3000], planks: ["Floating planks", 300, 800], rails: ["Aluminium tracks", 1500, 6000], cubes: ["Wall boxes", 400, 1200], pegboard: ["Wood pegboard", 200, 600] } }],
    addons: { growlight: ["Grow light under the shelf", 100, 300] },
  },
  // IKEA HYLLIS runs (60 × 27 × 74 cm each, metal shelves) under one top in the desk's woods
  ...Object.fromEntries([1, 2, 3].map((n) => [`piece:hyllis${n}`, {
    name: `HYLLIS ×${n} with a wooden top, ${n * 60} cm`, cat: "Storage",
    options: [{ key: "wood", label: "Top", tag: "hyllis", values: {
      oak: ["Light oak, like the oak desk", 100 + 150 * n, 250 + 300 * n],
      walnut: ["Walnut, like the walnut desk", 150 + 250 * n, 350 + 500 * n],
      black: ["Black ash, like your desk today", 100 + 150 * n, 250 + 350 * n] } }],
  }])),
  rug: {
    name: "Rug", cat: "Rugs",
    options: [{ key: "v", label: "Rug", tag: "rug", values: { geo: ["Geometric wool 160 × 230", 600, 1200], jute: ["Round jute", 300, 800], kilim: ["Kilim", 800, 3000] } }],
  },
};
// Every other template: [name, category, lo, hi, in gallery]
const SINGLES = {
  "corner:reading/armchair": ["366 armchair", "Seating", 3000, 4500],
  "corner:pair/armchair 1": ["366 armchair", "Seating", 3000, 4500, false],
  "corner:pair/armchair 2": ["366 armchair", "Seating", 3000, 4500, false],
  "freed:nook/armchair": ["366 armchair", "Seating", 3000, 4500, false],
  "corner:rocker/rocker": ["Bentwood rocker", "Seating", 1000, 2500],
  "corner:hanging": ["Hanging egg chair", "Seating", 1200, 3000],
  "corner:beanbag/bean bag": ["Leather bean bag", "Seating", 500, 1500],
  "opp:beanbag/bean bag": ["Corduroy bean bag", "Seating", 500, 1500],
  "opp:eames/chair": ["Eames lounge chair", "Seating", 3500, 8000],
  "corner:eames/chair": ["Eames lounge chair", "Seating", 3500, 8000, false],
  "opp:eames/ottoman": ["Eames ottoman", "Seating", 500, 1000],
  "corner:eames/ottoman": ["Eames ottoman", "Seating", 500, 1000, false],
  "opp:daybed": ["Daybed", "Seating", 2500, 6000],
  "opp:lounge": ["Floor sofa", "Seating", 1500, 4000],
  "x:pouf": ["Leather pouf", "Seating", 300, 900],
  "opp:beanbag/pouf": ["Round pouf with tray", "Seating", 300, 900],
  "x:ottoman": ["Mustard ottoman", "Seating", 500, 1500],
  "corner:secretary/stool": ["Stool", "Seating", 150, 400],
  "freed:desk2/stool": ["Oak stool", "Seating", 150, 400],
  "corner:reading/side table": ["Round side table", "Desks & tables", 400, 900],
  "corner:pair/coffee table": ["Tulip coffee table", "Desks & tables", 600, 1500],
  "corner:secretary/secretary": ["Secretary desk", "Desks & tables", 1500, 3500],
  "freed:desk2/desk": ["Hobby trestle desk", "Desks & tables", 500, 1200],
  "opp:bench": ["Electronics bench", "Desks & tables", 2000, 5000],
  "x:bench": ["Radiator bench", "Storage", 2500, 5000],
  "corner:bookcase": ["Tall bookcase", "Storage", 800, 2500],
  "opp:console": ["Steel drawers 120", "Storage", 1500, 3500],
  "opp:long": ["Steel drawers 195", "Storage", 2500, 5500],
  "opp:hifi": ["Hi-fi unit", "Storage", 1500, 4000],
  "opp:console/print": ["Framed print", "Wall decor", 100, 300],
  "opp:long/prints on a ledge": ["Picture ledge with prints", "Wall decor", 200, 500],
  "opp:hifi/print": ["Framed print", "Wall decor", 100, 300, false],
  "opp:bench/pegboard": ["Pegboard with tools", "Storage", 150, 500],
  "opp:prl": ["PRL wall unit", "Storage", 800, 3000],
  "opp:planchest": ["Plan chest", "Storage", 1500, 4000],
  "freed:dresser": ["Dresser", "Storage", 1500, 4000],
  "freed:rail": ["Clothes rail", "Storage", 400, 1200],
  "between:tower": ["Slim shelf tower", "Storage", 600, 1800],
  "x:laddershelf": ["Ladder shelf", "Storage", 300, 800],
  "x:shaftshelves": ["Shaft shelves", "Storage", 150, 400],
  "freed:nook/shelf": ["Small wall shelf", "Storage", 100, 300],
  "opp:beanbag/basket": ["Book basket", "Storage", 100, 300],
  "corner:reading/floor lamp": ["Tripod floor lamp", "Lighting", 500, 1200],
  "freed:nook/floor lamp": ["Tripod floor lamp", "Lighting", 500, 1200, false],
  "corner:rocker/lantern": ["Paper floor lantern", "Lighting", 400, 1200],
  "corner:beanbag/floor lamp": ["Pole floor lamp", "Lighting", 200, 600],
  "opp:beanbag/floor lamp": ["Pole floor lamp", "Lighting", 200, 600, false],
  "opp:eames/floor lamp": ["Dome floor lamp", "Lighting", 400, 1200],
  "corner:eames/floor lamp": ["Dome floor lamp", "Lighting", 400, 1200, false],
  "x:sconces": ["Wall sconces, pair", "Lighting", 600, 1600],
  "x:piclights/above desk": ["Picture light", "Lighting", 100, 300],
  "x:piclights/on shaft": ["Picture light", "Lighting", 100, 300, false],
  "plant:rubber": ["Rubber plant", "Plants", 250, 500],
  "plant:monstera": ["Monstera", "Plants", 200, 600],
  "plant:ladder": ["Plant ladder", "Plants", 300, 700],
  "plant:hanging": ["Hanging pothos, pair", "Plants", 150, 400],
  "plant:windowrod": ["Window rod with pots", "Plants", 150, 350],
  "freed:plants/fig": ["Fiddle-leaf fig", "Plants", 200, 500],
  "freed:plants/snake plant": ["Snake plant", "Plants", 100, 250],
  "freed:plants/fern": ["Fern on a stand", "Plants", 150, 400],
  "between:plant": ["Snake plant trough", "Plants", 300, 800],
  "x:runner": ["Runner rug", "Rugs", 200, 600],
  "between:fin": ["Oak fin", "Dividers", 300, 800],
  "between:slats": ["Slatted screen", "Dividers", 800, 2000],
  "between:glass": ["Reeded glass panel", "Dividers", 1500, 3500],
  "between:felt": ["Felt desk screen", "Dividers", 300, 900],
  "between:cords": ["Cord curtain", "Dividers", 200, 600],
  "between:folding": ["Folding screen", "Dividers", 500, 2000],
  "art:posters/above desk": ["Polish School poster", "Wall decor", 100, 250],
  "art:posters/on shaft": ["Polish School poster", "Wall decor", 100, 250, false],
  "art:film/above desk": ["Film poster", "Wall decor", 150, 350],
  "art:film/on shaft": ["Film poster", "Wall decor", 150, 350, false],
  "art:gallery": ["Gallery wall", "Wall decor", 300, 900],
  "art:clock": ["Sunburst clock", "Wall decor", 300, 900],
  "art:textile": ["Woven wall hanging", "Wall decor", 500, 1500],
  "x:hooks": ["Door hook rail with a coat", "Storage", 80, 250],
  "piece:globelamp": ["Opal globe table lamp", "Lighting", 200, 700],
  "piece:wire/wire shelf": ["Chrome wire cube shelf", "Storage", 1500, 9000],
  "piece:wire/donut lamp": ["Orange glass donut lamp", "Lighting", 300, 1200],
  "piece:wire/u candle holder": ["Chrome U candle holder", "Small things", 80, 250],
  "piece:wire/chrome vase": ["Chrome cylinder vase", "Small things", 100, 400],
  "art:mcm/green gradient": ["Gradient in the wall green", "Paintings", 150, 450],
  "art:mcm/mauve gradient": ["Gradient in the wardrobe mauve", "Paintings", 150, 450],
  "art:mcm/green into mauve": ["Green into mauve gradient", "Paintings", 250, 700],
  "art:mcm/sunset arches": ["Sunset arches", "Paintings", 150, 400],
  "art:mcm/circles": ["Circles and a line", "Paintings", 120, 350],
  "art:mcm/cut-out leaves": ["Cut-out leaves", "Paintings", 120, 350],
  "art:mcm/layered hills": ["Layered hills", "Paintings", 200, 500],
  "art:mcm/sun and horizon": ["Sun over the horizon", "Paintings", 120, 350],
  "art:mcm/colour field": ["Colour field", "Paintings", 300, 900],
  "art:mcm/boomerangs": ["Boomerang pattern", "Paintings", 80, 250],
  "wf:slats": ["Oak slat wall", "Wall decor", 1500, 3500],
  "wf:cork": ["Cork wall", "Wall decor", 300, 800],
  "between:pinboard": ["Cork pinboard", "Wall decor", 150, 400],
  "between:paint": ["Painted niche", "Wall decor", 200, 500],
  "x:felt": ["Felt acoustic panels", "Wall decor", 400, 1200],
  "x:pegrail": ["Shaker peg rail, chairs", "Wall decor", 400, 1200],
  "x:eink": ["E-ink dashboard", "Wall decor", 300, 800],
  "x:globe": ["Vintage floor globe", "Small things", 300, 1200],
  "x:humidifier": ["Ceramic humidifier", "Small things", 200, 600],
  "x:terrarium": ["Terrarium", "Small things", 100, 300],
  "x:figurines": ["Ćmielów figurines", "Small things", 100, 600],
  "x:flipclock": ["Flip clock", "Small things", 100, 300],
  "x:co2": ["CO₂ sensor", "Small things", 150, 500],
  "x:matrix": ["LED matrix clock", "Small things", 100, 300],
  "x:baskets": ["Woven baskets", "Small things", 80, 250],
  "x:throw": ["Throw and cushions", "Small things", 200, 600],
};
const CATEGORIES = ["Seating", "Desks & tables", "Storage", "Lighting", "Plants", "Rugs", "Dividers", "Wall decor", "Paintings", "Small things"];
const PROTO_IDS = [...Object.keys(FAMILIES), ...Object.keys(SINGLES)];
const infoOf = (p) => (FAMILIES[p] ? { name: FAMILIES[p].name, cat: FAMILIES[p].cat, family: FAMILIES[p] } : { name: SINGLES[p][0], cat: SINGLES[p][1], lo: SINGLES[p][2], hi: SINGLES[p][3] });
function fnv(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
const CODE_OF = Object.fromEntries(PROTO_IDS.map((p) => [p, fnv(p).slice(0, 6)]));
const PROTO_OF_CODE = Object.fromEntries(PROTO_IDS.map((p) => [CODE_OF[p], p]));

function defaultOpts(p) {
  const f = FAMILIES[p];
  return f ? Object.fromEntries(f.options.map((o) => [o.key, Object.keys(o.values)[0]])) : {};
}
function priceOf(inst) {
  const f = FAMILIES[inst.p];
  if (!f) { const s = SINGLES[inst.p]; return [s[2], s[3]]; }
  let lo = 0, hi = 0;
  for (const o of f.options) {
    if (o.when && !o.when(inst.o)) continue;
    if (o.free && o.free(inst.o)) continue;
    const v = o.values[inst.o[o.key]];
    if (v) { lo += v[1]; hi += v[2]; }
  }
  for (const a of inst.a) if (f.addons && f.addons[a]) { lo += f.addons[a][1]; hi += f.addons[a][2]; }
  return [lo, hi];
}

// ================================================================ presets (the earlier option sets, now placing objects)
const LEGACY = {
  order: ["paint", "wf", "light", "desklamp", "desk", "chair", "pc", "shelf", "wardrobe", "freed", "window", "rug", "art", "corner", "opp", "plant", "between", "desklen"],
  slots: {
    paint: ["today", "ceilwhite", "twotone", "drench", "doorolive", "limewash", "shaft"], wf: ["none", "slats", "cork", "grass", "rail"],
    light: ["today", "globe", "lantern", "ph", "track", "rattan"], desklamp: ["today", "mushroom", "angle"],
    desk: ["today", "walnut", "oak", "wide", "l", "long", "short"], chair: ["today", "ag", "kneel", "cantilever"], pc: ["today", "caddy", "mount"],
    shelf: ["none", "string", "planks", "rails", "cubes", "pegboard"], wardrobe: ["today", "reeded", "sage", "shoji", "bookcase", "none"],
    freed: ["empty", "rail", "dresser", "desk2", "nook", "plants"], window: ["today", "linen", "venetian", "cafe", "motor", "blackout"],
    rug: ["none", "geo", "jute", "kilim"], art: ["none", "posters", "film", "gallery", "clock", "textile"],
    corner: ["none", "reading", "rocker", "bookcase", "pair", "hanging", "beanbag", "secretary", "eames"],
    opp: ["none", "console", "long", "bench", "hifi", "daybed", "prl", "planchest", "beanbag", "lounge", "eames"],
    plant: ["none", "rubber", "monstera", "ladder", "hanging", "windowrod"],
    between: ["none", "fin", "slats", "glass", "felt", "pinboard", "cords", "paint", "tower", "plant", "folding"], desklen: ["l120", "l130", "l140", "l150", "l160"],
  },
  x: ["bias", "sconces", "piclights", "uplight", "nightlight", "pelmet", "sill", "film", "colrad", "trv", "bench", "runner", "chairmat", "sheepskin", "throw",
    "pouf", "ottoman", "darkfloor", "monarm", "pedestal", "pad", "riser", "spine", "screen2", "charger", "acc", "mic", "perch", "rack", "shaftshelves",
    "laddershelf", "hooks", "abovedoor", "baskets", "pegrail", "felt", "eink", "projector", "co2", "matrix", "figurines", "flipclock", "globe", "growlight",
    "excluder", "humidifier", "terrarium"],
};
const base = () => Object.fromEntries(LEGACY.order.map((k) => [k, LEGACY.slots[k][0]]));
const PRESETS = {
  today: { name: "Today", note: "Your room as it is.", slots: base(), x: [] },
  rec: { name: "Mid-century", note: "Walnut desk, globe pendant, reading corner, steel drawers, posters, rug.", slots: { ...base(), light: "globe", desklamp: "mushroom", desk: "walnut", pc: "caddy", shelf: "string",
    rug: "geo", art: "posters", corner: "reading", opp: "console", plant: "rubber" }, x: ["bias", "throw", "acc"] },
  bold: { name: "Bold", note: "Olive door wall, slats, lantern, open bookcase, kilim, rocker and hi-fi.", slots: { ...base(), paint: "doorolive", wf: "slats", light: "lantern", desklamp: "angle", desk: "walnut", desklen: "l160", chair: "cantilever", pc: "mount",
    shelf: "rails", wardrobe: "bookcase", rug: "kilim", art: "gallery", corner: "rocker", opp: "hifi", plant: "hanging" }, x: ["sconces", "uplight", "sheepskin", "monarm", "pad", "felt", "pelmet"] },
  maker: { name: "Maker", note: "Electronics bench, L-shaped desk, pegboard, track lights, rack and sensors.", slots: { ...base(), wf: "cork", light: "track", desklamp: "angle", desk: "l", chair: "kneel", pc: "mount", shelf: "pegboard",
    rug: "none", art: "film", corner: "bookcase", opp: "bench", plant: "ladder" }, x: ["rack", "mic", "screen2", "matrix", "co2", "eink", "monarm", "spine", "growlight", "felt"] },
  empty: { name: "Empty room", note: "Just the walls, window and door.", empty: true },
};

// Desk arrangements: where the desk, chair, desk-wall pieces and opposite-wall pieces go
const ARRANGE = {
  A: { name: "Desk by the wardrobe", desk: [0.35, 0.80, 0], chair: [1.05, 0.75, 0] },
  B: { name: "Desk at the window", desk: [0.95, 0.35, 90], chair: [0.95, 1.10, 90] },
  C: { name: "Desk on the east wall", desk: [W - 0.35, 1.05, 180], chair: [1.65, 1.05, 180], wall: [W, 1.05, 180],
    opp: { "opp:console": [0.235, 0.95], "opp:long": [0.235, 0.62], "opp:bench": [0.31, 0.90], "opp:hifi": [0.21, 0.95], "opp:daybed": [0.40, 1.00],
      "opp:prl": [0.225, 0.95], "opp:planchest": [0.37, 0.90], "opp:lounge": [0.41, 1.05], "opp:beanbag": [0.40, 0.95], "opp:eames": [0.55, 1.05] } },
};
const DESK_WALL = new Set(["shelves", "art:posters/above desk", "art:film/above desk", "x:piclights/above desk", "wf:slats", "wf:cork", "between:paint"]);

// ================================================================ state
// objects: [{ id, p (template), x, y (m), r (deg), z (m, wall height offset), o (options), a (add-ons) }]
let nextId = 1;
function inst(p, o = {}, a = []) {
  const t = TPL[p];
  const opts = { ...defaultOpts(p), ...o };
  const f = FAMILIES[p];
  if (f) for (const opt of f.options) if (!(opts[opt.key] in opt.values)) opts[opt.key] = Object.keys(opt.values)[0];
  const adds = new Set(a.filter((k) => f && f.addons && k in f.addons));
  return { id: nextId++, p, x: t ? t.home[0] : 1.4, y: t ? t.home[1] : 1.6, r: 0, z: 0, o: opts, a: adds };
}
const state = { style: "green", scene: "everyday", view: "doll", paint: "today", finish: "none", light: "today", room: new Set(), colors: {}, lamp: null, objects: [] };

function rotateAbout([x, y], [px, py], rdeg) {
  const c = Math.cos(deg(rdeg)), s = Math.sin(deg(rdeg));
  return [px + (x - px) * c - (y - py) * s, py + (x - px) * s + (y - py) * c];
}
function arrange(objs, layout) {
  const L = ARRANGE[layout];
  const hasWardrobe = objs.some((o) => o.p === "wardrobe");
  for (const o of objs) {
    const t = TPL[o.p];
    if (!t) continue;
    if (o.p === "desk") [o.x, o.y, o.r] = L.desk;
    else if (o.p === "chair") [o.x, o.y, o.r] = L.chair;
    else if (DESK_WALL.has(o.p) && L.wall) {
      [o.x, o.y] = rotateAbout(t.home, [0, 0.80], 180).map((v, i) => v + [L.wall[0], L.wall[1] - 0.80][i]);
      o.r = 180;
    } else if (t.set && L.opp && L.opp[t.set]) {
      let piv = L.opp[t.set];
      if (t.set === "opp:long" && !hasWardrobe) piv = [0.235, 1.03];
      const [rx, ry] = rotateAbout(t.home, t.setPivot, 180);
      [o.x, o.y, o.r] = [rx - t.setPivot[0] + piv[0], ry - t.setPivot[1] + piv[1], 180];
    } else if (DESK_WALL.has(o.p) || t.set) { [o.x, o.y] = t.home; o.r = 0; }
  }
}
// Turn one of the earlier option sets into a scene of objects
function fromPreset(P, layout = "A") {
  if (P.empty) return { paint: "today", light: "today", finish: "none", room: new Set(), colors: {}, lamp: null, objects: [] };
  const s = P.slots, x = new Set(P.x || []);
  const out = { paint: s.paint, light: s.light, finish: s.wf === "grass" || s.wf === "rail" ? s.wf : "none", room: new Set([...x].filter((k) => k in ROOM_ADDONS)), colors: {}, lamp: null, objects: [] };
  const add = (p, o, a) => { if (TPL[p]) out.objects.push(inst(p, o, a)); };
  const addTag = (tag) => { for (const p of PROTO_IDS) if (p === tag || p.startsWith(tag + "/")) add(p); };
  let top = s.desk, len = s.desklen;
  if (top === "wide") { top = "walnut"; len = "l160"; }
  if (top === "short") { top = "walnut"; len = "l130"; }
  if (top === "long" && s.wardrobe !== "none") top = "today";
  add("desk", { top, len, lamp: s.desklamp, pc: s.pc }, [...x]);
  add("chair", { model: s.chair }, [...x]);
  if (s.wardrobe !== "none") add("wardrobe", { v: s.wardrobe });
  if (s.shelf !== "none") add("shelves", { v: s.shelf }, [...x]);
  if (s.rug !== "none") add("rug", { v: s.rug });
  if (s.art !== "none") addTag(`art:${s.art}`);
  if (s.wf === "slats" || s.wf === "cork") addTag(`wf:${s.wf}`);
  for (const k of ["corner", "opp", "plant", "between"]) if (s[k] !== LEGACY.slots[k][0]) addTag(`${k}:${s[k]}`);
  if (s.wardrobe === "none" && s.freed !== "empty") addTag(`freed:${s.freed}`);
  for (const k of x) if (!(k in ROOM_ADDONS)) addTag(`x:${k}`);
  arrange(out.objects, layout);
  return out;
}

// ================================================================ the link
// "r2" + style, scene, view, paint, finish, light + "-" + room add-on bits,
// then per object "~" code.x.y.rot.z.options (cm, degrees; "_" = minus). Orders only ever grow.
const STYLE_KEYS = Object.keys(STYLES), SCENE_KEYS = ["evening", "everyday", "focus"];
const VIEW_KEYS = ["doll", "photo", "door", "opposite", "seated", "standing", "top"];
const PAINT_KEYS = Object.keys(PAINT), FINISH_KEYS = Object.keys(FINISH), LIGHT_KEYS = Object.keys(LIGHTS), ROOM_KEYS = Object.keys(ROOM_ADDONS);
// Links keep the room add-ons' old bit order; the door hook rail used to be one and is now a piece
const ROOM_LINK_KEYS = [...ROOM_KEYS.slice(0, 8), "hooks", ...ROOM_KEYS.slice(8)];
const n36 = (v) => (v < 0 ? "_" : "") + Math.abs(Math.round(v)).toString(36);
const p36 = (s) => (s[0] === "_" ? -1 : 1) * parseInt(s.replace("_", "") || "0", 36);
const bits36 = (keys, set) => { let b = 0n; keys.forEach((k, i) => { if (set.has(k)) b |= 1n << BigInt(i); }); return b.toString(36); };
const unbits36 = (keys, str) => { let b = 0n; for (const d of str || "") b = b * 36n + BigInt(parseInt(d, 36)); return new Set(keys.filter((k, i) => (b >> BigInt(i)) & 1n)); };
function encode(s) {
  const c = (keys, v) => Math.max(0, keys.indexOf(v)).toString(36);
  let t = "r2" + c(STYLE_KEYS, s.style) + c(SCENE_KEYS, s.scene) + c(VIEW_KEYS, s.view) + c(PAINT_KEYS, s.paint) + c(FINISH_KEYS, s.finish) + c(LIGHT_KEYS, s.light);
  t += "-" + bits36(ROOM_LINK_KEYS, s.room);
  const cols = WALL_KEYS.filter((k) => s.colors && s.colors[k]);
  if (cols.length) t += "~cc" + cols.map((k) => `.${WALL_KEYS.indexOf(k).toString(36)}${s.colors[k].slice(1)}`).join("");
  if (s.lamp) t += "~cl." + s.lamp.slice(1);
  for (const o of s.objects) {
    const f = FAMILIES[o.p];
    const opts = f ? f.options.map((op) => Math.max(0, Object.keys(op.values).indexOf(o.o[op.key])).toString(36)).join("") + "-" + bits36(Object.keys(f.addons || {}), o.a) : "";
    t += `~${CODE_OF[o.p]}.${n36(o.x * 100)}.${n36(o.y * 100)}.${n36(o.r)}.${n36(o.z * 100)}.${opts}${o.lc ? "." + o.lc.slice(1) : ""}`;
  }
  return t;
}
function decode(tok) {
  const [head, ...objs] = (tok || "").split("~");
  const m = /^r2([0-9a-z]{6})-([0-9a-z]*)$/.exec(head);
  if (!m) return null;
  const at = (i, keys) => keys[parseInt(m[1][i], 36)];
  const s = { style: at(0, STYLE_KEYS) || "green", scene: at(1, SCENE_KEYS) || "everyday", view: at(2, VIEW_KEYS) || "doll",
    paint: at(3, PAINT_KEYS) || "today", finish: at(4, FINISH_KEYS) || "none", light: at(5, LIGHT_KEYS) || "today", room: unbits36(ROOM_LINK_KEYS, m[2]), colors: {}, lamp: null, objects: [] };
  if (s.room.delete("hooks")) s.objects.push({ ...inst("x:hooks"), x: 1.18, y: D }); // where it hung as a room add-on
  for (const e of objs) {
    if (e.startsWith("cc.")) {
      for (const c of e.split(".").slice(1)) { const k = WALL_KEYS[parseInt(c[0], 36)]; if (k && /^[0-9a-f]{6}$/.test(c.slice(1))) s.colors[k] = "#" + c.slice(1); }
      continue;
    }
    if (e.startsWith("cl.")) { if (/^[0-9a-f]{6}$/.test(e.slice(3))) s.lamp = "#" + e.slice(3); continue; }
    const [code, x, y, r, z, opts = "", lc = ""] = e.split(".");
    const p = PROTO_OF_CODE[code];
    if (!p) continue;
    const f = FAMILIES[p], o = {}, [idx = "", ab = ""] = opts.split("-");
    if (f) f.options.forEach((op, i) => { const k = Object.keys(op.values)[parseInt(idx[i], 36)]; if (k) o[op.key] = k; });
    s.objects.push({ id: nextId++, p, x: p36(x) / 100, y: p36(y) / 100, r: p36(r), z: p36(z) / 100, o: { ...defaultOpts(p), ...o }, a: f ? unbits36(Object.keys(f.addons || {}), ab) : new Set(), ...(/^[0-9a-f]{6}$/.test(lc) ? { lc: "#" + lc } : {}) });
  }
  return s;
}
// Links from before objects existed: "r1" + style, layout, scene, view, one char per option, "-" add-ons
function decodeLegacy(tok) {
  const m = /^r1([0-9a-z]+)-([0-9a-z]*)/.exec(tok || "");
  if (!m) return null;
  const c = m[1], slots = base();
  LEGACY.order.forEach((k, i) => { const v = c[4 + i] && LEGACY.slots[k][parseInt(c[4 + i], 36)]; if (v) slots[k] = v; });
  return { style: STYLE_KEYS[parseInt(c[0], 36)] || "green", layout: ["A", "B", "C"][parseInt(c[1], 36)] || "A", scene: SCENE_KEYS[parseInt(c[2], 36)] || "everyday",
    view: VIEW_KEYS[parseInt(c[3], 36)] || "doll", preset: { slots, x: [...unbits36(LEGACY.x, m[2])] } };
}


// ================================================================ the GPU room
const canvas = document.getElementById("room");
const rig = new Rig(canvas);
let gpu = null, world = null, pieces = null;

// The look the model ships with: Blender's node woods, redrawn as patterns
const ORIGINAL_TEX = {
  "Pegboard": { peg: "#34363a" },
  "Birch Pegboard": { peg: "#d8c19a" },
  "Cork": conc("#b88a5a", { lime: true }),
  "Oak Floor": wood("#a8723f", "#6d431d", { planks: 22, streak: 900, size: 2048 }),
  "Walnut": wood("#6b4429", "#3b2414"),
  "Light Oak": wood("#b98a55", "#7d5730"),
  "Reeded Oak": wood("#b98950", "#7d5730"),
  "Window Oak": wood("#b8782f", "#7a4a18"),
  "Desk Black Ash": wood("#241f1c", "#0e0c0b"),
  "PRL Veneer": wood("#7a4a2a", "#4a2a14"),
};
// Every pattern any setting can ask for, drawn once into one texture array
const isPattern = (spec) => spec && (spec.wood || spec.conc || spec.peg);
const PATTERN_SPECS = [];
const patternIndex = new Map();
for (const src of [ORIGINAL_TEX, ...Object.values(STYLES).map((s) => s.mats), ...Object.values(PAINT).map((s) => s.mats || {}),
  ...Object.values(FINISH).map((s) => s.mats || {}), ...Object.values(ROOM_ADDONS).map((s) => s.mats || {})]) {
  for (const spec of Object.values(src)) {
    if (!isPattern(spec)) continue;
    const key = JSON.stringify(spec);
    if (!patternIndex.has(key)) { patternIndex.set(key, PATTERN_SPECS.length); PATTERN_SPECS.push(spec); }
  }
}

// Light colour: the lamp's light and its glowing shade or bulb follow one colour
const GLOW = new Set(["Bulb", "Bias Glow", "Mushroom Lamp", "Linen Shade", "Paper Lantern", "Opal Glass", "Plafon Diffuser", "Night Glow", "Grow Glow", "Donut Glass", "Globe Opal"]);
const materials = new Map(); // name -> { index, orig: { color (linear), roughness, metallic, emission, strength } }
function applyMaterials(overrides) {
  for (const [mname, { index, orig }] of materials) {
    let spec = overrides[mname];
    if (!spec && (mname === "Wall Door" || mname === "Wall East")) spec = overrides["Wall White"];
    spec = spec || ORIGINAL_TEX[mname] || null;
    const v = { color: orig.color, roughness: orig.roughness, metallic: orig.metallic, emission: orig.emission, pattern: -1 };
    if (isPattern(spec)) {
      v.pattern = patternIndex.get(JSON.stringify(spec));
      v.color = [1, 1, 1];
      if (spec.conc && spec.conc[1] && spec.conc[1].polished) v.roughness = 0.35;
    } else if (spec && spec.c) {
      v.color = hexToLinear(spec.c);
      v.roughness = spec.rough ?? orig.roughness;
      v.metallic = spec.metal ?? orig.metallic;
    }
    gpu.setMaterial(index, v);
  }
}

const SCENES = {
  evening: { ceiling: 0xffb26a, hemi: 0xffcf9a, hemiI: 0.55, mul: 0.75 },
  everyday: { ceiling: 0xffd2a0, hemi: 0xffe6c8, hemiI: 0.75, mul: 1.0 },
  focus: { ceiling: 0xf2f4ff, hemi: 0xf2f4ff, hemiI: 0.95, mul: 1.25 },
};

// ================================================================ loading the model
const TPL = {}; // template id -> { home, mount, facing, set, setPivot, template }
let loaded = false;
async function start() {
  const loading = document.getElementById("loading");
  if (!navigator.gpu) { loading.textContent = "This planner draws with WebGPU, which this browser doesn't offer. Try a recent Chrome, Edge or Safari."; return; }
  const gltf = await loadRoom("room.json");
  world = buildWorld(gltf);
  gpu = await createGpu(canvas, world, PATTERN_SPECS);
  pieces = createPieces(world, gpu);
  gltf.materials.forEach((m, index) => {
    if (index >= MAX_MATS) return;
    materials.set(m.name, { index, orig: { color: m.color.slice(0, 3), roughness: m.roughness, metallic: m.metallic, emission: m.emission, strength: m.strength } });
    gpu.setMaterial(index, {
      color: m.color.slice(0, 3), roughness: m.roughness, metallic: m.metallic, emission: m.emission, pattern: -1,
      painted: m.name.startsWith("Painting ") ? 1 : 0, glow: GLOW.has(m.name) ? 1 : 0, glowStrength: m.strength,
    });
  });
  for (const [id, t] of world.templates) TPL[id] = { home: t.home, mount: t.mount, facing: t.facing, set: t.set, setPivot: t.setPivot, template: t };
  gpu.onFrame = frame;
  if (import.meta.env.DEV) window.__planner = { world, gpu, pieces, rig, state, pick: (x, y) => pieces.pick(rig.rayAt(x, y)), get hidden() { return hiddenSides; }, cutaway: () => cutaway(), roomState: () => roomState };
  setBackground();
  loaded = true;
  loading.hidden = true;
  initialState();
  buildGallery();
  update(false);
  setView(state.view || "doll", false);
  loadThumbs();
}
start().catch((err) => {
  document.getElementById("loading").textContent = "The room didn't load. Reload the page to try again.";
  console.error(err);
});

// The page's stage colour behind the room, given as the light the final pass turns into it
function setBackground() {
  if (!gpu) return;
  const c = getComputedStyle(document.documentElement).getPropertyValue("--stage").trim() || "#d9d4c8";
  hexToLinear(c).forEach((v, i) => { gpu.background[i] = beforeTone(v); });
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", setBackground);
new MutationObserver(setBackground).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

function initialState() {
  const tok = location.hash.slice(1);
  let saved = decode(tok);
  if (!saved && !tok) { try { saved = decode(localStorage.getItem("study-restyle-v2")); } catch {} }
  if (saved) { Object.assign(state, saved); return; }
  const legacy = decodeLegacy(tok);
  if (legacy) {
    const P = { ...legacy.preset };
    Object.assign(state, { style: legacy.style, scene: legacy.scene, view: legacy.view }, fromPreset(P, legacy.layout));
    return;
  }
  Object.assign(state, fromPreset(PRESETS.today));
}

// ================================================================ placing objects
function familyTags(o) {
  const f = FAMILIES[o.p];
  const tags = new Set();
  if (!f) return tags;
  for (const op of f.options) if (op.tag) tags.add(`${op.tag}:${o.o[op.key]}`);
  for (const a of o.a) tags.add(`x:${a}`);
  return tags;
}
function slotBaseVisible(o, slot) {
  const f = FAMILIES[o.p];
  const op = f && f.options.find((x) => x.tag === slot);
  return !op || o.o[op.key] === Object.keys(op.values)[0];
}
const hasLamp = (p) => !!TPL[p] && TPL[p].template.anchors.length > 0;
const LAMP_SWATCHES = [["Candle", "#ff8a2a"], ["Warm 2200K", "#ffa552"], ["Soft 2700K", "#ffc48c"], ["Neutral 4000K", "#ffe2c6"], ["Daylight", "#f2f4ff"],
  ["Red", "#ff3b2f"], ["Amber", "#ffb000"], ["Green", "#3dff7a"], ["Teal", "#2fe6d0"], ["Blue", "#3c6bff"], ["Purple", "#9b4dff"], ["Pink", "#ff5fb4"]];
function lampBlock(hex, fallback, scope) {
  return `<div class="colrow"><label for="lamp-${scope}">Pick a colour</label>
      <input type="color" id="lamp-${scope}" data-lampcolor="${scope}" value="${hex || fallback}">
      ${hex ? `<button class="btn" data-unlamp="${scope}">Reset</button>` : `<span class="price">as bought</span>`}</div>
    <div class="chips">${LAMP_SWATCHES.map(([n, c]) => `<button class="chip" data-setlamp="${c}" data-scope="${scope}" title="${c}"><i class="dot" style="background:${c}"></i>${n}</button>`).join("")}</div>`;
}
// Desk tops and frames are modelled 140 cm long (y 0.10-1.50); each desk stretches its own copy.
function deskStretch(o) {
  const L = ["today", "walnut", "oak"].includes(o.o.top) ? parseInt(o.o.len.slice(1), 10) / 100 : 1.40;
  const y0 = Math.min(0.10, 1.646 - L), y1 = y0 + L, ds = y0 - 0.10, dn = y1 - 1.50;
  return { ds, dn, top: L / 1.40, cross: (1.24 + dn - ds) / 1.24 };
}
function placementOf(o, s) {
  const f = FAMILIES[o.p], tags = familyTags(o);
  const shows = f ? (t) => (!t.opt || tags.has(t.opt)) && (!t.slotBase || slotBaseVisible(o, t.slotBase)) && (!t.hideWith || !tags.has(t.hideWith)) : () => true;
  // Seated: hide the backrest of the desk chair you're sitting in
  const seatedChair = currentView === "seated" && s.objects.find((x) => x.p === "chair") === o;
  return {
    position: toThree(o.x, o.y, o.z), yaw: deg(o.r), shows,
    desk: o.p === "desk" ? deskStretch(o) : undefined,
    hideChairBack: seatedChair,
    tint: o.lc ? hexToLinear(o.lc) : null,
  };
}
const placeObject = (o, s = state) => pieces.place(`o${o.id}`, TPL[o.p].template, placementOf(o, s));
function renderObjects(s) {
  const keep = new Set();
  for (const o of s.objects) {
    if (!TPL[o.p]) continue;
    placeObject(o, s);
    keep.add(`o${o.id}`);
  }
  for (const key of [...pieces.keys()]) if (key !== "ROOM" && !keep.has(key)) pieces.remove(key);
  pieces.flushLights();
}
// What a wall looks like before any hand-picked colour, so recolouring the window wall
// doesn't drag the door and east walls along with it
let lastMats = {};
const origHex = (name) => { const m = materials.get(name); return m ? linearToHex(m.orig.color) : "#e9e7e1"; };
function styleSpec(s, name) {
  const m = { ...STYLES[s.style].mats, ...(PAINT[s.paint].mats || {}), ...(FINISH[s.finish].mats || {}) };
  return m[name] || (name === "Wall Door" || name === "Wall East" ? m["Wall White"] : null) || { c: origHex(name) };
}
function wallHex(name) {
  const spec = lastMats[name] || ((name === "Wall Door" || name === "Wall East") && lastMats["Wall White"]) || null;
  if (spec && spec.c) return spec.c;
  if (spec && spec.conc) return spec.conc[0];
  if (spec && spec.wood) return spec.wood[0];
  return origHex(name);
}
// Walls between the eye and the room are cut away
let roomState = null, hiddenSides = "";
function cutaway() {
  const p = rig.position;
  const bx = p.x, by = -p.z, bz = p.y, m = 0.02;
  return [by < -m && "S", by > D + m && "N", bx < -m && "W", bx > W + m && "E", bz > H - 0.01 && "C"].filter(Boolean).join("");
}
function placeRoom() {
  const s = roomState;
  if (!s) return;
  const tags = new Set([`light:${s.light}`, `paint:${s.paint}`, ...(s.finish === "rail" ? ["wf:rail"] : []), ...[...s.room].map((k) => `x:${k}`)]);
  const shows = (t) => (!t.opt || tags.has(t.opt)) && (!t.slotBase || t.slotBase !== "light" || s.light === "today") && (!t.hideWith || !tags.has(t.hideWith)) && (!t.side || !hiddenSides.includes(t.side));
  pieces.place("ROOM", world.room, { position: new V3(), yaw: 0, shows, tint: s.lamp ? hexToLinear(s.lamp) : null });
}
function applyRoom(s) {
  roomState = s;
  const mats = { ...STYLES[s.style].mats, ...(PAINT[s.paint].mats || {}), ...(FINISH[s.finish].mats || {}) };
  for (const k of s.room) Object.assign(mats, ROOM_ADDONS[k].mats || {});
  for (const [k, c] of Object.entries(s.colors || {})) {
    mats[WALLS[k].mat] = { c };
    if (k === "south" && !(s.colors || {}).east) mats["Wall East"] = mats["Wall East"] || styleSpec(s, "Wall East");
    if (k === "south" && !(s.colors || {}).north) mats["Wall Door"] = mats["Wall Door"] || styleSpec(s, "Wall Door");
  }
  lastMats = mats;
  applyMaterials(mats);
  const sc = SCENES[s.scene];
  pieces.setRoomLamp({ color: s.lamp ? hexToLinear(s.lamp) : srgbHexToLinear(sc.ceiling), intensity: (s.light === "globe" ? 3 : 8) * sc.mul });
  placeRoom();
  pieces.flushLights();
  gpu.setSky(srgbHexToLinear(sc.hemi), srgbHexToLinear(0x6b5440), sc.hemiI / Math.PI);
}

// ================================================================ undo, link, update
let comparing = false, TODAY_STATE = null;
const undoStack = [], redoStack = [];
let lastToken = "", restoring = false;
const stripView = (t) => t.slice(0, 4) + t.slice(5);
function persist() {
  const tok = encode(state);
  if (tok === lastToken) return;
  if (lastToken && !restoring && stripView(tok) !== stripView(lastToken)) { undoStack.push(lastToken); redoStack.length = 0; }
  lastToken = tok;
  try { history.replaceState(null, "", "#" + tok); } catch {}
  try { localStorage.setItem("study-restyle-v2", tok); } catch {}
  document.getElementById("undo").disabled = !undoStack.length;
  document.getElementById("redo").disabled = !redoStack.length;
}
function restore(tok) {
  const s = decode(tok);
  if (!s) return;
  restoring = true;
  const keepView = state.view;
  Object.assign(state, s, { view: keepView });
  if (selected && selected.id && !state.objects.some((o) => o.id === selected.id)) select(null);
  // Ids are fresh after decoding, so re-find the selection by position in the list
  update(false);
  restoring = false;
  lastToken = encode(state);
  persist();
}
function undo() { if (!undoStack.length) return; redoStack.push(lastToken); const t = undoStack.pop(); select(null); restore(t); }
function redo() { if (!redoStack.length) return; undoStack.push(lastToken); const t = redoStack.pop(); select(null); restore(t); }
document.getElementById("undo").addEventListener("click", undo);
document.getElementById("redo").addEventListener("click", redo);

function update(animate = true) {
  if (loaded) {
    const s = comparing ? { ...TODAY_STATE, scene: state.scene } : state;
    renderObjects(s);
    applyRoom(s);
  }
  syncPanels(); // after the room, so the wall-colour pickers show the current colours
  if (loaded) persist();
}

// ================================================================ panels
// The inspector shows room settings, or the selected piece's settings; the room list and
// the gallery below it are always there.
const inspectorEl = document.getElementById("inspector"), objectsEl = document.getElementById("objects"), galleryEl = document.getElementById("gallery");
const thumbs = {}; // template id -> data URL
const img = (p, cls = "") => (thumbs[p] ? `<img src="${thumbs[p]}" alt="" class="${cls}" data-thumb="${p}">` : `<span class="ph ${cls}" data-thumb="${p}"></span>`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function totals() {
  let lo = STYLES[state.style].lo + PAINT[state.paint].lo + FINISH[state.finish].lo + LIGHTS[state.light].lo;
  let hi = STYLES[state.style].hi + PAINT[state.paint].hi + FINISH[state.finish].hi + LIGHTS[state.light].hi;
  for (const k of state.room) { lo += ROOM_ADDONS[k].lo; hi += ROOM_ADDONS[k].hi; }
  const painted = Object.keys(state.colors || {}).length;
  lo += painted * WALL_PAINT[0]; hi += painted * WALL_PAINT[1];
  for (const o of state.objects) { const [a, b] = priceOf(o); lo += a; hi += b; }
  return [lo, hi];
}
const chipRow = (group, entries, cur, priced = true) =>
  `<div class="chips" role="group">${entries.map(([k, v]) => `<button class="chip" data-${group}="${k}" aria-pressed="${k === cur}">${esc(v.name ?? v[0])}${priced && (v.hi ?? v[2]) ? `<small>${fmt(v.lo ?? v[1])}+</small>` : ""}</button>`).join("")}</div>`;

function renderRoomSettings() {
  inspectorEl.innerHTML = `
    <div class="insp-head"><h2>Room</h2><span>click a piece to edit it instead</span></div>
    <section class="block"><div class="block-head"><h2>Presets</h2><span>replace everything</span></div>
      <div class="chips">${Object.entries(PRESETS).map(([k, v]) => `<button class="chip" data-preset="${k}" title="${esc(v.note)}">${v.name}</button>`).join("")}</div>
      <p class="note">Each preset places a set of objects. Click any object afterwards to change, move or remove it.</p></section>
    <section class="block"><div class="block-head"><h2>Arrange</h2><span>moves desk, chair and wall pieces</span></div>
      <div class="chips">${Object.entries(ARRANGE).map(([k, v]) => `<button class="chip" data-arrange="${k}">${v.name}</button>`).join("")}</div></section>
    <section class="block"><div class="block-head"><h2>Style</h2><span>walls, floor, finishes</span></div>
      <div class="choice-grid">${Object.entries(STYLES).map(([k, v]) => `<button class="choice" data-style="${k}" aria-pressed="${k === state.style}">
        <span class="swatches">${v.sw.map((c) => `<i style="background:${c}"></i>`).join("")}</span>${v.name}<small>${v.hi ? range(v.lo, v.hi) : "no cost"}</small></button>`).join("")}</div>
      <p class="note">${esc(STYLES[state.style].note)}</p></section>
    <section class="block"><div class="block-head"><h2>Paint</h2></div>${chipRow("paint", Object.entries(PAINT), state.paint)}
      <p class="row-label">Wall finish</p>${chipRow("finish", Object.entries(FINISH), state.finish)}</section>
    <section class="block"><div class="block-head"><h2>Wall colours</h2><span>or click a wall in the room</span></div>
      <div class="xlist">${WALL_KEYS.map((k) => `<div class="colrow"><label for="col-${k}">${WALLS[k].name}</label>
        <input type="color" id="col-${k}" data-color="${k}" value="${(state.colors[k] || wallHex(WALLS[k].mat)).toLowerCase()}">
        ${state.colors[k] ? `<button class="btn" data-uncolor="${k}">Reset</button>` : `<span class="price">as styled</span>`}</div>`).join("")}</div>
      <p class="note">Each hand-picked colour adds ${fmt(WALL_PAINT[0])}–${fmt(WALL_PAINT[1])} zł for paint.</p></section>
    <section class="block"><div class="block-head"><h2>Ceiling light</h2><span>click it in the room to edit</span></div>
      <button class="objrow" data-act="ceiling"><i class="dot" style="width:26px;height:26px;margin:0 auto;background:${state.lamp || "#ffd2a0"}"></i><span class="name">${esc(LIGHTS[state.light].name)}</span><span class="price">${LIGHTS[state.light].hi ? range(LIGHTS[state.light].lo, LIGHTS[state.light].hi) : "owned"}</span></button></section>
    <section class="block"><div class="block-head"><h2>Window, radiator, door</h2><span>${[...state.room].length} on</span></div>
      <div class="xlist">${Object.entries(ROOM_ADDONS).map(([k, v]) => `<label class="xrow"><input type="checkbox" data-room="${k}" ${state.room.has(k) ? "checked" : ""}>
        <span class="name">${esc(v.name)}</span><span class="price">${fmt(v.lo)}–${fmt(v.hi)}</span></label>`).join("")}</div></section>`;
}
function renderCeilingSettings() {
  const L = LIGHTS[state.light];
  inspectorEl.innerHTML = `<div class="insp-head"><button class="btn" data-act="back">← Room settings</button><span>Ceiling light</span></div>
    <div class="obj-head"><div class="wall-swatch" style="background:${state.lamp || "#ffd2a0"}"></div><div><h2>${esc(L.name)}</h2>
      <p>Lighting · on the ceiling</p><p><strong>${L.hi ? range(L.lo, L.hi) : "already yours"}</strong></p></div></div>
    <section class="block"><p class="row-label">Fixture</p>${chipRow("light", Object.entries(LIGHTS), state.light)}</section>
    <section class="block"><p class="row-label">Light colour<span>smart bulb</span></p>${lampBlock(state.lamp, "#ffd2a0", "ceiling")}</section>`;
}
function renderWallSettings(k) {
  const v = state.colors[k] || wallHex(WALLS[k].mat);
  inspectorEl.innerHTML = `<div class="insp-head"><button class="btn" data-act="back">← Room settings</button><span>Wall</span></div>
    <div class="obj-head"><div class="wall-swatch" style="background:${v}"></div><div><h2>${esc(WALLS[k].name)}</h2>
      <p>${state.colors[k] ? "your own colour" : "as the style and paint have it"}</p><p><strong>${state.colors[k] ? range(...WALL_PAINT) : "no cost"}</strong></p></div></div>
    <section class="block"><p class="row-label">Colour</p><div class="colrow"><label for="wcol-${k}">Pick a colour</label>
      <input type="color" id="wcol-${k}" data-color="${k}" value="${v.toLowerCase()}">
      ${state.colors[k] ? `<button class="btn" data-uncolor="${k}">Reset</button>` : ""}</div>
      <div class="chips">${WALL_SWATCHES.map(([n, c]) => `<button class="chip" data-setcolor="${c}" title="${c}"><i class="dot" style="background:${c}"></i>${n}</button>`).join("")}</div>
      <p class="note">Click another wall to paint that one, or empty floor to go back.</p></section>`;
}
const WALL_SWATCHES = [["Today's green", "#5f8f78"], ["Wardrobe mauve", "#8a5459"], ["Warm white", "#efe9df"], ["Sage", "#9aa98c"], ["Forest", "#3f5a45"], ["Mustard", "#c9a24a"], ["Terracotta", "#b8674a"], ["Teak", "#8a5a3b"], ["Dusty blue", "#7d93a6"], ["Charcoal", "#3b3a38"]];
function lampHex(o) {
  const a = TPL[o.p]?.template.anchors[0];
  return a ? "#" + lampBase(a.kind).color.toString(16).padStart(6, "0") : "#ffc98f";
}
function renderObjectList() {
  objectsEl.innerHTML = `<div class="block-head"><h2>In the room</h2><span>${state.objects.length} pieces</span></div>
    ${state.objects.length ? `<div class="objlist">${state.objects.map((o) => { const [lo, hi] = priceOf(o); return `<button class="objrow" data-select="${o.id}" aria-current="${selected && selected.id === o.id}">
      ${img(o.p)}<span class="name">${esc(infoOf(o.p).name)}</span><span class="price">${hi ? range(lo, hi) : "owned"}</span></button>`; }).join("")}</div>`
    : `<p class="empty">The room is empty. Drag pieces in from below, or pick a preset.</p>`}`;
}
function renderObjectSettings(o) {
  const el = inspectorEl;
  const info = infoOf(o.p), f = FAMILIES[o.p], [lo, hi] = priceOf(o), t = TPL[o.p];
  let html = `<div class="insp-head"><button class="btn" data-act="back">← Room settings</button><span>${esc(info.cat)}</span></div><div class="obj-head">${img(o.p)}<div><h2>${esc(info.name)}</h2><p>${esc(info.cat)} · ${t.mount === "wall" ? "on a wall" : "on the floor"}</p><p><strong>${hi ? range(lo, hi) : "already yours"}</strong></p></div></div>`;
  if (f) {
    for (const op of f.options) {
      if (op.when && !op.when(o.o)) continue;
      html += `<section class="block"><p class="row-label">${op.label}${op.free && op.free(o.o) ? "<span>included in the top</span>" : ""}</p>${chipRow(`opt-${op.key}`, Object.entries(op.values), o.o[op.key])}</section>`;
    }
    if (f.addons) html += `<section class="block"><p class="row-label">Add-ons</p><div class="xlist">${Object.entries(f.addons).map(([k, v]) => `<label class="xrow">
      <input type="checkbox" data-addon="${k}" ${o.a.has(k) ? "checked" : ""}><span class="name">${esc(v[0])}</span><span class="price">${fmt(v[1])}–${fmt(v[2])}</span></label>`).join("")}</div></section>`;
  }
  if (hasLamp(o.p)) html += `<section class="block"><p class="row-label">Light colour<span>smart bulb</span></p>${lampBlock(o.lc, lampHex(o), "obj")}</section>`;
  const similar = PROTO_IDS.filter((p) => p !== o.p && infoOf(p).cat === info.cat && TPL[p] && TPL[p].mount === t.mount && (FAMILIES[p] || SINGLES[p][4] !== false));
  if (similar.length) html += `<section class="block"><p class="row-label">Replace with</p><div class="chips">${similar.map((p) => `<button class="chip" data-replace="${p}">${esc(infoOf(p).name)}</button>`).join("")}</div></section>`;
  html += `<section class="block"><p class="row-label">Position</p><div class="actions">
    ${t.mount === "floor" ? `<button class="btn" data-turn="-15">⟲ 15°</button><button class="btn" data-turn="15">⟳ 15°</button><button class="btn" data-turn="90">⟳ 90°</button>` : ""}
    <button class="btn" data-act="home">Back to its usual spot</button>
    ${t.mount === "floor" && o.z > 0.005 ? `<button class="btn" data-act="floor">Put it on the floor (lifted ${Math.round(o.z * 100)} cm)</button>` : ""}</div>
    <p class="note">${t.mount === "floor" ? "Drag the arrows to slide it or lift it, the ring to turn it." : "Drag the arrows to slide it along the wall or up and down. Drag it across the room or round a corner to hang it on another wall."}</p></section>
    <section class="block"><div class="actions"><button class="btn" data-act="dup">Duplicate</button><button class="btn danger" data-act="del">Remove from the room</button></div></section>`;
  el.innerHTML = html;
}
function syncPanels() {
  const [lo, hi] = totals();
  document.getElementById("total").textContent = range(lo, hi);
  document.querySelectorAll("#scenes button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scene === state.scene)));
  const o = selected && state.objects.find((x) => x.id === selected.id);
  if (o) renderObjectSettings(o); else if (selected && selected.wall) renderWallSettings(selected.wall);
  else if (selected && selected.ceiling) renderCeilingSettings(); else renderRoomSettings();
  renderObjectList();
}
// One delegated handler for both panels
function onPanelClick(e) {
  const b = e.target.closest("button, input");
  if (!b) return;
  const d = b.dataset;
  const o = selected && state.objects.find((x) => x.id === selected.id);
  if (d.preset) { select(null); Object.assign(state, fromPreset(PRESETS[d.preset])); return update(); }
  if (d.arrange) { arrange(state.objects, d.arrange); return update(); }
  if (d.style) { state.style = d.style; return update(); }
  if (d.paint) { state.paint = d.paint; return update(); }
  if (d.finish) { state.finish = d.finish; return update(); }
  if (d.light) { state.light = d.light; return update(); }
  if (d.room && b.tagName === "INPUT") { b.checked ? state.room.add(d.room) : state.room.delete(d.room); return update(); }
  if (d.select) { const x = state.objects.find((q) => q.id === Number(d.select)); if (x) select(x, true); return; }
  if (d.uncolor) { delete state.colors[d.uncolor]; return update(); }
  if (d.setlamp || d.unlamp) {
    const hex = d.setlamp || null, scope = d.scope || d.unlamp;
    if (scope === "ceiling") state.lamp = hex;
    else if (o) { if (hex) o.lc = hex; else delete o.lc; }
    return update();
  }
  if (d.setcolor && selected && selected.wall) { state.colors[selected.wall] = d.setcolor; return update(); }
  if (d.act === "back") return select(null);
  if (d.act === "ceiling") return select({ ceiling: true });
  if (!o) return;
  for (const [k, v] of Object.entries(d)) {
    if (!k.startsWith("opt")) continue;
    const key = k.slice(3).replace(/^-?/, "").toLowerCase();
    o.o[key] = v;
    // A desk long enough to reach the PC's spot moves the PC under it
    if (o.p === "desk" && key === "len" && parseInt(v.slice(1), 10) >= 140 && o.o.pc === "today") o.o.pc = "caddy";
    return update();
  }
  if (d.addon && b.tagName === "INPUT") { b.checked ? o.a.add(d.addon) : o.a.delete(d.addon); return update(); }
  if (d.replace) { o.p = d.replace; o.o = defaultOpts(d.replace); o.a = new Set(); return update(); }
  if (d.turn) { o.r = ((o.r + Number(d.turn)) % 360 + 540) % 360 - 180; return update(); }
  if (d.act === "floor") { o.z = 0; return update(); }
  if (d.act === "home") { const t = TPL[o.p]; [o.x, o.y] = t.home; o.r = 0; o.z = 0; return update(); }
  if (d.act === "dup") return duplicate(o);
  if (d.act === "del") return removeObj(o);
}
inspectorEl.addEventListener("click", onPanelClick);
function setLampFrom(el) {
  const scope = el.dataset.lampcolor, o = selected && state.objects.find((x) => x.id === selected.id);
  if (scope === "ceiling") state.lamp = el.value;
  else if (o) { o.lc = el.value; placeObject(o); pieces.flushLights(); }
}
inspectorEl.addEventListener("input", (e) => {
  if (e.target.dataset && e.target.dataset.lampcolor) { setLampFrom(e.target); if (loaded && e.target.dataset.lampcolor === "ceiling") applyRoom(state); return; }
  const k = e.target.dataset && e.target.dataset.color;
  if (!k) return;
  state.colors[k] = e.target.value;
  if (loaded) applyRoom(comparing ? { ...TODAY_STATE, scene: state.scene } : state);
});
inspectorEl.addEventListener("change", (e) => {
  if (e.target.dataset && e.target.dataset.lampcolor) { setLampFrom(e.target); return update(); }
  const k = e.target.dataset && e.target.dataset.color;
  if (!k) return;
  state.colors[k] = e.target.value;
  update();
});
objectsEl.addEventListener("click", onPanelClick);

// ================================================================ gallery
function buildGallery() {
  const items = PROTO_IDS.filter((p) => TPL[p] && (FAMILIES[p] || SINGLES[p][4] !== false));
  galleryEl.innerHTML = `<div class="block-head"><h2>Add pieces</h2><span>drag onto the floor or a wall</span></div>
    <p class="note">Or click one to drop it into the room, then move it with the arrows.</p>` +
    CATEGORIES.map((cat) => {
      const list = items.filter((p) => infoOf(p).cat === cat);
      if (!list.length) return "";
      return `<section class="gallery-cat"><div class="block-head"><h2>${cat}</h2><span>${list.length}</span></div><div class="cards">${list.map((p) => {
        const inf = infoOf(p), fam = FAMILIES[p];
        const price = fam ? (() => { const [lo, hi] = priceOf({ p, o: defaultOpts(p), a: new Set() }); return hi ? range(lo, hi) : "from 0 zł"; })() : range(inf.lo, inf.hi);
        return `<div class="card" role="button" tabindex="0" draggable="true" data-add="${p}" title="Drag into the room, or click to add">${img(p)}<span class="name">${esc(inf.name)}</span><small>${price}${TPL[p].mount === "wall" ? " · wall" : ""}</small></div>`;
      }).join("")}</div></section>`;
    }).join("");
}
galleryEl.addEventListener("click", (e) => {
  const b = e.target.closest("[data-add]");
  if (b) addObject(b.dataset.add, null);
});
galleryEl.addEventListener("keydown", (e) => {
  const b = e.target.closest("[data-add]");
  if (b && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); addObject(b.dataset.add, null); }
});
galleryEl.addEventListener("dragstart", (e) => {
  const b = e.target.closest("[data-add]");
  if (!b) return;
  e.dataTransfer.setData("text/plain", b.dataset.add);
  e.dataTransfer.effectAllowed = "copy";
});
const stage = document.getElementById("stage");
stage.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; stage.classList.add("dropping"); });
stage.addEventListener("dragleave", () => stage.classList.remove("dropping"));
stage.addEventListener("drop", (e) => {
  e.preventDefault();
  stage.classList.remove("dropping");
  const p = e.dataTransfer.getData("text/plain");
  if (TPL[p]) addObject(p, e);
});
// Facing: which wall a wall piece hangs on, as the angle of its outward normal
const FACING_ANGLE = { W: 0, S: 90, E: 180, N: -90 };
function addObject(p, e) {
  const t = TPL[p], o = inst(p);
  if (e) {
    const ray = rayFrom(e);
    if (t.mount === "wall") {
      const hit = pieces.pick(ray);
      if (hit) {
        const nrm = hit.normal;
        if (Math.abs(nrm.y) < 0.5) {
          const bx = nrm.x, by = -nrm.z; // the wall's normal in plan
          const ang = radToDeg(Math.atan2(by, bx));
          o.x = hit.point.x; o.y = -hit.point.z;
          o.r = Math.round(ang - FACING_ANGLE[t.facing]);
        }
      }
    } else if (Math.abs(ray.direction.y) > 1e-6) {
      const k = -ray.origin.y / ray.direction.y;
      if (k > 0) { o.x = clamp(ray.origin.x + ray.direction.x * k, 0.1, W - 0.1); o.y = clamp(-(ray.origin.z + ray.direction.z * k), 0.1, D - 0.1); }
    }
  } else if (t.mount === "floor") { o.x = 1.40; o.y = 1.70; }
  state.objects.push(o);
  update();
  select(o, true);
}
function duplicate(o) {
  const c = { ...o, id: nextId++, o: { ...o.o }, a: new Set(o.a) };
  if (TPL[o.p].mount === "wall") c.z += 0.15; else { c.x += 0.15; c.y -= 0.15; }
  state.objects.push(c);
  update();
  select(c, true);
}
function removeObj(o) {
  state.objects = state.objects.filter((x) => x !== o);
  select(null);
  update();
}


// ================================================================ thumbnails
// Rendered once from the model into public/thumbs; index.json maps template ids to files
async function loadThumbs() {
  try {
    const res = await fetch("thumbs/index.json", { cache: "no-cache" });
    if (!res.ok) return;
    const files = await res.json();
    for (const p of PROTO_IDS) if (files[p]) thumbs[p] = `thumbs/${files[p]}`;
    document.querySelectorAll("[data-thumb]").forEach((el) => {
      const p = el.dataset.thumb;
      if (!thumbs[p]) return;
      if (el.tagName === "IMG") el.src = thumbs[p];
      else { const i = document.createElement("img"); i.src = thumbs[p]; i.alt = ""; i.className = el.className.replace("ph", "").trim(); i.dataset.thumb = p; el.replaceWith(i); }
    });
  } catch {}
}

// ================================================================ selecting and moving
const pieceBar = document.getElementById("piecebar");
let selected = null, downAt = null;
function rayFrom(e) {
  const r = canvas.getBoundingClientRect();
  return rig.rayAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
}
const isLightTag = (u) => String(u.opt || "").startsWith("light:") || u.slotBase === "light";
function pick(e) {
  const hit = pieces.pick(rayFrom(e));
  if (!hit) return null;
  if (hit.key !== "ROOM") return state.objects.find((o) => `o${o.id}` === hit.key) || null;
  if (hit.chunk.chain.some(isLightTag)) return { ceiling: true };
  const k = WALL_OF_MAT[hit.material];
  return k ? { wall: k } : null; // the nearest visible thing wins, so walls block picks
}
const gizmo = createGizmo(rig, canvas, {
  start(axis) {
    const o = selected && state.objects.find((x) => x.id === selected.id);
    if (!o) return;
    dragSide = wallSide(o);
    const anchor = gizmo.position;
    const node = toThree(o.x, o.y, o.z);
    dragStart = { offset: node.clone().sub(anchor), nodeYaw: deg(o.r), y: node.y, anchor };
  },
  change(position, turn, axis) {
    const o = selected && state.objects.find((x) => x.id === selected.id);
    if (!o || !dragStart) return;
    // Carry the handles' move and turn over to the piece, turning about the piece's middle
    const node = position.clone().add(dragStart.offset.clone().rotateY(turn));
    let yaw = dragStart.nodeYaw + turn;
    if (TPL[o.p].mount === "wall") {
      // Always snapped flat to a wall, facing into the room. Dragged past the end of its wall it
      // wraps round the corner onto the next one; dragged across the room it jumps to the nearest wall.
      const rx = node.x, ry = -node.z;
      const px = clamp(rx, 0, W), py = clamp(ry, 0, D);
      const [os, d] = [["W", -rx], ["E", rx - W], ["S", -ry], ["N", ry - D]].sort((a, b) => b[1] - a[1])[0];
      let side, x, y;
      if (d > 0 && os !== dragSide) {
        side = os;
        if (side === "S" || side === "N") [x, y] = [clamp(px < W / 2 ? px + d : px - d, 0, W), side === "S" ? 0 : D];
        else [x, y] = [side === "W" ? 0 : W, clamp(py < D / 2 ? py + d : py - d, 0, D)];
      } else {
        [side] = [["W", px], ["E", W - px], ["S", py], ["N", D - py]].sort((a, b) => a[1] - b[1])[0];
        [x, y] = side === "W" ? [0, py] : side === "E" ? [W, py] : side === "S" ? [px, 0] : [px, D];
      }
      node.x = x; node.z = -y;
      o.r = ((FACING_ANGLE[side] - FACING_ANGLE[TPL[o.p].facing || "W"]) % 360 + 540) % 360 - 180;
      o.z = node.y;
    } else {
      // Only the up arrow changes the height: other handles keep the piece where it stands
      node.y = axis === "Y" ? Math.max(0, node.y) : dragStart.y;
      o.z = node.y;
      o.r = Math.round(radToDeg(Math.atan2(Math.sin(yaw), Math.cos(yaw))));
    }
    o.x = node.x; o.y = -node.z;
    placeObject(o);
    pieces.flushLights();
  },
  end() { dragStart = null; update(); },
});
let dragStart = null, dragSide = null;
// Which wall a wall piece hangs on, from the way it faces
const wallSide = (o) => Object.keys(FACING_ANGLE).find((k) => ((FACING_ANGLE[k] - FACING_ANGLE[TPL[o.p].facing || "W"] - o.r) % 360 + 360) % 360 === 0) || null;
function selectionBox() {
  if (!selected || comparing) return null;
  if (selected.wall) return pieces.boundsWhere("ROOM", (c) => c.matBounds.has(materials.get(WALLS[selected.wall].mat)?.index), materials.get(WALLS[selected.wall].mat)?.index);
  if (selected.ceiling) return pieces.boundsWhere("ROOM", (c) => c.chain.some(isLightTag));
  return pieces.bounds(`o${selected.id}`);
}
const centre = (b) => new V3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
function select(o, openTab = false) {
  if (o && (o.wall || o.ceiling)) {
    selected = o.wall ? { wall: o.wall } : { ceiling: true };
    gizmo.detach();
    pieceBar.hidden = true;
    inspectorEl.scrollTop = 0;
    return syncPanels();
  }
  selected = o ? { id: o.id } : null;
  const box = o && pieces.bounds(`o${o.id}`);
  pieceBar.hidden = !box;
  if (box) {
    document.getElementById("piece-name").textContent = infoOf(o.p).name;
    const wall = TPL[o.p].mount === "wall";
    gizmo.attach(centre(box), deg(o.r), !wall);
    pieceBar.querySelectorAll("[data-rot]").forEach((b) => { b.hidden = wall; });
    if (openTab) inspectorEl.scrollTop = 0;
  } else gizmo.detach();
  syncPanels();
}
const BOX_COLOR = [0.74, 0.42, 0.06, 1]; // #e0ad4a
function overlayLines() {
  const out = [];
  const b = selectionBox();
  if (b) {
    const { min: a, max: z } = b;
    const ring = (y) => [a.x, y, a.z, z.x, y, a.z, z.x, y, z.z, a.x, y, z.z];
    out.push({ points: ring(a.y), color: BOX_COLOR, width: 1.25, closed: true }, { points: ring(z.y), color: BOX_COLOR, width: 1.25, closed: true });
    for (const [x, zz] of [[a.x, a.z], [z.x, a.z], [z.x, z.z], [a.x, z.z]]) out.push({ points: [x, a.y, zz, x, z.y, zz], color: BOX_COLOR, width: 1.25 });
    if (selected && selected.id && gizmo.attached) {
      const o = state.objects.find((x) => x.id === selected.id);
      if (o) gizmo.follow(centre(b), deg(o.r));
    }
  }
  if (!comparing) out.push(...gizmo.lines());
  return out;
}
canvas.addEventListener("pointerdown", (e) => { if (e.button === 0) downAt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener("pointerup", (e) => {
  if (!downAt || comparing || gizmo.dragging || !loaded) { downAt = null; return; }
  const clicked = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 4;
  downAt = null;
  if (!clicked) return;
  const o = pick(e);
  if (o) select(o, true);
  else if (!gizmo.under(e)) select(null);
});
pieceBar.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  const o = selected && state.objects.find((x) => x.id === selected.id);
  if (!b || !o) return;
  if (b.dataset.rot) { o.r = ((o.r + Number(b.dataset.rot)) % 360 + 540) % 360 - 180; update(); }
  if (b.id === "bar-dup") duplicate(o);
  if (b.id === "bar-del") removeObj(o);
  if (b.id === "bar-done") select(null);
});
window.addEventListener("keydown", (e) => {
  if (e.target.closest && e.target.closest("input, textarea")) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); return redo(); }
  const o = selected && state.objects.find((x) => x.id === selected.id);
  if (!o) return;
  if (mod && (e.key === "d" || e.key === "D")) { e.preventDefault(); return duplicate(o); }
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); return removeObj(o); }
  if (e.key === "Escape") return select(null);
  if (TPL[o.p].mount === "floor" && (e.key === "q" || e.key === "Q")) { o.r -= 15; update(); }
  if (TPL[o.p].mount === "floor" && (e.key === "e" || e.key === "E")) { o.r += 15; update(); }
});

// ================================================================ views
const VIEWS = {
  doll: { pos: [W + 2.6, 4.4, 2.4], target: [W / 2, 0.9, -D / 2], fov: 45, three: true },
  photo: { pos: [2.20, 1.45, 1.40], target: [0.0, 1.55, 1.12], hfov: 100 },
  door: { pos: [1.80, 0.55, 1.60], target: [1.85, 2.95, 0.95], hfov: 98 },
  opposite: { pos: [0.95, 1.25, 1.55], target: [W, 0.95, 0.85], hfov: 95 },
  // Eye level in the desk chair, looking at the nearest desk
  seated: () => {
    const ch = state.objects.find((o) => o.p === "chair") || { x: 1.05, y: 0.75 };
    const desks = state.objects.filter((o) => o.p === "desk");
    const dk = desks.sort((a, b) => Math.hypot(a.x - ch.x, a.y - ch.y) - Math.hypot(b.x - ch.x, b.y - ch.y))[0] || { x: 0.35, y: 0.75 };
    const d = Math.hypot(dk.x - ch.x, dk.y - ch.y) || 1, u = [(dk.x - ch.x) / d, (dk.y - ch.y) / d];
    return { pos: [ch.x + u[0] * 0.04, ch.y + u[1] * 0.04, 1.2], target: [dk.x + u[0] * 0.2, dk.y + u[1] * 0.2, 1.02], fov: 62 };
  },
  standing: { pos: [1.45, 1.75, 1.63], target: [0.2, 0.4, 1.30], fov: 62 },
  top: { pos: [W / 2, 8.5, -D / 2 + 0.001], target: [W / 2, 0, -D / 2], fov: 30, three: true, ortho: true },
};
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
function fovFor(v) {
  if (!v.hfov) return v.fov;
  const h = deg(v.hfov) / 2;
  return Math.min(105, radToDeg(2 * Math.atan(Math.tan(h) / rig.aspect)));
}
const INSIDE = new Set(["photo", "door", "opposite", "seated", "standing"]);
const hintEl = document.getElementById("hint");
let lookMode = false;
function setLookMode(on) {
  lookMode = on;
  rig.enableZoom = !on;
  rig.enablePan = !on;
  rig.rotateSpeed = on ? -0.35 : 1;
  rig.minDistance = on ? 0.01 : 0.4;
  rig.minPolarAngle = on ? 0.15 : 0;
  rig.maxPolarAngle = on ? Math.PI - 0.15 : Math.PI * 0.49;
  hintEl.textContent = on ? "Drag to look around · scroll to zoom · click a piece to edit it" : "Drag to orbit · scroll to zoom · click a piece to move or edit it";
}
function lookTarget(pos, target) { return pos.clone().add(target.clone().sub(pos).normalize().multiplyScalar(0.05)); }
rig.onWheelLook = (dy) => { if (lookMode) rig.fov = clamp(rig.fov + dy * 0.04, 25, 105); };
let tween = null, currentView = "doll";
function setView(name, animate = true) {
  currentView = name;
  state.view = name;
  const v = typeof VIEWS[name] === "function" ? VIEWS[name]() : VIEWS[name];
  const inside = INSIDE.has(name);
  document.querySelectorAll("#views button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === name)));
  const pos = v.three ? new V3(...v.pos) : toThree(...v.pos);
  const target = v.three ? new V3(...v.target) : toThree(...v.target);
  const to = { pos, target, fov: fovFor(v), inside, ortho: !!v.ortho };
  rig.ortho = false;
  rig.halt();
  if (!inside) setLookMode(false);
  if (loaded) renderObjects(comparing ? TODAY_STATE : state);
  persist();
  if (!animate || reduceMotion) {
    rig.position.copy(to.pos); rig.target.copy(inside ? lookTarget(to.pos, to.target) : to.target);
    rig.fov = to.fov;
    if (inside) setLookMode(true);
    if (to.ortho) { rig.ortho = true; rig.orthoZoom = 1; }
    tween = null; return;
  }
  tween = { from: { pos: rig.position.clone(), target: rig.target.clone(), fov: rig.fov }, to, t0: performance.now(), dur: 700 };
}
document.getElementById("views").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (b) setView(b.dataset.view); });
document.getElementById("scenes").addEventListener("click", (e) => { const b = e.target.closest("button[data-scene]"); if (b) { state.scene = b.dataset.scene; update(); } });
rig.onStart = () => {
  if (tween && tween.to.inside) { rig.target.copy(lookTarget(tween.to.pos, tween.to.target)); setLookMode(true); }
  if (tween && tween.to.ortho) { rig.ortho = true; rig.orthoZoom = 1; }
  tween = null;
  if (lookMode) return;
  currentView = null;
  document.querySelectorAll("#views button").forEach((b) => b.setAttribute("aria-pressed", "false"));
};

// Hold to compare with the room as it is today
const cmp = document.getElementById("compare");
const startCmp = (e) => { e.preventDefault(); if (!loaded) return; TODAY_STATE = TODAY_STATE || { ...state, ...fromPreset(PRESETS.today), style: "green" }; comparing = true; cmp.classList.add("on"); gizmo.detach(); update(false); };
const endCmp = () => { if (!comparing) return; comparing = false; cmp.classList.remove("on"); update(false); if (selected) { const o = selected.wall || selected.ceiling ? selected : state.objects.find((x) => x.id === selected.id); if (o) select(o); } };
cmp.addEventListener("pointerdown", startCmp);
["pointerup", "pointerleave", "pointercancel"].forEach((ev) => cmp.addEventListener(ev, endCmp));
cmp.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) startCmp(e); });
cmp.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") endCmp(); });

// Copy a link that reopens this exact setup
function shareUrl() {
  return location.href.split("#")[0] + "#" + encode(state);
}
document.getElementById("copy-link").addEventListener("click", async () => {
  const url = shareUrl(), status = document.getElementById("copy-status"), input = document.getElementById("share-url");
  input.value = url;
  try { await navigator.clipboard.writeText(url); status.textContent = "Link copied"; input.hidden = true; }
  catch { status.textContent = "Copy the link below"; input.hidden = false; input.focus(); input.select(); }
});
window.addEventListener("hashchange", () => {
  const tok = location.hash.slice(1);
  if (tok === lastToken || !decode(tok)) return;
  select(null);
  restore(tok);
});

// ================================================================ loop
function resize() {
  const r = canvas.getBoundingClientRect();
  rig.aspect = r.width / Math.max(1, r.height);
  // Fit the whole floor plan with a little margin
  rig.orthoHalf = Math.max(D / 2 + 0.3, (W / 2 + 0.3) / rig.aspect);
}
new ResizeObserver(resize).observe(canvas.parentElement);
resize();
const ease = (t) => 1 - Math.pow(1 - t, 3);
function frame() {
  if (tween) {
    const t = Math.min(1, (performance.now() - tween.t0) / tween.dur), k = ease(t);
    rig.position.lerpVectors(tween.from.pos, tween.to.pos, k);
    rig.target.lerpVectors(tween.from.target, tween.to.target, k);
    rig.fov = tween.from.fov + (tween.to.fov - tween.from.fov) * k;
    if (t === 1) {
      if (tween.to.inside) { rig.target.copy(lookTarget(tween.to.pos, tween.to.target)); setLookMode(true); }
      if (tween.to.ortho) { rig.ortho = true; rig.orthoZoom = 1; }
      tween = null;
    }
  } else rig.update();
  const sides = cutaway();
  if (sides !== hiddenSides) { hiddenSides = sides; placeRoom(); pieces.flushLights(); }
  gpu.setOverlay(overlayLines());
  gpu.view.write(rig.viewMatrix(), rig.projectionMatrix());
}
syncPanels();
