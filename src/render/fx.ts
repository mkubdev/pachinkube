/**
 * Visual effects: additive particles, shockwave rings, lightning arcs.
 * Everything is pooled and pre-allocated: no per-frame allocation, so a
 * screen full of bursts costs a few draw calls and a CPU loop over the pool.
 */
import * as THREE from "three";

const MAX_PARTICLES = 6000;
const MAX_RINGS = 48;
const MAX_ZAPS = 32;
const ZAP_POINTS = 14;

const particleVert = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aLife;
  varying vec3 vColor;
  varying float vLife;
  void main() {
    vColor = aColor;
    vLife = aLife;
    // Dead particles are clipped away instead of compacting the pool on the CPU.
    if (aLife <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Shrink as life runs out; scale with distance so size is in world units.
    gl_PointSize = aSize * (0.35 + 0.65 * aLife) * (420.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

const particleFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vLife;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    // Soft disc with a hot core.
    float a = smoothstep(1.0, 0.0, r);
    a = a * a * vLife;
    gl_FragColor = vec4(vColor * (1.0 + 1.5 * (1.0 - r)) * a, a);
  }`;

export class FxSystem {
  // --- particles ---
  private readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly life: Float32Array;
  private readonly vel = new Float32Array(MAX_PARTICLES * 3);
  private readonly decay = new Float32Array(MAX_PARTICLES);
  private readonly gravity = new Float32Array(MAX_PARTICLES);
  private readonly alive: number[] = [];
  private readonly free: number[] = [];
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly lifeAttr: THREE.BufferAttribute;

  // --- rings ---
  private readonly rings: THREE.InstancedMesh;
  private readonly ringState = Array.from({ length: MAX_RINGS }, () => ({ age: 1, life: 1, max: 1, x: 0, y: 0, color: new THREE.Color() }));
  private ringCursor = 0;

  // --- lightning ---
  private readonly zaps: Array<{ line: THREE.Line; mat: THREE.LineBasicMaterial; age: number; life: number; color: THREE.Color }> = [];
  private zapCursor = 0;

  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();
  private readonly tmpColor2 = new THREE.Color();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(MAX_PARTICLES * 3);
    this.col = new Float32Array(MAX_PARTICLES * 3);
    this.size = new Float32Array(MAX_PARTICLES);
    this.life = new Float32Array(MAX_PARTICLES);
    for (let i = MAX_PARTICLES - 1; i >= 0; i--) this.free.push(i);

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.lifeAttr = new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.posAttr);
    geo.setAttribute("aColor", this.colAttr);
    geo.setAttribute("aSize", this.sizeAttr);
    geo.setAttribute("aLife", this.lifeAttr);
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: particleVert,
        fragmentShader: particleFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);

    this.rings = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.955, 1.0, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      MAX_RINGS,
    );
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 9;
    for (let i = 0; i < MAX_RINGS; i++) {
      this.rings.setMatrixAt(i, this.hidden);
      this.rings.setColorAt(i, this.tmpColor.setScalar(0));
    }
    scene.add(this.rings);

    for (let i = 0; i < MAX_ZAPS; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ZAP_POINTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const mat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(g, mat);
      line.frustumCulled = false;
      line.visible = false;
      line.renderOrder = 11;
      scene.add(line);
      this.zaps.push({ line, mat, age: 1, life: 1, color: new THREE.Color() });
    }
  }

  /** Radial burst of `count` sparks. `spread` < 1 biases upward. */
  burst(x: number, y: number, color: THREE.Color | number, count: number, speed = 3, size = 0.16, life = 0.5, gravity = -9): void {
    this.burst2(x, y, color, color, count, speed, size, life, gravity);
  }

  /** Radial burst whose particles each blend between two colours. */
  burst2(x: number, y: number, colorA: THREE.Color | number, colorB: THREE.Color | number, count: number, speed = 3, size = 0.16, life = 0.5, gravity = -9): void {
    const ca = this.tmpColor.set(colorA);
    const cb = this.tmpColor2.set(colorB);
    for (let n = 0; n < count; n++) {
      const i = this.free.pop();
      if (i === undefined) return;
      const mix = Math.random();
      const tint = 0.75 + Math.random() * 0.5;
      this.spawnAt(
        i, x, y, speed, size, life, gravity,
        (ca.r + (cb.r - ca.r) * mix) * tint,
        (ca.g + (cb.g - ca.g) * mix) * tint,
        (ca.b + (cb.b - ca.b) * mix) * tint,
      );
    }
  }

  /** Prismatic burst: every particle gets its own hue around the wheel. */
  burstPrism(x: number, y: number, count: number, speed = 3, size = 0.16, life = 0.5, gravity = -9): void {
    for (let n = 0; n < count; n++) {
      const i = this.free.pop();
      if (i === undefined) return;
      const c = this.tmpColor.setHSL(Math.random(), 1, 0.65);
      this.spawnAt(i, x, y, speed, size, life, gravity, c.r, c.g, c.b);
    }
  }

  /** Shared particle kinematics: one slot, one radial spark. */
  private spawnAt(i: number, x: number, y: number, speed: number, size: number, life: number, gravity: number, r: number, g: number, b: number): void {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.35 + Math.random() * 0.85);
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = 0.15 + Math.random() * 0.2;
    this.vel[i * 3] = Math.cos(a) * s;
    this.vel[i * 3 + 1] = Math.sin(a) * s + speed * 0.25;
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * s * 0.4;
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
    this.size[i] = size * (0.6 + Math.random() * 0.8);
    this.life[i] = 1;
    this.decay[i] = 1 / (life * (0.6 + Math.random() * 0.8));
    this.gravity[i] = gravity;
    this.alive.push(i);
  }

  /** One slow, short-lived spark: called per frame behind fast balls. */
  trail(x: number, y: number, color: THREE.Color | number, size = 0.12): void {
    const i = this.free.pop();
    if (i === undefined) return;
    const c = this.tmpColor.set(color);
    this.pos[i * 3] = x + (Math.random() - 0.5) * 0.04;
    this.pos[i * 3 + 1] = y + (Math.random() - 0.5) * 0.04;
    this.pos[i * 3 + 2] = 0.05;
    this.vel[i * 3] = 0;
    this.vel[i * 3 + 1] = 0;
    this.vel[i * 3 + 2] = 0;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
    this.size[i] = size;
    this.life[i] = 1;
    this.decay[i] = 1 / 0.28;
    this.gravity[i] = 0;
    this.alive.push(i);
  }

  /** Expanding shockwave ring. */
  ring(x: number, y: number, color: THREE.Color | number, maxRadius = 1.2, life = 0.45): void {
    const i = this.ringCursor++ % MAX_RINGS;
    const r = this.ringState[i]!;
    r.age = 0;
    r.life = life;
    r.max = maxRadius;
    r.x = x;
    r.y = y;
    r.color.set(color);
  }

  /** Jittered lightning arc that fades out, with a short side fork. */
  zap(from: { x: number; y: number }, to: { x: number; y: number }, color: THREE.Color | number, life = 0.28, fork = true): void {
    if (fork) {
      // A branch leaves the main bolt about a third of the way along.
      const t = 0.3 + Math.random() * 0.3;
      const bx = from.x + (to.x - from.x) * t;
      const by = from.y + (to.y - from.y) * t;
      const len = Math.hypot(to.x - from.x, to.y - from.y) * 0.45;
      const ang = Math.atan2(to.y - from.y, to.x - from.x) + (Math.random() < 0.5 ? 1 : -1) * (0.7 + Math.random() * 0.5);
      this.zap({ x: bx, y: by }, { x: bx + Math.cos(ang) * len, y: by + Math.sin(ang) * len }, color, life * 0.7, false);
    }
    const z = this.zaps[this.zapCursor++ % MAX_ZAPS]!;
    const arr = (z.line.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < ZAP_POINTS; i++) {
      const t = i / (ZAP_POINTS - 1);
      const edge = i === 0 || i === ZAP_POINTS - 1 ? 0 : 1;
      const j = (Math.random() - 0.5) * 0.28 * edge * Math.sin(t * Math.PI);
      arr[i * 3] = from.x + dx * t + nx * j;
      arr[i * 3 + 1] = from.y + dy * t + ny * j;
      arr[i * 3 + 2] = 0.2;
    }
    (z.line.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    z.age = 0;
    z.life = life;
    z.color.set(color);
    z.line.visible = true;
  }

  get activeParticles(): number {
    return this.alive.length;
  }

  /** Kill everything in flight (new run). */
  clear(): void {
    for (const i of this.alive) {
      this.life[i] = 0;
      this.free.push(i);
    }
    this.alive.length = 0;
    this.lifeAttr.needsUpdate = true;
    for (const r of this.ringState) r.age = r.life = 1;
    for (const z of this.zaps) z.line.visible = false;
  }

  update(dt: number): void {
    // Particles: integrate, retire the dead by swap-remove.
    for (let k = this.alive.length - 1; k >= 0; k--) {
      const i = this.alive[k]!;
      const l = (this.life[i] = this.life[i]! - this.decay[i]! * dt);
      if (l <= 0) {
        this.life[i] = 0;
        this.alive[k] = this.alive[this.alive.length - 1]!;
        this.alive.pop();
        this.free.push(i);
        continue;
      }
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! + this.gravity[i]! * dt;
      this.pos[i * 3] = this.pos[i * 3]! + this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1] = this.pos[i * 3 + 1]! + this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2] = this.pos[i * 3 + 2]! + this.vel[i * 3 + 2]! * dt;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;

    // Rings.
    for (let i = 0; i < MAX_RINGS; i++) {
      const r = this.ringState[i]!;
      if (r.age >= r.life) {
        this.rings.setMatrixAt(i, this.hidden);
        continue;
      }
      r.age += dt;
      const t = Math.min(r.age / r.life, 1);
      const ease = 1 - (1 - t) * (1 - t);
      const radius = 0.15 + r.max * ease;
      this.dummy.position.set(r.x, r.y, 0.12);
      this.dummy.scale.setScalar(radius);
      this.dummy.updateMatrix();
      this.rings.setMatrixAt(i, this.dummy.matrix);
      // Quadratic fade so the ring is a crisp flash, not a lingering donut.
      this.rings.setColorAt(i, this.tmpColor.copy(r.color).multiplyScalar((1 - t) * (1 - t) * 1.4));
    }
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;

    // Lightning.
    for (const z of this.zaps) {
      if (!z.line.visible) continue;
      z.age += dt;
      if (z.age >= z.life) {
        z.line.visible = false;
        continue;
      }
      const t = z.age / z.life;
      const flicker = 0.6 + 0.4 * Math.sin(t * 40);
      z.mat.color.copy(z.color).multiplyScalar((1 - t) * 2.2 * flicker);
    }
  }

}
