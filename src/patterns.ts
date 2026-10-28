// Generated textures. Blender's node-based woods don't survive glTF export, so the planner paints
// its woods, concrete and pegboard on canvases, and its mid-century paintings too.

export type PatternSpec = { wood: [string, string, { planks?: number; streak?: number; size?: number }?] } | { conc: [string, { polished?: boolean; lime?: boolean; grass?: boolean }?] } | { peg: string };

export const PATTERN_SIZE = 1024;

function mulberry(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function canvas(size: number, draw: (g: CanvasRenderingContext2D, size: number) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  return c;
}
// Drawn at the original's size, then scaled into the shared texture array
function woodCanvas(base: string, dark: string, { planks = 0, streak = 260, size = 1024 } = {}) {
  return canvas(size, (g) => {
    const rand = mulberry(7);
    g.fillStyle = base; g.fillRect(0, 0, size, size);
    if (planks) {
      const pw = size / planks;
      for (let i = 0; i < planks; i++) {
        g.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.08})`; g.fillRect(i * pw, 0, pw, size);
        g.fillStyle = 'rgba(40,20,5,0.35)'; g.fillRect(i * pw, 0, 1.5, size);
        g.fillRect(i * pw, rand() * size, pw, 1.5);
      }
    }
    g.globalAlpha = 0.18;
    for (let i = 0; i < streak; i++) {
      g.strokeStyle = rand() > 0.5 ? dark : base;
      g.lineWidth = 0.5 + rand() * 2;
      const x = rand() * size;
      g.beginPath(); g.moveTo(x, 0);
      g.bezierCurveTo(x + rand() * 16 - 8, size * 0.33, x + rand() * 16 - 8, size * 0.66, x + rand() * 10 - 5, size);
      g.stroke();
    }
  });
}
function concreteCanvas(base: string, { polished = false, lime = false, grass = false } = {}) {
  return canvas(1024, (g, size) => {
    const rand = mulberry(11);
    g.fillStyle = base; g.fillRect(0, 0, size, size);
    if (grass) {
      for (let i = 0; i < 2600; i++) {
        g.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(60,40,10,0.12)';
        g.fillRect(0, rand() * size, size, 0.8 + rand() * 1.6);
      }
      for (let x = 0; x < size; x += size / 6) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 0, 2, size); }
      return;
    }
    const blots = lime ? 260 : 900;
    for (let i = 0; i < blots; i++) {
      const r = (lime ? 40 : 6) + rand() * (lime ? 120 : 40);
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, r);
      const a = lime ? 0.06 : polished ? 0.05 : 0.08;
      const tone = rand() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      grd.addColorStop(0, tone); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.save(); g.translate(rand() * size, rand() * size); g.fillStyle = grd;
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.restore();
    }
    if (!lime && !polished) {
      for (let y = 0; y < size; y += size / 14) { g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(0, y, size, 2); }
      g.fillStyle = 'rgba(0,0,0,0.22)';
      for (let y = size / 28; y < size; y += size / 7) for (let x = size / 8; x < size; x += size / 4) {
        g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
      }
    }
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(0,0,0,${rand() * 0.12})`;
      g.fillRect(rand() * size, rand() * size, 1.5, 1.5);
    }
  });
}
function pegCanvas(base: string) {
  return canvas(1024, (g, size) => {
    g.fillStyle = base; g.fillRect(0, 0, size, size);
    g.fillStyle = 'rgba(0,0,0,0.65)';
    const cols = 34, rows = 22;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      g.beginPath(); g.arc(((i + 0.5) * size) / cols, ((j + 0.5) * size) / rows, 5, 0, Math.PI * 2); g.fill();
    }
  });
}

/** Draws a pattern into a square canvas of the array's size. */
export function patternCanvas(spec: PatternSpec): HTMLCanvasElement {
  const src = 'wood' in spec ? woodCanvas(spec.wood[0], spec.wood[1], spec.wood[2]) : 'peg' in spec ? pegCanvas(spec.peg) : concreteCanvas(spec.conc[0], spec.conc[1]);
  if (src.width === PATTERN_SIZE) return src;
  return canvas(PATTERN_SIZE, (g) => g.drawImage(src, 0, 0, PATTERN_SIZE, PATTERN_SIZE));
}

// ---------------------------------------------------------------- paintings
// Mid-century paintings. The palette borrows the room's own colours: the wall green and the
// wardrobe mauve.
const PAL = {
  green: '#5f8f78', deep: '#3f5f50', sage: '#a3b39a', mauve: '#8a5459', plum: '#5a3439', blush: '#dcae9f',
  mustard: '#d3a447', rust: '#b8674a', cream: '#efe6d2', teal: '#2f6f6a', ink: '#2b2724', walnut: '#6a4529',
};
type Draw = (c: CanvasRenderingContext2D, w: number, h: number) => void;
function vgrad(c: CanvasRenderingContext2D, w: number, h: number, stops: [number, string][]) {
  const g = c.createLinearGradient(0, 0, 0, h);
  for (const [t, col] of stops) g.addColorStop(t, col);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
}
function disc(c: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, a0 = 0, a1 = Math.PI * 2) {
  c.fillStyle = col; c.beginPath(); c.moveTo(x, y); c.arc(x, y, r, a0, a1); c.fill();
}
const ARTWORKS: Record<string, [number, number, Draw]> = {
  greengrad: [50, 70, (c, w, h) => vgrad(c, w, h, [[0, PAL.cream], [0.45, PAL.sage], [1, PAL.deep]])],
  mauvegrad: [50, 70, (c, w, h) => vgrad(c, w, h, [[0, '#f1d9c6'], [0.4, PAL.blush], [1, PAL.plum]])],
  duo: [60, 90, (c, w, h) => vgrad(c, w, h, [[0, PAL.deep], [0.3, PAL.green], [0.55, '#b9a088'], [0.75, PAL.mauve], [1, PAL.plum]])],
  arches: [50, 50, (c, w, h) => {
    c.fillStyle = PAL.cream; c.fillRect(0, 0, w, h);
    [PAL.rust, PAL.mustard, PAL.green, PAL.mauve, PAL.cream].forEach((col, i) => disc(c, w / 2, h * 0.86, w * (0.42 - i * 0.08), col, Math.PI, 0));
    c.fillStyle = PAL.ink; c.fillRect(w * 0.08, h * 0.86, w * 0.84, h * 0.012);
  }],
  circles: [40, 50, (c, w, h) => {
    c.fillStyle = PAL.cream; c.fillRect(0, 0, w, h);
    disc(c, w * 0.42, h * 0.38, w * 0.3, PAL.green);
    disc(c, w * 0.62, h * 0.66, w * 0.24, PAL.mauve, -Math.PI / 2, Math.PI / 2);
    disc(c, w * 0.26, h * 0.74, w * 0.08, PAL.mustard);
    c.fillStyle = PAL.ink; c.fillRect(w * 0.62, h * 0.12, w * 0.012, h * 0.76);
  }],
  leaves: [40, 40, (c, w, h) => {
    c.fillStyle = PAL.cream; c.fillRect(0, 0, w, h);
    ([[0.32, 0.55, -0.5, PAL.green], [0.55, 0.45, 0.3, PAL.deep], [0.7, 0.66, 0.9, PAL.mustard], [0.42, 0.3, -1.1, PAL.teal], [0.6, 0.78, 0.2, PAL.mauve]] as const)
      .forEach(([x, y, a, col]) => { c.save(); c.translate(w * x, h * y); c.rotate(a); c.fillStyle = col; c.beginPath(); c.ellipse(0, 0, w * 0.2, w * 0.07, 0, 0, Math.PI * 2); c.fill(); c.restore(); });
  }],
  hills: [60, 40, (c, w, h) => {
    vgrad(c, w, h, [[0, '#f3e3cc'], [0.5, PAL.blush]]);
    disc(c, w * 0.7, h * 0.32, h * 0.13, PAL.mustard);
    ([[0.48, PAL.sage, 1.1], [0.6, PAL.green, 1.7], [0.72, PAL.deep, 0.8], [0.84, PAL.plum, 1.3]] as const).forEach(([y0, col, f]) => {
      c.fillStyle = col; c.beginPath(); c.moveTo(0, h);
      for (let x = 0; x <= w; x += 4) c.lineTo(x, h * y0 + Math.sin((x / w) * Math.PI * 2 * f + y0 * 9) * h * 0.06);
      c.lineTo(w, h); c.fill();
    });
  }],
  sun: [40, 40, (c, w, h) => {
    c.fillStyle = PAL.cream; c.fillRect(0, 0, w, h);
    disc(c, w / 2, h * 0.55, w * 0.3, PAL.mustard, Math.PI, 0);
    [PAL.rust, PAL.mauve, PAL.green, PAL.deep].forEach((col, i) => { c.fillStyle = col; c.fillRect(0, h * (0.55 + i * 0.1), w, h * 0.1); });
  }],
  field: [40, 50, (c, w, h) => {
    c.fillStyle = PAL.mauve; c.fillRect(0, 0, w, h);
    c.filter = `blur(${w * 0.012}px)`;
    c.fillStyle = PAL.green; c.fillRect(w * 0.1, h * 0.08, w * 0.8, h * 0.5);
    c.fillStyle = PAL.rust; c.fillRect(w * 0.1, h * 0.64, w * 0.8, h * 0.27);
    c.filter = 'none';
  }],
  boomerang: [30, 30, (c, w, h) => {
    c.fillStyle = PAL.cream; c.fillRect(0, 0, w, h);
    const cols = [PAL.green, PAL.mauve, PAL.mustard, PAL.teal, PAL.rust];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      c.save(); c.translate(w * (0.14 + i * 0.24 + (j % 2) * 0.1), h * (0.14 + j * 0.24)); c.rotate((i * 3 + j) * 0.9);
      c.strokeStyle = cols[(i + j * 2) % cols.length]!; c.lineWidth = w * 0.035; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-w * 0.06, -h * 0.03); c.quadraticCurveTo(0, h * 0.05, w * 0.06, -h * 0.03); c.stroke(); c.restore();
    }
  }],
};

export function artworkCanvas(key: string): HTMLCanvasElement {
  const [cw, ch, draw] = ARTWORKS[key] ?? ARTWORKS.greengrad!;
  const k = 640 / Math.max(cw, ch), w = Math.round(cw * k), h = Math.round(ch * k);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  draw(c, w, h);
  // a little paper grain
  const rand = mulberry(3);
  for (let i = 0; i < (w * h) / 40; i++) { c.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,.035)' : 'rgba(255,255,255,.04)'; c.fillRect(rand() * w, rand() * h, 1.5, 1.5); }
  return cv;
}
