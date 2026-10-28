// The planner's camera: a perspective or orthographic eye with an orbit controller that behaves
// like three.js's OrbitControls (damped orbit, pan, dolly), and a look-around mode that orbits a
// target a few centimetres in front of the eye. Writes matrices for cameras.custom each frame.
import { mat4, vec3 } from 'wgpu-matrix';

export class V3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v: V3) { return this.set(v.x, v.y, v.z); }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v: V3) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v: V3) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiplyScalar(s: number) { this.x *= s; this.y *= s; this.z *= s; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  lerpVectors(a: V3, b: V3, k: number) { return this.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k); }
  /** Turns about +y by `a` radians, as three's applyAxisAngle with the y axis does. */
  rotateY(a: number) { const c = Math.cos(a), s = Math.sin(a); return this.set(this.x * c + this.z * s, this.y, -this.x * s + this.z * c); }
  toArray(): [number, number, number] { return [this.x, this.y, this.z]; }
}

export interface Ray { origin: V3; direction: V3 }

export class Rig {
  position = new V3(5, 4, 3);
  target = new V3(1.4, 0.9, -1.7);
  fov = 45; // vertical, degrees
  aspect = 1;
  ortho = false;
  orthoZoom = 1;
  /** Half the height the plan view shows. */
  orthoHalf = 2;
  near = 0.05;
  far = 60;

  // OrbitControls' knobs
  enabled = true;
  enableZoom = true;
  enablePan = true;
  rotateSpeed = 1;
  minDistance = 0.4;
  maxDistance = 14;
  minPolarAngle = 0;
  maxPolarAngle = Math.PI * 0.49;
  onStart: () => void = () => {};

  private dTheta = 0;
  private dPhi = 0;
  private scale = 1;
  private panOffset = new V3();
  private dragging: { x: number; y: number; button: number } | null = null;

  constructor(private element: HTMLElement) {
    element.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', () => { this.dragging = null; });
    element.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Set by the gizmo while it holds the pointer. */
  blocked = false;

  private down(e: PointerEvent) {
    if (!this.enabled || this.blocked) return;
    this.dragging = { x: e.clientX, y: e.clientY, button: e.button };
    this.onStart();
  }
  private move(e: PointerEvent) {
    if (!this.dragging || !this.enabled || this.blocked) return;
    const dx = e.clientX - this.dragging.x, dy = e.clientY - this.dragging.y;
    this.dragging.x = e.clientX; this.dragging.y = e.clientY;
    const h = this.element.clientHeight || 1;
    if (this.dragging.button === 0) {
      this.dTheta -= ((2 * Math.PI * dx) / h) * this.rotateSpeed;
      this.dPhi -= ((2 * Math.PI * dy) / h) * this.rotateSpeed;
    } else if (this.enablePan) {
      this.pan(dx, dy);
    }
  }
  private wheel(e: WheelEvent) {
    if (!this.enabled || this.blocked) return;
    e.preventDefault();
    if (!this.enableZoom) return this.onWheelLook(e.deltaY);
    this.onStart();
    const k = Math.pow(0.95, Math.abs(e.deltaY) / 50);
    if (this.ortho) this.orthoZoom = Math.min(8, Math.max(0.3, e.deltaY < 0 ? this.orthoZoom / k : this.orthoZoom * k));
    else this.scale *= e.deltaY < 0 ? k : 1 / k;
  }
  /** Look mode scrolls the field of view instead of moving. */
  onWheelLook: (deltaY: number) => void = () => {};

  private pan(dx: number, dy: number) {
    const offset = this.position.clone().sub(this.target);
    const h = this.element.clientHeight || 1;
    const span = this.ortho ? (2 * this.orthoHalf) / this.orthoZoom : 2 * offset.length() * Math.tan((this.fov * Math.PI) / 360);
    const v = this.viewMatrix();
    // camera right and up in world space are the view matrix's rows
    const right = new V3(v[0]!, v[4]!, v[8]!), up = new V3(v[1]!, v[5]!, v[9]!);
    this.panOffset.add(right.multiplyScalar((-dx * span) / h)).add(up.multiplyScalar((dy * span) / h));
  }

  /** Eases the orbit towards what input asked for, as OrbitControls' damping does. */
  update() {
    const offset = this.position.clone().sub(this.target);
    let radius = offset.length();
    let theta = Math.atan2(offset.x, offset.z);
    let phi = Math.acos(Math.min(1, Math.max(-1, offset.y / (radius || 1))));
    const damping = 0.05 * 2;
    theta += this.dTheta * damping;
    phi += this.dPhi * damping;
    phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, phi));
    phi = Math.max(1e-6, Math.min(Math.PI - 1e-6, phi));
    radius = Math.max(this.minDistance, Math.min(this.maxDistance, radius * this.scale));
    this.target.add(this.panOffset.clone().multiplyScalar(damping * 2));
    this.panOffset.multiplyScalar(1 - damping * 2);
    this.dTheta *= 1 - damping;
    this.dPhi *= 1 - damping;
    this.scale = 1;
    this.position.set(
      this.target.x + radius * Math.sin(phi) * Math.sin(theta),
      this.target.y + radius * Math.cos(phi),
      this.target.z + radius * Math.sin(phi) * Math.cos(theta),
    );
  }

  /** Stops any easing still under way. */
  halt() { this.dTheta = this.dPhi = 0; this.panOffset.set(0, 0, 0); this.scale = 1; }

  viewMatrix() {
    const up = Math.abs(this.position.x - this.target.x) + Math.abs(this.position.z - this.target.z) < 1e-4 ? [0, 0, -1] : [0, 1, 0];
    return mat4.lookAt(this.position.toArray(), this.target.toArray(), up);
  }
  projectionMatrix() {
    if (this.ortho) {
      const h = this.orthoHalf / this.orthoZoom, w = h * this.aspect;
      return mat4.ortho(-w, w, -h, h, this.near, this.far);
    }
    return mat4.perspective((this.fov * Math.PI) / 180, this.aspect, this.near, this.far);
  }

  /** The ray through a point of the element, x and y from 0 to 1 with +y down. */
  rayAt(x: number, y: number): Ray {
    const inv = mat4.inverse(mat4.multiply(this.projectionMatrix(), this.viewMatrix()));
    const ndcX = x * 2 - 1, ndcY = 1 - y * 2;
    const a = vec3.transformMat4([ndcX, ndcY, 0], inv), b = vec3.transformMat4([ndcX, ndcY, 1], inv);
    const origin = new V3(a[0]!, a[1]!, a[2]!);
    return { origin, direction: new V3(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!).normalize() };
  }
  /** Where a world point lands on the element, in pixels; null behind the eye. */
  project(p: V3, width: number, height: number) {
    const m = mat4.multiply(this.projectionMatrix(), this.viewMatrix());
    const x = m[0]! * p.x + m[4]! * p.y + m[8]! * p.z + m[12]!;
    const y = m[1]! * p.x + m[5]! * p.y + m[9]! * p.z + m[13]!;
    const w = m[3]! * p.x + m[7]! * p.y + m[11]! * p.z + m[15]!;
    if (w <= 0) return null;
    return { x: ((x / w + 1) / 2) * width, y: ((1 - y / w) / 2) * height };
  }
}
