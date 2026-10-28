// The room on the CPU: templates cut into chunks that the GPU draws as instances.
// A chunk merges every mesh of a template that is shown and hidden together, moves together
// (desk parts stretch with the desk) and draws the same way (solid, light fixture or glass).
// Each vertex keeps its material's index, so one chunk can hold many materials.
import { mat4, vec3, type Gltf, type GltfNode, type Mat4 } from './glb.ts';

/** A node's visibility tags, as Blender wrote them into glTF extras. */
export interface Tags {
  opt?: string;
  slotBase?: string;
  hideWith?: string;
  side?: string;
}

export type DrawSet = 'solid' | 'fixture' | 'glass';
export type DeskPart = 'top' | 'north' | 'south' | 'cross';

export interface Chunk {
  id: number;
  owner: string; // template id, or 'ROOM'
  /** Visibility tags from the chunk up to its template, innermost first. */
  chain: Tags[];
  deskPart: DeskPart | null;
  chairBack: boolean;
  set: DrawSet;
  doubleSided: boolean;
  /** Painting key when the chunk is a painting's canvas, which samples its own image. */
  painting: string | null;
  /** Where the chunk's vertices are measured from, in template space. */
  origin: [number, number, number];
  positions: Float32Array; // relative to origin
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Material index per vertex. */
  mats: Uint32Array;
  /** Bounds relative to origin. */
  min: [number, number, number];
  max: [number, number, number];
  /** Bounds of each material's triangles, relative to origin. */
  matBounds: Map<number, { min: number[]; max: number[] }>;
}

export interface Anchor {
  kind: string;
  /** In template space. */
  position: [number, number, number];
  chain: Tags[];
  deskPart: DeskPart | null;
}

export interface Template {
  id: string;
  home: [number, number];
  mount: 'floor' | 'wall';
  facing?: string;
  set?: string;
  setPivot?: [number, number];
  family?: string;
  chunks: Chunk[];
  anchors: Anchor[];
}

const DESK_PARTS: [RegExp, DeskPart][] = [
  [/^Desk_(Top|Top_Walnut|Oak_Top)$/, 'top'],
  [/^Desk_(Foot|Leg|Bracket)_N$|^Desk_(Foot|Leg|Bracket)_Black_N$|^Desk_Oak_(Foot|Leg|Bracket)_1$/, 'north'],
  [/^Desk_(Foot|Leg|Bracket)_S$|^Desk_(Foot|Leg|Bracket)_Black_S$|^Desk_Oak_(Foot|Leg|Bracket)_0$/, 'south'],
  [/^Desk_(Crossbar|Crossbar_Black|Oak_Crossbar)$/, 'cross'],
  [/^PC_(Tower_Tidy|Caddy|Mount)/, 'north'],
];
const CHAIR_BACKS = new Set(['Chair Back Pivot', 'AG Back Pivot', 'Cantilever Back Pivot']);
const GLASS: Record<string, number> = { Glass: 0.18, 'Window Film': 0.6, 'Reeded Glass': 0.5 };
export const glassOpacity = (name: string) => GLASS[name];

const tagsOf = (e: Record<string, any>): Tags | null => {
  const t: Tags = {};
  for (const k of ['opt', 'slotBase', 'hideWith', 'side'] as const) if (e[k] !== undefined) t[k] = String(e[k]);
  return Object.keys(t).length ? t : null;
};
const isFixtureTag = (t: Tags) => (t.opt ?? '').startsWith('light:') || t.slotBase === 'light';

export interface World {
  gltf: Gltf;
  templates: Map<string, Template>;
  room: Template;
  chunks: Chunk[];
}

export function buildWorld(gltf: Gltf): World {
  const templates = new Map<string, Template>();
  const chunks: Chunk[] = [];
  const room: Template = { id: 'ROOM', home: [0, 0], mount: 'floor', chunks: [], anchors: [] };

  for (const r of gltf.roots) {
    const node = gltf.nodes[r]!;
    const e = node.extras;
    if (e.proto) {
      const t: Template = {
        id: e.proto, home: e.home, mount: e.mount, facing: e.facing, set: e.set, setPivot: e.setPivot, family: e.family,
        chunks: [], anchors: [],
      };
      for (const c of node.children) collect(gltf, t, gltf.nodes[c]!, mat4.identity(), [], null, false);
      templates.set(t.id, t);
      finish(t, chunks);
    } else collect(gltf, room, node, mat4.identity(), [], null, false);
  }
  finish(room, chunks);
  return { gltf, templates, room, chunks };
}

// Meshes gathered per chunk key before they're merged
const pending = new WeakMap<Template, Map<string, { key: Omit<Chunk, 'id' | 'origin' | 'positions' | 'normals' | 'uvs' | 'indices' | 'mats' | 'min' | 'max' | 'matBounds'>; parts: { node: GltfNode; m: Mat4 }[] }>>();

function collect(gltf: Gltf, t: Template, node: GltfNode, parent: Mat4, chain: Tags[], deskPart: DeskPart | null, chairBack: boolean) {
  const m = mat4.multiply(parent, node.matrix);
  const tags = tagsOf(node.extras);
  const nextChain = tags ? [tags, ...chain] : chain;
  const name = node.name.replace(/ /g, '_');
  const part = t.id === 'desk' ? DESK_PARTS.find(([re]) => re.test(name))?.[1] ?? deskPart : null;
  const back = chairBack || CHAIR_BACKS.has(node.name.replace(/_/g, ' '));

  if (node.extras.light) {
    let offset = 0;
    if (node.extras.light === 'ceiling') offset = -0.15;
    if (node.extras.light === 'mushroom') offset = -0.04;
    const p = vec3.transformMat4([0, offset, 0], m);
    t.anchors.push({ kind: node.extras.light, position: [p[0]!, p[1]!, p[2]!], chain: nextChain, deskPart: part });
  }

  if (node.mesh) {
    let groups = pending.get(t);
    if (!groups) pending.set(t, (groups = new Map()));
    for (const prim of node.mesh) {
      const mat = gltf.materials[prim.material]!;
      const set: DrawSet = GLASS[mat.name] !== undefined ? 'glass' : nextChain.some(isFixtureTag) && t.id === 'ROOM' ? 'fixture' : 'solid';
      const painting = mat.name.startsWith('Painting ') ? mat.name.slice(9) : null;
      const key = { owner: t.id, chain: nextChain, deskPart: part, chairBack: back, set, doubleSided: mat.doubleSided || /Curtain|Lantern|Shoji/.test(mat.name), painting };
      const k = JSON.stringify(key);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { key, parts: [] }));
      g.parts.push({ node: { ...node, mesh: [prim] }, m });
    }
  }
  for (const c of node.children) collect(gltf, t, gltf.nodes[c]!, m, nextChain, part, back);
}

function finish(t: Template, all: Chunk[]) {
  const groups = pending.get(t);
  if (!groups) return;
  for (const { key, parts } of groups.values()) {
    let verts = 0, idx = 0;
    for (const { node } of parts) { verts += node.mesh![0]!.positions.length / 3; idx += node.mesh![0]!.indices.length; }
    const positions = new Float32Array(verts * 3), normals = new Float32Array(verts * 3), uvs = new Float32Array(verts * 2);
    const indices = new Uint32Array(idx), mats = new Uint32Array(verts);
    let v = 0, i = 0;
    for (const { node, m } of parts) {
      const prim = node.mesh![0]!;
      const n = mat4.transpose(mat4.inverse(m));
      const mirrored = mat4.determinant(m) < 0;
      const count = prim.positions.length / 3;
      for (let k = 0; k < count; k++) {
        const p = vec3.transformMat4([prim.positions[k * 3]!, prim.positions[k * 3 + 1]!, prim.positions[k * 3 + 2]!], m);
        positions.set(p, (v + k) * 3);
        const q = vec3.normalize(vec3.transformMat4Upper3x3([prim.normals[k * 3]!, prim.normals[k * 3 + 1]!, prim.normals[k * 3 + 2]!], n));
        normals.set(q, (v + k) * 3);
        uvs[(v + k) * 2] = prim.uvs[k * 2]!;
        uvs[(v + k) * 2 + 1] = prim.uvs[k * 2 + 1]!;
        mats[v + k] = prim.material;
      }
      for (let k = 0; k < prim.indices.length; k += 3) {
        indices[i + k] = prim.indices[k]! + v;
        indices[i + k + 1] = prim.indices[k + (mirrored ? 2 : 1)]! + v;
        indices[i + k + 2] = prim.indices[k + (mirrored ? 1 : 2)]! + v;
      }
      v += count;
      i += prim.indices.length;
    }
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < verts; k++) for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, positions[k * 3 + a]!);
      max[a] = Math.max(max[a]!, positions[k * 3 + a]!);
    }
    const origin = [0, 1, 2].map((a) => (min[a]! + max[a]!) / 2) as [number, number, number];
    for (let k = 0; k < verts; k++) for (let a = 0; a < 3; a++) positions[k * 3 + a]! -= origin[a]!;
    const matBounds = new Map<number, { min: number[]; max: number[] }>();
    for (let k = 0; k < verts; k++) {
      let b = matBounds.get(mats[k]!);
      if (!b) matBounds.set(mats[k]!, (b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
      for (let a = 0; a < 3; a++) { b.min[a] = Math.min(b.min[a]!, positions[k * 3 + a]!); b.max[a] = Math.max(b.max[a]!, positions[k * 3 + a]!); }
    }
    const chunk: Chunk = {
      ...key, id: all.length, origin, positions, normals, uvs, indices, mats,
      min: [min[0]! - origin[0], min[1]! - origin[1], min[2]! - origin[2]],
      max: [max[0]! - origin[0], max[1]! - origin[1], max[2]! - origin[2]],
      matBounds,
    };
    all.push(chunk);
    t.chunks.push(chunk);
  }
  pending.delete(t);
}
