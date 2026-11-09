// Effecten: kogelgaten, deeltjes, hulzen, tracers, stof en rook.
import * as THREE from 'three';
import { whiteColors } from './world.js';

const V = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), M4 = new THREE.Matrix4();
const ZUP = new THREE.Vector3(0, 0, 1);

function particleMaterial(tex, additive) {
  return new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex }, uScale: { value: 600 } },
    vertexShader: `
      attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
      varying vec3 vColor; varying float vAlpha;
      uniform float uScale;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(aSize * uScale / max(0.05, -mv.z), 256.0);
        vColor = aColor; vAlpha = aAlpha;
      }`,
    fragmentShader: `
      uniform sampler2D uTex; varying vec3 vColor; varying float vAlpha;
      void main(){
        vec4 t = texture2D(uTex, gl_PointCoord);
        float a = t.a * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor * t.rgb, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

class Particles {
  constructor(scene, tex, n, additive) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
    this.a0 = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.floor = new Float32Array(n);
    this.i = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = particleMaterial(tex, additive);
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
    this.active = 0;
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, r, gg, b, a0, grav, drag, floorY = -10) {
    const i = this.i; this.i = (this.i + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = gg; this.col[i * 3 + 2] = b;
    this.life[i] = life; this.max[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.grav[i] = grav; this.drag[i] = drag; this.floor[i] = floorY;
    this.active = 1.5;
  }
  update(dt) {
    if (this.active <= 0) return;
    this.active -= dt;
    const { pos, vel, life, max } = this;
    for (let i = 0; i < this.n; i++) {
      if (life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      life[i] -= dt;
      const k = 1 - Math.max(0, life[i]) / max[i];
      const dr = Math.exp(-this.drag[i] * dt);
      vel[i * 3] *= dr; vel[i * 3 + 1] = vel[i * 3 + 1] * dr - this.grav[i] * dt; vel[i * 3 + 2] *= dr;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < this.floor[i]) { pos[i * 3 + 1] = this.floor[i]; vel[i * 3 + 1] *= -0.3; vel[i * 3] *= 0.5; vel[i * 3 + 2] *= 0.5; }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      this.alpha[i] = this.a0[i] * (1 - k) * Math.min(1, k * 12 + 0.2);
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
  }
  clear() { this.life.fill(0); this.alpha.fill(0); this.size.fill(0); this.active = 0.1; }
}

export class FX {
  constructor(engine, T) {
    this.engine = engine;
    const scene = engine.scene;
    this.scene = scene;
    this.T = T;
    // kogelgaten
    this.decals = {};
    const offs = { wood: [0, 0.5], concrete: [0.5, 0.5], cardboard: [0, 0], metal: [0.5, 0] };
    const pg = new THREE.PlaneGeometry(1, 1);
    for (const k in offs) {
      const t = T.decals.clone();
      t.offset.set(offs[k][0], offs[k][1]);
      t.repeat.set(0.5, 0.5);
      t.needsUpdate = true;
      const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.9 });
      const im = new THREE.InstancedMesh(pg, m, 160);
      im.count = 0;
      im.frustumCulled = false;
      im.renderOrder = 2;
      scene.add(im);
      this.decals[k] = { im, i: 0, n: 160 };
    }
    // deeltjes
    this.add = new Particles(scene, T.dot, 500, true);
    this.blend = new Particles(scene, T.dot, 700, false);
    this.puffs = new Particles(scene, T.smoke, 160, false);
    // hulzen
    const cg = whiteColors(new THREE.CylinderGeometry(0.0048, 0.0048, 0.045, 8));
    cg.rotateZ(Math.PI / 2);
    const cm = new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.95, roughness: 0.28, vertexColors: true });
    this.casings = new THREE.InstancedMesh(cg, cm, 48);
    this.casings.castShadow = false;
    this.casings.frustumCulled = false;
    this.casings.count = 48;
    scene.add(this.casings);
    this.cas = [];
    for (let i = 0; i < 48; i++) this.cas.push({ p: new THREE.Vector3(0, -50, 0), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), floor: 0, rest: 0, alive: false, sound: false });
    this.ci = 0;
    this.hideAllCasings();
    // tracers
    const tg = new THREE.BoxGeometry(0.014, 0.014, 1);
    tg.translate(0, 0, -0.5);
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.6, 1.6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracers = new THREE.InstancedMesh(tg, tm, 24);
    this.tracers.frustumCulled = false;
    this.tracers.renderOrder = 9;
    scene.add(this.tracers);
    this.tr = [];
    for (let i = 0; i < 24; i++) this.tr.push({ a: new THREE.Vector3(), d: new THREE.Vector3(), len: 0, head: 0, alive: false });
    this.ti = 0;
    // zwevend stof in het licht
    this.dust = new Particles(scene, T.dot, 320, false);
    this.dustInit = false;
    // rook
    this.smoke = [];
    this.onCasing = null;
  }

  hideAllCasings() {
    M4.makeScale(0, 0, 0);
    for (let i = 0; i < 48; i++) this.casings.setMatrixAt(i, M4);
    this.casings.instanceMatrix.needsUpdate = true;
  }

  decal(type, point, normal, size) {
    const D = this.decals[type] || this.decals.concrete;
    const i = D.i; D.i = (D.i + 1) % D.n;
    V.copy(point).addScaledVector(normal, 0.003);
    Q.setFromUnitVectors(ZUP, normal);
    const roll = new THREE.Quaternion().setFromAxisAngle(ZUP, Math.random() * Math.PI * 2);
    Q.multiply(roll);
    S.set(size, size, 1);
    M4.compose(V, Q, S);
    D.im.setMatrixAt(i, M4);
    D.im.count = Math.max(D.im.count, i + 1);
    D.im.instanceMatrix.needsUpdate = true;
  }

  impact(point, normal, mat, floorY = 0, noDecal = false) {
    const n = normal, p = point;
    const dec = noDecal ? () => {} : (t, pp, nn, s) => this.decal(t, pp, nn, s);
    const rnd = (s) => (Math.random() - 0.5) * s;
    if (mat === 'wood') {
      dec('wood', p, n, 0.06 + Math.random() * 0.03);
      for (let k = 0; k < 9; k++) this.blend.emit(p.x, p.y, p.z, n.x * 2.5 + rnd(3), n.y * 2.5 + rnd(3) + 1, n.z * 2.5 + rnd(3), 0.6 + Math.random() * 0.5, 0.025, 0.02, 0.85, 0.7, 0.5, 1, 9, 1.5, floorY);
      this.puffs.emit(p.x, p.y, p.z, n.x * 0.6, n.y * 0.6 + 0.1, n.z * 0.6, 0.9, 0.12, 0.45, 0.8, 0.72, 0.6, 0.35, -0.1, 2.5);
    } else if (mat === 'concrete' || mat === 'plastic' || mat === 'rubber') {
      if (mat === 'concrete') dec('concrete', p, n, 0.05 + Math.random() * 0.03);
      for (let k = 0; k < 8; k++) this.blend.emit(p.x, p.y, p.z, n.x * 3 + rnd(3), n.y * 3 + rnd(3), n.z * 3 + rnd(3), 0.5 + Math.random() * 0.4, 0.02, 0.015, 0.55, 0.55, 0.53, 1, 9, 1.2, floorY);
      this.puffs.emit(p.x, p.y, p.z, n.x * 0.8, n.y * 0.8 + 0.15, n.z * 0.8, 1.2, 0.15, 0.7, 0.62, 0.61, 0.58, 0.42, -0.08, 2.2);
    } else if (mat === 'metal' || mat === 'lexan' || mat === 'steel') {
      dec(mat === 'lexan' ? 'metal' : 'metal', p, n, mat === 'lexan' ? 0.03 : 0.04);
      const c = mat === 'lexan' ? [3, 3.2, 3.6] : [5, 2.8, 0.9];
      for (let k = 0; k < 12; k++) this.add.emit(p.x, p.y, p.z, n.x * 4 + rnd(6), n.y * 4 + rnd(6) + 1, n.z * 4 + rnd(6), 0.18 + Math.random() * 0.25, 0.018, 0.006, c[0], c[1], c[2], 1, 9, 0.5, floorY);
    } else if (mat === 'cardboard') {
      for (let k = 0; k < 6; k++) this.blend.emit(p.x, p.y, p.z, n.x * 1.5 + rnd(2), n.y * 1.5 + rnd(2) + 0.8, n.z * 1.5 + rnd(2), 0.8 + Math.random() * 0.4, 0.02, 0.02, 0.8, 0.66, 0.45, 1, 6, 2.5, floorY);
      this.puffs.emit(p.x, p.y, p.z, n.x * 0.4, 0.05, n.z * 0.4, 0.6, 0.08, 0.3, 0.8, 0.7, 0.55, 0.25, 0, 3);
    } else if (mat === 'body') {
      for (let k = 0; k < 6; k++) this.blend.emit(p.x, p.y, p.z, n.x * 1.2 + rnd(1.5), rnd(1.5) + 0.4, n.z * 1.2 + rnd(1.5), 0.4, 0.03, 0.02, 0.25, 0.25, 0.27, 0.9, 5, 3, floorY);
      this.puffs.emit(p.x, p.y, p.z, n.x * 0.5, 0.1, n.z * 0.5, 0.7, 0.1, 0.4, 0.5, 0.5, 0.52, 0.35, 0, 3);
    }
  }


  muzzle(pos, dir) {
    for (let k = 0; k < 2; k++) {
      this.puffs.emit(pos.x + dir.x * 0.1, pos.y + dir.y * 0.1, pos.z + dir.z * 0.1, dir.x * 1.2 + (Math.random() - 0.5) * 0.3, dir.y * 1.2 + 0.25, dir.z * 1.2 + (Math.random() - 0.5) * 0.3, 0.8 + Math.random() * 0.4, 0.06, 0.4, 0.75, 0.74, 0.72, 0.16, -0.12, 2.4);
    }
    for (let k = 0; k < 4; k++) this.add.emit(pos.x, pos.y, pos.z, dir.x * 8 + (Math.random() - 0.5) * 3, dir.y * 8 + (Math.random() - 0.5) * 3, dir.z * 8 + (Math.random() - 0.5) * 3, 0.05 + Math.random() * 0.05, 0.012, 0.004, 6, 3.5, 1.2, 1, 0, 1);
  }

  casing(pos, vel, floorY) {
    const c = this.cas[this.ci]; this.ci = (this.ci + 1) % this.cas.length;
    c.p.copy(pos); c.v.copy(vel); c.floor = floorY;
    c.q.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3));
    c.w.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
    c.alive = true; c.rest = 0; c.bounces = 0;
  }

  tracer(from, to) {
    const t = this.tr[this.ti]; this.ti = (this.ti + 1) % this.tr.length;
    t.a.copy(from);
    t.d.subVectors(to, from);
    t.len = t.d.length();
    if (t.len < 0.5) return;
    t.d.divideScalar(t.len);
    t.head = 0; t.alive = true;
  }

  setSmoke(world, amount) {
    for (const s of this.smoke) { this.scene.remove(s.sprite); s.sprite.material.dispose(); }
    this.smoke = [];
    if (!amount) return;
    const n = Math.round(30 * amount);
    for (let i = 0; i < n; i++) {
      const m = new THREE.SpriteMaterial({ map: this.T.smoke, color: 0xd8dadc, transparent: true, opacity: 0.12 + Math.random() * 0.14 * amount, depthWrite: false, fog: true, rotation: Math.random() * 6 });
      const sp = new THREE.Sprite(m);
      const sz = 3.5 + Math.random() * 4;
      sp.scale.set(sz, sz * 0.7, 1);
      sp.position.set(Math.random() * world.W, 0.6 + Math.random() * 1.6, Math.random() * world.D);
      sp.renderOrder = 8;
      this.scene.add(sp);
      this.smoke.push({ sprite: sp, vx: (Math.random() - 0.5) * 0.12, vz: (Math.random() - 0.5) * 0.12, vr: (Math.random() - 0.5) * 0.05, W: world.W, D: world.D });
    }
  }

  update(dt, cam) {
    // schaal voor puntgrootte
    const sc = this.engine.renderer.getPixelRatio() * this.engine.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
    for (const p of [this.add, this.blend, this.puffs, this.dust]) p.mat.uniforms.uScale.value = sc;
    this.add.update(dt); this.blend.update(dt); this.puffs.update(dt);
    // stof
    const d = this.dust, cp = cam.position;
    if (!this.dustInit) {
      for (let i = 0; i < d.n; i++) {
        d.pos[i * 3] = cp.x + (Math.random() - 0.5) * 14; d.pos[i * 3 + 1] = Math.random() * 4.5; d.pos[i * 3 + 2] = cp.z + (Math.random() - 0.5) * 14;
        d.vel[i * 3] = (Math.random() - 0.5) * 0.05; d.vel[i * 3 + 1] = (Math.random() - 0.5) * 0.03; d.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
        d.size[i] = 0.006 + Math.random() * 0.012; d.alpha[i] = 0.25 + Math.random() * 0.45;
        d.col[i * 3] = 1.4; d.col[i * 3 + 1] = 1.3; d.col[i * 3 + 2] = 1.15;
      }
      this.dustInit = true;
    }
    for (let i = 0; i < d.n; i++) {
      const t = performance.now() * 0.0002 + i;
      d.pos[i * 3] += (d.vel[i * 3] + Math.sin(t) * 0.02) * dt;
      d.pos[i * 3 + 1] += d.vel[i * 3 + 1] * dt;
      d.pos[i * 3 + 2] += (d.vel[i * 3 + 2] + Math.cos(t * 1.3) * 0.02) * dt;
      const dx = d.pos[i * 3] - cp.x, dz = d.pos[i * 3 + 2] - cp.z;
      if (dx > 7) d.pos[i * 3] -= 14; if (dx < -7) d.pos[i * 3] += 14;
      if (dz > 7) d.pos[i * 3 + 2] -= 14; if (dz < -7) d.pos[i * 3 + 2] += 14;
      if (d.pos[i * 3 + 1] < 0.1) d.pos[i * 3 + 1] = 4.4; if (d.pos[i * 3 + 1] > 4.5) d.pos[i * 3 + 1] = 0.2;
    }
    const da = d.geo.attributes;
    da.position.needsUpdate = true;
    if (!this._dustAttr) { da.aSize.needsUpdate = da.aAlpha.needsUpdate = da.aColor.needsUpdate = true; this._dustAttr = true; }
    // hulzen
    let any = false;
    for (let i = 0; i < this.cas.length; i++) {
      const c = this.cas[i];
      if (!c.alive) continue;
      any = true;
      if (c.rest < 1) {
        c.v.y -= 9.8 * dt;
        c.p.addScaledVector(c.v, dt);
        const ang = c.w.length() * dt;
        if (ang > 0) { Q.setFromAxisAngle(V.copy(c.w).normalize(), ang); c.q.premultiply(Q); }
        if (c.p.y < c.floor + 0.005) {
          c.p.y = c.floor + 0.005;
          if (c.v.y < -0.4 && c.bounces < 3) { c.bounces++; if (this.onCasing && c.bounces === 1) this.onCasing(); }
          c.v.y *= -0.35; c.v.x *= 0.55; c.v.z *= 0.55; c.w.multiplyScalar(0.5);
          if (Math.abs(c.v.y) < 0.25) { c.v.set(0, 0, 0); c.w.set(0, 0, 0); c.rest += dt * 0.25; }
        }
      } else {
        c.rest += dt;
        if (c.rest > 25) { c.alive = false; }
      }
      M4.compose(c.p, c.q, S.set(1, 1, 1));
      if (!c.alive) M4.makeScale(0, 0, 0);
      this.casings.setMatrixAt(i, M4);
    }
    if (any) this.casings.instanceMatrix.needsUpdate = true;
    // tracers
    let anyT = false;
    for (let i = 0; i < this.tr.length; i++) {
      const t = this.tr[i];
      if (!t.alive) { M4.makeScale(0, 0, 0); this.tracers.setMatrixAt(i, M4); continue; }
      anyT = true;
      t.head += dt * 260;
      const tail = Math.max(0, t.head - 3);
      const head = Math.min(t.len, t.head);
      if (tail >= t.len) { t.alive = false; M4.makeScale(0, 0, 0); this.tracers.setMatrixAt(i, M4); continue; }
      V.copy(t.a).addScaledVector(t.d, head);
      Q.setFromUnitVectors(ZUP, t.d);
      M4.compose(V, Q, S.set(1, 1, Math.max(0.01, head - tail)));
      this.tracers.setMatrixAt(i, M4);
    }
    this.tracers.instanceMatrix.needsUpdate = true;
    void anyT;
    // rook
    for (const s of this.smoke) {
      const p = s.sprite.position;
      p.x += s.vx * dt; p.z += s.vz * dt;
      s.sprite.material.rotation += s.vr * dt;
      if (p.x < -1) p.x = s.W + 1; if (p.x > s.W + 1) p.x = -1;
      if (p.z < -1) p.z = s.D + 1; if (p.z > s.D + 1) p.z = -1;
    }
  }

  clear() {
    for (const k in this.decals) { this.decals[k].im.count = 0; this.decals[k].i = 0; }
    this.add.clear(); this.blend.clear(); this.puffs.clear();
    for (const c of this.cas) c.alive = false;
    this.hideAllCasings();
    for (const t of this.tr) t.alive = false;
  }
}
