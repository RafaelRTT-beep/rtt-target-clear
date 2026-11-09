// Renderer, post-processing en kwaliteitsbeheer.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Viewmodel-pass: tekent het wapen bovenop de wereld met een eigen camera
class OverlayPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene; this.camera = camera;
    this.needsSwap = false;
  }
  render(renderer, writeBuffer, readBuffer) {
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uDamage: { value: 0 },
    uFlash: { value: 0 },
    uVignette: { value: 0.42 },
    uGrain: { value: 0.035 },
    uCA: { value: 0.0025 },
    uSat: { value: 1.06 },
    uContrast: { value: 1.06 },
    uFade: { value: 0 },
    uHitDir: { value: new THREE.Vector2(0, 0) },
    uHitAmt: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes;
    uniform float uDamage, uFlash, uVignette, uGrain, uCA, uSat, uContrast, uFade, uHitAmt;
    uniform vec2 uHitDir;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * (uCA + uDamage*0.006) * (0.4 + r2*3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat - uDamage*0.5);
      col = (col - 0.5) * uContrast + 0.5;
      col *= vec3(1.015, 1.0, 0.975);
      float asp = uRes.x / uRes.y;
      vec2 vc = c * vec2(asp, 1.0) / asp * 1.6;
      float vig = smoothstep(1.15, 0.25, length(vc));
      col *= mix(1.0, vig, uVignette);
      // schade: rode rand + richting
      float edge = smoothstep(0.18, 0.75, length(c) * 1.5);
      col = mix(col, vec3(0.42, 0.0, 0.0), clamp(uDamage * edge, 0.0, 0.85));
      if (uHitAmt > 0.0) {
        float d = dot(normalize(c + 1e-5), uHitDir);
        col = mix(col, vec3(0.7, 0.03, 0.02), uHitAmt * smoothstep(0.55, 1.0, d) * smoothstep(0.12, 0.5, length(c)));
      }
      col += uFlash;
      float n = hash(vUv * uRes + fract(uTime) * 100.0) - 0.5;
      col += n * uGrain;
      col *= 1.0 - uFade;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8d939a);
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.04, 140);
    this.scene.add(this.camera);
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 6);

    // omgevingslicht voor reflecties
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.32;
    this.vmScene.environment = env;
    this.vmScene.environmentIntensity = 0.7;
    pmrem.dispose();

    // licht
    this.hemi = new THREE.HemisphereLight(0xe6edf5, 0x6a5e4e, 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff3e2, 3.6);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // mondingsvuur (altijd aanwezig, intensiteit 0 -> geen shader-hercompilatie)
    this.flashLight = new THREE.PointLight(0xffb060, 0, 9, 1.6);
    this.scene.add(this.flashLight);
    this.enemyFlash = new THREE.PointLight(0xffa050, 0, 7, 1.8);
    this.scene.add(this.enemyFlash);

    const vmHemi = new THREE.HemisphereLight(0xdfe6ee, 0x4a4036, 1.4);
    this.vmScene.add(vmHemi);
    const vmKey = new THREE.DirectionalLight(0xfff1de, 2.2);
    vmKey.position.set(0.6, 1.4, 0.4);
    this.vmScene.add(vmKey);
    this.vmFlash = new THREE.PointLight(0xffa850, 0, 2.5, 1.5);
    this.vmScene.add(this.vmFlash);

    this.quality = 'high';
    this.forceShadow = true;
    this.pixelRatioCap = Math.min(window.devicePixelRatio || 1, 2);
    this.dynScale = 1;
    this.frameTimes = [];
    this.buildComposer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  buildComposer() {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.vmPass = new OverlayPass(this.vmScene, this.vmCamera);
    this.composer.addPass(this.vmPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  setQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    if (q === 'high') { this.pixelRatioCap = Math.min(dpr, 2); this.setShadow(2048); this.bloom.enabled = true; this.renderer.shadowMap.enabled = true; }
    else if (q === 'medium') { this.pixelRatioCap = Math.min(dpr, 1.5); this.setShadow(1024); this.bloom.enabled = true; this.renderer.shadowMap.enabled = true; }
    else { this.pixelRatioCap = Math.min(dpr, 1); this.setShadow(512); this.bloom.enabled = false; this.renderer.shadowMap.enabled = true; }
    this.dynScale = 1;
    this.resize();
    this.scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => (m.needsUpdate = true)); } });
  }

  setShadow(sz) {
    const s = this.sun.shadow;
    if (s.mapSize.x === sz) return;
    s.mapSize.set(sz, sz);
    if (s.map) { s.map.dispose(); s.map = null; }
  }

  fitShadow(x0, z0, x1, z1) {
    this.forceShadow = true;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const ext = Math.max(x1 - x0, z1 - z0) / 2 + 1.5;
    this.sun.position.set(cx - 9, 22, cz - 6);
    this.sun.target.position.set(cx, 0, cz);
    const cam = this.sun.shadow.camera;
    cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext;
    cam.near = 1; cam.far = 50;
    cam.updateProjectionMatrix();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.max(0.6, this.pixelRatioCap * this.dynScale);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * pr * 0.5, h * pr * 0.5);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h; this.vmCamera.updateProjectionMatrix();
    this.grade.uniforms.uRes.value.set(w * pr, h * pr);
    this.width = w; this.height = h;
  }

  // dynamische resolutie: houdt het vloeiend op de telefoon
  adapt(dt) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 45) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    let ns = this.dynScale;
    if (avg > 1 / 45) ns = Math.max(0.55, ns - 0.1);
    else if (avg < 1 / 57 && ns < 1) ns = Math.min(1, ns + 0.05);
    if (Math.abs(ns - this.dynScale) > 0.01) { this.dynScale = ns; this.resize(); }
  }

  render(dt, time) {
    // schaduwkaart niet elk frame verversen (muren staan stil)
    this.frameNo = (this.frameNo || 0) + 1;
    const every = this.quality === 'high' ? 2 : 3;
    this.renderer.shadowMap.autoUpdate = false;
    if (this.frameNo % every === 0 || this.forceShadow) { this.renderer.shadowMap.needsUpdate = true; this.forceShadow = false; }
    this.grade.uniforms.uTime.value = time;
    this.composer.render(dt);
  }
}
