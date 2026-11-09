// Procedurele textures: alles wordt in de browser getekend (geen downloads).
import * as THREE from 'three';

export function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const R = mulberry(seed);
  const P = new Float32Array(256 * 256);
  for (let i = 0; i < P.length; i++) P[i] = R();
  return function (x, y, px, py) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px;
    const y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
    const a = P[y0 * 256 + x0], b = P[y0 * 256 + x1], c = P[y1 * 256 + x0], d = P[y1 * 256 + x1];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function fbm(n, x, y, px, py, oct) {
  let s = 0, amp = 0.5, f = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    s += amp * n(x * f, y * f, px * f, py * f);
    tot += amp; amp *= 0.5; f *= 2;
  }
  return s / tot;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

function heightToNormal(h, w, hh, strength) {
  const c = canvas(w, hh);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, hh);
  const d = img.data;
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w, xr = (x + 1) % w, yu = (y - 1 + hh) % hh, yd = (y + 1) % hh;
      const dx = (h[y * w + xr] - h[y * w + xl]) * strength;
      const dy = (h[yd * w + x] - h[yu * w + x]) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      d[i] = (-dx / len * 0.5 + 0.5) * 255;
      d[i + 1] = (dy / len * 0.5 + 0.5) * 255;
      d[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------- Multiplex paneel: 4 varianten naast elkaar (elk 1,22 x 2,44 m) ----------
function makePlywood() {
  const VW = 384, H = 768, W = VW * 4;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const n1 = makeNoise(11), n2 = makeNoise(23), n3 = makeNoise(37);
  for (let y = 0; y < H; y++) {
    const fy = y / H;
    for (let x = 0; x < W; x++) {
      const fx = x / W;
      const broad = fbm(n1, fx * 16, fy * 4, 64, 4, 4);
      const grain = n2(fx * 520, fy * 9 + broad * 3, 256, 9);
      const fine = n3(fx * 900, fy * 300, 256, 256);
      let t = 0.86 + broad * 0.2 + (grain - 0.5) * 0.09 + (fine - 0.5) * 0.04;
      const i = (y * W + x) * 4;
      d[i] = 222 * t; d[i + 1] = 188 * t; d[i + 2] = 136 * t; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const R = mulberry(5);
  for (let v = 0; v < 4; v++) {
    const ox = v * VW;
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, 0, VW, H); ctx.clip();
    // ingezette "boot"-plugs van berkenmultiplex
    for (let k = 0; k < 4 + v; k++) {
      const px = ox + 30 + R() * (VW - 60), py = 40 + R() * (H - 80);
      ctx.fillStyle = `rgba(${150 + R() * 40},${120 + R() * 30},${80 + R() * 20},0.25)`;
      ctx.beginPath(); ctx.ellipse(px, py, 7 + R() * 5, 18 + R() * 10, 0, 0, Math.PI * 2); ctx.fill();
    }
    // vuil onderaan
    const g = ctx.createLinearGradient(0, H, 0, H - 170);
    g.addColorStop(0, 'rgba(60,45,30,0.42)'); g.addColorStop(1, 'rgba(60,45,30,0)');
    ctx.fillStyle = g; ctx.fillRect(ox, H - 170, VW, 170);
    // schoenschrammen
    for (let k = 0; k < 30; k++) {
      const sx = ox + R() * VW, sy = H - 10 - R() * 150;
      ctx.strokeStyle = `rgba(40,30,20,${0.08 + R() * 0.15})`;
      ctx.lineWidth = 1 + R() * 3;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + (R() - 0.5) * 50, sy + (R() - 0.5) * 8); ctx.stroke();
    }
    // BB-inslagen (airsoft!)
    for (let k = 0; k < 260; k++) {
      const bx = ox + R() * VW;
      const by = H * (0.2 + 0.55 * Math.pow(R(), 0.8));
      ctx.fillStyle = `rgba(70,50,30,${0.25 + R() * 0.35})`;
      ctx.beginPath(); ctx.arc(bx, by, 0.8 + R() * 1.4, 0, Math.PI * 2); ctx.fill();
    }
    // vlekken
    for (let k = 0; k < 3; k++) {
      const sx = ox + R() * VW, sy = R() * H;
      const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 20 + R() * 40);
      rg.addColorStop(0, 'rgba(90,65,40,0.18)'); rg.addColorStop(1, 'rgba(90,65,40,0)');
      ctx.fillStyle = rg; ctx.fillRect(sx - 70, sy - 70, 140, 140);
    }
    // stift-markering op twee varianten
    if (v === 1 || v === 3) {
      ctx.fillStyle = 'rgba(25,25,30,0.55)';
      ctx.font = 'bold 34px "Barlow Condensed", Arial Narrow, sans-serif';
      ctx.fillText(v === 1 ? 'B7' : 'RTT', ox + 40 + R() * 200, 120 + R() * 80);
    }
    // randen van het paneel
    ctx.fillStyle = 'rgba(80,58,32,0.45)';
    ctx.fillRect(ox, 0, 4, H); ctx.fillRect(ox + VW - 4, 0, 4, H);
    ctx.fillStyle = 'rgba(80,58,32,0.3)';
    ctx.fillRect(ox, 0, VW, 3);
    // schroefjes
    ctx.fillStyle = 'rgba(60,60,60,0.7)';
    for (let k = 0; k < 6; k++) {
      const yy = 40 + k * (H - 80) / 5;
      ctx.beginPath(); ctx.arc(ox + 9, yy, 2, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(ox + VW - 9, yy, 2, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  const t = tex(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------- Stenen behang (1,22 x 1,22 m, naadloos) ----------
function makeWallpaper() {
  const S = 768;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const R = mulberry(77);
  ctx.fillStyle = '#2b2724'; ctx.fillRect(0, 0, S, S);
  const rows = [];
  let tot = 0;
  while (tot < S) { const h = 26 + R() * 22; rows.push(h); tot += h; }
  const k = S / tot;
  let y = 0;
  const pal = [[118, 112, 104], [138, 128, 116], [96, 90, 84], [150, 140, 126], [84, 78, 72], [124, 110, 96], [106, 100, 98]];
  for (const rh0 of rows) {
    const rh = rh0 * k;
    let x = -R() * 120;
    while (x < S) {
      const len = 60 + R() * 170;
      const col = pal[Math.floor(R() * pal.length)];
      const jit = (R() - 0.5) * 18;
      for (const off of [0, -S, S]) {
        const x0 = x + off;
        if (x0 > S || x0 + len < 0) continue;
        const gx = 2.5 + R() * 2, gy = 2 + R() * 2;
        const r0 = col[0] + jit, g0 = col[1] + jit, b0 = col[2] + jit;
        const gr = ctx.createLinearGradient(0, y, 0, y + rh);
        gr.addColorStop(0, `rgb(${r0 + 28},${g0 + 26},${b0 + 22})`);
        gr.addColorStop(0.25, `rgb(${r0},${g0},${b0})`);
        gr.addColorStop(1, `rgb(${r0 - 30},${g0 - 30},${b0 - 28})`);
        ctx.fillStyle = gr;
        ctx.beginPath();
        const yy = y + gy, hh = rh - gy * 2, xx = x0 + gx, ww = len - gx * 2;
        ctx.moveTo(xx + 3, yy); ctx.lineTo(xx + ww - 4, yy + R() * 2);
        ctx.lineTo(xx + ww, yy + hh * 0.5); ctx.lineTo(xx + ww - 3, yy + hh);
        ctx.lineTo(xx + 2, yy + hh - R() * 2); ctx.lineTo(xx, yy + hh * 0.4);
        ctx.closePath(); ctx.fill();
      }
      x += len;
    }
    y += rh;
  }
  // structuur
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const n = makeNoise(91);
  for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
    const f = 0.82 + fbm(n, xx / S * 32, yy / S * 32, 32, 32, 3) * 0.36;
    const i = (yy * S + xx) * 4;
    d[i] *= f; d[i + 1] *= f; d[i + 2] *= f;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}

// ---------- Betonvloer (4 x 4 m, naadloos) + ruwheid + normal ----------
function makeConcrete() {
  const S = 1024;
  const c = canvas(S, S), cr = canvas(S, S);
  const ctx = c.getContext('2d'), rtx = cr.getContext('2d');
  const img = ctx.createImageData(S, S), rimg = rtx.createImageData(S, S);
  const d = img.data, rd = rimg.data;
  const h = new Float32Array(S * S);
  const n1 = makeNoise(3), n2 = makeNoise(4), n3 = makeNoise(5);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const fx = x / S, fy = y / S;
    const big = fbm(n1, fx * 6, fy * 6, 6, 6, 5);
    const stain = fbm(n2, fx * 10, fy * 10, 10, 10, 4);
    const sp = n3(fx * 400, fy * 400, 256, 256);
    let t = 0.78 + big * 0.32 + (sp - 0.5) * 0.08;
    let st = Math.max(0, stain - 0.56) * 2.2;
    t *= 1 - st * 0.35;
    const i = (y * S + x) * 4;
    d[i] = 150 * t; d[i + 1] = 148 * t; d[i + 2] = 142 * t; d[i + 3] = 255;
    const rough = 0.62 + big * 0.2 - st * 0.25 + (sp - 0.5) * 0.1;
    rd[i] = 255; rd[i + 1] = Math.max(0, Math.min(1, rough)) * 255; rd[i + 2] = 0; rd[i + 3] = 255;
    h[y * S + x] = sp * 0.25 + big * 0.5;
  }
  ctx.putImageData(img, 0, 0);
  rtx.putImageData(rimg, 0, 0);
  const R = mulberry(9);
  // putjes
  for (let k = 0; k < 900; k++) {
    const x = R() * S, y = R() * S, r = 0.6 + R() * 1.8;
    ctx.fillStyle = `rgba(50,50,48,${0.3 + R() * 0.4})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    const xi = x | 0, yi = y | 0;
    if (xi < S && yi < S) h[yi * S + xi] -= 0.8;
  }
  // banden- en schoensporen
  for (let k = 0; k < 40; k++) {
    ctx.strokeStyle = `rgba(30,30,30,${0.03 + R() * 0.05})`;
    ctx.lineWidth = 4 + R() * 18;
    ctx.beginPath();
    const x = R() * S, y = R() * S;
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + (R() - 0.5) * 400, y + (R() - 0.5) * 400, x + (R() - 0.5) * 400, y + (R() - 0.5) * 400, x + (R() - 0.5) * 600, y + (R() - 0.5) * 600);
    ctx.stroke();
  }
  // zaagsnede
  ctx.fillStyle = 'rgba(35,35,33,0.85)';
  ctx.fillRect(0, 0, S, 3); ctx.fillRect(0, 0, 3, S);
  for (let i = 0; i < S; i++) { h[i] -= 1; h[i * S] -= 1; }
  const nrm = heightToNormal(h, S, S, 2.2);
  const map = tex(c), rough = tex(cr, { srgb: false }), normal = tex(nrm, { srgb: false });
  return { map, rough, normal };
}

// ---------- Betonblokken hal (1,6 x 1,6 m) ----------
function makeBlocks() {
  const S = 512;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9d9c97'; ctx.fillRect(0, 0, S, S);
  const R = mulberry(31);
  const bw = S / 4, bh = S / 8;
  for (let r = 0; r < 8; r++) {
    const off = (r % 2) * bw / 2;
    for (let k = -1; k < 5; k++) {
      const x = k * bw + off, y = r * bh;
      const v = 150 + R() * 30;
      ctx.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
      ctx.fillRect(x + 3, y + 3, bw - 6, bh - 6);
    }
  }
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const n = makeNoise(12);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const f = 0.8 + fbm(n, x / S * 40, y / S * 40, 40, 40, 3) * 0.32;
    const i = (y * S + x) * 4;
    d[i] *= f; d[i + 1] *= f; d[i + 2] *= f;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}

// ---------- Eenvoudige vlakke ruis voor staal en plaat ----------
function makeGrime(seed, base, amt) {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const n = makeNoise(seed);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const f = 1 - amt + fbm(n, x / S * 8, y / S * 8, 8, 8, 5) * amt * 2;
    const i = (y * S + x) * 4;
    d[i] = base[0] * f; d[i + 1] = base[1] * f; d[i + 2] = base[2] * f; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}

// ---------- Kartonnen schijven ----------
// Canvas 300 x 512 = 0,50 x 0,853 m
export const TARGET_W = 0.5, TARGET_H = 0.853;
function ipscPath(ctx, w, h) {
  // IPSC-silhouet: hoofd + achthoekig lijf
  const cx = w / 2;
  const hw = w * 0.14, hTop = h * 0.02, hBot = h * 0.2;
  const bw = w * 0.46, bTop = h * 0.2, sh = h * 0.12, bBot = h * 0.995, ch = h * 0.12;
  ctx.beginPath();
  ctx.moveTo(cx - hw, hTop + 6); ctx.lineTo(cx - hw + 6, hTop); ctx.lineTo(cx + hw - 6, hTop); ctx.lineTo(cx + hw, hTop + 6);
  ctx.lineTo(cx + hw, hBot);
  ctx.lineTo(cx + bw - w * 0.12, bTop); ctx.lineTo(cx + bw, bTop + sh);
  ctx.lineTo(cx + bw, bBot - ch); ctx.lineTo(cx + bw - w * 0.1, bBot);
  ctx.lineTo(cx - bw + w * 0.1, bBot); ctx.lineTo(cx - bw, bBot - ch);
  ctx.lineTo(cx - bw, bTop + sh); ctx.lineTo(cx - bw + w * 0.12, bTop);
  ctx.lineTo(cx - hw, hBot);
  ctx.closePath();
}

function drawPerson(ctx, w, h, kind, R) {
  // half-realistische print van een persoon (taille omhoog)
  const cx = w / 2;
  const skin = ['#c99a7c', '#a87358', '#e2b99c', '#7a4f3a'][Math.floor(R() * 4)];
  const shirts = kind === 'shoot' ? ['#2b2d33', '#3a2f2a', '#23303a', '#4a4a4a'] : ['#3d6b9a', '#9a3d3d', '#d8d2c4', '#4d7a52', '#b08a3a'];
  const shirt = shirts[Math.floor(R() * shirts.length)];
  ctx.save();
  // romp
  const g = ctx.createLinearGradient(cx - 90, 0, cx + 90, 0);
  g.addColorStop(0, shade(shirt, -40)); g.addColorStop(0.5, shirt); g.addColorStop(1, shade(shirt, -55));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - 40, h * 0.2); ctx.quadraticCurveTo(cx - 110, h * 0.23, cx - 118, h * 0.36);
  ctx.lineTo(cx - 112, h); ctx.lineTo(cx + 112, h); ctx.lineTo(cx + 118, h * 0.36);
  ctx.quadraticCurveTo(cx + 110, h * 0.23, cx + 40, h * 0.2); ctx.closePath(); ctx.fill();
  if (kind === 'shoot' && R() < 0.6) { // capuchon
    ctx.fillStyle = shade(shirt, -25);
    ctx.beginPath(); ctx.ellipse(cx, h * 0.205, 58, 20, 0, 0, Math.PI); ctx.fill();
  }
  // nek + hoofd
  ctx.fillStyle = shade(skin, -20);
  ctx.fillRect(cx - 17, h * 0.155, 34, 30);
  const hg = ctx.createRadialGradient(cx - 10, h * 0.09, 6, cx, h * 0.11, 46);
  hg.addColorStop(0, shade(skin, 20)); hg.addColorStop(1, shade(skin, -35));
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.ellipse(cx, h * 0.105, 32, 42, 0, 0, 7); ctx.fill();
  // haar / muts
  ctx.fillStyle = kind === 'shoot' ? '#141414' : ['#2a1c12', '#5a3a1e', '#1a1a1a', '#8a6a3a'][Math.floor(R() * 4)];
  ctx.beginPath(); ctx.ellipse(cx, h * 0.07, 34, 26, 0, Math.PI, 0); ctx.fill();
  if (kind === 'shoot') { // bivakmuts-rand
    ctx.fillRect(cx - 34, h * 0.07, 68, 10);
  }
  // ogen
  ctx.fillStyle = '#1a1210';
  ctx.beginPath(); ctx.ellipse(cx - 11, h * 0.1, 4, 2.5, 0, 0, 7); ctx.ellipse(cx + 11, h * 0.1, 4, 2.5, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = shade(skin, -45); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - 8, h * 0.145); ctx.lineTo(cx + 8, h * 0.145); ctx.stroke();
  // armen + handen
  const armCol = shade(shirt, -15);
  if (kind === 'shoot') {
    // armen naar voren met pistool op de kijker gericht
    ctx.fillStyle = armCol;
    ctx.beginPath(); ctx.moveTo(cx - 100, h * 0.3); ctx.quadraticCurveTo(cx - 70, h * 0.48, cx - 14, h * 0.46);
    ctx.lineTo(cx - 10, h * 0.52); ctx.quadraticCurveTo(cx - 80, h * 0.56, cx - 112, h * 0.42); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + 100, h * 0.3); ctx.quadraticCurveTo(cx + 70, h * 0.48, cx + 14, h * 0.46);
    ctx.lineTo(cx + 10, h * 0.52); ctx.quadraticCurveTo(cx + 80, h * 0.56, cx + 112, h * 0.42); ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.ellipse(cx, h * 0.49, 26, 20, 0, 0, 7); ctx.fill();
    const type = R();
    ctx.fillStyle = '#0d0d0f';
    if (type < 0.7) { // pistool frontaal
      ctx.fillRect(cx - 15, h * 0.395, 30, 44);
      ctx.fillStyle = '#26272b'; ctx.fillRect(cx - 13, h * 0.4, 26, 10);
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(cx, h * 0.41, 5.5, 0, 7); ctx.fill();
    } else { // mes
      ctx.fillStyle = '#c9ccd2';
      ctx.beginPath(); ctx.moveTo(cx - 4, h * 0.46); ctx.lineTo(cx + 4, h * 0.46); ctx.lineTo(cx + 2, h * 0.33); ctx.lineTo(cx - 6, h * 0.36); ctx.fill();
      ctx.fillStyle = '#1b1b1b'; ctx.fillRect(cx - 7, h * 0.46, 14, 26);
    }
  } else {
    const type = R();
    ctx.fillStyle = armCol;
    if (type < 0.5) { // handen open omhoog
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(cx + s * 100, h * 0.3); ctx.quadraticCurveTo(cx + s * 140, h * 0.25, cx + s * 120, h * 0.12);
        ctx.lineTo(cx + s * 98, h * 0.12); ctx.quadraticCurveTo(cx + s * 110, h * 0.25, cx + s * 80, h * 0.36); ctx.fill();
      }
      ctx.fillStyle = skin;
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.ellipse(cx + s * 110, h * 0.085, 18, 26, 0, 0, 7); ctx.fill();
        for (let f = 0; f < 4; f++) { ctx.fillRect(cx + s * 110 - 15 + f * 8, h * 0.03, 6, 22); }
      }
    } else { // telefoon of portemonnee voor de borst
      ctx.beginPath(); ctx.moveTo(cx - 100, h * 0.3); ctx.quadraticCurveTo(cx - 70, h * 0.5, cx - 20, h * 0.48);
      ctx.lineTo(cx - 18, h * 0.54); ctx.quadraticCurveTo(cx - 85, h * 0.58, cx - 112, h * 0.42); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx + 100, h * 0.3); ctx.quadraticCurveTo(cx + 70, h * 0.5, cx + 20, h * 0.48);
      ctx.lineTo(cx + 18, h * 0.54); ctx.quadraticCurveTo(cx + 85, h * 0.58, cx + 112, h * 0.42); ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.ellipse(cx, h * 0.51, 30, 17, 0, 0, 7); ctx.fill();
      if (R() < 0.5) {
        ctx.fillStyle = '#111'; ctx.fillRect(cx - 14, h * 0.42, 28, 50);
        ctx.fillStyle = '#5d8fd0'; ctx.fillRect(cx - 11, h * 0.425, 22, 42);
      } else {
        ctx.fillStyle = '#5a3a22'; ctx.fillRect(cx - 22, h * 0.45, 44, 30);
        ctx.fillStyle = '#e7d9b0'; ctx.fillRect(cx - 18, h * 0.455, 18, 12);
      }
    }
  }
  ctx.restore();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

export function makeTargetCanvas(kind, seed) {
  const w = 300, h = 512;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const R = mulberry(seed * 977 + (kind === 'shoot' ? 1 : 2));
  ctx.save();
  ipscPath(ctx, w, h);
  ctx.clip();
  // karton
  ctx.fillStyle = kind === 'shoot' ? '#c9a676' : '#efece4';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 1600; i++) {
    ctx.fillStyle = `rgba(${kind === 'shoot' ? '120,90,50' : '160,155,140'},${R() * 0.08})`;
    ctx.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 3);
  }
  // print
  ctx.globalAlpha = 0.93;
  drawPerson(ctx, w, h, kind, R);
  ctx.globalAlpha = 1;
  // scoringszones (geperforeerde lijnen)
  ctx.strokeStyle = 'rgba(40,30,20,0.28)';
  ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
  ctx.strokeRect(w / 2 - 45, h * 0.32, 90, h * 0.28);
  ctx.strokeRect(w / 2 - 22, h * 0.05, 44, h * 0.09);
  ctx.setLineDash([]);
  if (kind !== 'shoot') {
    ctx.fillStyle = 'rgba(30,30,30,0.5)';
    ctx.font = 'bold 26px "Barlow Condensed", Arial Narrow, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('NO SHOOT', w / 2, h * 0.96);
  }
  ctx.restore();
  // rand
  ctx.strokeStyle = kind === 'shoot' ? 'rgba(90,65,35,0.9)' : 'rgba(150,145,130,0.9)';
  ctx.lineWidth = 3;
  ipscPath(ctx, w, h); ctx.stroke();
  // masker voor treffers (lage resolutie)
  const mc = canvas(60, 102);
  const mctx = mc.getContext('2d');
  mctx.scale(60 / w, 102 / h);
  ipscPath(mctx, w, h); mctx.fill();
  const md = mctx.getImageData(0, 0, 60, 102).data;
  const mask = new Uint8Array(60 * 102);
  for (let i = 0; i < mask.length; i++) mask[i] = md[i * 4 + 3] > 128 ? 1 : 0;
  return { canvas: c, mask, mw: 60, mh: 102 };
}

export function makeBackCanvas() {
  const w = 150, h = 256;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ipscPath(ctx, w, h); ctx.clip();
  ctx.fillStyle = '#a88a5e'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(80,60,30,0.3)';
  for (let y = 0; y < h; y += 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  return c;
}

// ---------- Decals: 2x2 atlas (hout, beton, karton, metaal) ----------
function makeDecals() {
  const S = 256, H = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const R = mulberry(3);
  const cells = [[0, 0], [H, 0], [0, H], [H, H]];
  cells.forEach(([ox, oy], k) => {
    const cx = ox + H / 2, cy = oy + H / 2;
    if (k === 0) { // hout: splinterkrans
      for (let i = 0; i < 26; i++) {
        const a = R() * Math.PI * 2, l = 16 + R() * 34;
        ctx.strokeStyle = `rgba(240,215,170,${0.5 + R() * 0.4})`; ctx.lineWidth = 2 + R() * 3;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l * 0.6); ctx.stroke();
      }
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 16);
      g.addColorStop(0, 'rgba(10,6,3,1)'); g.addColorStop(0.6, 'rgba(25,15,8,1)'); g.addColorStop(1, 'rgba(60,40,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 16, 0, 7); ctx.fill();
    } else if (k === 1) { // beton: brokkelige chip
      ctx.fillStyle = 'rgba(190,188,182,0.85)';
      ctx.beginPath();
      for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2, r = 18 + R() * 22; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      ctx.closePath(); ctx.fill();
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 14);
      g.addColorStop(0, 'rgba(30,30,30,1)'); g.addColorStop(1, 'rgba(80,80,80,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 14, 0, 7); ctx.fill();
    } else if (k === 2) { // karton: rond gaatje
      ctx.fillStyle = 'rgba(70,50,25,0.65)'; ctx.beginPath(); ctx.arc(cx, cy, 15, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(5,5,5,1)'; ctx.beginPath(); ctx.arc(cx, cy, 10, 0, 7); ctx.fill();
    } else { // metaal: glanzende deuk
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 22);
      g.addColorStop(0, 'rgba(230,230,230,1)'); g.addColorStop(0.5, 'rgba(120,120,120,0.9)'); g.addColorStop(1, 'rgba(60,60,60,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 22, 0, 7); ctx.fill();
    }
  });
  return tex(c, { repeat: false });
}

function radial(size, stops) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) g.addColorStop(p, col);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return c;
}

function makeFlash() {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const R = mulberry(8);
  ctx.translate(S / 2, S / 2);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2 + R() * 0.3, l = 70 + R() * 55;
    const g = ctx.createLinearGradient(0, 0, Math.cos(a) * l, Math.sin(a) * l);
    g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.4, 'rgba(255,170,60,0.8)'); g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a + 0.18) * l * 0.3, Math.sin(a + 0.18) * l * 0.3);
    ctx.lineTo(Math.cos(a) * l, Math.sin(a) * l);
    ctx.lineTo(Math.cos(a - 0.18) * l * 0.3, Math.sin(a - 0.18) * l * 0.3);
    ctx.fill();
  }
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 60);
  g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.3, 'rgba(255,200,110,0.9)'); g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 60, 0, 7); ctx.fill();
  return tex(c, { repeat: false });
}

function makeSmoke() {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const n = makeNoise(44);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x / S - 0.5, dy = y / S - 0.5;
    const r = Math.sqrt(dx * dx + dy * dy) * 2;
    const f = fbm(n, x / S * 6, y / S * 6, 6, 6, 5);
    const a = Math.max(0, 1 - r) ** 1.6 * (0.35 + f * 0.9);
    const i = (y * S + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.min(255, a * 255);
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { repeat: false });
}

// spandoek met RTT-logo voor aan de halmuren
function makeBanner(logoImg) {
  const W = 1024, H = 384;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f3ef'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#E30913'; ctx.fillRect(0, H - 26, W, 26);
  if (logoImg) {
    const lw = 720, lh = lw * logoImg.height / logoImg.width;
    ctx.drawImage(logoImg, (W - lw) / 2, 40, lw, lh);
  }
  ctx.fillStyle = '#111';
  ctx.font = '700 46px "Barlow Condensed", Arial Narrow, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('RUNNING THE TARGET  ·  WE CHANGE YOUR CHALLENGE', W / 2, H - 52);
  // zoompjes en kreukels
  for (let i = 0; i < 8; i++) {
    const g = ctx.createLinearGradient(i * 130, 0, i * 130 + 60, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(i * 130, 0, 60, H);
  }
  return tex(c, { repeat: false });
}

function makeRail() {
  // picatinny / M-LOK-patroon voor het wapen
  const c = canvas(64, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 64, 256);
  ctx.fillStyle = '#2a2a2a';
  for (let y = 4; y < 256; y += 16) ctx.fillRect(0, y, 64, 7);
  return tex(c, { srgb: false });
}

export function loadImage(src) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}

export async function buildTextures(progress) {
  const T = {};
  const steps = [
    ['ply', makePlywood],
    ['wallpaper', makeWallpaper],
    ['concrete', makeConcrete],
    ['blocks', makeBlocks],
    ['steel', () => makeGrime(61, [92, 96, 100], 0.12)],
    ['plate', () => makeGrime(62, [70, 72, 74], 0.18)],
    ['decals', makeDecals],
    ['flash', makeFlash],
    ['smoke', makeSmoke],
    ['rail', makeRail],
  ];
  let i = 0;
  for (const [k, fn] of steps) {
    T[k] = fn();
    i++;
    progress && progress(i / (steps.length + 1));
    await new Promise((r) => setTimeout(r, 0));
  }
  T.dot = tex(radial(64, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]), { repeat: false });
  T.glow = tex(radial(128, [[0, 'rgba(255,255,255,0.9)'], [0.2, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]), { repeat: false });
  T.logoImg = await loadImage('assets/rtt-logo.png');
  T.banner = makeBanner(T.logoImg);
  progress && progress(1);
  return T;
}
