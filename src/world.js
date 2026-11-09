// Bouwt een level: panelen uit het raster, de hal, entresol, trap, props,
// botsing (2D-segmenten per laag) en kogel-raycasts (draaibare boxen).
import * as THREE from 'three';
import { mulberry } from './textures.js';

export const CELL = 1.34;      // hart-op-hart paneelraster RTT-hal
export const WALL_H = 2.44;    // paneelhoogte
const POST = 0.09;
const PT = 0.036;              // paneeldikte incl. regels
const L = CELL - POST;         // paneel tussen palen
const DOOR_W = 0.84, DOOR_H = 2.04;
const WIN_W = 0.64, WIN_LO = 1.02, WIN_HI = 1.7;

// ---------------- geometrie-bouwer ----------------
class GB {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.v = 0; }
  quad(P, N, UV, col) {
    for (let k = 0; k < 4; k++) {
      this.p.push(P[k][0], P[k][1], P[k][2]);
      this.n.push(N[0], N[1], N[2]);
      this.u.push(UV[k][0], UV[k][1]);
      const cc = Array.isArray(col) ? col[k] : col;
      this.c.push(cc, cc, cc);
    }
    const v = this.v;
    this.i.push(v, v + 1, v + 2, v, v + 2, v + 3);
    this.v += 4;
  }
  get empty() { return this.v === 0; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const FACES = {
  '+z': { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  '-z': { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  '+x': { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  '-x': { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  '+y': { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  '-y': { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
};

// box in lokaal frame, gedraaid om Y en verplaatst.
// target(face) -> GB of null; uv(face, lx, ly, lz, wx, wy, wz) -> [u,v]
function box(o) {
  const { cx, cy, cz, sx, sy, sz, rot = 0 } = o;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  for (const f in FACES) {
    const gb = o.target(f);
    if (!gb) continue;
    const F = FACES[f];
    const P = [], UV = [], C = [];
    for (const s of F.v) {
      const lx = s[0] * hx, ly = s[1] * hy, lz = s[2] * hz;
      const wx = cx + lx * cs + lz * sn, wy = cy + ly, wz = cz - lx * sn + lz * cs;
      P.push([wx, wy, wz]);
      UV.push(o.uv ? o.uv(f, lx, ly, lz, wx, wy, wz) : defaultUV(f, lx, ly, lz, wy, sx, sy, sz));
      C.push(o.color === undefined ? 1 : (typeof o.color === 'function' ? o.color(wy) : o.color));
    }
    const N = [F.n[0] * cs + F.n[2] * sn, F.n[1], -F.n[0] * sn + F.n[2] * cs];
    gb.quad(P, N, UV, C);
  }
}
function defaultUV(f, lx, ly, lz, wy, sx, sy, sz) {
  if (f === '+z') return [lx + sx / 2, wy];
  if (f === '-z') return [sx / 2 - lx, wy];
  if (f === '+x') return [sz / 2 - lz, wy];
  if (f === '-x') return [lz + sz / 2, wy];
  return [lx + sx / 2, lz + sz / 2];
}

// shader-patch: contact-AO (vloer via textuur, wanden via hoogte)
function patchAO(mat, kind, ao) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    let head = '#include <common>\nvarying vec3 vWPos;\n';
    let body = '';
    if (kind === 'floor') {
      sh.uniforms.uAO = { value: ao.tex };
      sh.uniforms.uAORect = { value: ao.rect };
      head += 'uniform sampler2D uAO; uniform vec4 uAORect;\n';
      body = `vec2 aouv = (vWPos.xz - uAORect.xy) / uAORect.zw;
        float aov = 1.0;
        if (aouv.x > 0.0 && aouv.x < 1.0 && aouv.y > 0.0 && aouv.y < 1.0) aov = texture2D(uAO, vec2(aouv.x, 1.0 - aouv.y)).r;
        diffuseColor.rgb *= mix(1.0, aov, 0.9);`;
    } else {
      body = `float hb = vWPos.y - ${kind === 'wallHigh' ? '2.84' : '0.0'};
        diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.0, 0.75, hb)) * mix(1.0, 1.06, smoothstep(1.6, 2.44, hb));`;
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', head)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + body);
  };
  mat.customProgramCacheKey = () => 'ao-' + kind;
}

export function whiteColors(g) {
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}

// ray tegen om-Y-gedraaide box
export function rayBox(ox, oy, oz, dx, dy, dz, b, tMax) {
  const px = ox - b.cx, py = oy - b.cy, pz = oz - b.cz;
  const lox = px * b.c - pz * b.s, loz = px * b.s + pz * b.c;
  const ldx = dx * b.c - dz * b.s, ldz = dx * b.s + dz * b.c;
  let t0 = -1e9, t1 = 1e9, ax = -1, sgn = 0;
  const O = [lox, py, loz], D = [ldx, dy, ldz], H = [b.hx, b.hy, b.hz];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(D[k]) < 1e-9) {
      if (O[k] < -H[k] || O[k] > H[k]) return -1;
    } else {
      let ta = (-H[k] - O[k]) / D[k], tb = (H[k] - O[k]) / D[k];
      let s = -1;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; s = 1; }
      if (ta > t0) { t0 = ta; ax = k; sgn = s; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
  }
  if (t0 < 0 || t0 > tMax) return -1;
  b._ax = ax; b._sg = sgn;
  return t0;
}

export class World {
  constructor(engine, T, level) {
    this.engine = engine;
    this.T = T;
    this.level = level;
    this.group = new THREE.Group();
    this.hit = [];
    this.segs = { g: [], st: [], m: [] };
    this.circles = { g: [], m: [] };
    this.lexanPanes = [];
    this.disposables = [];
    this.R = mulberry(level.id * 101 + 7);
    this.parse();
    this.makeMaterials();
    this.buildEdges();
    if (level.mezz) this.buildMezz();
    if (level.stairs) this.buildStairs();
    this.buildProps();
    this.buildMarkings();
    this.buildHall();
    this.buildFloor();
    this.flush();
    engine.scene.add(this.group);
  }

  // ---------------- data ----------------
  parse() {
    const lv = this.level;
    const rows = lv.rooms;
    this.R_ = rows.length; this.C_ = rows[0].length;
    const Rn = this.R_, Cn = this.C_;
    this.W = Cn * CELL; this.D = Rn * CELL;
    const ch = (x, z) => (x < 0 || z < 0 || x >= Cn || z >= Rn) ? ' ' : rows[z][x];
    this.ch = ch;
    const isPaper = (c) => c !== ' ' && c !== '.' && c === c.toUpperCase() && c !== c.toLowerCase();
    const mk = (a, b) => {
      if (a === b) return null;
      if (a === ' ' && b === ' ') return null;
      return { type: 'wall', pA: isPaper(a), pB: isPaper(b) };
    };
    this.hE = []; this.vE = [];
    for (let z = 0; z <= Rn; z++) { this.hE[z] = []; for (let x = 0; x < Cn; x++) this.hE[z][x] = mk(ch(x, z - 1), ch(x, z)); }
    for (let z = 0; z < Rn; z++) { this.vE[z] = []; for (let x = 0; x <= Cn; x++) this.vE[z][x] = mk(ch(x - 1, z), ch(x, z)); }
    const T = { d: 'door', w: 'window', l: 'lexan', o: 'open', x: 'wall', '#': 'wall' };
    for (const e of lv.edges || []) {
      const [xs, zs, side, ty] = e.split(',');
      const x = +xs, z = +zs;
      let ref, arr, ix, iz;
      if (side === 'n') { arr = this.hE; iz = z; ix = x; }
      else if (side === 's') { arr = this.hE; iz = z + 1; ix = x; }
      else if (side === 'w') { arr = this.vE; iz = z; ix = x; }
      else { arr = this.vE; iz = z; ix = x + 1; }
      ref = arr[iz][ix];
      const type = T[ty];
      if (type === 'open') { arr[iz][ix] = { type: 'open' }; continue; }
      if (!ref) ref = arr[iz][ix] = { type: 'wall', pA: false, pB: false };
      ref.type = type;
      if (ty === '#') { ref.pA = ref.pB = true; }
    }
    // regio's
    this.region = [];
    this.regions = [];
    for (let z = 0; z < Rn; z++) this.region[z] = new Array(Cn).fill(-1);
    for (let z = 0; z < Rn; z++) for (let x = 0; x < Cn; x++) {
      if (ch(x, z) === ' ' || this.region[z][x] >= 0) continue;
      const id = this.regions.length;
      const letter = ch(x, z);
      const cells = [];
      const st = [[x, z]];
      this.region[z][x] = id;
      while (st.length) {
        const [cx, cz] = st.pop();
        cells.push([cx, cz]);
        for (const [nx, nz, e] of this.neighbors(cx, cz)) {
          if (ch(nx, nz) !== letter || this.region[nz][nx] >= 0) continue;
          if (e && e.type !== 'open') continue;
          this.region[nz][nx] = id; st.push([nx, nz]);
        }
      }
      this.regions.push({ id, letter, cells, hostiles: [], all: [], cleared: false, entry: null, mezz: false });
    }
    // BFS-afstand vanaf start
    const s = lv.start;
    this.dist = [];
    for (let z = 0; z < Rn; z++) this.dist[z] = new Array(Cn).fill(1e9);
    const q = [[s.x, s.z]];
    this.dist[s.z][s.x] = 0;
    while (q.length) {
      const [cx, cz] = q.shift();
      for (const [nx, nz, e] of this.neighbors(cx, cz)) {
        if (nx < 0 || nz < 0 || nx >= Cn || nz >= Rn || ch(nx, nz) === ' ') continue;
        if (e && !(e.type === 'open' || e.type === 'door')) continue;
        if (this.dist[nz][nx] <= this.dist[cz][cx] + 1) continue;
        this.dist[nz][nx] = this.dist[cz][cx] + 1;
        q.push([nx, nz]);
      }
    }
    // ingang per regio: deur met kleinste afstand aan de buitenkant
    for (const r of this.regions) {
      let best = 1e9, entry = null;
      for (const [cx, cz] of r.cells) {
        if (cx === s.x && cz === s.z) { best = -1; entry = this.cellCenter(cx, cz); }
        for (const [nx, nz, e] of this.neighbors(cx, cz)) {
          if (!e || !(e.type === 'door' || e.type === 'open')) continue;
          if (nx < 0 || nz < 0 || nx >= Cn || nz >= Rn) continue;
          if (this.region[nz][nx] === r.id) continue;
          const dd = this.dist[nz][nx];
          if (dd < best) { best = dd; entry = new THREE.Vector2((cx + nx + 1) / 2 * CELL, (cz + nz + 1) / 2 * CELL); }
        }
      }
      r.entry = entry || this.cellCenter(r.cells[0][0], r.cells[0][1]);
      r.order = best;
      let sx = 0, sz = 0;
      for (const [cx, cz] of r.cells) { sx += cx; sz += cz; }
      r.center = new THREE.Vector2((sx / r.cells.length + 0.5) * CELL, (sz / r.cells.length + 0.5) * CELL);
    }
    // entiteiten
    this.entities = [];
    const dirYaw = { n: Math.PI, s: 0, e: Math.PI / 2, w: -Math.PI / 2 };
    const addEnts = (grid, faces, ox, oz, y, regionFn) => {
      grid.forEach((row, z) => {
        for (let x = 0; x < row.length; x++) {
          const c = row[x];
          if (c === '.' || c === ' ') continue;
          const gx = ox + x, gz = oz + z;
          const reg = regionFn(gx, gz);
          const wx = (gx + 0.5) * CELL, wz = (gz + 0.5) * CELL;
          let yaw;
          const fk = `${gx},${gz}`;
          if (faces && faces[fk]) yaw = dirYaw[faces[fk]];
          else if (reg) { yaw = Math.atan2(reg.entry.x - wx, reg.entry.y - wz); }
          else yaw = 0;
          this.entities.push({ type: c, gx, gz, x: wx, z: wz, y, yaw, region: reg, mezz: y > 0.5 });
        }
      });
    };
    addEnts(lv.ents, lv.face, 0, 0, 0, (x, z) => this.regions[this.region[z][x]]);
    if (lv.mezz) {
      const m = lv.mezz;
      const reg = { id: this.regions.length, letter: '^', cells: [], hostiles: [], all: [], cleared: false, mezz: true };
      for (let z = m.z0; z <= m.z1; z++) for (let x = m.x0; x <= m.x1; x++) reg.cells.push([x, z]);
      const st = lv.stairs;
      reg.entry = new THREE.Vector2((st.x1 + 1) * CELL, (st.z0 + 0.5) * CELL);
      reg.center = new THREE.Vector2((m.x0 + m.x1 + 1) / 2 * CELL, (m.z0 + m.z1 + 1) / 2 * CELL);
      reg.order = 999;
      this.regions.push(reg);
      this.mezzRegion = reg;
      addEnts(m.ents, m.face, m.x0, m.z0, m.h, () => reg);
    }
    // ruimtes nummeren op volgorde van bereikbaarheid
    const sorted = [...this.regions].sort((a, b) => a.order - b.order);
    sorted.forEach((r, i) => { r.num = i + 1; });
    this.start = {
      x: (s.x + 0.5) * CELL, z: (s.z + 0.5) * CELL,
      yaw: { n: 0, e: -Math.PI / 2, s: Math.PI, w: Math.PI / 2 }[s.dir || 'n'],
    };
  }

  neighbors(x, z) {
    return [
      [x, z - 1, this.hE[z] ? this.hE[z][x] : null],
      [x, z + 1, this.hE[z + 1] ? this.hE[z + 1][x] : null],
      [x - 1, z, this.vE[z] ? this.vE[z][x] : null],
      [x + 1, z, this.vE[z] ? this.vE[z][x + 1] : null],
    ];
  }

  cellCenter(x, z) { return new THREE.Vector2((x + 0.5) * CELL, (z + 0.5) * CELL); }

  // ---------------- materialen ----------------
  makeMaterials() {
    const T = this.T;
    const std = (o) => { const m = new THREE.MeshStandardMaterial(o); this.disposables.push(m); return m; };
    this.M = {
      ply: std({ map: T.ply, roughness: 0.8, vertexColors: true }),
      paper: std({ map: T.wallpaper, roughness: 0.9, vertexColors: true }),
      door: std({ color: 0xe8e5dd, roughness: 0.5, vertexColors: true }),
      trim: std({ color: 0xa48a64, roughness: 0.75, metalness: 0, vertexColors: true }),
      lexan: std({ color: 0xd8ecff, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.2, envMapIntensity: 2.2, depthWrite: false }),
      black: std({ color: 0x1b1c1f, roughness: 0.55, metalness: 0.65, map: T.plate, vertexColors: true }),
      steel: std({ color: 0xa4abb2, roughness: 0.45, metalness: 0.6, map: T.steel, vertexColors: true }),
      concreteBeam: std({ color: 0xb9b7b0, roughness: 0.9, map: T.steel, vertexColors: true }),
      blocks: std({ map: T.blocks, roughness: 0.92, vertexColors: true }),
      roof: std({ color: 0x8c9095, roughness: 0.8, metalness: 0.3, map: T.steel, vertexColors: true }),
      mezzTop: std({ color: 0x8e9192, roughness: 0.7, map: T.plate, vertexColors: true }),
      blueRack: std({ color: 0x2f5fb0, roughness: 0.5, metalness: 0.4, vertexColors: true }),
      orangeRack: std({ color: 0xe0661c, roughness: 0.5, metalness: 0.3, vertexColors: true }),
      barrelBlue: std({ color: 0x1e4c9c, roughness: 0.42, vertexColors: true }),
      barrelBlack: std({ color: 0x1a1a1c, roughness: 0.5, vertexColors: true }),
      rubber: std({ color: 0x151516, roughness: 0.92, vertexColors: true }),
      pallet: std({ map: T.ply, color: 0xd8c8a8, roughness: 0.9, vertexColors: true }),
      crate: std({ map: T.ply, color: 0xb59468, roughness: 0.85, vertexColors: true }),
      table: std({ color: 0x5a4636, roughness: 0.6, vertexColors: true }),
      light: std({ color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 3.2, roughness: 1, vertexColors: true }),
      sky: std({ color: 0xeef4ff, emissive: 0xdfe9ff, emissiveIntensity: 1.4, roughness: 1, vertexColors: true }),
      speaker: std({ color: 0x111112, roughness: 0.7, vertexColors: true }),
    };
    this.gb = {};
    for (const k in this.M) this.gb[k] = new GB();
    patchAO(this.M.ply, 'wall');
    patchAO(this.M.paper, 'wall');
    patchAO(this.M.door, 'wall');
  }

  addHit(cx, cy, cz, sx, sy, sz, rot, mat, extra) {
    const b = { cx, cy, cz, hx: sx / 2, hy: sy / 2, hz: sz / 2, c: Math.cos(rot), s: Math.sin(rot), rot, mat };
    if (extra) Object.assign(b, extra);
    this.hit.push(b);
    return b;
  }

  // collision-segment langs lokale x van -a tot b in het frame van een rand
  addSeg(layer, cx, cz, rot, a, b, r, key) {
    const cs = Math.cos(rot), sn = Math.sin(rot);
    this.segs[layer].push({ ax: cx + a * cs, az: cz - a * sn, bx: cx + b * cs, bz: cz - b * sn, r, key });
  }

  // ---------------- panelen ----------------
  buildEdges() {
    const R = this.R;
    const nodes = new Set();
    const variant = () => Math.floor(R() * 4);
    const plyUV = (v, along0, len) => (f, lx, ly, lz, wx, wy) => {
      let u;
      if (f === '+z') u = lx; else if (f === '-z') u = -lx; else if (f === '+x' || f === '-x') u = lz * 2; else u = lx;
      const uu = (u - along0) / L + 0.5;
      const vv = (f === '+y' || f === '-y') ? 0.99 : wy / WALL_H;
      return [(v + Math.min(0.985, Math.max(0.015, uu))) / 4, vv];
    };
    const paperUV = (f, lx, ly, lz, wx, wy) => {
      const u = f === '-z' ? -lx : lx;
      return [(u + 5) / 1.22, wy / 1.22];
    };
    const edgeList = [];
    for (let z = 0; z < this.hE.length; z++) for (let x = 0; x < this.hE[z].length; x++) {
      const e = this.hE[z][x];
      if (e && e.type !== 'open') edgeList.push({ e, cx: (x + 0.5) * CELL, cz: z * CELL, rot: 0, n0: [x, z], n1: [x + 1, z], key: `h${x},${z}` });
    }
    for (let z = 0; z < this.vE.length; z++) for (let x = 0; x < this.vE[z].length; x++) {
      const e = this.vE[z][x];
      if (e && e.type !== 'open') edgeList.push({ e, cx: x * CELL, cz: (z + 0.5) * CELL, rot: Math.PI / 2, n0: [x, z + 1], n1: [x, z], key: `v${x},${z}` });
    }
    this.edgeList = edgeList;
    const nodeHasPerp = (nx, nz, horiz) => {
      // is er een loodrechte wand bij deze knoop?
      if (horiz) {
        return !!((this.vE[nz - 1] && this.vE[nz - 1][nx] && this.vE[nz - 1][nx].type !== 'open') || (this.vE[nz] && this.vE[nz][nx] && this.vE[nz][nx].type !== 'open'));
      }
      return !!((this.hE[nz] && this.hE[nz][nx - 1] && this.hE[nz][nx - 1].type !== 'open') || (this.hE[nz] && this.hE[nz][nx] && this.hE[nz][nx].type !== 'open'));
    };
    for (const E of edgeList) {
      const { e, cx, cz, rot } = E;
      nodes.add(E.n0.join(',')); nodes.add(E.n1.join(','));
      const v = variant();
      const tgtFor = (lo, hi) => (f) => {
        if (f === '+z') return e.pB ? this.gb.paper : this.gb.ply;
        if (f === '-z') return e.pA ? this.gb.paper : this.gb.ply;
        if (f === '-y') return null;
        return this.gb.ply;
      };
      const piece = (x0, x1, y0, y1, depth = PT, mat = null) => {
        const sx = x1 - x0, mx = (x0 + x1) / 2;
        const cs = Math.cos(rot), sn = Math.sin(rot);
        const wx = cx + mx * cs, wz = cz - mx * sn;
        box({
          cx: wx, cy: (y0 + y1) / 2, cz: wz, sx, sy: y1 - y0, sz: depth, rot,
          target: mat ? (f) => (f === '-y' ? null : mat) : tgtFor(),
          uv: (f, lx, ly, lz, ax, ay, az) => {
            if ((f === '+z' && e.pB) || (f === '-z' && e.pA)) return paperUV(f, lx + mx, ly, lz, ax, ay);
            return plyUV(v, 0, L)(f, lx + mx, ly, lz, ax, ay);
          },
          color: 1,
        });
        this.addHit(wx, (y0 + y1) / 2, wz, sx, y1 - y0, depth, rot, 'wood');
      };
      const H0 = 0.02, H1 = WALL_H;
      if (e.type === 'wall') {
        piece(-L / 2, L / 2, H0, H1);
        this.addSeg('g', cx, cz, rot, -CELL / 2, CELL / 2, PT / 2, E.key);
      } else if (e.type === 'door') {
        piece(-L / 2, -DOOR_W / 2, H0, H1);
        piece(DOOR_W / 2, L / 2, H0, H1);
        piece(-DOOR_W / 2, DOOR_W / 2, DOOR_H, H1);
        // kozijn
        const tr = this.gb.trim;
        const cs = Math.cos(rot), sn = Math.sin(rot);
        for (const sx of [-1, 1]) {
          const lx = sx * (DOOR_W / 2 - 0.015);
          box({ cx: cx + lx * cs, cy: DOOR_H / 2, cz: cz - lx * sn, sx: 0.03, sy: DOOR_H, sz: PT + 0.024, rot, target: () => tr, color: 1 });
        }
        box({ cx, cy: DOOR_H - 0.015, cz, sx: DOOR_W, sy: 0.03, sz: PT + 0.024, rot, target: () => tr, color: 1 });
        this.addSeg('g', cx, cz, rot, -CELL / 2, -DOOR_W / 2, PT / 2, E.key);
        this.addSeg('g', cx, cz, rot, DOOR_W / 2, CELL / 2, PT / 2, E.key);
        // deurblad: kies scharnierkant en draairichting zonder botsing
        const horiz = rot === 0;
        const opts = [];
        for (const hs of [-1, 1]) for (const sw of [-1, 1]) {
          const node = hs < 0 ? E.n0 : E.n1;
          const nb = horiz ? [node[0] + (hs < 0 ? -1 : 0), node[1] + (sw < 0 ? -1 : 0)] : [node[0] + (sw < 0 ? -1 : 0), node[1] + (hs < 0 ? 0 : -1)];
          const free = this.ch(nb[0], nb[1]) !== ' ';
          const perp = nodeHasPerp(node[0], node[1], horiz);
          // cel direct naast de deur aan de draaikant: hoe groot is die ruimte?
          const adj = horiz ? [E.n0[0], E.n0[1] + (sw < 0 ? -1 : 0)] : [E.n1[0] + (sw < 0 ? -1 : 0), E.n1[1]];
          const rid = (adj[0] >= 0 && adj[1] >= 0 && adj[0] < this.C_ && adj[1] < this.R_) ? this.region[adj[1]][adj[0]] : -1;
          const big = rid >= 0 && this.regions[rid].cells.length > 4 ? 0.8 : 0;
          opts.push({ hs, sw, score: (free ? 2 : 0) + (perp ? 0 : 1) + big + R() * 0.4 });
        }
        opts.sort((a, b) => b.score - a.score);
        const o = opts[0];
        const folded = o.score >= 3;
        const ang = folded ? 2.9 + R() * 0.15 : 1.75;
        const hx = o.hs * DOOR_W / 2;
        // richting van het blad in lokaal frame: dicht = naar het midden
        const dx0 = -o.hs, a = ang * o.sw;
        const ldx = dx0 * Math.cos(ang), ldz = Math.sin(ang) * o.sw * (o.hs < 0 ? 1 : 1);
        const lcx = hx + ldx * 0.4, lcz = ldz * 0.4 + o.sw * (PT / 2 + 0.02);
        const leafRot = rot + Math.atan2(-ldz, ldx);
        const wx = cx + lcx * cs + lcz * sn, wz = cz - lcx * sn + lcz * cs;
        box({ cx: wx, cy: 1.01, cz: wz, sx: 0.8, sy: 1.98, sz: 0.036, rot: leafRot, target: () => this.gb.door, color: 1 });
        // klink
        const kcs = Math.cos(leafRot), ksn = Math.sin(leafRot);
        for (const side of [-1, 1]) {
          const kx = 0.32, kz = side * 0.035;
          box({ cx: wx + kx * kcs + kz * ksn, cy: 1.02, cz: wz - kx * ksn + kz * kcs, sx: 0.12, sy: 0.025, sz: 0.03, rot: leafRot, target: () => this.gb.steel, color: 1 });
        }
        this.addHit(wx, 1.01, wz, 0.8, 1.98, 0.036, leafRot, 'wood');
        const ex = wx + 0.4 * kcs, ez = wz - 0.4 * ksn, sx2 = wx - 0.4 * kcs, sz2 = wz + 0.4 * ksn;
        if (folded) this.segs.g.push({ ax: sx2, az: sz2, bx: ex, bz: ez, r: 0.02, key: E.key + 'd' });
        void a;
      } else if (e.type === 'window' || e.type === 'lexan') {
        piece(-L / 2, -WIN_W / 2, H0, H1);
        piece(WIN_W / 2, L / 2, H0, H1);
        piece(-WIN_W / 2, WIN_W / 2, H0, WIN_LO);
        piece(-WIN_W / 2, WIN_W / 2, WIN_HI, H1);
        const tr = this.gb.trim;
        box({ cx, cy: WIN_LO + 0.012, cz, sx: WIN_W + 0.04, sy: 0.024, sz: PT + 0.07, rot, target: () => tr, color: 1 });
        if (e.type === 'lexan') {
          box({ cx, cy: (WIN_LO + WIN_HI) / 2, cz, sx: WIN_W, sy: WIN_HI - WIN_LO, sz: 0.008, rot, target: (f) => (f === '+z' || f === '-z') ? this.gb.lexan : null, uv: () => [0, 0], color: 1 });
          this.addHit(cx, (WIN_LO + WIN_HI) / 2, cz, WIN_W, WIN_HI - WIN_LO, 0.01, rot, 'lexan');
          // dunne zwarte rand rond het lexaan
          const cs = Math.cos(rot), sn = Math.sin(rot);
          for (const sx of [-1, 1]) {
            const lx = sx * (WIN_W / 2);
            box({ cx: cx + lx * cs, cy: (WIN_LO + WIN_HI) / 2, cz: cz - lx * sn, sx: 0.025, sy: WIN_HI - WIN_LO, sz: 0.03, rot, target: () => tr, color: 1 });
          }
          box({ cx, cy: WIN_HI - 0.01, cz, sx: WIN_W, sy: 0.025, sz: 0.03, rot, target: () => tr, color: 1 });
        }
        this.addSeg('g', cx, cz, rot, -CELL / 2, CELL / 2, PT / 2, E.key);
      }
    }
    // palen
    for (const k of nodes) {
      const [nx, nz] = k.split(',').map(Number);
      const x = nx * CELL, z = nz * CELL;
      box({ cx: x, cy: (WALL_H + 0.06) / 2, cz: z, sx: POST, sy: WALL_H + 0.06, sz: POST, target: (f) => f === '-y' ? null : this.gb.ply, color: 0.72, uv: (f, lx, ly, lz, wx, wy) => [0.25 + (lx + lz) * 0.4, wy / WALL_H] });
      this.addHit(x, (WALL_H + 0.06) / 2, z, POST, WALL_H + 0.06, POST, 0, 'wood');
      // voetje
      box({ cx: x, cy: 0.012, cz: z, sx: 0.32, sy: 0.024, sz: 0.32, target: (f) => f === '-y' ? null : this.gb.black, color: 1 });
    }
  }

  // ---------------- entresol ----------------
  buildMezz() {
    const m = this.level.mezz;
    const x0 = m.x0 * CELL, x1 = (m.x1 + 1) * CELL, z0 = m.z0 * CELL, z1 = (m.z1 + 1) * CELL, h = m.h;
    this.mezz = { x0, x1, z0, z1, h };
    const T = 0.22;
    // vloerplaat
    box({ cx: (x0 + x1) / 2, cy: h - 0.03, cz: (z0 + z1) / 2, sx: x1 - x0, sy: 0.06, sz: z1 - z0, target: (f) => f === '+y' ? this.gb.mezzTop : this.gb.black, uv: (f, lx, ly, lz) => [lx / 2, lz / 2], color: 1 });
    this.addHit((x0 + x1) / 2, h - T / 2, (z0 + z1) / 2, x1 - x0, T, z1 - z0, 0, 'metal');
    // liggers onder de vloer
    for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / 4) {
      box({ cx: Math.min(Math.max(x, x0 + 0.08), x1 - 0.08), cy: h - 0.06 - 0.12, cz: (z0 + z1) / 2, sx: 0.12, sy: 0.24, sz: z1 - z0, target: (f) => this.gb.black, color: 0.9 });
    }
    for (const z of [z0 + 0.06, z1 - 0.06]) {
      box({ cx: (x0 + x1) / 2, cy: h - 0.17, cz: z, sx: x1 - x0, sy: 0.28, sz: 0.12, target: () => this.gb.black, color: 0.9 });
    }
    // kolommen (net naast de paneellijn)
    const colPos = [[x0 + 0.12, z1 + 0.12], [(x0 + x1) / 2, z1 + 0.12], [x1 - 0.12, z1 + 0.12], [x1 - 0.12, z0 + 0.12]];
    for (const [cx, cz] of colPos) {
      box({ cx, cy: (h - 0.2) / 2, cz, sx: 0.16, sy: h - 0.2, sz: 0.16, target: () => this.gb.black, color: 1 });
      this.addHit(cx, (h - 0.2) / 2, cz, 0.16, h - 0.2, 0.16, 0, 'metal');
      this.circles.g.push({ x: cx, z: cz, r: 0.1 });
    }
    // reling, behalve op de trap-aansluiting
    const st = this.level.stairs;
    const gapZ0 = st.z0 * CELL, gapZ1 = (st.z1 + 1) * CELL;
    const rail = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const rot = Math.atan2(-(bz - az), bx - ax);
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      for (const [yy, th] of [[1.05, 0.05], [0.55, 0.035], [0.08, 0.15]]) {
        box({ cx, cy: h + yy, cz, sx: len, sy: th, sz: 0.04, rot, target: () => this.gb.black, color: 1 });
        this.addHit(cx, h + yy, cz, len, th, 0.04, rot, 'metal');
      }
      const n = Math.max(1, Math.round(len / 1.3));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        box({ cx: px, cy: h + 0.54, cz: pz, sx: 0.05, sy: 1.08, sz: 0.05, target: () => this.gb.black, color: 1 });
        this.addHit(px, h + 0.54, pz, 0.05, 1.08, 0.05, 0, 'metal');
      }
      this.segs.m.push({ ax, az, bx, bz, r: 0.05, key: 'rail' });
    };
    rail(x0, z0, x1, z0);
    rail(x1, z0, x1, z1);
    rail(x0, z1, x1, z1);
    if (gapZ0 > z0) rail(x0, z0, x0, gapZ0);
    if (gapZ1 < z1) rail(x0, gapZ1, x0, z1);
  }

  buildStairs() {
    const s = this.level.stairs, h = this.level.mezz.h;
    const x0 = s.x0 * CELL, x1 = (s.x1 + 1) * CELL, z0 = s.z0 * CELL, z1 = (s.z1 + 1) * CELL;
    this.stairs = { x0, x1, z0, z1, h, dir: s.dir };
    const n = 16;
    const run = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const yTop = (i + 1) * h / n;
      const cx = x0 + run * (i + 0.5);
      box({ cx, cy: yTop - 0.02, cz: (z0 + z1) / 2, sx: run + 0.01, sy: 0.04, sz: z1 - z0 - 0.12, target: (f) => this.gb.black, uv: (f, lx, ly, lz) => [lx * 3, lz * 3], color: f => 1 });
      this.addHit(cx, yTop / 2, (z0 + z1) / 2, run, yTop, z1 - z0 - 0.12, 0, 'metal');
    }
    // trapbomen
    const len = Math.hypot(x1 - x0, h);
    const ang = Math.atan2(h, x1 - x0);
    for (const z of [z0 + 0.05, z1 - 0.05]) {
      const g = whiteColors(new THREE.BoxGeometry(len, 0.22, 0.05));
      const mesh = new THREE.Mesh(g, this.M.black);
      mesh.position.set((x0 + x1) / 2, h / 2 - 0.05, z);
      mesh.rotation.z = ang;
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      this.disposables.push(g);
      // leuning
      const g2 = whiteColors(new THREE.CylinderGeometry(0.02, 0.02, len, 8));
      const rail = new THREE.Mesh(g2, this.M.black);
      rail.position.set((x0 + x1) / 2, h / 2 + 0.95, z);
      rail.rotation.z = ang - Math.PI / 2;
      this.group.add(rail);
      this.disposables.push(g2);
    }
  }

  // hoogte van de vloer onder speler/actor
  floorY(x, z, layer) {
    if (layer === 1) return this.mezz.h;
    if (layer === 2 && this.stairs) {
      const s = this.stairs;
      const t = Math.min(1, Math.max(0, (x - s.x0) / (s.x1 - s.x0)));
      return t * s.h;
    }
    return 0;
  }

  inStairs(x, z) {
    const s = this.stairs;
    return s && x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1;
  }
  inMezz(x, z) {
    const m = this.mezz;
    return m && x > m.x0 && x < m.x1 && z > m.z0 && z < m.z1;
  }

  // laagwissels: 0 grond, 2 trap, 1 entresol
  updateLayer(p) {
    if (!this.stairs) return 0;
    const x = p.pos.x, z = p.pos.z;
    const inS = this.inStairs(x, z);
    if (p.layer === 0 && inS && x < this.stairs.x0 + 0.6) p.layer = 2;
    else if (p.layer === 1 && inS) p.layer = 2;
    else if (p.layer === 2 && !inS) {
      p.layer = (x >= this.stairs.x1 - 0.05 && this.inMezz(x + 0.1, z)) ? 1 : 0;
    }
    return p.layer;
  }

  collide(pos, r, layer) {
    const segs = layer === 1 ? this.segs.m : this.segs.g;
    const skip = layer === 2 ? this.stairsTopKey : null;
    for (let it = 0; it < 3; it++) {
      for (const s of segs) {
        if (skip && s.key === skip) continue;
        const ex = s.bx - s.ax, ez = s.bz - s.az;
        const l2 = ex * ex + ez * ez;
        let t = l2 > 0 ? ((pos.x - s.ax) * ex + (pos.z - s.az) * ez) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = s.ax + ex * t, qz = s.az + ez * t;
        const dx = pos.x - qx, dz = pos.z - qz;
        const d2 = dx * dx + dz * dz, rr = r + s.r;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 1e-4;
          const push = (rr - d);
          pos.x += dx / d * push; pos.z += dz / d * push;
        }
      }
      for (const c of (layer === 1 ? this.circles.m : this.circles.g)) {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const d2 = dx * dx + dz * dz, rr = r + c.r;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 1e-4;
          pos.x += dx / d * (rr - d); pos.z += dz / d * (rr - d);
        }
      }
      if (layer === 2 && this.stairs) {
        const s = this.stairs;
        pos.z = Math.min(s.z1 - r - 0.05, Math.max(s.z0 + r + 0.05, pos.z));
      }
    }
  }

  // kogel/zicht-raycast tegen statische wereld
  raycast(o, d, tMax = 120) {
    let best = tMax, hit = null;
    for (const b of this.hit) {
      const t = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, b, best);
      if (t >= 0 && t < best) { best = t; hit = b; hit._hax = b._ax; hit._hsg = b._sg; }
    }
    // vloer
    if (d.y < -1e-5) {
      const t = (0 - o.y) / d.y;
      if (t > 0 && t < best) {
        return { t, point: new THREE.Vector3(o.x + d.x * t, 0, o.z + d.z * t), normal: new THREE.Vector3(0, 1, 0), mat: 'concrete' };
      }
    }
    if (!hit) return null;
    const n = [0, 0, 0];
    n[hit._hax] = hit._hsg;
    // terug naar wereld
    const nx = n[0] * hit.c + n[2] * hit.s, nz = -n[0] * hit.s + n[2] * hit.c;
    return { t: best, point: new THREE.Vector3(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best), normal: new THREE.Vector3(nx, n[1], nz), mat: hit.mat, box: hit };
  }

  regionAt(x, z, layer) {
    if (layer === 1 && this.mezzRegion) return this.mezzRegion;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (cx < 0 || cz < 0 || cx >= this.C_ || cz >= this.R_) return null;
    const id = this.region[cz][cx];
    return id >= 0 ? this.regions[id] : null;
  }

  // ---------------- props ----------------
  buildProps() {
    const R = this.R;
    for (const en of this.entities) {
      const { type, x, z, y } = en;
      const layer = en.mezz ? 'm' : 'g';
      const rot = R() * Math.PI * 2;
      if (type === 'B') this.barrel(x + (R() - 0.5) * 0.3, y, z + (R() - 0.5) * 0.3, R() < 0.6, layer);
      else if (type === 'K') this.crates(x, y, z, rot, layer);
      else if (type === 'P') this.pallets(x, y, z, rot, layer);
      else if (type === 'Y') this.tires(x, y, z, layer);
      else if (type === 'T') this.table(x, y, z, rot, layer);
    }
  }

  barrel(x, y, z, blue, layer) {
    const gb = blue ? this.gb.barrelBlue : this.gb.barrelBlack;
    const r = 0.29, h = 0.88, seg = 18;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const p = (a, yy, rr) => [x + Math.cos(a) * rr, y + yy, z + Math.sin(a) * rr];
      const prof = [[0, r * 0.96], [0.04, r], [0.28, r], [0.31, r * 1.03], [0.34, r], [0.54, r], [0.57, r * 1.03], [0.6, r], [h - 0.04, r], [h, r * 0.96]];
      for (let k = 0; k < prof.length - 1; k++) {
        const [y0, r0] = prof[k], [y1, r1] = prof[k + 1];
        const am = (a0 + a1) / 2;
        gb.quad([p(a1, y0, r0), p(a0, y0, r0), p(a0, y1, r1), p(a1, y1, r1)], [Math.cos(am), 0, Math.sin(am)], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.85, 0.85, 1, 1].map(c => c * (0.7 + 0.3 * (y0 / h))));
      }
      gb.quad([[x, y + h, z], [x, y + h, z], p(a1, h, r * 0.96), p(a0, h, r * 0.96)], [0, 1, 0], [[0, 0], [0, 0], [1, 0], [1, 1]], 1);
    }
    // vuldoppen
    box({ cx: x + 0.12, cy: y + h + 0.012, cz: z, sx: 0.07, sy: 0.025, sz: 0.07, target: () => gb, color: 0.8 });
    this.addHit(x, y + h / 2, z, r * 1.8, h, r * 1.8, 0, 'plastic');
    this.circles[layer].push({ x, z, r: r + 0.02 });
  }

  crates(x, y, z, rot, layer) {
    const R = this.R;
    const pieces = [[0, 0, 0.82, 0.62, 0.62], [0.05, 0.62, 0.7, 0.5, 0.55], [0.5, 0, 0.5, 0.5, 0.5]];
    const cs = Math.cos(rot), sn = Math.sin(rot);
    for (const [ox, oy, sx, sy, sz] of pieces) {
      if (oy > 0 && R() < 0.3) continue;
      const lx = ox - 0.15, lz = (oy > 0 ? 0 : (ox > 0.4 ? 0.55 : 0)) - 0.2;
      const cx = x + lx * cs + lz * sn, cz = z - lx * sn + lz * cs;
      const rr = rot + (R() - 0.5) * 0.3;
      box({ cx, cy: y + oy + sy / 2, cz, sx, sy, sz, rot: rr, target: () => this.gb.crate, uv: (f, a, b, c, wx, wy) => [(a + c) * 0.25 + 0.3, (wy - y) * 0.4], color: 0.9 });
      // latten
      box({ cx, cy: y + oy + sy - 0.04, cz, sx: sx + 0.02, sy: 0.06, sz: sz + 0.02, rot: rr, target: () => this.gb.crate, color: 0.7, uv: () => [0.1, 0.1] });
      box({ cx, cy: y + oy + 0.04, cz, sx: sx + 0.02, sy: 0.06, sz: sz + 0.02, rot: rr, target: () => this.gb.crate, color: 0.7, uv: () => [0.1, 0.1] });
      this.addHit(cx, y + oy + sy / 2, cz, sx, sy, sz, rr, 'wood');
      // botsing als vier segmenten
      const c2 = Math.cos(rr), s2 = Math.sin(rr);
      const corner = (a, b) => [cx + a * c2 + b * s2, cz - a * s2 + b * c2];
      if (oy === 0) {
        const P = [corner(-sx / 2, -sz / 2), corner(sx / 2, -sz / 2), corner(sx / 2, sz / 2), corner(-sx / 2, sz / 2)];
        for (let i = 0; i < 4; i++) {
          const a = P[i], b = P[(i + 1) % 4];
          this.segs[layer].push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], r: 0.01, key: 'prop' });
        }
      }
    }
  }

  pallets(x, y, z, rot, layer) {
    const n = 3 + Math.floor(this.R() * 4);
    const cs = Math.cos(rot), sn = Math.sin(rot);
    for (let k = 0; k < n; k++) {
      const yb = y + k * 0.144;
      const jit = (this.R() - 0.5) * 0.06;
      const P = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
      for (let i = 0; i < 5; i++) { // bovenlatten
        const lx = -0.5 + i * 0.25 + jit;
        const [cx, cz] = P(lx, 0);
        box({ cx, cy: yb + 0.13, cz, sx: 0.1, sy: 0.022, sz: 0.8, rot, target: () => this.gb.pallet, uv: (f, a, b, c) => [0.6 + a, 0.3 + c * 0.3], color: 0.95 });
      }
      for (const lz of [-0.33, 0, 0.33]) { // blokken + dwarslat
        const [cx, cz] = P(jit, lz);
        box({ cx, cy: yb + 0.1, cz, sx: 1.2, sy: 0.022, sz: 0.1, rot, target: () => this.gb.pallet, uv: (f, a) => [0.3 + a * 0.2, 0.2], color: 0.85 });
        for (const lx of [-0.55, 0, 0.55]) {
          const [bx, bz] = P(lx + jit, lz);
          box({ cx: bx, cy: yb + 0.045, cz: bz, sx: 0.1, sy: 0.09, sz: 0.1, rot, target: () => this.gb.pallet, uv: () => [0.4, 0.2], color: 0.75 });
        }
      }
    }
    const h = n * 0.144;
    this.addHit(x, y + h / 2, z, 1.2, h, 0.8, rot, 'wood');
    const corner = (a, b) => [x + a * cs + b * sn, z - a * sn + b * cs];
    const P = [corner(-0.6, -0.4), corner(0.6, -0.4), corner(0.6, 0.4), corner(-0.6, 0.4)];
    for (let i = 0; i < 4; i++) {
      const a = P[i], b = P[(i + 1) % 4];
      this.segs[layer].push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], r: 0.01, key: 'prop' });
    }
  }

  tires(x, y, z, layer) {
    const n = 3 + Math.floor(this.R() * 2);
    for (let k = 0; k < n; k++) {
      const g = new THREE.TorusGeometry(0.3, 0.11, 10, 24);
      g.rotateX(Math.PI / 2);
      g.scale(1, 0.85, 1);
      const m = new THREE.Mesh(g, this.M.rubber);
      // vertex-kleur nodig voor vertexColors
      const cnt = g.attributes.position.count;
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(cnt * 3).fill(1), 3));
      m.position.set(x + (this.R() - 0.5) * 0.08, y + 0.094 + k * 0.188, z + (this.R() - 0.5) * 0.08);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      this.disposables.push(g);
    }
    this.addHit(x, y + n * 0.094, z, 0.8, n * 0.188, 0.8, 0, 'rubber');
    this.circles[layer].push({ x, z, r: 0.42 });
  }

  table(x, y, z, rot, layer) {
    box({ cx: x, cy: y + 0.74, cz: z, sx: 1.3, sy: 0.04, sz: 0.75, rot, target: () => this.gb.table, color: 1 });
    const cs = Math.cos(rot), sn = Math.sin(rot);
    for (const [a, b] of [[-0.6, -0.32], [0.6, -0.32], [0.6, 0.32], [-0.6, 0.32]]) {
      box({ cx: x + a * cs + b * sn, cy: y + 0.36, cz: z - a * sn + b * cs, sx: 0.05, sy: 0.72, sz: 0.05, rot, target: () => this.gb.black, color: 1 });
    }
    this.addHit(x, y + 0.74, z, 1.3, 0.05, 0.75, rot, 'wood');
    this.circles[layer].push({ x, z, r: 0.5 });
  }

  // START/FINISH-vakken
  buildMarkings() {
    const mk = (x, z, text, col) => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d');
      ctx.strokeStyle = col; ctx.lineWidth = 14;
      ctx.strokeRect(10, 10, 236, 236);
      for (let i = -256; i < 256; i += 36) {
        ctx.strokeStyle = col; ctx.globalAlpha = 0.25; ctx.lineWidth = 10;
        ctx.beginPath(); ctx.moveTo(i, 256); ctx.lineTo(i + 256, 0); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.font = '800 54px "Barlow Condensed", Arial Narrow, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, 128, 128);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
      const g = new THREE.PlaneGeometry(1.1, 1.1);
      g.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, 0.005, z);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.disposables.push(g, m, t);
      return mesh;
    };
    mk(this.start.x, this.start.z, 'START', '#f2f2f2');
    const fin = this.entities.find((e) => e.type === 'X');
    if (fin) {
      this.finish = { x: fin.x, z: fin.z };
      this.finishMesh = mk(fin.x, fin.z, 'FINISH', '#E30913');
    }
  }

  // ---------------- de hal ----------------
  buildHall() {
    const mg = 6.5;
    const X0 = -mg, X1 = this.W + mg, Z0 = -mg, Z1 = this.D + mg;
    this.hall = { X0, X1, Z0, Z1 };
    const HH = 7.4, ROOF = 8.6;
    const g = this.gb;
    // muren van betonblokken
    const wall = (cx, cz, len, rot) => {
      box({ cx, cy: HH / 2, cz, sx: len, sy: HH, sz: 0.3, rot, target: (f) => (f === '+z' ? g.blocks : null), uv: (f, lx, ly, lz, wx, wy) => [lx / 1.6, wy / 1.6], color: (wy) => 0.75 + Math.min(1, wy / 3) * 0.25 });
      this.addHit(cx, HH / 2, cz, len, HH, 0.3, rot, 'concrete');
    };
    wall((X0 + X1) / 2, Z0, X1 - X0, 0);
    wall((X0 + X1) / 2, Z1, X1 - X0, Math.PI);
    wall(X0, (Z0 + Z1) / 2, Z1 - Z0, Math.PI / 2);
    wall(X1, (Z0 + Z1) / 2, Z1 - Z0, -Math.PI / 2);
    // dak + lichtstraten
    box({ cx: (X0 + X1) / 2, cy: ROOF, cz: (Z0 + Z1) / 2, sx: X1 - X0, sy: 0.1, sz: Z1 - Z0, target: (f) => f === '-y' ? g.roof : null, uv: (f, lx, ly, lz) => [lx / 3, lz / 3], color: 0.55 });
    for (let x = X0 + 4; x < X1 - 2; x += 7) {
      box({ cx: x, cy: ROOF - 0.08, cz: (Z0 + Z1) / 2, sx: 1.4, sy: 0.04, sz: Z1 - Z0 - 4, target: (f) => f === '-y' ? g.sky : null, color: 1 });
    }
    // betonnen spanten + stalen kolommen
    for (let z = Z0 + 3; z < Z1 - 1; z += 6.2) {
      box({ cx: (X0 + X1) / 2, cy: 6.6, cz: z, sx: X1 - X0, sy: 0.9, sz: 0.45, target: () => g.concreteBeam, uv: (f, lx, ly, lz, wx, wy) => [lx / 4, wy / 2], color: 0.85 });
      for (const x of [X0 + 0.35, X1 - 0.35]) {
        box({ cx: x, cy: 3.1, cz: z, sx: 0.36, sy: 6.2, sz: 0.36, target: () => g.steel, uv: (f, lx, ly, lz, wx, wy) => [lx + lz, wy / 2], color: (wy) => wy < 0.9 ? 0.9 : 1 });
        // rood-wit aanrijdbeveiliging
        box({ cx: x, cy: 0.45, cz: z, sx: 0.4, sy: 0.9, sz: 0.4, target: () => g.orangeRack, color: 1 });
        // speaker
        box({ cx: x + (x < 0 ? 0.35 : -0.35), cy: 4.6, cz: z + 0.3, sx: 0.32, sy: 0.5, sz: 0.3, rot: 0.3, target: () => g.speaker, color: 1 });
      }
      // gordingen
    }
    for (let x = X0 + 2; x < X1; x += 3.5) {
      box({ cx: x, cy: 7.3, cz: (Z0 + Z1) / 2, sx: 0.12, sy: 0.2, sz: Z1 - Z0, target: () => g.steel, uv: () => [0.2, 0.2], color: 0.6 });
    }
    // TL-armaturen
    for (let x = X0 + 4; x < X1 - 2; x += 4.2) {
      for (let z = Z0 + 4.5; z < Z1 - 2; z += 4.6) {
        box({ cx: x, cy: 6.05, cz: z, sx: 0.22, sy: 0.07, sz: 1.55, target: (f) => (f === '-y' ? g.light : g.steel), uv: () => [0.5, 0.5], color: 1 });
        box({ cx: x, cy: 6.6, cz: z, sx: 0.01, sy: 1.0, sz: 0.01, target: () => g.black, color: 1 });
      }
    }
    // sectiedeuren met ramen (oostkant)
    const doorTex = this.sectionalDoorTex();
    const dm = new THREE.MeshStandardMaterial({ map: doorTex.map, emissiveMap: doorTex.emi, emissive: 0xffffff, emissiveIntensity: 2.6, roughness: 0.6, metalness: 0.2 });
    this.disposables.push(dm, doorTex.map, doorTex.emi);
    const dg = new THREE.PlaneGeometry(4.2, 4.6);
    this.disposables.push(dg);
    for (let z = Z0 + 6; z < Z1 - 4; z += 7) {
      const d = new THREE.Mesh(dg, dm);
      d.position.set(X1 - 0.16, 2.3, z);
      d.rotation.y = -Math.PI / 2;
      this.group.add(d);
      box({ cx: X1 - 0.2, cy: 4.75, cz: z, sx: 0.12, sy: 0.3, sz: 4.6, target: () => g.black, color: 1 });
    }
    // spandoeken met RTT-logo
    const bm = new THREE.MeshStandardMaterial({ map: this.T.banner, roughness: 0.85 });
    const bg = new THREE.PlaneGeometry(5.2, 1.95);
    this.disposables.push(bm, bg);
    const b1 = new THREE.Mesh(bg, bm);
    b1.position.set((X0 + X1) / 2, 4.2, Z0 + 0.17);
    this.group.add(b1);
    const b2 = new THREE.Mesh(bg, bm);
    b2.position.set(X0 + 0.17, 4.2, (Z0 + Z1) / 2);
    b2.rotation.y = Math.PI / 2;
    this.group.add(b2);
    const b3 = new THREE.Mesh(bg, bm);
    b3.position.set((X0 + X1) / 2 + 2, 4.2, Z1 - 0.17);
    b3.rotation.y = Math.PI;
    this.group.add(b3);
    // palletstelling (blauw/oranje) aan de westkant
    const rx = X0 + 1.1;
    for (let z = Z0 + 2; z < Z1 - 2; z += 2.8) {
      for (const dz of [-0.05, 0]) void dz;
      box({ cx: rx - 0.5, cy: 2.2, cz: z, sx: 0.08, sy: 4.4, sz: 0.08, target: () => g.blueRack, color: 1 });
      box({ cx: rx + 0.5, cy: 2.2, cz: z, sx: 0.08, sy: 4.4, sz: 0.08, target: () => g.blueRack, color: 1 });
    }
    for (const y of [1.4, 2.9, 4.3]) {
      for (const dx of [-0.5, 0.5]) {
        box({ cx: rx + dx, cy: y, cz: (Z0 + Z1) / 2, sx: 0.06, sy: 0.12, sz: Z1 - Z0 - 4, target: () => g.orangeRack, color: 1 });
      }
      // lading
      for (let z = Z0 + 3.4; z < Z1 - 3; z += 2.8) {
        if (this.R() < 0.35) continue;
        box({ cx: rx, cy: y + 0.06 + 0.35, cz: z, sx: 0.9, sy: 0.7, sz: 1.1, target: () => g.crate, uv: (f, a, b, c) => [0.3 + a * 0.3, 0.3 + b * 0.3], color: 0.8 });
      }
    }
    // losse tonnen en pallets rond het veld
    const R = this.R;
    for (let k = 0; k < 10; k++) {
      const side = k % 4;
      let x, z;
      if (side === 0) { x = -1.5 - R() * 3; z = R() * this.D; }
      else if (side === 1) { x = this.W + 1.5 + R() * 3; z = R() * this.D; }
      else if (side === 2) { x = R() * this.W; z = -1.5 - R() * 3; }
      else { x = R() * this.W; z = this.D + 1.5 + R() * 3; }
      if (R() < 0.6) this.barrel(x, 0, z, R() < 0.5, 'g'); else this.pallets(x, 0, z, R() * 3, 'g');
    }
    // buitengrens: speler blijft in het veld
  }

  sectionalDoorTex() {
    const W = 256, H = 280;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const e = document.createElement('canvas'); e.width = W; e.height = H;
    const ctx = c.getContext('2d'), etx = e.getContext('2d');
    ctx.fillStyle = '#c9ccce'; ctx.fillRect(0, 0, W, H);
    etx.fillStyle = '#000'; etx.fillRect(0, 0, W, H);
    for (let i = 0; i < 7; i++) {
      const y = i * H / 7;
      ctx.fillStyle = '#9da1a4'; ctx.fillRect(0, y, W, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      for (let k = 0; k < 4; k++) ctx.fillRect(0, y + 8 + k * 9, W, 2);
    }
    // raamstrook
    const wy = H / 7 * 2 + 6, wh = H / 7 - 12;
    for (let k = 0; k < 5; k++) {
      const x = 10 + k * (W - 20) / 5;
      ctx.fillStyle = '#eaf2ff'; ctx.fillRect(x + 3, wy, (W - 20) / 5 - 6, wh);
      etx.fillStyle = '#f2f6ff'; etx.fillRect(x + 3, wy, (W - 20) / 5 - 6, wh);
    }
    const t1 = new THREE.CanvasTexture(c); t1.colorSpace = THREE.SRGBColorSpace;
    const t2 = new THREE.CanvasTexture(e); t2.colorSpace = THREE.SRGBColorSpace;
    return { map: t1, emi: t2 };
  }

  buildFloor() {
    const { X0, X1, Z0, Z1 } = this.hall;
    // AO-textuur van het veld (contactschaduw langs panelen en props)
    const pad = 1.5, ppm = 36;
    const ax0 = -pad, az0 = -pad, aw = this.W + pad * 2, ad = this.D + pad * 2;
    const c = document.createElement('canvas');
    c.width = Math.ceil(aw * ppm); c.height = Math.ceil(ad * ppm);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const toPx = (x, z) => [(x - ax0) * ppm, (z - az0) * ppm];
    ctx.lineCap = 'round';
    const passes = [[30, 0.035], [20, 0.05], [12, 0.08], [6, 0.12], [3, 0.2]];
    for (const [w, a] of passes) {
      ctx.strokeStyle = `rgba(0,0,0,${a})`; ctx.lineWidth = w;
      ctx.beginPath();
      for (const s of this.segs.g) {
        if (s.key === 'rail') continue;
        const [x1, y1] = toPx(s.ax, s.az), [x2, y2] = toPx(s.bx, s.bz);
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      }
      ctx.stroke();
      for (const cc of this.circles.g) {
        const [x, y] = toPx(cc.x, cc.z);
        ctx.fillStyle = `rgba(0,0,0,${a * 1.2})`;
        ctx.beginPath(); ctx.arc(x, y, cc.r * ppm + w / 2, 0, 7); ctx.fill();
      }
    }
    if (this.mezz) {
      const m = this.mezz;
      const [x1, y1] = toPx(m.x0, m.z0), [x2, y2] = toPx(m.x1, m.z1);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    }
    const aoTex = new THREE.CanvasTexture(c);
    aoTex.colorSpace = THREE.NoColorSpace;
    this.disposables.push(aoTex);
    const T = this.T;
    const fm = new THREE.MeshStandardMaterial({ map: T.concrete.map, roughnessMap: T.concrete.rough, normalMap: T.concrete.normal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1, metalness: 0, envMapIntensity: 0.9 });
    patchAO(fm, 'floor', { tex: aoTex, rect: new THREE.Vector4(ax0, az0, aw, ad) });
    const fg = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0);
    fg.rotateX(-Math.PI / 2);
    const uv = fg.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (X1 - X0) / 4, uv.getY(i) * (Z1 - Z0) / 4);
    const floor = new THREE.Mesh(fg, fm);
    floor.position.set((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
    floor.receiveShadow = true;
    this.group.add(floor);
    this.disposables.push(fm, fg);
    this.floorMesh = floor;
  }

  flush() {
    const noShadow = new Set(['light', 'sky', 'lexan', 'roof', 'blocks']);
    const noReceive = new Set(['light', 'sky']);
    for (const k in this.gb) {
      const gb = this.gb[k];
      if (gb.empty) continue;
      const g = gb.geometry();
      const m = new THREE.Mesh(g, this.M[k]);
      m.castShadow = !noShadow.has(k);
      m.receiveShadow = !noReceive.has(k);
      if (k === 'lexan') m.renderOrder = 5;
      this.group.add(m);
      this.disposables.push(g);
    }
    this.gb = null;
    // trap-top segment overslaan als je op de trap staat
    if (this.stairs) {
      const s = this.level.stairs;
      this.stairsTopKey = `v${s.x1 + 1},${s.z0}`;
    }
  }

  dispose() {
    this.engine.scene.remove(this.group);
    for (const d of this.disposables) d.dispose && d.dispose();
    this.group.traverse((o) => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); });
  }
}
