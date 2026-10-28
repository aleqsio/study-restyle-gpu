// Draws the room with TypeGPU Kit: one mesh pool of chunks, instance sets for solid pieces,
// light fixtures and glass, point lights with a shadow from the ceiling light, a final pass with
// ACES tone mapping, and lines on top for the gizmo and the selection box.
import { cameras, frames, instances, lighting, lines, meshPool, passes, post, shading, targets, textures, tone } from '@typegpu/kit';
import * as web from '@typegpu/kit/web';
import { caps } from '@typegpu/kit/geometry';
import { d, std, tgpu } from 'typegpu';
import type { Chunk, DrawSet, World } from './world.ts';
import { artworkCanvas, patternCanvas, type PatternSpec } from './patterns.ts';

export const MAX_MATS = 192;
const HDR = 'rgba16float';
const SAMPLES = 4;

const Mat = d.struct({
  color: d.vec3f,
  roughness: d.f32,
  emission: d.vec3f,
  metallic: d.f32,
  /** Layer of the pattern array, or -1. */
  pattern: d.i32,
  /** 1 when the mesh's own texture (a painting) gives the colour. */
  painted: d.u32,
  /** 1 for a lamp's shade or bulb, which follows the lamp's light colour. */
  glow: d.u32,
  glowStrength: d.f32,
});
export type MatValue = d.Infer<typeof Mat>;

const mats = tgpu.accessor(d.arrayOf(Mat, MAX_MATS));
const patterns = tgpu.accessor(d.texture2dArray(d.f32));
const smooth = tgpu.accessor(d.sampler());

export interface Row {
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  /** Lamp colour for glowing materials, linear, w = 1 when set. */
  tint: [number, number, number, number];
  opacity?: number;
}

export interface LightSpec {
  position: [number, number, number];
  color: [number, number, number];
  intensity: number;
  range: number;
}

export interface OverlayLine {
  points: number[];
  color: [number, number, number, number];
  width: number;
  closed?: boolean;
  /** Arrowheads at both ends. */
  arrow?: boolean;
}

const EXPOSURE = 1.05;
/**
 * The light that comes out of the final pass as `display`, a linear screen colour: ACES
 * (Narkowicz's fit) undone, then exposure. For the background and the lines drawn on top.
 */
export function beforeTone(display: number): number {
  const y = Math.min(Math.max(display, 0), 0.98), a = 2.43 * y - 2.51, b = 0.59 * y - 0.03, k = 0.14 * y;
  const x = Math.abs(a) < 1e-6 ? -k / b : (-b - Math.sqrt(Math.max(0, b * b - 4 * a * k))) / (2 * a);
  return Math.max(0, x) / EXPOSURE;
}
const toneColor = (c: [number, number, number, number]): [number, number, number, number] => [beforeTone(c[0]), beforeTone(c[1]), beforeTone(c[2]), c[3]];

export async function createGpu(canvas: HTMLCanvasElement, world: World, specs: PatternSpec[]) {
  const root = await tgpu.init();
  const surface = web.surface(root, canvas, { maxPixelRatio: 2 });

  // ---------------------------------------------------------------- meshes
  const chunks = world.chunks;
  const pool = meshPool.create(root, {
    capacity: chunks.length,
    vertices: chunks.reduce((s, c) => s + c.positions.length / 3, 0),
    indices: chunks.reduce((s, c) => s + c.indices.length, 0),
    extra: { mat: d.u32 },
  });
  const bitmaps = new Map<string, ImageBitmap>();
  for (const c of chunks) if (c.painting && !bitmaps.has(c.painting)) bitmaps.set(c.painting, await createImageBitmap(artworkCanvas(c.painting)));
  const meshOf = new Map<number, ReturnType<typeof pool.add>['meshes'][number]>();
  const loads: Promise<void>[] = [];
  for (const c of chunks) {
    const model = pool.add({
      meshes: [{
        positions: c.positions, normals: c.normals, uvs: c.painting ? paintingUvs(c) : c.uvs, indices: c.indices,
        material: {
          color: [1, 1, 1, 1], roughness: 1, metallic: 0, emission: [0, 0, 0],
          textures: c.painting ? { color: { image: 0, sampler: { addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' } } } : {},
          doubleSided: c.doubleSided,
        },
        extra: { mat: c.mats },
      }],
      images: c.painting ? [bitmaps.get(c.painting)!] : [],
    });
    loads.push(model.ready);
    meshOf.set(c.id, model.meshes[0]!);
  }

  // ---------------------------------------------------------------- materials
  const matBuffer = root.createReadonly(d.arrayOf(Mat, MAX_MATS));
  const matValues: MatValue[] = Array.from({ length: MAX_MATS }, () => ({
    color: d.vec3f(1), roughness: 1, emission: d.vec3f(0), metallic: 0, pattern: -1, painted: 0, glow: 0, glowStrength: 1,
  }));
  let matsDirty = true;
  const bitmapsOfSpecs = await Promise.all(specs.map((s) => createImageBitmap(patternCanvas(s))));
  const patternTexture = textures.array(root, bitmapsOfSpecs.length ? bitmapsOfSpecs : [await createImageBitmap(patternCanvas({ peg: '#ffffff' }))]);
  const patternView = patternTexture.createView(d.texture2dArray(d.f32));
  const patternSampler = textures.sampler(root, { anisotropy: 8 });

  // ---------------------------------------------------------------- the kind
  const Piece = instances.define('Piece', {
    host: { tint: d.vec4f },
    carry: (vertexIndex) => {
      'use gpu';
      return d.vec4f(d.f32(pool.extra.mat(vertexIndex)), 0, 0, 0);
    },
    material: (point, piece, base, carried) => {
      'use gpu';
      const m = mats.$[d.u32(carried.x + 0.5)]!;
      // Sampled before any branch: WGSL wants textureSample in uniform control flow
      const grain = std.textureSample(patterns.$, smooth.$, point.uv, std.max(m.pattern, 0)).xyz;
      let color = d.vec3f(m.color);
      if (m.painted === 1) {
        color = d.vec3f(base.color);
      } else if (m.pattern >= 0) {
        color = color * grain;
      }
      let emission = d.vec3f(m.emission);
      if (m.glow === 1 && piece.tint.w > 0.5) {
        emission = piece.tint.xyz * m.glowStrength;
        color = std.mix(piece.tint.xyz, d.vec3f(1), 0.6);
      }
      return shading.Material({ color, roughness: m.roughness, metallic: m.metallic, emission });
    },
  });

  const counts: Record<DrawSet, number> = { solid: 0, fixture: 0, glass: 0 };
  for (const c of chunks) counts[c.set] += 1;
  const capacityFor = (set: DrawSet) => Math.max(64, counts[set] * 24);
  const sets = {
    solid: instances.create(root, pool, { kind: Piece, capacity: capacityFor('solid') }),
    fixture: instances.create(root, pool, { kind: Piece, capacity: capacityFor('fixture') }),
    glass: instances.create(root, pool, { kind: Piece, capacity: capacityFor('glass') }),
  };

  // ---------------------------------------------------------------- light
  const light = lighting.create(root, {
    settings: { sunDirection: [0, 0, 0], sunIntensity: 0, skyTop: [0.9, 0.8, 0.6], skyBottom: [0.15, 0.09, 0.05], skyIntensity: 0.24 },
    points: { capacity: 48 },
    pointShadow: { count: 1, size: 1024 },
  });
  const fill = (cfg: any) => cfg.with(mats, matBuffer).with(patterns, () => patternView.$).with(smooth, () => patternSampler.$);
  const renderers = {
    solid: sets.solid.renderer(light).pipe(fill),
    fixture: sets.fixture.renderer(light).pipe(fill),
    glass: sets.glass.renderer(light, { alpha: 'blend' }).pipe(fill),
  };

  // ---------------------------------------------------------------- passes
  const view = cameras.custom(root);
  const screen = targets.create(root, surface, {
    color: { format: HDR, samples: SAMPLES },
    depth: { format: 'depth24plus', samples: SAMPLES },
    hdr: { format: HDR, sampled: true },
  });
  const background = [0.6, 0.55, 0.48, 1];
  const scene = passes
    .create(root, screen, { color: passes.color, depth: passes.depth }, { resolve: { color: 'hdr' }, clear: background })
    .pipe(view.inject());
  const drawn = [scene.add(renderers.solid), scene.add(renderers.fixture), scene.add(renderers.glass)];
  const casters = light.pointShadow.add(renderers.solid);

  const overlay = passes.create(root, screen, { hdr: passes.color }).pipe(view.inject());
  const OVERLAY_LINES = 16;
  const strokes = lines.create(root, view, { capacity: OVERLAY_LINES, length: 72, units: 'points' });
  const arrows = lines.create(root, view, { capacity: 4, length: 2, units: 'points', startCap: caps.arrow, endCap: caps.arrow });
  const overlayDrawn = [overlay.add(strokes.drawing), overlay.add(arrows.drawing)];

  const final = post.create(root, {
    format: surface.format,
    source: () => screen.textures.hdr,
    tone: tone.aces,
    settings: { exposure: EXPOSURE, vignette: 0 },
  });

  await Promise.all([scene.initAsync(), overlay.initAsync(), final.initAsync(), ...loads]);

  // ---------------------------------------------------------------- rows and lights
  type Placed = { set: DrawSet; id: ReturnType<typeof sets.solid.add> };
  const rows = new Map<string, Placed>();
  const lightIds = new Map<string, ReturnType<NonNullable<typeof light.points>['add']>>();
  let shadowKey: string | null = null;

  const api = {
    root,
    surface,
    view,
    background,
    setMaterial(i: number, v: Partial<MatValue>) {
      Object.assign(matValues[i]!, v);
      matsDirty = true;
    },
    /** Shows a chunk at a transform, under `key`; `null` hides it. */
    place(key: string, chunk: Chunk, row: Row | null) {
      const had = rows.get(key);
      if (!row) {
        if (had) { sets[had.set].remove(had.id); rows.delete(key); }
        return;
      }
      const fields = { position: row.position, rotation: row.rotation, scale: row.scale, tint: row.tint, ...(row.opacity !== undefined ? { opacity: row.opacity } : {}) };
      if (had) sets[had.set].write(had.id, fields as any);
      else rows.set(key, { set: chunk.set, id: sets[chunk.set].add(meshOf.get(chunk.id)!, fields as any) });
    },
    has: (key: string) => rows.has(key),
    keys: () => rows.keys(),
    /** Replaces the point lights, keyed; `shadow` names the one that casts. */
    setLights(next: Map<string, LightSpec>, shadow: string | null) {
      for (const [key, id] of lightIds) if (!next.has(key)) { light.points.remove(id); lightIds.delete(key); }
      for (const [key, l] of next) {
        const id = lightIds.get(key);
        if (id === undefined) lightIds.set(key, light.points.add(l));
        else light.points.write(id, l);
      }
      if (shadow !== shadowKey) {
        shadowKey = shadow;
        const id = shadow ? lightIds.get(shadow) : undefined;
        light.pointShadow.cast(id !== undefined ? [id] : []);
      }
    },
    setSky(top: number[], bottom: number[], intensity: number) {
      light.settings.patch({ skyTop: top as any, skyBottom: bottom as any, skyIntensity: intensity });
    },
    setOverlay(list: OverlayLine[]) {
      const plain = list.filter((l) => !l.arrow), pointed = list.filter((l) => l.arrow);
      for (let i = 0; i < OVERLAY_LINES; i++) {
        const l = plain[i];
        if (!l) { strokes.write(i, []); continue; }
        const pts = l.closed ? [...l.points, l.points[0]!, l.points[1]!, l.points[2]!] : l.points;
        strokes.write(i, pts, { width: l.width, color: toneColor(l.color) });
      }
      for (let i = 0; i < 4; i++) {
        const l = pointed[i];
        arrows.write(i, l ? l.points : [], l ? { width: l.width, color: toneColor(l.color) } : undefined);
      }
    },
    onFrame: (_dt: number) => {},
  };

  const loop = frames.create(root, (frame) => {
    api.onFrame(frame.dt);
    if (matsDirty) { matBuffer.write(matValues); matsDirty = false; }
    sets.solid.flush(); sets.fixture.flush(); sets.glass.flush();
    screen.fit();
    light.flush();
    light.pointShadow.record(frame.encoder, casters);
    scene.record(frame, drawn);
    overlay.record(frame, overlayDrawn, { clear: false });
    final.record(frame.encoder, surface.view(frame));
  });
  web.animate(loop, { surface });
  return api;
}
export type Gpu = Awaited<ReturnType<typeof createGpu>>;

/** A painting's canvas is a plain box from Blender: give it 0..1 UVs, up is up, across runs along the wall. */
function paintingUvs(c: Chunk) {
  const n = c.positions.length / 3;
  const size = [c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2]];
  const across = size[0]! > size[2]! ? 0 : 2;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    uv[i * 2] = (c.positions[i * 3 + across]! - c.min[across]!) / size[across]!;
    uv[i * 2 + 1] = 1 - (c.positions[i * 3 + 1]! - c.min[1]) / size[1]!;
  }
  return uv;
}
