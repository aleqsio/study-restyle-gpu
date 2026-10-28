// Move and turn handles drawn as kit lines over the scene: arrows along x, y and z, a square to
// slide on the floor's plane, and a ring to turn about y. Hit-tested on the screen and dragged
// with rays, as three.js's TransformControls does.
import { V3, type Rig } from './camera.ts';
import type { OverlayLine } from './gpu.ts';

export type Axis = 'X' | 'Y' | 'Z' | 'XZ' | 'E';

export interface GizmoEvents {
  /** A drag starts; return false to refuse it. */
  start(axis: Axis): void;
  /** The handle moved: where its middle is now and how far it has turned, radians. */
  change(position: V3, yaw: number, axis: Axis): void;
  end(): void;
}

const AXES: Record<'X' | 'Y' | 'Z', V3> = { X: new V3(1, 0, 0), Y: new V3(0, 1, 0), Z: new V3(0, 0, 1) };
// Linear screen colours, as TransformControls draws them
const COLORS: Record<Axis, [number, number, number, number]> = {
  X: [0.9, 0.02, 0.02, 1], Y: [0.05, 0.9, 0.05, 1], Z: [0.02, 0.05, 0.9, 1], XZ: [0.05, 0.9, 0.05, 0.6], E: [0.05, 0.9, 0.05, 1],
};
const ACTIVE: [number, number, number, number] = [0.95, 0.85, 0.05, 1];
const SNAP = 0.01;
const TURN_SNAP = (5 * Math.PI) / 180;

export function createGizmo(rig: Rig, canvas: HTMLCanvasElement, events: GizmoEvents) {
  let at: { position: V3; yaw: number; ring: boolean } | null = null;
  let hover: Axis | null = null;
  let drag: { axis: Axis; start: V3; yaw0: number; s0: number; plane0: V3 | null; angle0: number } | null = null;

  const size = () => {
    if (!at) return 0.2;
    if (rig.ortho) return (rig.orthoHalf / rig.orthoZoom) * 0.22;
    const dist = rig.position.clone().sub(at.position).length();
    return dist * Math.tan((rig.fov * Math.PI) / 360) * 0.32;
  };
  const toScreen = (p: V3) => rig.project(p, canvas.clientWidth, canvas.clientHeight);
  const pointer = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, ray: rig.rayAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height) };
  };

  function handles() {
    if (!at) return [];
    const L = size(), c = at.position;
    const out: { axis: Axis; points: V3[]; closed?: boolean; arrow?: boolean }[] = [];
    for (const k of ['X', 'Y', 'Z'] as const) out.push({ axis: k, points: [c.clone().add(AXES[k].clone().multiplyScalar(-L)), c.clone().add(AXES[k].clone().multiplyScalar(L))], arrow: true });
    const q = L * 0.22, o = L * 0.28;
    out.push({ axis: 'XZ', points: [new V3(o, 0, o), new V3(o + q, 0, o), new V3(o + q, 0, o + q), new V3(o, 0, o + q)].map((p) => p.add(c)), closed: true });
    if (at.ring) {
      const R = L * 1.25, pts: V3[] = [];
      for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; pts.push(new V3(c.x + Math.cos(a) * R, c.y, c.z - Math.sin(a) * R)); }
      out.push({ axis: 'E', points: pts, closed: true });
    }
    return out;
  }

  function hit(px: number, py: number): Axis | null {
    let best: Axis | null = null, bestD = 9;
    for (const h of handles()) {
      const s = h.points.map(toScreen);
      if (s.some((p) => !p)) continue;
      const n = h.closed ? s.length : s.length - 1;
      if (h.axis === 'XZ' && inside(px, py, s as { x: number; y: number }[])) return 'XZ';
      for (let i = 0; i < n; i++) {
        const a = s[i]!, b = s[(i + 1) % s.length]!;
        const d = segDist(px, py, a.x, a.y, b.x, b.y) + (h.axis === 'E' ? 2 : 0);
        if (d < bestD) { bestD = d; best = h.axis; }
      }
    }
    return best;
  }

  // Where a ray passes closest to the line through `c` along `dir`, as a distance along it
  const along = (ray: { origin: V3; direction: V3 }, c: V3, dir: V3) => {
    const w = ray.origin.clone().sub(c);
    const b = dot(dir, ray.direction), d = dot(dir, w), e = dot(ray.direction, w);
    const den = 1 - b * b;
    if (den < 1e-6) return 0;
    return (d - b * e) / den;
  };
  const onPlane = (ray: { origin: V3; direction: V3 }, y: number) => {
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = (y - ray.origin.y) / ray.direction.y;
    return t > 0 ? ray.origin.clone().add(ray.direction.clone().multiplyScalar(t)) : null;
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (!at || e.button !== 0) return;
    const p = pointer(e);
    const axis = hit(p.x, p.y);
    if (!axis) return;
    e.stopImmediatePropagation();
    canvas.setPointerCapture(e.pointerId);
    const start = at.position.clone();
    const plane0 = axis === 'XZ' || axis === 'E' ? onPlane(p.ray, start.y) : null;
    drag = {
      axis, start, yaw0: at.yaw,
      s0: axis.length === 1 && axis !== 'E' ? along(p.ray, start, AXES[axis as 'X']) : 0,
      plane0,
      angle0: plane0 ? Math.atan2(-(plane0.z - start.z), plane0.x - start.x) : 0,
    };
    rig.blocked = true;
    events.start(axis);
  }, { capture: true });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointer(e);
    if (!drag) {
      const h = at ? hit(p.x, p.y) : null;
      if (h !== hover) { hover = h; canvas.style.cursor = h ? 'grab' : ''; }
      return;
    }
    const pos = drag.start.clone();
    let yaw = drag.yaw0;
    if (drag.axis === 'X' || drag.axis === 'Y' || drag.axis === 'Z') {
      const dir = AXES[drag.axis];
      const s = Math.round((along(p.ray, drag.start, dir) - drag.s0) / SNAP) * SNAP;
      pos.add(dir.clone().multiplyScalar(s));
    } else if (drag.axis === 'XZ' && drag.plane0) {
      const q = onPlane(p.ray, drag.start.y);
      if (q) { pos.x += Math.round((q.x - drag.plane0.x) / SNAP) * SNAP; pos.z += Math.round((q.z - drag.plane0.z) / SNAP) * SNAP; }
    } else if (drag.axis === 'E' && drag.plane0) {
      const q = onPlane(p.ray, drag.start.y);
      if (q) yaw = drag.yaw0 + Math.round((Math.atan2(-(q.z - drag.start.z), q.x - drag.start.x) - drag.angle0) / TURN_SNAP) * TURN_SNAP;
    }
    events.change(pos, yaw - drag.yaw0, drag.axis);
  });

  const finish = () => {
    if (!drag) return;
    drag = null;
    rig.blocked = false;
    events.end();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  return {
    attach(position: V3, yaw: number, ring: boolean) { at = { position: position.clone(), yaw, ring }; },
    /** Moves the handles while nothing drags them. */
    follow(position: V3, yaw: number) { if (at && !drag) { at.position.copy(position); at.yaw = yaw; } },
    detach() { at = null; drag = null; hover = null; rig.blocked = false; canvas.style.cursor = ''; },
    get attached() { return !!at; },
    get dragging() { return !!drag; },
    get position() { return at?.position.clone() ?? null; },
    /** Lines to draw this frame. */
    lines(): OverlayLine[] {
      return handles().map((h) => ({
        points: h.points.flatMap((p) => p.toArray()),
        color: drag?.axis === h.axis || (!drag && hover === h.axis) ? ACTIVE : COLORS[h.axis],
        width: h.axis === 'E' ? 3 : h.axis === 'XZ' ? 2 : 3.5,
        closed: h.closed,
        arrow: h.arrow,
      }));
    },
    under(e: PointerEvent) { const p = pointer(e); return !!at && !!hit(p.x, p.y); },
  };
}
export type Gizmo = ReturnType<typeof createGizmo>;

const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function inside(px: number, py: number, poly: { x: number; y: number }[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
