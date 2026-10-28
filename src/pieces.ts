// Turns planner objects into instance rows and lamp lights, and answers questions about what is
// where: which piece is under the pointer, and the box around a piece, a wall or the ceiling lamp.
import type { Gpu, LightSpec } from './gpu.ts';
import type { Anchor, Chunk, DeskPart, Tags, Template, World } from './world.ts';
import { glassOpacity } from './world.ts';
import { V3, type Ray } from './camera.ts';

export interface Placement {
  /** Three.js-space position of the template's pivot. */
  position: V3;
  /** Turn about +y, radians. */
  yaw: number;
  /** Whether a node with these tags shows. */
  shows: (t: Tags) => boolean;
  desk?: { ds: number; dn: number; top: number; cross: number };
  hideChairBack?: boolean;
  /** Linear lamp colour, or null for the lamps' own. */
  tint: [number, number, number] | null;
}

interface Placed {
  template: Template;
  placement: Placement;
  /** Chunks shown, with their row transforms. */
  rows: Map<number, { position: V3; yaw: number; scale: [number, number, number] }>;
}

export interface Box { min: V3; max: V3 }

// three.js PointLight intensities, divided by pi for the kit's units
const LAMPS: Record<string, { color: number; intensity: number }> = {
  ceiling: { color: 0xffd2a0, intensity: 8 },
  pendant: { color: 0xffc98f, intensity: 5 },
  desk: { color: 0xfff2d0, intensity: 1.2 },
  bulb: { color: 0xffb060, intensity: 0.5 },
  mushroom: { color: 0xffc27a, intensity: 1.4 },
  floor: { color: 0xffc98f, intensity: 2.2 },
  console: { color: 0xffcf96, intensity: 1.2 },
  bench: { color: 0xf4f6ff, intensity: 1.6 },
  sconce: { color: 0xffcf96, intensity: 1.0 },
  uplight: { color: 0xffd8a8, intensity: 1.5 },
  bias: { color: 0xffc890, intensity: 0.6 },
  donut: { color: 0xff8a30, intensity: 1.4 },
  globe: { color: 0xffd8a8, intensity: 1.2 },
};
export const lampBase = (kind: string) => LAMPS[kind] ?? { color: 0xffd2a0, intensity: 1 };
export const srgbHexToLinear = (hex: number): [number, number, number] => {
  const c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return [c[0]!, c[1]!, c[2]!];
};

export function createPieces(world: World, gpu: Gpu) {
  const placed = new Map<string, Placed>();
  /** Lights by key, with the room's ceiling light set from outside. */
  const lamps = new Map<string, LightSpec>();
  let roomLamp: { color: [number, number, number]; intensity: number } | null = null;
  let shadowKey: string | null = null;

  const deskShift = (part: DeskPart | null, desk: Placement['desk']): { z: number; k: number } => {
    if (!part || !desk) return { z: 0, k: 1 };
    if (part === 'top') return { z: -(desk.ds + desk.dn) / 2, k: desk.top };
    if (part === 'cross') return { z: -(desk.ds + desk.dn) / 2, k: desk.cross };
    if (part === 'north') return { z: -desk.dn, k: 1 };
    return { z: -desk.ds, k: 1 };
  };
  const chunkShows = (c: Chunk, p: Placement) => c.chain.every(p.shows) && !(c.chairBack && p.hideChairBack);
  const anchorShows = (a: Anchor, p: Placement) => a.chain.every(p.shows);

  function place(key: string, template: Template, p: Placement) {
    let entry = placed.get(key);
    if (!entry || entry.template !== template) {
      if (entry) remove(key);
      entry = { template, placement: p, rows: new Map() };
      placed.set(key, entry);
    }
    entry.placement = p;
    const rotation: [number, number, number, number] = [0, Math.sin(p.yaw / 2), 0, Math.cos(p.yaw / 2)];
    for (const c of template.chunks) {
      const rowKey = `${key}#${c.id}`;
      if (!chunkShows(c, p)) {
        gpu.place(rowKey, c, null);
        entry.rows.delete(c.id);
        continue;
      }
      const { z, k } = deskShift(c.deskPart, p.desk);
      const local = new V3(c.origin[0], c.origin[1], c.origin[2] + z).rotateY(p.yaw);
      const position = p.position.clone().add(local);
      const scale: [number, number, number] = [1, 1, k];
      const tint: [number, number, number, number] = p.tint ? [...p.tint, 1] : [0, 0, 0, 0];
      const op = c.set === 'glass' ? glassOpacityOf(c) : undefined;
      gpu.place(rowKey, c, { position: position.toArray(), rotation, scale, tint, ...(op !== undefined ? { opacity: op } : {}) });
      entry.rows.set(c.id, { position, yaw: p.yaw, scale });
    }
    // Lamps
    for (const k of [...lamps.keys()]) if (k.startsWith(key + '@')) lamps.delete(k);
    template.anchors.forEach((a, i) => {
      if (!anchorShows(a, p)) return;
      const { z } = deskShift(a.deskPart, p.desk);
      const at = p.position.clone().add(new V3(a.position[0], a.position[1], a.position[2] + z).rotateY(p.yaw));
      const base = lampBase(a.kind);
      if (a.kind === 'ceiling') {
        if (!roomLamp) return;
        lamps.set(`${key}@${i}`, { position: at.toArray(), color: roomLamp.color, intensity: roomLamp.intensity / Math.PI, range: 14 });
        shadowKey = `${key}@${i}`;
        return;
      }
      const color = p.tint ?? srgbHexToLinear(base.color);
      lamps.set(`${key}@${i}`, { position: at.toArray(), color, intensity: base.intensity / Math.PI, range: 10 });
    });
  }

  function remove(key: string) {
    const entry = placed.get(key);
    if (!entry) return;
    for (const c of entry.template.chunks) gpu.place(`${key}#${c.id}`, c, null);
    for (const k of [...lamps.keys()]) if (k.startsWith(key + '@')) lamps.delete(k);
    placed.delete(key);
  }

  const matName = (i: number) => world.gltf.materials[i]?.name ?? '';
  const glassOpacityOf = (c: Chunk) => glassOpacity(matName(c.mats[0] ?? 0)) ?? 0.3;

  function flushLights() {
    const shadow = shadowKey && lamps.has(shadowKey) ? shadowKey : null;
    gpu.setLights(lamps, shadow);
  }

  // ---------------------------------------------------------------- picking
  function pick(ray: Ray) {
    let best: { t: number; key: string; chunk: Chunk; mat: number; point: V3; normal: V3 } | null = null;
    for (const [key, entry] of placed) {
      for (const [id, row] of entry.rows) {
        const c = world.chunks[id]!;
        // into the chunk's space: undo position, turn, then scale
        const o = ray.origin.clone().sub(row.position).rotateY(-row.yaw);
        const dv = ray.direction.clone().rotateY(-row.yaw);
        o.z /= row.scale[2]; dv.z /= row.scale[2];
        if (!hitsBox(o, dv, c.min, c.max, best?.t ?? Infinity)) continue;
        const hit = hitTriangles(o, dv, c, best?.t ?? Infinity);
        if (hit) {
          const point = ray.origin.clone().add(ray.direction.clone().multiplyScalar(hit.t));
          const n = new V3(hit.n[0], hit.n[1], hit.n[2] / row.scale[2]).rotateY(row.yaw).normalize();
          best = { t: hit.t, key, chunk: c, mat: c.mats[hit.v]!, point, normal: n };
        }
      }
    }
    return best && { ...best, material: matName(best.mat) };
  }

  // ---------------------------------------------------------------- bounds
  function boxOf(entry: Placed, chunks: Iterable<[number, { position: V3; yaw: number; scale: [number, number, number] }]>, part?: (c: Chunk) => { min: number[]; max: number[] } | null): Box | null {
    const min = new V3(Infinity, Infinity, Infinity), max = new V3(-Infinity, -Infinity, -Infinity);
    let any = false;
    for (const [id, row] of chunks) {
      const c = world.chunks[id]!;
      const b = part ? part(c) : { min: c.min, max: c.max };
      if (!b) continue;
      any = true;
      for (let i = 0; i < 8; i++) {
        const p = new V3(i & 1 ? b.max[0]! : b.min[0]!, i & 2 ? b.max[1]! : b.min[1]!, (i & 4 ? b.max[2]! : b.min[2]!) * row.scale[2]).rotateY(row.yaw).add(row.position);
        min.set(Math.min(min.x, p.x), Math.min(min.y, p.y), Math.min(min.z, p.z));
        max.set(Math.max(max.x, p.x), Math.max(max.y, p.y), Math.max(max.z, p.z));
      }
    }
    void entry;
    return any ? { min, max } : null;
  }
  const bounds = (key: string) => { const e = placed.get(key); return e ? boxOf(e, e.rows) : null; };
  const boundsWhere = (key: string, test: (c: Chunk) => boolean, matIndex?: number) => {
    const e = placed.get(key);
    if (!e) return null;
    return boxOf(e, [...e.rows].filter(([id]) => test(world.chunks[id]!)), matIndex === undefined ? undefined : (c) => c.matBounds.get(matIndex) ?? null);
  };

  return {
    place,
    remove,
    has: (key: string) => placed.has(key),
    keys: () => placed.keys(),
    setRoomLamp(l: typeof roomLamp) { roomLamp = l; },
    flushLights,
    pick,
    bounds,
    boundsWhere,
    lampsOf: (template: Template) => template.anchors.length > 0,
  };
}
export type Pieces = ReturnType<typeof createPieces>;

function hitsBox(o: V3, d: V3, min: number[], max: number[], limit: number) {
  let t0 = 0, t1 = limit;
  const os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    const inv = 1 / ds[a]!;
    let tn = (min[a]! - os[a]!) * inv, tf = (max[a]! - os[a]!) * inv;
    if (tn > tf) [tn, tf] = [tf, tn];
    t0 = Math.max(t0, tn); t1 = Math.min(t1, tf);
    if (t0 > t1) return false;
  }
  return true;
}

function hitTriangles(o: V3, d: V3, c: Chunk, limit: number) {
  const P = c.positions, I = c.indices;
  let best: { t: number; v: number; n: [number, number, number] } | null = null;
  let tMax = limit;
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i]! * 3, b = I[i + 1]! * 3, e = I[i + 2]! * 3;
    const e1x = P[b]! - P[a]!, e1y = P[b + 1]! - P[a + 1]!, e1z = P[b + 2]! - P[a + 2]!;
    const e2x = P[e]! - P[a]!, e2y = P[e + 1]! - P[a + 1]!, e2z = P[e + 2]! - P[a + 2]!;
    const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const tx = o.x - P[a]!, ty = o.y - P[a + 1]!, tz = o.z - P[a + 2]!;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t <= 1e-5 || t >= tMax) continue;
    tMax = t;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    // face the ray, as three's raycast reports the face normal
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    best = { t, v: I[i]!, n: [nx, ny, nz] };
  }
  return best;
}
