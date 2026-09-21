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
  ShockWaveEffect,
  VignetteEffect,
} from "postprocessing";
import { FxSystem } from "./fx.js";
import { ELEMENTS, type Element } from "../game/elements.js";
import type { Quality } from "../game/gfx.js";

/** Render resolution per quality; phones default to medium via gfx defaults. */
function pixelRatioFor(q: Quality): number {
  if (q === "low") return 1;
  return Math.min(devicePixelRatio, q === "medium" ? 1.5 : 2);
}

/**
 * Pegs: one instanced draw with a custom shader. Per instance we carry the
 * base colour (lit/unlit/pulse) and an element id; the fragment shader paints
 * fire (rolling noise flicker), ice (faceted glint) or storm (crackle).
 */
const pegVert = /* glsl */ `
  uniform float uTime;
  attribute vec3 instanceColorA;
  attribute float aElement;
  attribute float aStamp;
  varying vec3 vColor;
  varying float vElement;
  varying float vAge;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  void main() {
    vColor = instanceColorA;
    vElement = aElement;
    vAge = uTime - aStamp;
    vLocal = position;
    vNormalW = normalize(mat3(instanceMatrix) * normal);
    // Freshly set elements pop: scale in over ~0.35 s.
    float pop = aElement > 0.5 ? 1.0 + 0.6 * max(0.0, 1.0 - vAge * 2.8) : 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position * pop, 1.0);
  }`;

const pegFrag = /* glsl */ `
  uniform float uTime;
  varying vec3 vColor;
  varying float vElement;
  varying float vAge;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec3 c = vColor;
    // Cheap rim so pegs read as cylinders, not flat discs.
    float rim = 1.0 - abs(vNormalW.z);
    if (vElement > 2.5) {
      // storm: electric crackle, white-blue flashes
      float n = noise(vLocal.xy * 12.0 + uTime * 9.0);
      float spark = step(0.82, noise(vLocal.yx * 30.0 + uTime * 23.0));
      c = mix(vec3(0.25, 0.8, 1.0), vec3(1.0), spark) * (1.1 + 0.9 * n) + rim * vec3(0.4, 0.7, 0.9);
    } else if (vElement > 1.5) {
      // ice: pale, faceted glints that drift
      float f = step(0.9, noise(vLocal.xy * 8.0 + floor(uTime * 2.0)));
      c = vec3(0.45, 0.85, 1.0) * (1.3 + 0.6 * rim) + f * vec3(1.8);
    } else if (vElement > 0.5) {
      // fire: rolling flame noise, brighter at the top of the peg
      float n = noise(vec2(vLocal.x * 6.0, vLocal.y * 6.0 - uTime * 4.0));
      float n2 = noise(vec2(vLocal.y * 9.0 + 3.0, vLocal.x * 9.0 - uTime * 6.0));
      float flame = n * 0.6 + n2 * 0.4;
      c = mix(vec3(1.0, 0.12, 0.0), vec3(1.0, 0.55, 0.05), flame) * (0.8 + 0.9 * flame) + rim * vec3(0.5, 0.15, 0.0);
    }
    // White-hot flash the instant an element lands, fading over ~0.4 s.
    if (vElement > 0.5) c += vec3(2.5) * max(0.0, 1.0 - vAge * 2.5);
    gl_FragColor = vec4(c, 1.0);
  }`;

const ELEMENT_ID: Record<Element, number> = { fire: 1, ice: 2, storm: 3 };
/** Aura modes beyond the elements: Rainbow's hue wheel and Abyss's black hole. */
const AURA_RAINBOW = 4;
const AURA_ABYSS = 5;
const ABYSS_TRAIL = 0x7a3cff;

/** Additive billboard discs around imbued balls: corona / crystal shards / arcs. */
const auraVert = /* glsl */ `
  attribute float aElement;
  attribute float aSeed;
  varying vec2 vUv;
  varying float vElement;
  varying float vSeed;
  void main() {
    vUv = uv * 2.0 - 1.0;
    vElement = aElement;
    vSeed = aSeed;
    // Billboard: take the instance translation/scale, drop its rotation.
    vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float s = length(vec3(instanceMatrix[0]));
    gl_Position = projectionMatrix * (centre + vec4(position.xy * s, 0.0, 0.0));
  }`;
const auraFrag = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vElement;
  varying float vSeed;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 hsv(float h) { vec3 p = abs(fract(vec3(h) + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0); return clamp(p - 1.0, 0.0, 1.0); }
  // Output is premultiplied: rgb adds to the frame, alpha darkens it. Elements
  // are pure additive glow (alpha 0); the Abyss core is the one thing that
  // swallows light.
  void main() {
    float r = length(vUv);
    if (r > 1.0) discard;
    float a = atan(vUv.y, vUv.x);
    float t = uTime + vSeed * 10.0;
    vec3 c; float alpha;
    if (vElement > 4.5) {
      // abyss: black core, wobbling violet accretion ring, sparks spiralling in
      float core = smoothstep(0.40, 0.30, r);
      float ring = smoothstep(0.14, 0.0, abs(r - 0.48 - 0.05 * sin(t * 3.0 + a * 2.0)));
      float spiral = step(0.94, hash(floor(vec2(a * 4.0 + r * 14.0 - t * 5.0, r * 12.0))));
      vec3 acc = mix(vec3(0.30, 0.04, 0.55), vec3(0.75, 0.40, 1.0), ring) * 1.7 * ring;
      vec3 sparks = vec3(0.6, 0.3, 1.0) * spiral * smoothstep(1.0, 0.45, r) * (1.0 - core);
      gl_FragColor = vec4(acc + sparks, core);
      return;
    }
    if (vElement > 3.5) {
      // rainbow: a spinning hue wheel with a shimmer
      float band = smoothstep(1.0, 0.5, r) * smoothstep(0.3, 0.55, r);
      float shimmer = 0.7 + 0.3 * sin(t * 9.0 + r * 24.0 - a * 3.0);
      gl_FragColor = vec4(hsv(fract(a / 6.2831 + t * 0.6)) * 2.2 * band * shimmer, 0.0);
      return;
    }
    if (vElement > 2.5) {
      // storm: three rotating arcs
      float arc = smoothstep(0.35, 0.0, abs(fract((a / 6.2831 + t * 0.9) * 3.0) - 0.5) - 0.28) * smoothstep(1.0, 0.55, r) * smoothstep(0.35, 0.6, r);
      float spark = step(0.94, hash(floor(vUv * 9.0) + floor(t * 12.0)));
      c = vec3(0.5, 0.95, 1.0) * 2.2; alpha = arc * 0.9 + spark * 0.8;
    } else if (vElement > 1.5) {
      // ice: six slow crystal spokes
      float spokes = pow(abs(cos(a * 3.0 + t * 0.6)), 24.0) * smoothstep(1.0, 0.3, r);
      float halo = smoothstep(1.0, 0.4, r) * 0.25;
      c = vec3(0.65, 0.92, 1.0) * 1.8; alpha = spokes + halo;
    } else {
      // fire: flickering corona
      float flick = 0.7 + 0.3 * sin(t * 17.0 + a * 4.0) * sin(t * 11.0);
      float corona = smoothstep(1.0, 0.35, r) * flick;
      c = mix(vec3(1.0, 0.25, 0.0), vec3(1.0, 0.75, 0.2), corona) * 1.9; alpha = corona * 0.85;
    }
    gl_FragColor = vec4(c * alpha, 0.0);
  }`;

import { BUMPER_RADIUS, type Fin, type Peg, type Snapshot } from "../sim/types.js";
import { BALL_TYPES, type BallTypeId } from "../game/balls.js";

export const MAX_BALLS = 1024;

const NEON_MAGENTA = 0xff2d95;
const NEON_CYAN = 0x2de2ff;
// Peg colours are fed straight to bloom: unlit sits under the threshold, lit
// is pushed past 1.0 so it glows.
const PEG_UNLIT = new THREE.Color(0x0e3b45);
const PEG_LIT = new THREE.Color(1.0, 0.18, 0.58).multiplyScalar(2.2);
/** Bumpers glow amber so they read as targets before the first hit. */
const PEG_BUMPER = new THREE.Color(1.0, 0.5, 0.08).multiplyScalar(1.5);
const PEG_BUMPER_LIT = new THREE.Color(1.0, 0.82, 0.25).multiplyScalar(2.4);
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
  private readonly auras: THREE.InstancedMesh;
  private readonly auraMat: THREE.ShaderMaterial;
  private readonly auraElement: THREE.InstancedBufferAttribute;
  private readonly auraSeed: THREE.InstancedBufferAttribute;
  private pegStampAttr: THREE.InstancedBufferAttribute | null = null;
  private pegBase: Peg[] = [];
  private pegBumper = new Uint8Array(0);
  private finMeshes: THREE.Mesh[] = [];
  private readonly pocketStrips: THREE.Mesh[] = [];
  private readonly laser: THREE.Mesh;
  private laserLife = 0;
  private tint = 0; // 0..1 board tint strength (gravity flip / magnet storm)
  private tintColor = new THREE.Color(0xffffff);
  private baseBackground: THREE.Color;
  private time = 0;
  private shockwave: ShockWaveEffect;
  private readonly shockPos = new THREE.Vector3();
  private pegs: THREE.InstancedMesh | null = null;
  private pegMat: THREE.ShaderMaterial | null = null;
  private pegColorAttr: THREE.InstancedBufferAttribute | null = null;
  private pegElementAttr: THREE.InstancedBufferAttribute | null = null;
  private pegLit: Uint8Array = new Uint8Array(0);
  private pegPulse: Float32Array = new Float32Array(0);
  private readonly pulsing = new Set<number>();
  private quality: Quality;
  /** 0..1 "how wild is it right now": drives bloom, aberration, vignette. */
  private heat = 0;
  private heatTarget = 0;
  private bloomKick = 0;
  private readonly aim: THREE.Mesh;
  private readonly dummy = new THREE.Object3D();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly color = new THREE.Color();
  private readonly tmpElColor = new THREE.Color();
  private readonly ray = new THREE.Raycaster();
  private readonly boardPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly camBase = new THREE.Vector3();
  /** Screen space taken by fixed UI bars (px); the board is fitted into what is left. */
  private insets = { top: 0, bottom: 0, compact: false };
  private shake = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, private readonly board: BoardDims, quality: Quality = "high") {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(pixelRatioFor(quality));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene.background = new THREE.Color(0x07070c);
    this.baseBackground = new THREE.Color(0x07070c);
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

    const auraGeo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(2, 2) as unknown as THREE.InstancedBufferGeometry);
    auraGeo.instanceCount = MAX_BALLS;
    this.auraElement = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BALLS), 1).setUsage(THREE.DynamicDrawUsage);
    this.auraSeed = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BALLS), 1).setUsage(THREE.DynamicDrawUsage);
    auraGeo.setAttribute("aElement", this.auraElement);
    auraGeo.setAttribute("aSeed", this.auraSeed);
    this.auraMat = new THREE.ShaderMaterial({
      vertexShader: auraVert,
      fragmentShader: auraFrag,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      // Premultiplied "over": src.rgb + dst × (1 − src.a). Alpha 0 is additive glow.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.auras = new THREE.InstancedMesh(auraGeo, this.auraMat, MAX_BALLS);
    this.auras.count = 0;
    this.auras.frustumCulled = false;
    this.auras.renderOrder = 8;
    this.scene.add(this.auras);

    // Laser sweep beam: a thin additive quad across the board, flashed on demand.
    this.laser = new THREE.Mesh(
      new THREE.PlaneGeometry(board.width + 1.2, 0.14),
      new THREE.MeshBasicMaterial({ color: 0xff2d95, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.laser.position.z = 0.2;
    this.laser.visible = false;
    this.laser.renderOrder = 12;
    this.scene.add(this.laser);

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
    this.bloom = new BloomEffect({ intensity: 1.35, luminanceThreshold: 0.55, luminanceSmoothing: 0.2, mipmapBlur: true });
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0004, 0.0004), radialModulation: true, modulationOffset: 0.25 });
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.45 });
    this.shockwave = new ShockWaveEffect(this.camera, this.shockPos, { speed: 2.2, maxRadius: 0.9, waveSize: 0.18, amplitude: 0.06 });
    this.buildPasses();
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  /**
   * (Re)build the postprocessing chain for the current quality. Medium drops
   * the chromatic aberration; low bypasses the composer entirely (see render).
   * The effect objects themselves live on: heat/kicks keep driving them.
   */
  private buildPasses(): void {
    // removeAllPasses without dispose: EffectPass.dispose would take the shared
    // effects down with it. A rebuild is a rare, user-driven event.
    this.composer.removeAllPasses();
    if (this.quality === "low") return;
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // The shockwave distorts UVs, which postprocessing refuses to combine with a
    // convolution (bloom) in one pass; it gets its own pass, applied first.
    this.composer.addPass(new EffectPass(this.camera, this.shockwave));
    this.composer.addPass(
      this.quality === "high"
        ? new EffectPass(this.camera, this.bloom, this.chroma, this.vignette)
        : new EffectPass(this.camera, this.bloom, this.vignette),
    );
  }

  /** Switch render quality live: adjusts resolution and rebuilds the post chain. */
  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.setPixelRatio(pixelRatioFor(q));
    this.buildPasses();
    this.resize();
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
      this.pocketStrips.push(m);
    }
  }

  /** Pocket strips glow in proportion to their multiplier; the lottery pocket is gold. */
  setPocketMults(mults: number[], lottery = -1): void {
    const best = Math.max(...mults);
    this.pocketStrips.forEach((strip, i) => {
      const mat = strip.material as THREE.MeshStandardMaterial;
      const m = mults[i] ?? 1;
      const base = i === lottery ? 0xffd34d : m === best ? NEON_MAGENTA : NEON_CYAN;
      mat.color.setHex(base);
      mat.emissive.setHex(base);
      mat.emissiveIntensity = 0.6 + Math.min(m, 12) * 0.28;
      strip.scale.y = 1 + Math.min(m, 12) * 0.12;
    });
  }

  setPegs(pegs: Peg[]): void {
    if (this.pegs) {
      // New run, new layout: drop the previous instanced mesh entirely.
      this.scene.remove(this.pegs);
      this.pegs.geometry.dispose();
      (this.pegs.material as THREE.Material).dispose();
      this.pegs = null;
      this.pulsing.clear();
    }
    const geo = new THREE.CylinderGeometry(1, 1, 0.5, 18);
    geo.rotateX(Math.PI / 2);
    const inst = new THREE.InstancedBufferGeometry().copy(geo as unknown as THREE.InstancedBufferGeometry);
    inst.instanceCount = pegs.length;
    this.pegColorAttr = new THREE.InstancedBufferAttribute(new Float32Array(pegs.length * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.pegElementAttr = new THREE.InstancedBufferAttribute(new Float32Array(pegs.length), 1).setUsage(THREE.DynamicDrawUsage);
    this.pegStampAttr = new THREE.InstancedBufferAttribute(new Float32Array(pegs.length).fill(-10), 1).setUsage(THREE.DynamicDrawUsage);
    inst.setAttribute("instanceColorA", this.pegColorAttr);
    inst.setAttribute("aElement", this.pegElementAttr);
    inst.setAttribute("aStamp", this.pegStampAttr);
    this.pegBase = pegs;
    this.pegMat = new THREE.ShaderMaterial({
      vertexShader: pegVert,
      fragmentShader: pegFrag,
      uniforms: { uTime: { value: 0 } },
    });
    const mesh = new THREE.InstancedMesh(inst, this.pegMat, pegs.length);
    pegs.forEach((p, i) => {
      this.dummy.position.set(p.x, p.y, 0);
      this.dummy.scale.setScalar(p.radius);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      this.writePegColor(i, PEG_UNLIT);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false; // board is always fully on screen
    this.scene.add(mesh);
    this.pegs = mesh;
    this.pegLit = new Uint8Array(pegs.length);
    this.pegPulse = new Float32Array(pegs.length);
    this.pegBumper = new Uint8Array(pegs.length);
  }

  private pegRadius(i: number): number {
    return this.pegBumper[i] ? BUMPER_RADIUS : (this.pegBase[i]?.radius ?? 0.08);
  }

  private pegColor(i: number): THREE.Color {
    const lit = this.pegLit[i] === 1;
    return this.pegBumper[i] ? (lit ? PEG_BUMPER_LIT : PEG_BUMPER) : lit ? PEG_LIT : PEG_UNLIT;
  }

  /** This round's bumper pegs: bigger and amber. Called with the new set every round. */
  setPegBumpers(pegs: number[]): void {
    if (!this.pegs) return;
    this.pegBumper.fill(0);
    for (const p of pegs) this.pegBumper[p] = 1;
    for (let i = 0; i < this.pegBase.length; i++) {
      const p = this.pegBase[i]!;
      this.dummy.position.set(p.x, p.y, 0);
      this.dummy.scale.setScalar(this.pegRadius(i));
      this.dummy.updateMatrix();
      this.pegs.setMatrixAt(i, this.dummy.matrix);
      this.writePegColor(i, this.pegColor(i));
    }
    this.pegs.instanceMatrix.needsUpdate = true;
  }

  private writePegColor(i: number, c: THREE.Color): void {
    if (!this.pegColorAttr) return;
    this.pegColorAttr.setXYZ(i, c.r, c.g, c.b);
    this.pegColorAttr.needsUpdate = true;
  }

  /** Paint a peg's element (null clears it). */
  setPegElement(peg: number, el: Element | null): void {
    if (!this.pegElementAttr || !this.pegStampAttr) return;
    this.pegElementAttr.setX(peg, el ? ELEMENT_ID[el] : 0);
    this.pegElementAttr.needsUpdate = true;
    if (el) {
      this.pegStampAttr.setX(peg, this.time);
      this.pegStampAttr.needsUpdate = true;
    }
  }

  /** Laser sweep at board height y: beam flash plus sparks along the row. */
  laserSweep(y: number, color: number | THREE.Color = 0xff2d95): void {
    this.laser.position.y = y;
    (this.laser.material as THREE.MeshBasicMaterial).color.set(color);
    this.laser.visible = true;
    this.laserLife = 1;
    const half = this.board.width / 2;
    for (let x = -half; x <= half; x += 0.35) this.fx.burst(x, y, color, 4, 2.5, 0.12, 0.45, -3);
    this.kickBloom(1.0);
  }

  /** Portal rings at both ends of a teleport. */
  portal(from: { x: number; y: number }, to: { x: number; y: number }): void {
    for (const p of [from, to]) {
      this.fx.ring(p.x, p.y, 0xb46cff, 0.9, 0.45);
      this.fx.ring(p.x, p.y, 0x7df9ff, 1.3, 0.6);
      this.fx.burst(p.x, p.y, 0xb46cff, 40, 4, 0.16, 0.6, 0);
    }
    this.fx.zap(from, to, 0xb46cff, 0.35, false);
  }

  /** Whole-board colour cast for physics events (0 clears). */
  setTint(color: number | null, strength = 0.6): void {
    this.tint = color === null ? 0 : strength;
    if (color !== null) this.tintColor.setHex(color);
  }

  /** Screen-space shockwave from a board point (steam, chains, bombs). */
  shock(x: number, y: number, strength = 1): void {
    this.shockPos.set(x, y, 0);
    this.shockwave.amplitude = 0.04 + 0.05 * strength;
    this.shockwave.maxRadius = 0.5 + 0.5 * strength;
    this.shockwave.explode();
  }

  resetPegElements(): void {
    if (!this.pegElementAttr) return;
    (this.pegElementAttr.array as Float32Array).fill(0);
    this.pegElementAttr.needsUpdate = true;
  }

  setPegLit(peg: number, lit: boolean): void {
    if (!this.pegs) return;
    this.pegLit[peg] = lit ? 1 : 0;
    this.writePegColor(peg, this.pegColor(peg));
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
    for (let i = 0; i < this.pegs.count; i++) this.writePegColor(i, this.pegColor(i));
    this.resetPegElements();
  }

  /** Clear transient presentation state between runs. */
  resetForNewRun(): void {
    this.fx.clear();
    this.shake = 0;
    this.heat = this.heatTarget = 0;
    this.bloomKick = 0;
    this.balls.count = 0;
    this.auras.count = 0;
  }

  /** Combo intensity 0..1; post effects ease toward it. */
  setHeat(h: number): void {
    this.heatTarget = Math.max(0, Math.min(1, h));
  }

  /** Momentary bloom surge for milestones and big landings. */
  kickBloom(strength: number): void {
    this.bloomKick = Math.min(2.5, this.bloomKick + strength);
  }

  /** Wall fins: short neon ramps in the wall colour (left magenta, right cyan). */
  setFins(fins: Fin[]): void {
    for (const m of this.finMeshes) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.finMeshes = [];
    for (const f of fins) {
      const dx = f.x2 - f.x1;
      const dy = f.y2 - f.y1;
      const color = f.x1 < 0 ? NEON_MAGENTA : NEON_CYAN;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(Math.hypot(dx, dy), 0.07, 0.3),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.4 }),
      );
      m.position.set((f.x1 + f.x2) / 2, (f.y1 + f.y2) / 2, 0);
      m.rotation.z = Math.atan2(dy, dx);
      this.scene.add(m);
      this.finMeshes.push(m);
    }
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

  /** Renderer asks the game which element a ball carries (null = none). */
  elementOf: (ballId: number) => Element | null = () => null;

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
      if (tag === "rainbow") {
        // The hue wheel drives the ball itself too; bright enough for bloom.
        this.color.setHSL((this.time * 0.5 + b.id * 0.13) % 1, 1, 0.6).multiplyScalar(1.7);
      } else {
        this.color.set(type ? type.color : SHARD_COLOR);
        const el = tag === "abyss" ? null : this.elementOf(b.id);
        // Imbued balls glow their element: pushed past 1.0 so bloom picks them up.
        if (el) this.color.lerp(this.tmpElColor.setHex(ELEMENTS[el].color), 0.7).multiplyScalar(1.8);
      }
      this.balls.setColorAt(i, this.color);
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
      const el = this.elementOf(b.id);
      // Element auras trail even when slow; plain balls only when fast.
      if (speed < TRAIL_SPEED && !el) continue;
      const type = BALL_TYPES[(b.tag ?? "steel") as BallTypeId];
      if (b.tag === "rainbow") this.fx.trail(b.x, b.y, this.tmpElColor.setHSL((this.time * 0.5 + b.id * 0.13) % 1, 1, 0.6), b.radius * 2.4);
      else if (b.tag === "abyss") this.fx.trail(b.x, b.y, ABYSS_TRAIL, b.radius * 2.2);
      else this.fx.trail(b.x, b.y, el ? ELEMENTS[el].color : type ? type.color : SHARD_COLOR, b.radius * (el ? 2.4 : 1.6));
      budget--;
    }

    // Drift: pegs follow their sim offsets, interpolated like the balls.
    if (this.pegs && curr.pegOffsets) {
      const po = prev.pegOffsets;
      for (let i = 0; i < this.pegBase.length; i++) {
        const p = this.pegBase[i]!;
        const o1 = curr.pegOffsets[i] ?? 0;
        const o0 = po ? (po[i] ?? o1) : o1;
        this.dummy.position.set(p.x + o0 + (o1 - o0) * alpha, p.y, 0);
        this.dummy.scale.setScalar(this.pegRadius(i));
        this.dummy.updateMatrix();
        this.pegs.setMatrixAt(i, this.dummy.matrix);
      }
      this.pegs.instanceMatrix.needsUpdate = true;
    } else if (this.pegs && prev.pegOffsets && !curr.pegOffsets) {
      // Motion just ended: snap pegs home.
      for (let i = 0; i < this.pegBase.length; i++) {
        const p = this.pegBase[i]!;
        this.dummy.position.set(p.x, p.y, 0);
        this.dummy.scale.setScalar(this.pegRadius(i));
        this.dummy.updateMatrix();
        this.pegs.setMatrixAt(i, this.dummy.matrix);
      }
      this.pegs.instanceMatrix.needsUpdate = true;
    }

    // Element auras ride along with imbued balls.
    let na = 0;
    for (let i = 0; i < n; i++) {
      const b = curr.balls[i]!;
      const el = this.elementOf(b.id);
      const mode = b.tag === "rainbow" ? AURA_RAINBOW : b.tag === "abyss" ? AURA_ABYSS : el ? ELEMENT_ID[el] : 0;
      if (!mode) continue;
      const p = prevById.get(b.id) ?? b;
      this.dummy.position.set(p.x + (b.x - p.x) * alpha, p.y + (b.y - p.y) * alpha, 0.05);
      this.dummy.scale.setScalar(b.radius * (mode === AURA_ABYSS ? 3.4 : 2.6));
      this.dummy.updateMatrix();
      this.auras.setMatrixAt(na, this.dummy.matrix);
      this.auraElement.setX(na, mode);
      this.auraSeed.setX(na, (b.id % 97) / 97);
      na++;
    }
    this.auras.count = na;
    this.auras.instanceMatrix.needsUpdate = true;
    this.auraElement.needsUpdate = true;
    this.auraSeed.needsUpdate = true;
    this.time += dt;
    this.auraMat.uniforms.uTime!.value = this.time;

    // Peg pulses decay back to their resting colour; the shader animates elements.
    if (this.pegs && this.pulsing.size) {
      for (const i of this.pulsing) {
        const v = (this.pegPulse[i] = Math.max(0, this.pegPulse[i]! - dt * 5));
        this.color.copy(this.pegColor(i)).lerp(PEG_HOT, v * v);
        this.writePegColor(i, this.color);
        if (v <= 0) this.pulsing.delete(i);
      }
    }
    if (this.pegMat) this.pegMat.uniforms.uTime!.value = this.time;

    // Laser beam decays; the tint leaks into the vignette colour cheaply via bloom kick.
    if (this.laserLife > 0) {
      this.laserLife = Math.max(0, this.laserLife - dt * 2.2);
      (this.laser.material as THREE.MeshBasicMaterial).opacity = this.laserLife * 1.5;
      this.laser.scale.y = 1 + (1 - this.laserLife) * 4;
      if (this.laserLife === 0) this.laser.visible = false;
    }
    if (this.tint > 0) {
      (this.scene.background as THREE.Color).lerp(this.tintColor, 0.02 * this.tint);
    } else {
      (this.scene.background as THREE.Color).lerp(this.baseBackground, 0.05);
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
    if (this.quality === "low") this.renderer.render(this.scene, this.camera);
    else this.composer.render(dt);
  }

  /**
   * Tell the camera how much of the screen the HUD bars cover (phones stack
   * them above and below the board). `compact` trims the side/launch margins.
   */
  setViewInsets(top: number, bottom: number, compact: boolean): void {
    if (this.insets.top === top && this.insets.bottom === bottom && this.insets.compact === compact) return;
    this.insets = { top, bottom, compact };
    this.resize();
  }

  private resize(): void {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // Fit the whole board (plus the launch area) into the screen minus the UI
    // bars, whatever the aspect, and centre it in that band.
    const { top, bottom, compact } = this.insets;
    const usable = Math.max(120, h - top - bottom);
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const marginH = compact ? 2.8 : 3.4; // launch area above (≥1.5) + pockets below (≥0.8)
    const marginW = compact ? 1.0 : 2.6;
    const needH = (this.board.height + marginH) / 2 / tan / (usable / h);
    const needW = (this.board.width + marginW) / 2 / tan / this.camera.aspect;
    const d = Math.max(needH, needW);
    const worldPerPx = (2 * d * tan) / h;
    const cy = this.board.height / 2 + 0.3 + ((top - bottom) / 2) * worldPerPx;
    this.camBase.set(0, cy, d);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(0, cy, 0);
    this.camera.updateProjectionMatrix();
  }
}
