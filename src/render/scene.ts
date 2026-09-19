/**
 * Three.js presentation of the 2D simulation.
 *
 * The board lives in the XY plane; depth is purely cosmetic. Pegs and balls are
 * InstancedMesh so a screen full of chaos stays at a handful of draw calls.
 * Everything here is presentation: nothing reads back into the sim.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import {
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  VignetteEffect,
} from "postprocessing";
import { FxSystem } from "./fx.js";

import type { Peg, Snapshot } from "../sim/types.js";
import { BALL_TYPES, type BallTypeId } from "../game/balls.js";

export const MAX_BALLS = 1024;

const NEON_MAGENTA = 0xff2d95;
const NEON_CYAN = 0x2de2ff;
// Peg colours are fed straight to bloom: unlit sits under the threshold, lit
// is pushed past 1.0 so it glows.
const PEG_UNLIT = new THREE.Color(0x0e3b45);
const PEG_LIT = new THREE.Color(1.0, 0.18, 0.58).multiplyScalar(2.2);
const PEG_HOT = new THREE.Color(1.0, 0.9, 1.0).multiplyScalar(4.0);
const SHARD_COLOR = new THREE.Color(0xfff1a8);
const TRAIL_SPEED = 5.5;

export interface BoardDims {
  width: number;
  height: number;
  buckets: number;
}

export class BoardRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: BloomEffect;
  private readonly chroma: ChromaticAberrationEffect;
  private readonly vignette: VignetteEffect;
  readonly fx: FxSystem;
  private readonly balls: THREE.InstancedMesh;
  private pegs: THREE.InstancedMesh | null = null;
  private pegLit: Uint8Array = new Uint8Array(0);
  private pegPulse: Float32Array = new Float32Array(0);
  private readonly pulsing = new Set<number>();
  /** 0..1 "how wild is it right now": drives bloom, aberration, vignette. */
  private heat = 0;
  private heatTarget = 0;
  private bloomKick = 0;
  private readonly aim: THREE.Mesh;
  private readonly dummy = new THREE.Object3D();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly color = new THREE.Color();
  private readonly ray = new THREE.Raycaster();
  private readonly boardPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly camBase = new THREE.Vector3();
  private shake = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, private readonly board: BoardDims) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene.background = new THREE.Color(0x07070c);
    // Room environment immediately so chrome never renders black; the neon
    // HDRI swaps in when it arrives (see loadEnvironment).
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(0, board.height / 2, board.height * 1.05);
    this.camera.lookAt(0, board.height / 2, 0);

    this.scene.add(new THREE.AmbientLight(0x404060, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(3, board.height, 6);
    this.scene.add(key);

    this.buildBackdrop();
    this.buildPockets();

    this.balls = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12 }),
      MAX_BALLS,
    );
    this.balls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.balls.count = 0;
    // InstancedMesh computes its bounding sphere lazily on the first frame it
    // is drawn. With count = 0 that sphere is empty and three never recomputes
    // it, so every later frame would be frustum-culled: no balls, ever.
    this.balls.frustumCulled = false;
    this.scene.add(this.balls);

    this.aim = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.32, 4),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(NEON_CYAN).multiplyScalar(1.6) }),
    );
    this.aim.rotation.x = Math.PI;
    this.aim.position.set(0, board.height + 0.9, 0);
    this.aim.visible = false;
    this.scene.add(this.aim);

    this.fx = new FxSystem(this.scene);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new BloomEffect({ intensity: 1.35, luminanceThreshold: 0.55, luminanceSmoothing: 0.2, mipmapBlur: true });
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0004, 0.0004), radialModulation: true, modulationOffset: 0.25 });
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.45 });
    this.composer.addPass(new EffectPass(this.camera, this.bloom, this.chroma, this.vignette));
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  private buildBackdrop(): void {
    const { width, height } = this.board;
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(width + 1.2, height + 2.2),
      new THREE.MeshStandardMaterial({ color: 0x0c0c16, roughness: 0.9, metalness: 0.1 }),
    );
    back.position.set(0, height / 2 + 0.3, -0.35);
    this.scene.add(back);

    // Neon edge tubes; the Blender cabinet wraps around these.
    const tube = new THREE.CylinderGeometry(0.05, 0.05, height + 1.4, 12);
    for (const [sx, color] of [[-1, NEON_MAGENTA], [1, NEON_CYAN]] as const) {
      const m = new THREE.Mesh(
        tube,
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.4, roughness: 0.4 }),
      );
      m.position.set(sx * (width / 2 + 0.15), height / 2 + 0.2, 0);
      this.scene.add(m);
    }
  }

  private buildPockets(): void {
    const { width, buckets } = this.board;
    const bw = width / buckets;
    const mid = (buckets - 1) / 2;
    const divider = new THREE.BoxGeometry(0.07, 0.9, 0.5);
    const divMat = new THREE.MeshStandardMaterial({ color: 0x1a1d28, metalness: 0.6, roughness: 0.35 });
    for (let i = 1; i < buckets; i++) {
      const m = new THREE.Mesh(divider, divMat);
      m.position.set(-width / 2 + i * bw, 0.45, 0);
      this.scene.add(m);
    }
    const strip = new THREE.BoxGeometry(bw - 0.12, 0.06, 0.5);
    for (let i = 0; i < buckets; i++) {
      const d = Math.abs(i - mid);
      const c = d < 0.5 ? NEON_MAGENTA : NEON_CYAN;
      const m = new THREE.Mesh(
        strip,
        new THREE.MeshStandardMaterial({
          color: c,
          emissive: c,
          emissiveIntensity: d < 0.5 ? 3 : 1.2 - d * 0.25,
          roughness: 0.5,
        }),
      );
      m.position.set(-width / 2 + bw * (i + 0.5), 0.03, 0);
      this.scene.add(m);
    }
  }

  setPegs(pegs: Peg[]): void {
    const geo = new THREE.CylinderGeometry(1, 1, 0.5, 18);
    geo.rotateX(Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), pegs.length);
    pegs.forEach((p, i) => {
      this.dummy.position.set(p.x, p.y, 0);
      this.dummy.scale.setScalar(p.radius);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      mesh.setColorAt(i, PEG_UNLIT);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false; // board is always fully on screen
    this.scene.add(mesh);
    this.pegs = mesh;
    this.pegLit = new Uint8Array(pegs.length);
    this.pegPulse = new Float32Array(pegs.length);
  }

  setPegLit(peg: number, lit: boolean): void {
    if (!this.pegs) return;
    this.pegLit[peg] = lit ? 1 : 0;
    this.pegs.setColorAt(peg, lit ? PEG_LIT : PEG_UNLIT);
    if (this.pegs.instanceColor) this.pegs.instanceColor.needsUpdate = true;
  }

  /** Flash a peg white-hot; it decays back to its lit/unlit colour. */
  pulsePeg(peg: number): void {
    this.pegPulse[peg] = 1;
    this.pulsing.add(peg);
  }

  resetPegs(): void {
    if (!this.pegs) return;
    this.pegLit.fill(0);
    this.pegPulse.fill(0);
    this.pulsing.clear();
    for (let i = 0; i < this.pegs.count; i++) this.pegs.setColorAt(i, PEG_UNLIT);
    if (this.pegs.instanceColor) this.pegs.instanceColor.needsUpdate = true;
  }

  /** Combo intensity 0..1; post effects ease toward it. */
  setHeat(h: number): void {
    this.heatTarget = Math.max(0, Math.min(1, h));
  }

  /** Momentary bloom surge for milestones and big landings. */
  kickBloom(strength: number): void {
    this.bloomKick = Math.min(2.5, this.bloomKick + strength);
  }

  setAim(x: number | null): void {
    this.aim.visible = x !== null;
    if (x !== null) this.aim.position.x = x;
  }

  addShake(strength: number): void {
    this.shake = Math.min(1, this.shake + strength);
  }

  /** Swap the placeholder environment for an equirectangular .hdr (Poly Haven). */
  async loadEnvironment(url: string): Promise<boolean> {
    try {
      const hdr = await new RGBELoader().loadAsync(url);
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const env = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();
      hdr.dispose();
      this.scene.environment = env;
      this.scene.environmentIntensity = 0.9;
      return true;
    } catch {
      return false;
    }
  }

  /** Load the Blender cabinet if it has been exported; silently skip otherwise. */
  async loadCabinet(url: string): Promise<boolean> {
    const draco = new DRACOLoader().setDecoderPath("/draco/");
    let gltf;
    try {
      gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(url);
    } catch {
      return false; // not exported yet: the board still works without it
    }
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of mats as THREE.MeshStandardMaterial[]) {
        const name = m.name.toLowerCase();
        if (name.includes("neon")) {
          m.emissive = new THREE.Color(NEON_MAGENTA);
          m.emissiveIntensity = 2.2;
        } else if (name.includes("body")) {
          // The dark body reads as a mirror under the placeholder environment;
          // pull metalness down so it stays a dark cabinet, not a chrome slab.
          m.metalness = 0.25;
          m.roughness = 0.55;
          m.envMapIntensity = 0.35;
        }
      }
    });
    this.scene.add(gltf.scene);
    return true;
  }

  /** Board x under a screen position, or null when off the board plane. */
  boardXAt(clientX: number, clientY: number): number | null {
    const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = this.ray.ray.intersectPlane(this.boardPlane, this.tmp);
    if (!hit) return null;
    const half = this.board.width / 2 - 0.2;
    return Math.max(-half, Math.min(half, hit.x));
  }

  /** Screen-space pixel position of a board point, for DOM popups and labels. */
  project(x: number, y: number): { x: number; y: number } {
    this.tmp.set(x, y, 0).project(this.camera);
    return { x: (this.tmp.x + 1) / 2 * innerWidth, y: (1 - this.tmp.y) / 2 * innerHeight };
  }

  /** Interpolate between two physics snapshots and draw. */
  render(prev: Snapshot, curr: Snapshot, alpha: number, dt: number): void {
    const prevById = new Map(prev.balls.map((b) => [b.id, b]));
    const n = Math.min(curr.balls.length, MAX_BALLS);
    for (let i = 0; i < n; i++) {
      const b = curr.balls[i]!;
      const p = prevById.get(b.id) ?? b;
      this.dummy.position.set(p.x + (b.x - p.x) * alpha, p.y + (b.y - p.y) * alpha, 0);
      this.dummy.scale.setScalar(b.radius);
      this.dummy.updateMatrix();
      this.balls.setMatrixAt(i, this.dummy.matrix);
      const tag = b.tag ?? "steel";
      const type = BALL_TYPES[tag as BallTypeId];
      this.balls.setColorAt(i, type ? this.color.setHex(type.color) : SHARD_COLOR);
    }
    for (let i = n; i < this.balls.count; i++) this.balls.setMatrixAt(i, this.hidden);
    this.balls.count = n;
    this.balls.instanceMatrix.needsUpdate = true;
    if (this.balls.instanceColor) this.balls.instanceColor.needsUpdate = true;

    // Trails behind fast balls: one spark per ball per frame, budget-capped.
    let budget = 48;
    for (let i = 0; i < n && budget > 0; i++) {
      const b = curr.balls[i]!;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed < TRAIL_SPEED) continue;
      const type = BALL_TYPES[(b.tag ?? "steel") as BallTypeId];
      this.fx.trail(b.x, b.y, type ? type.color : SHARD_COLOR, b.radius * 1.6);
      budget--;
    }

    // Peg pulses decay back to their resting colour.
    if (this.pegs && this.pulsing.size) {
      for (const i of this.pulsing) {
        const v = (this.pegPulse[i] = Math.max(0, this.pegPulse[i]! - dt * 5));
        this.color.copy(this.pegLit[i] ? PEG_LIT : PEG_UNLIT).lerp(PEG_HOT, v * v);
        this.pegs.setColorAt(i, this.color);
        if (v <= 0) this.pulsing.delete(i);
      }
      if (this.pegs.instanceColor) this.pegs.instanceColor.needsUpdate = true;
    }

    // Post effects ride the combo heat plus momentary kicks.
    this.heat += (this.heatTarget - this.heat) * Math.min(1, dt * 4);
    this.bloomKick *= Math.exp(-dt * 6);
    this.bloom.intensity = 1.35 + this.heat * 1.1 + this.bloomKick;
    const ab = 0.0003 + this.heat * 0.0018 + this.bloomKick * 0.0009;
    this.chroma.offset.set(ab, ab);
    this.vignette.darkness = 0.45 + this.heat * 0.25;
    this.fx.update(dt);

    if (this.shake > 0.001) {
      const s = this.shake * 0.18;
      this.camera.position.set(
        this.camBase.x + (Math.random() - 0.5) * s,
        this.camBase.y + (Math.random() - 0.5) * s,
        this.camBase.z,
      );
      this.shake *= Math.exp(-dt * 9);
    } else {
      this.camera.position.copy(this.camBase);
    }
    this.composer.render(dt);
  }

  private resize(): void {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // Fit the whole board (plus the launch area) regardless of aspect.
    const fovRad = THREE.MathUtils.degToRad(this.camera.fov);
    const need = (this.board.height + 3.4) / 2 / Math.tan(fovRad / 2);
    const needW = (this.board.width + 2.6) / 2 / Math.tan(fovRad / 2) / this.camera.aspect;
    this.camBase.set(0, this.board.height / 2 + 0.3, Math.max(need, needW));
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(0, this.board.height / 2 + 0.3, 0);
    this.camera.updateProjectionMatrix();
  }
}
