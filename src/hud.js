// HUD: tijd, doel, munitie, kruisdraad, hitmarkers, meldingen en minimap.
import { CELL } from './world.js';

const $ = (id) => document.getElementById(id);

export function fmtTime(s) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(2)}`;
}

export class HUD {
  constructor() {
    this.el = $('hud');
    this.timer = $('timer');
    this.obj = $('objective');
    this.ammo = $('ammoNum');
    this.ammoBar = $('ammoBar');
    this.reloadTag = $('reloadTag');
    this.cross = $('cross');
    this.hm = $('hitmarker');
    this.banner = $('banner');
    this.toasts = $('toasts');
    this.mini = $('minimap');
    this.mctx = this.mini.getContext('2d');
    this.health = $('healthBar');
    this.hmT = 0;
    this.bannerT = 0;
    this.miniT = 0;
    this.lastAmmo = -1;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.mini.width = 150 * dpr; this.mini.height = 150 * dpr;
    this.dpr = dpr;
  }

  show(on) { this.el.classList.toggle('show', on); }

  tapFx(x, y) {
    const d = document.createElement('div');
    d.className = 'tapfx';
    d.style.left = x + 'px'; d.style.top = y + 'px';
    this.el.appendChild(d);
    setTimeout(() => d.remove(), 450);
  }

  setTimer(s, pen) {
    this.timer.innerHTML = fmtTime(s) + (pen > 0 ? `<span class="pen">+${pen}s</span>` : '');
  }

  setObjective(t) { if (this.obj.textContent !== t) this.obj.textContent = t; }

  setAmmo(mag, max, reloading) {
    const key = mag * 10 + (reloading ? 1 : 0);
    if (key === this.lastAmmo) return;
    this.lastAmmo = key;
    this.ammo.textContent = mag;
    this.ammo.classList.toggle('low', mag <= 8);
    this.ammoBar.style.transform = `scaleX(${mag / max})`;
    this.reloadTag.classList.toggle('show', reloading || mag === 0);
    this.reloadTag.textContent = reloading ? 'HERLADEN…' : 'HERLAAD';
  }

  setHealth(h) { this.health.style.transform = `scaleX(${Math.max(0, h) / 100})`; this.health.parentElement.classList.toggle('low', h < 45); }

  setCross(px, ads) {
    this.cross.style.setProperty('--gap', `${Math.max(6, px).toFixed(1)}px`);
    this.cross.classList.toggle('ads', ads > 0.6);
  }

  hitmarker(kill, head) {
    this.hm.classList.remove('show', 'kill', 'head');
    void this.hm.offsetWidth;
    this.hm.classList.add('show');
    if (kill) this.hm.classList.add('kill');
    if (head) this.hm.classList.add('head');
  }

  showBanner(text, sub = '', cls = '') {
    this.banner.innerHTML = `<div class="b-main">${text}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}`;
    this.banner.className = 'show ' + cls;
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { this.banner.className = ''; }, 1900);
  }

  toast(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + cls;
    d.textContent = text;
    this.toasts.appendChild(d);
    setTimeout(() => d.classList.add('out'), 1500);
    setTimeout(() => d.remove(), 2000);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }

  minimap(dt, world, player, actors, now) {
    this.miniT -= dt;
    if (this.miniT > 0) return;
    this.miniT = 0.08;
    const c = this.mctx, S = this.mini.width, dpr = this.dpr;
    const sc = 7.5 * dpr; // px per meter
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); c.clip();
    c.fillStyle = 'rgba(8,10,12,0.62)'; c.fillRect(0, 0, S, S);
    c.translate(S / 2, S / 2);
    c.rotate(player.yaw);
    c.scale(sc, sc);
    c.translate(-player.pos.x, -player.pos.z);
    // ruimtes
    for (const r of world.regions) {
      if (r.mezz) continue;
      if (!r.cleared && r !== world._curRegion) continue;
      c.fillStyle = r.cleared ? 'rgba(80,200,120,0.22)' : 'rgba(255,255,255,0.08)';
      for (const [x, z] of r.cells) c.fillRect(x * CELL, z * CELL, CELL + 0.02, CELL + 0.02);
    }
    if (world.mezz) {
      const m = world.mezz;
      c.strokeStyle = 'rgba(120,170,255,0.55)'; c.lineWidth = 0.08; c.setLineDash([0.3, 0.2]);
      c.strokeRect(m.x0, m.z0, m.x1 - m.x0, m.z1 - m.z0); c.setLineDash([]);
    }
    // wanden
    c.strokeStyle = 'rgba(235,235,235,0.85)'; c.lineWidth = 0.09; c.lineCap = 'round';
    c.beginPath();
    for (const s of world.segs.g) { if (s.key === 'prop') continue; c.moveTo(s.ax, s.az); c.lineTo(s.bx, s.bz); }
    c.stroke();
    // finish
    if (world.finish) {
      c.fillStyle = 'rgba(227,9,19,0.9)';
      c.fillRect(world.finish.x - 0.55, world.finish.z - 0.55, 1.1, 1.1);
    }
    // vijanden die net schoten
    for (const a of actors.list) {
      if (a.kind !== 'human' || !a.hostile || a.dead) continue;
      if (a.lastShotAt && now - a.lastShotAt < 1.6) {
        c.fillStyle = '#ff3b30';
        c.beginPath(); c.arc(a.group.position.x, a.group.position.z, 0.32, 0, Math.PI * 2); c.fill();
      }
    }
    c.restore();
    // speler-pijl
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(S / 2, S / 2 - 9 * dpr); c.lineTo(S / 2 + 6 * dpr, S / 2 + 6 * dpr); c.lineTo(S / 2, S / 2 + 2 * dpr); c.lineTo(S / 2 - 6 * dpr, S / 2 + 6 * dpr);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 2 * dpr;
    c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); c.stroke();
    // noorden
    c.save(); c.translate(S / 2, S / 2); c.rotate(player.yaw);
    c.fillStyle = 'rgba(255,255,255,0.7)'; c.font = `${10 * dpr}px Barlow Condensed, sans-serif`; c.textAlign = 'center';
    c.fillText('N', 0, -S / 2 + 14 * dpr);
    c.restore();
  }
}
