// Reads the room model: a gzipped, base64-wrapped binary glTF, into nodes, meshes and materials.
// The kit's own gltf.read flattens nodes and merges meshes by material; the planner needs every
// node's extras, so this keeps the tree and leaves the merging to world.ts.
import { mat4, quat, vec3 } from 'wgpu-matrix';

export type Mat4 = Float32Array;

export interface GltfMaterial {
  name: string;
  /** Linear RGBA. */
  color: [number, number, number, number];
  roughness: number;
  metallic: number;
  /** Linear, times KHR_materials_emissive_strength. */
  emission: [number, number, number];
  /** KHR_materials_emissive_strength, 1 without it. */
  strength: number;
  doubleSided: boolean;
}

export interface Primitive {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  material: number;
}

export interface GltfNode {
  index: number;
  name: string;
  extras: Record<string, any>;
  children: number[];
  parent: number | null;
  /** Local transform. */
  matrix: Mat4;
  mesh: Primitive[] | null;
}

export interface Gltf {
  nodes: GltfNode[];
  roots: number[];
  materials: GltfMaterial[];
}

export async function loadRoom(url: string): Promise<Gltf> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const { data } = await res.json();
  const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
  const glb = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return parseGlb(glb);
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function parseGlb(buffer: ArrayBuffer): Gltf {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("The room model isn't a binary glTF.");
  let offset = 12;
  let json: any = null;
  let bin: ArrayBuffer | null = null;
  while (offset < buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)));
    else if (type === 0x004e4942) bin = buffer.slice(start, start + length);
    offset = start + length;
  }
  if (!json || !bin) throw new Error('The room model has no JSON or binary chunk.');

  const read = (index: number) => {
    const acc = json.accessors[index];
    const bv = json.bufferViews[acc.bufferView];
    const n = COMPONENTS[acc.type]! * acc.count;
    const at = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const stride = bv.byteStride;
    const size = COMPONENTS[acc.type]!;
    const Ctor = acc.componentType === 5126 ? Float32Array : acc.componentType === 5125 ? Uint32Array : acc.componentType === 5123 ? Uint16Array : Uint8Array;
    if (stride && stride !== size * Ctor.BYTES_PER_ELEMENT) {
      const out = new Ctor(n);
      for (let i = 0; i < acc.count; i++) out.set(new Ctor(bin!, at + i * stride, size), i * size);
      return out;
    }
    return new Ctor(bin!.slice(at, at + n * Ctor.BYTES_PER_ELEMENT));
  };

  const materials: GltfMaterial[] = (json.materials ?? []).map((m: any) => {
    const pbr = m.pbrMetallicRoughness ?? {};
    const strength = m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
    const e = m.emissiveFactor ?? [0, 0, 0];
    return {
      name: m.name ?? '',
      color: pbr.baseColorFactor ?? [1, 1, 1, 1],
      roughness: pbr.roughnessFactor ?? 1,
      metallic: pbr.metallicFactor ?? 1,
      emission: [e[0] * strength, e[1] * strength, e[2] * strength],
      strength,
      doubleSided: !!m.doubleSided,
    };
  });

  const meshes: Primitive[][] = (json.meshes ?? []).map((mesh: any) =>
    mesh.primitives.map((p: any) => {
      const positions = read(p.attributes.POSITION) as Float32Array;
      const count = positions.length / 3;
      const normals = p.attributes.NORMAL !== undefined ? (read(p.attributes.NORMAL) as Float32Array) : new Float32Array(count * 3);
      const uvs = p.attributes.TEXCOORD_0 !== undefined ? (read(p.attributes.TEXCOORD_0) as Float32Array) : new Float32Array(count * 2);
      const raw = p.indices !== undefined ? read(p.indices) : Uint32Array.from({ length: count }, (_, i) => i);
      return { positions, normals, uvs, indices: Uint32Array.from(raw), material: p.material ?? 0 };
    }),
  );

  const nodes: GltfNode[] = json.nodes.map((n: any, index: number) => {
    let matrix: Mat4;
    if (n.matrix) matrix = new Float32Array(n.matrix);
    else {
      matrix = mat4.identity();
      mat4.translate(matrix, n.translation ?? [0, 0, 0], matrix);
      mat4.multiply(matrix, mat4.fromQuat(n.rotation ?? [0, 0, 0, 1]), matrix);
      mat4.scale(matrix, n.scale ?? [1, 1, 1], matrix);
    }
    return { index, name: n.name ?? `node ${index}`, extras: n.extras ?? {}, children: n.children ?? [], parent: null, matrix, mesh: n.mesh !== undefined ? meshes[n.mesh]! : null };
  });
  for (const n of nodes) for (const c of n.children) nodes[c]!.parent = n.index;

  return { nodes, roots: json.scenes[json.scene ?? 0].nodes, materials };
}

/** Splits a transform into position, rotation and scale (no shear). */
export function decompose(m: Mat4) {
  const position = [m[12]!, m[13]!, m[14]!] as [number, number, number];
  const sx = Math.hypot(m[0]!, m[1]!, m[2]!), sy = Math.hypot(m[4]!, m[5]!, m[6]!), sz = Math.hypot(m[8]!, m[9]!, m[10]!);
  const det = mat4.determinant(m);
  const scale = [det < 0 ? -sx : sx, sy, sz] as [number, number, number];
  const r = mat4.identity();
  for (let i = 0; i < 3; i++) { r[i] = m[i]! / scale[0]; r[4 + i] = m[4 + i]! / sy; r[8 + i] = m[8 + i]! / sz; }
  const rotation = Array.from(quat.fromMat(r)) as [number, number, number, number];
  return { position, rotation, scale };
}

export { mat4, quat, vec3 };
