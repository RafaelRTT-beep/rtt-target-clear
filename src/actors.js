// Schijven, poppers en 3D-figuren (verdachten, burgers, gijzelnemer) met AI.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeTargetCanvas, makeBackCanvas, TARGET_W, TARGET_H, mulberry } from './textures.js';
import { rayBox } from './world.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _ray = new THREE.Ray();
const ease = (t) => t * t * (3 - 2 * t);

// ---------------- gedeelde geometrie en materialen ----------------
const GEO = {};
function geo(key, fn) { return GEO[key] || (GEO[key] = fn()); }
const MATS = {};
function mat(hex, rough = 0.8, metal = 0) {
  const k = hex + '|' + rough + '|' + metal;
  return MATS[k] || (MATS[k] = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal }));
}
function limbGeo(r, len) {
  return geo(`limb${r}_${len}`, () => {
    const g = new THREE.CapsuleGeometry(r, len, 4, 10);
    g.translate(0, -(len / 2 + r * 0.6), 0);
    return g;
  });
}
function rbox(w, h, d, r = 0.02) { return geo(`rb${w}_${h}_${d}_${r}`, () => new RoundedBoxGeometry(w, h, d, 2, r)); }
function mesh(g, m, parent, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true; o.receiveShadow = true;
  parent.add(o);
  return o;
}

// Figuren worden als één skinned mesh per persoon gebouwd: alle onderdelen krijgen een
// vertex-kleur en hangen star aan een bot. Zo kost een figuur 1 draw call in plaats van ~30.
const HUMAN_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 });
const WEAPON_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.45 });
const _col = new THREE.Color();

class PartList {
  constructor() { this.parts = []; }
  add(g, color, parent, x = 0, y = 0, z = 0) {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    this.parts.push({ g, color, parent, o });
    return o;
  }
  bake(space, boneIndex) {
    const inv = new THREE.Matrix4().copy(space.matrixWorld).invert();
    const allIndexed = this.parts.every((p) => !!p.g.index);
    const geos = [];
    for (const p of this.parts) {
      p.o.updateMatrix();
      const m = new THREE.Matrix4().multiplyMatrices(inv, p.parent.matrixWorld).multiply(p.o.matrix);
      let g = p.g.clone();
      if (!allIndexed && g.index) g = g.toNonIndexed();
      g.applyMatrix4(m);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      const n = g.attributes.position.count;
      _col.set(p.color);
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { c[i * 3] = _col.r; c[i * 3 + 1] = _col.g; c[i * 3 + 2] = _col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      if (boneIndex) {
        const bi = boneIndex.get(p.parent) || 0;
        const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      }
      geos.push(g);
    }
    const out = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    return out;
  }
}

// pistool / geweer voor de figuren (1 mesh elk)
function finishWeapon(g, P, muzzlePos) {
  g.updateMatrixWorld(true);
  const m = new THREE.Mesh(P.bake(g), WEAPON_MAT);
  g.add(m);
  const muzzle = new THREE.Object3D(); muzzle.position.copy(muzzlePos); g.add(muzzle);
  return { g, muzzle, mesh: m };
}
function buildPistol() {
  const g = new THREE.Group(), P = new PartList();
  P.add(rbox(0.032, 0.035, 0.19, 0.008), 0x141517, g, 0, 0.012, 0.06);
  P.add(rbox(0.03, 0.11, 0.045, 0.008), 0x1c1d1f, g, 0, -0.045, -0.005).rotation.x = -0.25;
  return finishWeapon(g, P, new THREE.Vector3(0, 0.015, 0.16));
}
function buildRifle() {
  const g = new THREE.Group(), P = new PartList();
  P.add(rbox(0.045, 0.07, 0.3, 0.008), 0x151618, g, 0, 0, 0.05);
  P.add(rbox(0.05, 0.05, 0.3, 0.01), 0x7d6a4e, g, 0, 0.005, 0.35);
  P.add(geo('rbar', () => new THREE.CylinderGeometry(0.008, 0.008, 0.18, 8).rotateX(Math.PI / 2)), 0x151618, g, 0, 0.008, 0.58);
  P.add(rbox(0.04, 0.08, 0.18, 0.01), 0x7d6a4e, g, 0, -0.01, -0.2);
  P.add(rbox(0.025, 0.14, 0.06, 0.006), 0x23241f, g, 0, -0.09, 0.08).rotation.x = 0.25;
  P.add(rbox(0.028, 0.09, 0.04, 0.006), 0x23241f, g, 0, -0.07, -0.03).rotation.x = -0.3;
  P.add(geo('rsight', () => new THREE.CylinderGeometry(0.016, 0.016, 0.06, 10).rotateX(Math.PI / 2)), 0x151618, g, 0, 0.06, 0.06);
  return finishWeapon(g, P, new THREE.Vector3(0, 0.008, 0.68));
}

const SKIN = [0xc99a7c, 0xa87358, 0xe0b597, 0x7a4f3a, 0xb98a6a];
const SUSPECT_TOPS = [0x23252b, 0x2f2a26, 0x1f2a33, 0x3a3d40, 0x2b3326];
const CIV_TOPS = [0x3d6b9a, 0x9a3d3d, 0xd8d2c4, 0x4d7a52, 0xb08a3a, 0x7a5a8a, 0xc96f3a];
const PANTS = [0x2a3446, 0x2b2b2d, 0x4a4a3e, 0x3c4f6a, 0x5a4a3a];

function buildHuman(R, role, weapon) {
  const suspect = role === 'suspect';
  const skin = SKIN[Math.floor(R() * SKIN.length)];
  const top = (suspect ? SUSPECT_TOPS : CIV_TOPS)[Math.floor(R() * (suspect ? SUSPECT_TOPS.length : CIV_TOPS.length))];
  const pants = PANTS[Math.floor(R() * PANTS.length)];
  const shoes = suspect ? 0x111111 : [0xe8e8e8, 0x222222, 0x6a4a2a][Math.floor(R() * 3)];
  const dark = 0x111214;
  const root = new THREE.Group();
  const J = {};
  const bones = [];
  const joint = (name, parent, x, y, z) => { const b = new THREE.Bone(); b.position.set(x, y, z); parent.add(b); J[name] = b; bones.push(b); return b; };
  const P = new PartList();
  const part = (g, c, parent, x, y, z) => P.add(g, c, parent, x, y, z);
  const hips = joint('hips', root, 0, 0.98, 0);
  part(rbox(0.33, 0.19, 0.21, 0.06), pants, hips, 0, 0, 0);
  const spine = joint('spine', hips, 0, 0.06, 0);
  part(geo('abd', () => new THREE.CapsuleGeometry(0.12, 0.1, 4, 12)), top, spine, 0, 0.08, 0).scale.set(1.2, 1, 0.82);
  const chest = joint('chest', spine, 0, 0.18, 0);
  part(rbox(0.36, 0.3, 0.21, 0.07), top, chest, 0, 0.1, 0);
  if (suspect && R() < 0.55) {
    part(rbox(0.38, 0.26, 0.25, 0.04), 0x262a22, chest, 0, 0.08, 0);
    part(rbox(0.1, 0.08, 0.04, 0.01), 0x262a22, chest, -0.08, 0.02, 0.13);
    part(rbox(0.1, 0.08, 0.04, 0.01), 0x262a22, chest, 0.08, 0.02, 0.13);
  }
  const neck = joint('neck', chest, 0, 0.255, 0);
  part(geo('neck', () => new THREE.CylinderGeometry(0.05, 0.058, 0.09, 10)), suspect ? dark : skin, neck, 0, 0.03, 0);
  const head = joint('head', neck, 0, 0.08, 0);
  part(geo('head', () => new THREE.SphereGeometry(0.092, 20, 16)), skin, head, 0, 0.1, 0.005).scale.set(0.88, 1.1, 1.0);
  if (suspect) {
    // bivakmuts (dekt het hele hoofd) met oogspleet en bril
    part(geo('bala', () => new THREE.SphereGeometry(0.099, 22, 16)), dark, head, 0, 0.1, 0.0).scale.set(0.9, 1.12, 1.03);
    part(rbox(0.11, 0.026, 0.02, 0.009), skin, head, 0, 0.124, 0.091);
    part(rbox(0.13, 0.032, 0.028, 0.011), 0x070707, head, 0, 0.125, 0.095);
    if (R() < 0.5) { // pet
      part(geo('cap', () => new THREE.SphereGeometry(0.104, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)), 0x1c1f24, head, 0, 0.13, 0);
      part(rbox(0.14, 0.012, 0.08, 0.005), 0x1c1f24, head, 0, 0.148, 0.09);
    }
  } else {
    part(rbox(0.024, 0.036, 0.03, 0.008), skin, head, 0, 0.092, 0.09);
    const hairCol = [0x2a1c12, 0x5a3a1e, 0x1a1a1a, 0x8a6a3a, 0xb0a090][Math.floor(R() * 5)];
    part(geo('hair', () => new THREE.SphereGeometry(0.096, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55)), hairCol, head, 0, 0.115, -0.008).scale.set(0.93, 1.1, 1.05);
    // veiligheidsbril (zoals in de hal verplicht)
    part(rbox(0.13, 0.032, 0.024, 0.01), 0x8fa8bc, head, 0, 0.125, 0.086);
    part(rbox(0.05, 0.01, 0.02, 0.004), 0x8a5a4a, head, 0, 0.058, 0.086);
  }
  // armen
  for (const side of [1, -1]) {
    const s = side > 0 ? 'l' : 'r';
    const sh = joint(s + 'Sh', chest, side * 0.2, 0.2, 0);
    part(geo('shoulder', () => new THREE.SphereGeometry(0.056, 12, 10)), top, sh, 0, -0.015, 0);
    part(limbGeo(0.052, 0.19), top, sh);
    const el = joint(s + 'El', sh, 0, -0.29, 0);
    part(limbGeo(0.043, 0.18), suspect ? top : (R() < 0.5 ? skin : top), el);
    const hand = joint(s + 'Hand', el, 0, -0.27, 0);
    part(rbox(0.07, 0.09, 0.035, 0.015), suspect ? dark : skin, hand, 0, -0.04, 0);
  }
  // benen
  for (const side of [1, -1]) {
    const s = side > 0 ? 'l' : 'r';
    const hp = joint(s + 'Hip', hips, side * 0.095, -0.05, 0);
    part(limbGeo(0.085, 0.3), pants, hp);
    const kn = joint(s + 'Knee', hp, 0, -0.43, 0);
    part(limbGeo(0.066, 0.31), pants, kn);
    const ft = joint(s + 'Foot', kn, 0, -0.44, 0);
    part(rbox(0.1, 0.075, 0.26, 0.025), shoes, ft, 0, -0.012, 0.045);
  }
  root.updateMatrixWorld(true);
  const boneIndex = new Map(bones.map((b, i) => [b, i]));
  const skinned = new THREE.SkinnedMesh(P.bake(root, boneIndex), HUMAN_MAT);
  skinned.castShadow = true; skinned.receiveShadow = true;
  root.add(skinned);
  skinned.updateMatrixWorld(true);
  skinned.bind(new THREE.Skeleton(bones));
  skinned.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.2);
  // wapen aan de borst (pose-afhankelijk)
  let wpn = null;
  if (weapon === 'pistol') wpn = buildPistol();
  else if (weapon === 'rifle') wpn = buildRifle();
  if (wpn) chest.add(wpn.g);
  return { root, J, wpn, skinned };
}

// poses: hoeken per gewricht [x,y,z]
const POSES = {
  idle: { hips: [0, 0, 0], spine: [0.03, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0], lSh: [0.05, 0, 0.12], rSh: [0.05, 0, -0.12], lEl: [-0.25, 0, 0], rEl: [-0.25, 0, 0], lHip: [0, 0, 0.04], rHip: [0, 0, -0.04], lKnee: [0.05, 0, 0], rKnee: [0.05, 0, 0], hipsY: 0.98 },
  lowPistol: { spine: [0.05, 0, 0], lSh: [-0.75, 0, -0.32], rSh: [-0.75, 0, 0.32], lEl: [-0.35, 0, 0], rEl: [-0.35, 0, 0], lHip: [0.05, 0, 0.08], rHip: [-0.08, 0, -0.08], lKnee: [0.15, 0, 0], rKnee: [0.1, 0, 0], hipsY: 0.97 },
  aimPistol: { spine: [0.06, 0, 0], head: [0.05, 0, 0], lSh: [-1.48, 0, -0.32], rSh: [-1.48, 0, 0.32], lEl: [-0.12, 0, 0], rEl: [-0.12, 0, 0], lHip: [0.12, 0, 0.1], rHip: [-0.15, 0, -0.1], lKnee: [0.25, 0, 0], rKnee: [0.2, 0, 0], hipsY: 0.95 },
  lowRifle: { spine: [0.05, 0, 0], lSh: [-0.7, 0, -0.45], rSh: [-0.25, 0, 0.35], lEl: [-0.9, 0, 0], rEl: [-1.4, 0, 0], lHip: [0.05, 0, 0.08], rHip: [-0.08, 0, -0.08], lKnee: [0.15, 0, 0], rKnee: [0.1, 0, 0], hipsY: 0.97 },
  aimRifle: { spine: [0.08, 0, 0], head: [0.12, -0.15, 0], lSh: [-1.25, 0, -0.62], rSh: [-0.55, 0, 0.75], lEl: [-0.35, 0, 0], rEl: [-1.55, 0, 0], lHip: [0.12, 0, 0.1], rHip: [-0.15, 0, -0.1], lKnee: [0.25, 0, 0], rKnee: [0.2, 0, 0], hipsY: 0.95 },
  handsUp: { spine: [-0.02, 0, 0], head: [-0.05, 0, 0], lSh: [-0.3, 0, 1.75], rSh: [-0.3, 0, -1.75], lEl: [0, 0, 1.45], rEl: [0, 0, -1.45], lHip: [0, 0, 0.05], rHip: [0, 0, -0.05], hipsY: 0.98 },
  cower: { hips: [0.15, 0, 0], spine: [0.45, 0, 0], chest: [0.25, 0, 0], head: [0.2, 0, 0], lSh: [-2.6, 0, 0.5], rSh: [-2.6, 0, -0.5], lEl: [-1.9, 0, 0], rEl: [-1.9, 0, 0], lHip: [-1.95, 0, 0.18], rHip: [-1.9, 0, -0.18], lKnee: [2.35, 0, 0], rKnee: [2.3, 0, 0], hipsY: 0.47 },
  hostage: { spine: [0.04, 0, 0], head: [-0.15, 0.1, 0], lSh: [-0.35, 0, 0.4], rSh: [-0.35, 0, -0.4], lEl: [-0.9, 0, 0], rEl: [-0.9, 0, 0], lKnee: [0.12, 0, 0], rKnee: [0.12, 0, 0], hipsY: 0.96 },
  dead: { spine: [-0.1, 0, 0], head: [-0.3, 0.4, 0], lSh: [-0.2, 0, 1.2], rSh: [-0.4, 0, -1.0], lEl: [-0.3, 0, 0], rEl: [-0.6, 0, 0], lHip: [0.15, 0, 0.2], rHip: [-0.1, 0, -0.15], lKnee: [0.5, 0, 0], rKnee: [0.2, 0, 0], hipsY: 0.98 },
};
const JOINT_NAMES = ['hips', 'spine', 'chest', 'neck', 'head', 'lSh', 'rSh', 'lEl', 'rEl', 'lHip', 'rHip', 'lKnee', 'rKnee'];
const _e = new THREE.Euler(), _q = new THREE.Quaternion();
function poseQuats(p) {
  const out = {};
  for (const n of JOINT_NAMES) {
    const a = p[n] || [0, 0, 0];
    out[n] = new THREE.Quaternion().setFromEuler(_e.set(a[0], a[1], a[2]));
  }
  out.hipsY = p.hipsY;
  return out;
}
const PQ = {};
for (const k in POSES) PQ[k] = poseQuats({ ...POSES.idle, ...POSES[k] });

// wapen-transform per pose (in borst-ruimte)
const WPN = {
  pistol: { low: [0, -0.12, 0.3, 1.0], aim: [0, 0.2, 0.55, 0] },
  rifle: { low: [-0.12, -0.05, 0.12, 0.9], aim: [-0.13, 0.17, 0.1, 0] },
};

// ---------------- schijf ----------------
class Target {
  constructor(ctx, ent, kind, turner) {
    this.kind = 'target';
    this.hostile = kind === 'shoot';
    this.ent = ent;
    this.region = ent.region;
    this.turner = turner;
    this.hits = 0;
    this.nsHits = 0;
    this.down = false;
    this.neutralized = false;
    const g = new THREE.Group();
    g.position.set(ent.x, ent.y, ent.z);
    g.rotation.y = ent.yaw;
    this.group = g;
    const stand = new THREE.Group();
    g.add(stand);
    // voet + staander
    mesh(geo('tbase', () => new THREE.BoxGeometry(0.5, 0.05, 0.36)), mat(0x202124, 0.7, 0.5), stand, 0, 0.025, 0);
    mesh(geo('tpole', () => new THREE.BoxGeometry(0.035, 0.95, 0.025)), mat(0x8a6b45, 0.9), stand, 0, 0.5, -0.03);
    // scharnier (valt achterover) en draaier
    this.turn = new THREE.Group();
    this.turn.position.set(0, 0, 0);
    stand.add(this.turn);
    this.hinge = new THREE.Group();
    this.hinge.position.set(0, 0.95, -0.02);
    this.turn.add(this.hinge);
    const tc = makeTargetCanvas(kind, ctx.seed());
    this.canvas = tc.canvas; this.mask = tc.mask; this.mw = tc.mw; this.mh = tc.mh;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    const fm = new THREE.MeshStandardMaterial({ map: this.tex, alphaTest: 0.5, roughness: 0.92 });
    this.face = mesh(geo('tface', () => new THREE.PlaneGeometry(TARGET_W, TARGET_H).translate(0, TARGET_H / 2, 0)), fm, this.hinge, 0, 0, 0);
    const bm = ctx.backMat;
    const back = mesh(geo('tback', () => new THREE.PlaneGeometry(TARGET_W, TARGET_H).translate(0, TARGET_H / 2, 0)), bm, this.hinge, 0, 0, -0.004);
    back.rotation.y = Math.PI;
    this.mats = [fm];
    if (turner) { this.turnAng = Math.PI / 2; this.turn.rotation.y = this.turnAng; this.triggered = false; }
    else this.turnAng = 0;
    this.fall = 0; this.shake = 0;
    ctx.scene.add(g);
  }

  aimPoint(out) {
    this.face.updateWorldMatrix(true, false);
    return out.set(0, TARGET_H * 0.55, 0).applyMatrix4(this.face.matrixWorld);
  }
  get alive() { return this.hostile && !this.neutralized; }

  raycast(o, d, tMax) {
    if (this.down) return null;
    this.face.updateWorldMatrix(true, false);
    _m.copy(this.face.matrixWorld).invert();
    _ray.origin.copy(o).applyMatrix4(_m);
    _ray.direction.copy(d).transformDirection(_m);
    // let op: transformDirection normaliseert; t omrekenen via punt
    if (Math.abs(_ray.direction.z) < 1e-6) return null;
    const tl = -_ray.origin.z / _ray.direction.z;
    if (tl < 0) return null;
    const lx = _ray.origin.x + _ray.direction.x * tl, ly = _ray.origin.y + _ray.direction.y * tl;
    const u = lx / TARGET_W + 0.5, v = ly / TARGET_H;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const mx = Math.floor(u * this.mw), my = Math.floor((1 - v) * this.mh);
    if (!this.mask[my * this.mw + mx]) return null;
    const wp = new THREE.Vector3(lx, ly, 0).applyMatrix4(this.face.matrixWorld);
    const t = wp.distanceTo(o);
    if (t > tMax) return null;
    const n = new THREE.Vector3(0, 0, Math.sign(_ray.origin.z) || 1).transformDirection(this.face.matrixWorld);
    return { t, actor: this, point: wp, normal: n, u, v, mat: 'cardboard' };
  }

  onHit(h, game) {
    // gat in de print
    const ctx = this.canvas.getContext('2d');
    const x = h.u * this.canvas.width, y = (1 - h.v) * this.canvas.height;
    ctx.fillStyle = 'rgba(60,40,20,0.6)'; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill();
    ctx.fillStyle = '#060606'; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fill();
    this.tex.needsUpdate = true;
    this.shake = 1;
    const head = h.v > 0.79 && Math.abs(h.u - 0.5) < 0.16;
    if (this.hostile) {
      this.hits++;
      if (!this.neutralized && (this.hits >= 2 || head)) {
        this.neutralized = true;
        this.fallT = 0;
        game.onNeutralize(this, head);
        return { kill: true, head };
      }
      return { kill: false, head };
    }
    this.nsHits++;
    game.onNoShoot(this);
    return { kill: false, noShoot: true };
  }

  update(dt, game) {
    if (this.turner && !this.triggered) {
      const p = game.player;
      if (game.regionOfPlayer === this.region || p.pos.distanceTo(this.group.position) < 4.5) { this.triggered = true; this.turnT = 0; game.sound.ui(420); }
    }
    if (this.turner && this.triggered && this.turnAng > 0) {
      this.turnT += dt / 0.4;
      this.turnAng = Math.PI / 2 * (1 - ease(Math.min(1, this.turnT)));
      this.turn.rotation.y = this.turnAng;
    }
    if (this.neutralized) {
      if (!this.down) {
        this.fallT += dt;
        const t = Math.min(1, this.fallT / 0.45);
        this.fall = t;
        this.hinge.rotation.x = -1.45 * t * t;
        if (t >= 1) { this.down = true; this.bounceT = 0; }
      } else if (this.bounceT < 0.5) {
        // klein naveren op de grond
        this.bounceT += dt;
        this.hinge.rotation.x = -1.45 + Math.sin(this.bounceT * 26) * 0.07 * (1 - this.bounceT / 0.5);
      } else this.hinge.rotation.x = -1.45;
    } else if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 4);
      this.hinge.rotation.x = -Math.sin(this.shake * 18) * 0.05 * this.shake;
    }
  }
}

// ---------------- stalen popper ----------------
class Popper {
  constructor(ctx, ent) {
    this.kind = 'popper';
    this.hostile = true;
    this.ent = ent;
    this.region = ent.region;
    this.neutralized = false;
    this.down = false;
    const g = new THREE.Group();
    g.position.set(ent.x, ent.y, ent.z);
    g.rotation.y = ent.yaw;
    this.group = g;
    mesh(geo('pbase', () => new THREE.BoxGeometry(0.42, 0.04, 0.4)), mat(0x2a2b2e, 0.6, 0.6), g, 0, 0.02, 0);
    this.hinge = new THREE.Group();
    this.hinge.position.set(0, 0.06, 0);
    g.add(this.hinge);
    const shape = new THREE.Shape();
    shape.moveTo(-0.15, 0); shape.lineTo(0.15, 0); shape.lineTo(0.1, 0.55); shape.lineTo(0.05, 0.62);
    shape.absarc(0, 0.73, 0.11, -Math.PI / 2 + 0.45, Math.PI * 1.5 - 0.45, false);
    shape.lineTo(-0.05, 0.62); shape.lineTo(-0.1, 0.55); shape.closePath();
    const pg = geo('popper', () => new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 }));
    this.plate = mesh(pg, mat([0xe8e2d6, 0xd9715a][ctx.seed() % 2], 0.55, 0.3), this.hinge, 0, 0, -0.006);
    this.fallT = 0;
    ctx.scene.add(g);
  }
  get alive() { return !this.neutralized; }
  aimPoint(out) { return out.set(0, 0.6, 0).applyMatrix4(this.group.matrixWorld); }
  raycast(o, d, tMax) {
    if (this.down) return null;
    this.hinge.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(0, 0.42, 0).applyMatrix4(this.hinge.matrixWorld);
    const yaw = this.group.rotation.y;
    const b = { cx: p.x, cy: p.y, cz: p.z, hx: 0.13, hy: 0.42, hz: 0.02, c: Math.cos(yaw), s: Math.sin(yaw) };
    if (this.neutralized) return null;
    const t = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, b, tMax);
    if (t < 0) return null;
    const point = new THREE.Vector3().copy(o).addScaledVector(d, t);
    return { t, actor: this, point, normal: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), mat: 'metal' };
  }
  onHit(h, game) {
    if (this.neutralized) return { kill: false };
    this.neutralized = true;
    game.sound.steel(game.panOf(this.group.position), game.distOf(this.group.position));
    game.onNeutralize(this, false);
    return { kill: true };
  }
  update(dt) {
    if (this.neutralized && !this.down) {
      this.fallT += dt;
      const t = Math.min(1, this.fallT / 0.35);
      this.hinge.rotation.x = -1.5 * t * t;
      if (t >= 1) this.down = true;
    }
  }
}

// ---------------- mens ----------------
class Human {
  constructor(ctx, ent, role, opts = {}) {
    this.kind = 'human';
    this.role = role; // suspect | civilian
    this.hostile = role === 'suspect';
    this.ent = ent;
    this.region = ent.region;
    this.R = mulberry(ctx.seed() * 13 + 1);
    this.weaponType = role === 'suspect' ? (opts.rifle ? 'rifle' : 'pistol') : null;
    const h = buildHuman(this.R, role, this.weaponType);
    this.rig = h; this.J = h.J; this.wpn = h.wpn;
    this.group = h.root;
    this.group.position.set(ent.x + (opts.dx || 0), ent.y, ent.z + (opts.dz || 0));
    this.baseYaw = ent.yaw;
    this.baseY = ent.y;
    this.headYaw = 0;
    this.yaw = ent.yaw;
    this.group.rotation.y = this.yaw;
    this.layer = ent.mezz ? 1 : 0;
    this.health = 2;
    this.dead = false;
    this.neutralized = false;
    this.state = 'idle';
    this.alertT = 0; this.fireT = 0; this.burst = 0; this.stagger = 0;
    this.seen = false;
    this.lastSeen = new THREE.Vector3();
    this.losT = this.R() * 0.2;
    this.los = false;
    this.flinch = 0;
    this.deadT = 0;
    this.peeker = !!opts.peeker;
    this.hostage = !!opts.hostage;
    this.isTaker = !!opts.taker;
    this.civPose = opts.pose || 'handsUp';
    this.pose = this.hostile ? (this.weaponType === 'rifle' ? 'lowRifle' : 'lowPistol') : this.civPose;
    this.cur = {};
    for (const n of JOINT_NAMES) { this.cur[n] = PQ[this.pose][n].clone(); this.J[n].quaternion.copy(this.cur[n]); }
    this.hipsY = PQ[this.pose].hipsY;
    this.J.hips.position.y = this.hipsY;
    this.aimBlend = 0;
    this.breath = this.R() * 6;
    this.walk = 0;
    this.peekPhase = 0; this.peekT = 1.5 + this.R() * 2; this.peekSide = 0;
    if (this.peeker) {
      // zijstap loodrecht op kijkrichting, naar een vrije kant
      const sx = Math.cos(this.yaw), sz = -Math.sin(this.yaw);
      const test = (s) => {
        const tx = ent.x + sx * s * 1.0, tz = ent.z + sz * s * 1.0;
        const r = ctx.world.raycast(new THREE.Vector3(ent.x, 1.2, ent.z), new THREE.Vector3(sx * s, 0, sz * s), 1.3);
        return !r && ctx.world.regionAt(tx, tz, 0) === this.region;
      };
      this.peekDir = test(1) ? 1 : test(-1) ? -1 : 0;
      this.home = new THREE.Vector3(ent.x, ent.y, ent.z);
      this.peekVec = new THREE.Vector3(sx * this.peekDir, 0, sz * this.peekDir);
      if (!this.peekDir) this.peeker = false;
    }
    // mondingsvuur
    if (this.wpn) {
      const fm = new THREE.SpriteMaterial({ map: ctx.T.flash, color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 });
      this.flash = new THREE.Sprite(fm);
      this.flash.scale.set(0.32, 0.32, 1);
      this.flash.visible = false;
      this.wpn.muzzle.add(this.flash);
      this.setWeaponPose(0);
    }
    this.ctx = ctx;
    ctx.scene.add(this.group);
    this.headPos = new THREE.Vector3();
    this.chestPos = new THREE.Vector3();
  }

  get alive() { return this.hostile && !this.neutralized; }

  setWeaponPose(a) {
    if (!this.wpn) return;
    const w = WPN[this.weaponType];
    const p = w.low.map((v, i) => v + (w.aim[i] - v) * a);
    this.wpn.g.position.set(p[0], p[1], p[2]);
    this.wpn.g.rotation.set(p[3], 0, 0);
  }

  updateBounds() {
    this.J.head.getWorldPosition(this.headPos);
    this.headPos.y += 0.1;
    this.J.chest.getWorldPosition(this.chestPos);
    this.chestPos.y += 0.05;
  }

  aimPoint(out) { return out.copy(this.chestPos); }

  raycast(o, d, tMax) {
    if (this.dead) return null;
    // hoofd (bol)
    let best = tMax, res = null;
    const hp = this.headPos;
    _v.subVectors(o, hp);
    const b = _v.dot(d), c = _v.lengthSq() - 0.118 * 0.118;
    const disc = b * b - c;
    if (disc > 0) {
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < best) { best = t; res = 'head'; }
    }
    // romp
    const hy = this.group.position.y;
    const top = this.chestPos.y + 0.18, bottom = this.J.hips.getWorldPosition(_v2).y - 0.1;
    const yaw = this.yaw;
    const tb = { cx: (this.chestPos.x + _v2.x) / 2, cy: (top + bottom) / 2, cz: (this.chestPos.z + _v2.z) / 2, hx: 0.2, hy: (top - bottom) / 2, hz: 0.14, c: Math.cos(yaw), s: Math.sin(yaw) };
    let t = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, tb, best);
    if (t >= 0 && t < best) { best = t; res = 'torso'; }
    // benen
    const lb = { cx: _v2.x, cy: hy + (bottom - hy) / 2, cz: _v2.z, hx: 0.17, hy: Math.max(0.05, (bottom - hy) / 2), hz: 0.13, c: Math.cos(yaw), s: Math.sin(yaw) };
    t = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, lb, best);
    if (t >= 0 && t < best) { best = t; res = 'legs'; }
    if (!res) return null;
    const point = new THREE.Vector3().copy(o).addScaledVector(d, best);
    return { t: best, actor: this, point, normal: d.clone().negate(), part: res, mat: 'body' };
  }

  onHit(h, game) {
    if (this.dead) return { kill: false };
    const dmg = h.part === 'head' ? 3 : h.part === 'torso' ? 1 : 1;
    this.health -= dmg;
    this.flinch = 1;
    this.stagger = 0.4;
    game.sound.impact('body', game.panOf(this.group.position), game.distOf(this.group.position));
    if (!this.hostile) {
      this.die(h);
      game.onCivilianHit(this);
      return { kill: false, civ: true };
    }
    // getroffen verdachte wordt meteen alert
    if (this.state === 'idle') { this.state = 'alert'; this.alertT = 0.25; }
    if (this.health <= 0) {
      this.die(h);
      this.neutralized = true;
      game.onNeutralize(this, h.part === 'head');
      return { kill: true, head: h.part === 'head' };
    }
    return { kill: false };
  }

  die(h) {
    this.dead = true;
    this.deadT = 0;
    // val weg van het schot, maar nooit door een wand of reling
    const d = (h && h.dir) ? h.dir : new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const base = Math.atan2(d.x, d.z);
    const o = this.group.position.clone(); o.y += 0.55;
    let pick = base;
    for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
      const a = base + off;
      const r = this.ctx.world.raycast(o, new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), 1.85);
      if (!r) { pick = a; break; }
      pick = null;
    }
    this.crumple = pick === null;
    const local = (pick === null ? base : pick) - this.yaw;
    this.fallDir = new THREE.Vector2(Math.sin(local), Math.cos(local)).normalize();
    this.fallPivot = new THREE.Group();
    if (this.flash) this.flash.material.opacity = 0;
  }

  setPose(name, rate, dt) {
    const tq = PQ[name];
    const k = 1 - Math.exp(-rate * dt);
    for (const n of JOINT_NAMES) {
      this.cur[n].slerp(tq[n], k);
      this.J[n].quaternion.copy(this.cur[n]);
    }
    this.hipsY += (tq.hipsY - this.hipsY) * k;
    this.J.hips.position.y = this.hipsY;
  }

  update(dt, game) {
    this.breath += dt;
    if (this.dead) {
      this.deadT += dt;
      const t = Math.min(1, this.deadT / 0.55);
      const e = t * t;
      this.setPose('dead', 6, dt);
      // kantel het hele lichaam om de voeten, weg van het schot
      const ang = e * Math.PI / 2 * (this.crumple ? 0.3 : 0.94);
      if (this.crumple) this.setPose('cower', 8, dt);
      this.group.rotation.set(this.fallDir.y * ang, this.yaw, -this.fallDir.x * ang, 'YXZ');
      this.group.position.y = this.baseY + e * 0.13;
      this.J.hips.position.y = this.hipsY - Math.min(1, this.deadT / 0.3) * 0.18;
      if (t >= 1 && !this.thudded) { this.thudded = true; game.sound.thud(game.panOf(this.group.position), game.distOf(this.group.position)); }
      return;
    }
    const p = game.player;
    const eye = p.eye;
    this.updateBounds();
    const toP = _v.subVectors(eye, this.headPos);
    const dist = toP.length();
    // zicht (getrapt)
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.14 + this.R() * 0.06;
      let vis = false;
      if (dist < 26 && p.alive) {
        const dir = toP.clone().divideScalar(dist);
        const fwd = Math.sin(this.yaw) * dir.x + Math.cos(this.yaw) * dir.z;
        const inFov = this.state !== 'idle' || fwd > -0.1 || dist < 2.2;
        if (inFov) {
          const hit = game.world.raycast(this.headPos, dir, dist);
          vis = !hit || hit.t > dist - 0.3;
          if (!vis) {
            // ook de borst proberen
            const ch = _v2.copy(eye); ch.y -= 0.45;
            const d2 = ch.sub(this.headPos);
            const l2 = d2.length(); d2.divideScalar(l2);
            const h2 = game.world.raycast(this.headPos, d2, l2);
            vis = !h2 || h2.t > l2 - 0.3;
          }
          // eigen gijzelaar blokkeert niet; andere figuren negeren we
        }
      }
      this.los = vis;
      if (vis) this.lastSeen.copy(eye);
    }
    if (!this.hostile) {
      // burger: kijkt naar de speler, schrikt van schoten
      let want = 0;
      if (this.los) {
        const target = Math.atan2(eye.x - this.group.position.x, eye.z - this.group.position.z);
        want = THREE.MathUtils.clamp(wrap(target - this.yaw), -0.9, 0.9);
      }
      this.headYaw += (want - this.headYaw) * Math.min(1, dt * 4);
      if (game.lastShotT < 0.5 && game.lastShotPos.distanceTo(this.group.position) < 9 && this.civPose === 'handsUp' && !this.hostage && this.R() < dt * 0.6) this.civPose = 'cower';
      this.setPose(this.civPose, 5, dt);
      this.J.neck.quaternion.multiply(_q.setFromAxisAngle(_v2.set(0, 1, 0), this.headYaw));
      if (this.civPose === 'handsUp') {
        const s = Math.sin(this.breath * 9) * 0.02;
        this.J.lEl.rotation.z += s; this.J.rEl.rotation.z -= s;
      }
      this.J.chest.position.y = 0.18 + Math.sin(this.breath * 2.2) * 0.004;
      return;
    }
    // ------ verdachte ------
    const diff = game.diff;
    const heardShot = game.lastShotT < 0.15 && game.lastShotPos.distanceTo(this.group.position) < 13;
    if (this.state === 'idle') {
      if (this.los && dist < 22) { this.state = 'alert'; this.alertT = diff.reaction * (0.85 + this.R() * 0.3); }
      else if (heardShot) { this.state = 'search'; this.alertT = 0; }
    }
    if (this.state === 'search' && this.los) { this.state = 'alert'; this.alertT = diff.reaction * 0.8; }
    // draaien naar de speler (of laatste positie)
    let wantYaw = this.baseYaw;
    if (this.state !== 'idle') {
      const tgt = this.los ? eye : this.lastSeen.lengthSq() > 0 ? this.lastSeen : game.lastShotPos;
      wantYaw = Math.atan2(tgt.x - this.group.position.x, tgt.z - this.group.position.z);
    }
    const dy = wrap(wantYaw - this.yaw);
    const maxTurn = (this.state === 'idle' ? 1.5 : 5.5) * dt;
    this.yaw += THREE.MathUtils.clamp(dy, -maxTurn, maxTurn);
    this.group.rotation.y = this.yaw;
    // peeker beweging
    if (this.peeker && this.state !== 'idle') {
      this.peekT -= dt;
      const out = this.peekPhase === 1;
      if (this.peekT <= 0) {
        this.peekPhase = out ? 0 : 1;
        this.peekT = this.peekPhase ? 1.6 + this.R() * 1.2 : 1.4 + this.R() * 1.5;
      }
      const target = this.peekPhase ? 1 : 0;
      const prev = this.peekSide;
      this.peekSide += THREE.MathUtils.clamp(target - this.peekSide, -dt * 2.2, dt * 2.2);
      this.group.position.copy(this.home).addScaledVector(this.peekVec, this.peekSide * 0.95);
      if (Math.abs(this.peekSide - prev) > 1e-4) this.walk += dt * 9;
    }
    // benen: kleine pas bij bewegen
    const ws = Math.sin(this.walk) * (this.peeker && this.peekSide > 0.02 && this.peekSide < 0.98 ? 0.35 : 0);
    // pose
    const aimPose = this.weaponType === 'rifle' ? 'aimRifle' : 'aimPistol';
    const lowPose = this.weaponType === 'rifle' ? 'lowRifle' : 'lowPistol';
    const aiming = this.state === 'alert' || this.state === 'engage';
    this.setPose(aiming ? aimPose : lowPose, 7, dt);
    this.J.lHip.rotation.x += ws; this.J.rHip.rotation.x -= ws;
    this.aimBlend += ((aiming ? 1 : 0) - this.aimBlend) * Math.min(1, dt * 7);
    this.setWeaponPose(this.aimBlend);
    // richten in hoogte (borst kantelt naar speler)
    if (aiming) {
      const tgt = this.los ? eye : this.lastSeen;
      const hd = Math.hypot(tgt.x - this.chestPos.x, tgt.z - this.chestPos.z);
      const pitch = Math.atan2(tgt.y - 0.25 - this.chestPos.y, hd);
      this.J.chest.quaternion.multiply(_q.setFromAxisAngle(_v2.set(1, 0, 0), -pitch * 0.9));
    }
    // flinch
    if (this.flinch > 0) {
      this.flinch = Math.max(0, this.flinch - dt * 4);
      this.J.spine.quaternion.multiply(_q.setFromAxisAngle(_v2.set(1, 0, 0), -this.flinch * 0.35));
    }
    this.J.chest.position.y = 0.18 + Math.sin(this.breath * 2.4) * 0.005;
    // flash uitdoven
    if (this.flash && this.flash.material.opacity > 0) this.flash.material.opacity = Math.max(0, this.flash.material.opacity - dt * 25);
    if (this.flash) this.flash.visible = this.flash.material.opacity > 0.01;
    if (this.stagger > 0) { this.stagger -= dt; return; }
    // schieten
    if (this.state === 'alert') {
      this.alertT -= dt;
      if (this.alertT <= 0 && Math.abs(dy) < 0.3) { this.state = 'engage'; this.fireT = 0; this.burst = this.weaponType === 'rifle' ? 3 : 1; this.firstShot = true; }
    } else if (this.state === 'engage') {
      if (!this.los) { this.lostT = (this.lostT || 0) + dt; if (this.lostT > 2.5) { this.state = 'search'; this.lostT = 0; } return; }
      this.lostT = 0;
      this.fireT -= dt;
      if (this.fireT <= 0 && Math.abs(dy) < 0.25 && this.aimBlend > 0.8) {
        this.shoot(game, dist);
        if (this.weaponType === 'rifle') {
          this.burst--;
          if (this.burst > 0) this.fireT = 0.1;
          else { this.burst = 2 + Math.floor(this.R() * 3); this.fireT = diff.rifleGap * (0.8 + this.R() * 0.5); }
        } else this.fireT = diff.pistolGap * (0.75 + this.R() * 0.6);
      }
    }
  }

  shoot(game, dist) {
    const p = game.player;
    const muzzle = this.wpn.muzzle.getWorldPosition(new THREE.Vector3());
    let chance = game.diff.accuracy * THREE.MathUtils.clamp(1.2 - dist * 0.035, 0.35, 1.15);
    if (p.speed > 1.2) chance *= 0.65;
    if (p.crouch) chance *= 0.8;
    if (this.firstShot) { chance *= 0.4; this.firstShot = false; this.engageStart = game.clock; }
    // ze schieten zich in: hoe langer ze op je vuren, hoe zuiverder
    chance *= Math.min(1, 0.55 + (game.clock - (this.engageStart || game.clock)) * 0.22);
    const hit = this.R() < chance;
    const aim = p.eye.clone();
    aim.y -= 0.35;
    if (!hit) {
      const right = new THREE.Vector3().subVectors(aim, muzzle).cross(new THREE.Vector3(0, 1, 0)).normalize();
      aim.addScaledVector(right, (this.R() < 0.5 ? -1 : 1) * (0.35 + this.R() * 0.6));
      aim.y += (this.R() - 0.4) * 0.6;
    }
    const dir = aim.clone().sub(muzzle).normalize();
    const w = game.world.raycast(muzzle, dir, 60);
    const end = w ? w.point : muzzle.clone().addScaledVector(dir, 60);
    game.fx.tracer(muzzle, end);
    if (w && !hit) game.fx.impact(w.point, w.normal, w.mat === 'concrete' ? 'concrete' : w.mat, 0);
    this.flash.material.opacity = 1; this.flash.visible = true;
    this.flash.material.rotation = this.R() * 6;
    game.engine.enemyFlash.position.copy(muzzle);
    game.engine.enemyFlash.intensity = 6;
    game.sound.enemyShot(game.panOf(muzzle), dist);
    this.lastShotAt = game.clock;
    if (hit) game.onPlayerHit(this.weaponType === 'rifle' ? game.diff.rifleDmg : game.diff.pistolDmg, muzzle);
    else if (dist > 2) game.sound.whiz(game.panOf(muzzle));
  }
}

function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

// ---------------- manager ----------------
export class Actors {
  constructor(game, world) {
    this.game = game;
    this.world = world;
    this.list = [];
    let seed = world.level.id * 1000;
    const backC = makeBackCanvas();
    const bt = new THREE.CanvasTexture(backC); bt.colorSpace = THREE.SRGBColorSpace;
    const ctx = {
      scene: game.engine.scene, T: game.T, world,
      seed: () => ++seed,
      backMat: new THREE.MeshStandardMaterial({ map: bt, alphaTest: 0.5, roughness: 0.95 }),
    };
    this.ctx = ctx;
    for (const e of world.entities) {
      let a = null;
      switch (e.type) {
        case 'S': a = new Target(ctx, e, 'shoot', false); break;
        case 'N': a = new Target(ctx, e, 'noshoot', false); break;
        case 'R': a = new Target(ctx, e, 'shoot', true); break;
        case 'Q': a = new Target(ctx, e, 'noshoot', true); break;
        case 'O': a = new Popper(ctx, e); break;
        case 'E': a = new Human(ctx, e, 'suspect', {}); break;
        case 'F': a = new Human(ctx, e, 'suspect', { rifle: true }); break;
        case 'G': a = new Human(ctx, e, 'suspect', { peeker: true }); break;
        case 'C': a = new Human(ctx, e, 'civilian', { pose: 'handsUp' }); break;
        case 'c': a = new Human(ctx, e, 'civilian', { pose: 'cower' }); break;
        case 'H': {
          const hostage = new Human(ctx, e, 'civilian', { pose: 'hostage', hostage: true });
          this.list.push(hostage);
          const bx = -Math.sin(e.yaw) * 0.34 + Math.cos(e.yaw) * 0.17, bz = -Math.cos(e.yaw) * 0.34 - Math.sin(e.yaw) * 0.17;
          a = new Human(ctx, e, 'suspect', { taker: true, dx: bx, dz: bz });
          break;
        }
        default: break;
      }
      if (a) this.list.push(a);
    }
    for (const a of this.list) {
      if (a.region) {
        a.region.all.push(a);
        if (a.hostile) a.region.hostiles.push(a);
      }
    }
    this.hostiles = this.list.filter((a) => a.hostile);
    this.civilians = this.list.filter((a) => !a.hostile);
  }

  raycast(o, d, tMax) {
    let best = null;
    for (const a of this.list) {
      const h = a.raycast(o, d, best ? best.t : tMax);
      if (h && (!best || h.t < best.t)) best = h;
    }
    return best;
  }

  update(dt) {
    for (const a of this.list) a.update(dt, this.game);
  }

  // speler niet door figuren en schijfstandaards laten lopen
  pushPlayer(p) {
    for (const a of this.list) {
      if (a.dead || a.down) continue;
      const g = a.group.position;
      if (Math.abs(g.y - p.pos.y) > 1.2) continue;
      const r = a.kind === 'human' ? 0.55 : 0.42;
      const dx = p.pos.x - g.x, dz = p.pos.z - g.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.pos.x += dx / d * (r - d); p.pos.z += dz / d * (r - d);
      }
    }
  }

  // doel voor aim-assist: levende vijandige doelen dichtbij het vizier
  assistTarget(cam, dir, maxAng) {
    let best = null, bestA = maxAng;
    const p = new THREE.Vector3();
    for (const a of this.list) {
      if (!a.alive || (a.kind === 'target' && a.turner && a.turnAng > 0.6)) continue;
      a.aimPoint(p);
      const to = p.clone().sub(cam);
      const dist = to.length();
      if (dist > 30) continue;
      to.divideScalar(dist);
      const ang = Math.acos(THREE.MathUtils.clamp(to.dot(dir), -1, 1));
      const angAdj = ang * (1 + dist * 0.02);
      if (angAdj < bestA) {
        const w = this.world.raycast(cam, to, dist);
        if (w && w.t < dist - 0.4) continue;
        bestA = angAdj; best = { actor: a, point: p.clone(), ang, dist };
      }
    }
    return best;
  }

  dispose() {
    for (const a of this.list) {
      this.game.engine.scene.remove(a.group);
      if (a.tex) a.tex.dispose();
      if (a.mats) a.mats.forEach((m) => m.dispose());
      if (a.flash) a.flash.material.dispose();
      if (a.rig) { a.rig.skinned.geometry.dispose(); a.rig.skinned.skeleton.dispose(); if (a.wpn) a.wpn.mesh.geometry.dispose(); }
    }
    this.ctx.backMat.map.dispose();
    this.ctx.backMat.dispose();
  }
}
