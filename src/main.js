// RTT Target Clear — hoofdlus en spelverloop.
import * as THREE from 'three';
import { Engine } from './engine.js';
import { buildTextures } from './textures.js';
import { LEVELS } from './levels.js';
import { World } from './world.js';
import { Actors } from './actors.js';
import { FX } from './fx.js';
import { Sound } from './audio.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Weapon } from './weapon.js';
import { HUD, fmtTime } from './hud.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('rtt-tc-' + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('rtt-tc-' + k, JSON.stringify(v)); } catch (_) { /* privé-modus */ } },
};

const DIFF = {
  1: { reaction: 1, accuracy: 0, pistolGap: 1, rifleGap: 1, pistolDmg: 0, rifleDmg: 0 },
  2: { reaction: 0.95, accuracy: 0.3, pistolGap: 0.8, rifleGap: 1.35, pistolDmg: 15, rifleDmg: 11 },
  3: { reaction: 0.82, accuracy: 0.34, pistolGap: 0.72, rifleGap: 1.2, pistolDmg: 16, rifleDmg: 12 },
};

class Game {
  constructor() {
    this.state = 'loading';
    this.settings = Object.assign({ sens: 1, quality: 'auto', assist: true, sound: true }, store.get('settings', {}));
    this.best = store.get('best', {});
    this.clock = 0;
    this.lastShotT = 99;
    this.lastShotPos = new THREE.Vector3(0, -99, 0);
    this.canShoot = false;
  }

  async boot() {
    const bar = $('loadBar');
    const setP = (p) => { bar.style.transform = `scaleX(${p})`; };
    this.engine = new Engine($('c'));
    const q = this.settings.quality === 'auto' ? this.autoQuality() : this.settings.quality;
    this.engine.setQuality(q);
    setP(0.05);
    if (document.fonts && document.fonts.ready) { try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]); } catch (_) { /* ok */ } }
    this.T = await buildTextures((p) => setP(0.05 + p * 0.7));
    this.sound = new Sound();
    this.sound.setEnabled(this.settings.sound);
    this.input = new Input($('touch'), $('c'), { sens: this.settings.sens });
    this.input.onUnlock = () => { if (this.state === 'play') this.pause(); };
    this.fx = new FX(this.engine, this.T);
    this.fx.onCasing = () => this.sound.casing();
    this.player = new Player();
    this.weapon = new Weapon(this.engine, this.T, this.sound, this.fx);
    this.hud = new HUD();
    this.adsBtn = document.querySelector('[data-btn=ads]');
    this.crouchBtn = document.querySelector('[data-btn=crouch]');
    setP(0.85);
    this.loadLevel(0);
    // eerste frame (incl. schaduwkaart) tekenen en shaders voorcompileren zodat het eerste schot niet hapert
    this.engine.render(0.016, 0);
    this.engine.renderer.compile(this.engine.vmScene, this.engine.vmCamera);
    setP(1);
    this.bindUI();
    this.renderMenu();
    setTimeout(() => { $('loading').classList.add('hide'); }, 250);
    setTimeout(() => { $('loading').style.display = 'none'; }, 1100);
    this.setState('menu');
    this.last = performance.now();
    const loop = (t) => { requestAnimationFrame(loop); this.frame(t); };
    requestAnimationFrame(loop);
  }

  autoQuality() {
    const mobile = matchMedia('(pointer: coarse)').matches;
    if (!mobile) return 'high';
    const mem = navigator.deviceMemory || 4;
    return mem >= 4 ? 'high' : 'medium';
  }

  // ---------------- levels ----------------
  loadLevel(i) {
    if (this.actors) this.actors.dispose();
    if (this.world) this.world.dispose();
    this.fx.clear();
    this.levelIndex = i;
    this.level = LEVELS[i];
    const lv = this.level;
    this.world = new World(this.engine, this.T, lv);
    this.actors = new Actors(this, this.world);
    this.diff = DIFF[lv.id];
    this.engine.scene.fog = new THREE.FogExp2(lv.smoke ? 0xb9bcbe : 0xa9adb1, lv.fog);
    this.engine.scene.background = new THREE.Color(lv.smoke ? 0xb9bcbe : 0x8d939a);
    this.engine.fitShadow(-1, -1, this.world.W + 1, this.world.D + 1);
    this.fx.setSmoke(this.world, lv.smoke);
    this.resetRun();
  }

  resetRun() {
    const s = this.world.start;
    this.player.spawn(s.x, s.z, s.yaw);
    this.weapon.reset();
    this.input.reset();
    this.time = 0;
    this.penalty = 0;
    this.hits = 0;
    this.noShoots = 0;
    this.civHits = 0;
    this.kills = 0;
    this.heads = 0;
    this.finished = false;
    this.lastShotT = 99;
    this.damageTaken = 0;
    this.endT = 0;
    const shootables = this.actors.hostiles;
    this.totalHostile = shootables.length;
    this.downHostile = 0;
    this.rooms = this.world.regions.filter((r) => r.hostiles.length > 0);
    for (const r of this.world.regions) r.cleared = false;
    this.roomsCleared = 0;
    this.regionOfPlayer = null;
  }

  restartLevel() {
    // alles opnieuw opbouwen zodat schijven en figuren weer staan
    this.loadLevel(this.levelIndex);
  }

  // ---------------- schieten ----------------
  fireShot(origin, dir) {
    this.lastShotT = 0;
    this.lastShotPos.copy(origin);
    const w = this.world.raycast(origin, dir, 150);
    const a = this.actors.raycast(origin, dir, w ? w.t : 150);
    if (a) {
      a.dir = dir;
      const res = a.actor.onHit(a, this) || {};
      this.fx.impact(a.point, a.normal, a.mat, this.player.floorY, true);
      if (a.mat === 'cardboard') this.sound.impact('cardboard', this.panOf(a.point), this.distOf(a.point));
      if (a.actor.hostile) {
        this.hits++;
        this.hud.hitmarker(res.kill, res.head);
        this.sound.hitmarker(res.kill);
      }
    } else if (w) {
      this.fx.impact(w.point, w.normal, w.mat, 0);
      this.sound.impact(w.mat, this.panOf(w.point), this.distOf(w.point));
    }
  }

  panOf(p) {
    const cam = this.engine.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const to = new THREE.Vector3().subVectors(p, cam.position).normalize();
    return right.dot(to);
  }
  distOf(p) { return this.engine.camera.position.distanceTo(p); }

  // ---------------- spel-callbacks ----------------
  onNeutralize(a, head) {
    this.downHostile++;
    if (a.kind === 'human') { this.kills++; if (head) this.heads++; }
    const r = a.region;
    if (r && !r.cleared && r.hostiles.every((h) => h.neutralized)) {
      r.cleared = true;
      this.roomsCleared++;
      const name = r.mezz ? 'ENTRESOL' : r.letter === '.' ? 'VELD' : `KAMER ${this.roomLabel(r)}`;
      this.hud.showBanner(`${name} CLEAR`, `${this.roomsCleared} / ${this.rooms.length}`, 'ok');
      setTimeout(() => this.sound.clear(), 120);
    }
    if (this.level.mode === 'combat' && this.downHostile >= this.totalHostile && !this.finished) {
      this.finished = true;
      this.endT = 1.4;
      this.hud.showBanner('ALLES CLEAR', 'Alle verdachten uitgeschakeld', 'ok big');
    }
  }

  roomLabel(r) {
    const idx = this.rooms.indexOf(r);
    return idx >= 0 ? idx + 1 : r.num;
  }

  onNoShoot() {
    this.noShoots++;
    this.penalty += 10;
    this.hud.toast('NO-SHOOT GERAAKT  +10 s', 'bad');
    this.sound.fail();
  }

  onCivilianHit(a) {
    this.civHits++;
    this.penalty += 15;
    if (a.hostage) { this.fail('Gijzelaar geraakt'); return; }
    this.hud.toast(`BURGER GERAAKT  +15 s  (${this.civHits}/3)`, 'bad');
    this.sound.fail();
    if (this.civHits >= 3) this.fail('Te veel burgers geraakt');
  }

  onPlayerHit(dmg, from) {
    if (this.state !== 'play' || this.finished) return;
    this.player.damage(dmg);
    this.damageTaken += dmg;
    this.sound.hurt();
    // richting voor de rode rand
    const cam = this.engine.camera;
    const to = new THREE.Vector3().subVectors(from, cam.position);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const x = to.dot(right), y = to.dot(fwd);
    const v = new THREE.Vector2(x, y).normalize();
    this.engine.grade.uniforms.uHitDir.value.set(v.x, v.y);
    this.hitAmt = 1;
    if (!this.player.alive) this.fail('Je bent geraakt en uitgeschakeld');
  }

  fail(reason) {
    if (this.state !== 'play') return;
    this.finished = true;
    this.failed = reason;
    this.endT = 1.6;
    this.sound.fail();
    this.hud.showBanner('MISSIE MISLUKT', reason, 'bad big');
  }

  // ---------------- toestanden ----------------
  setState(s) {
    this.state = s;
    document.body.dataset.state = s;
    const play = s === 'play' || s === 'countdown';
    this.hud.show(play);
    this.engine.vmScene.visible = play;
    this.input.setEnabled(s === 'play' || s === 'countdown');
    $('menu').classList.toggle('show', s === 'menu');
    $('brief').classList.toggle('show', s === 'brief');
    $('pause').classList.toggle('show', s === 'pause');
    $('result').classList.toggle('show', s === 'result');
    $('touch').classList.toggle('show', play && this.input.touch);
    this.canShoot = s === 'play';
  }

  startBrief(i) {
    this.sound.unlock();
    this.tryFullscreen();
    if (i !== this.levelIndex) this.loadLevel(i);
    else this.restartLevel();
    const lv = this.level;
    $('briefCode').textContent = `LEVEL ${lv.id}`;
    $('briefName').textContent = lv.name;
    $('briefSub').textContent = lv.sub;
    $('briefText').textContent = lv.brief;
    $('briefRules').innerHTML = lv.rules.map((r) => `<li>${r}</li>`).join('');
    const hostiles = this.actors.hostiles.length, civ = this.actors.civilians.length;
    $('briefStats').innerHTML = lv.mode === 'targets'
      ? `<div><b>${hostiles}</b><span>shoot</span></div><div><b>${this.actors.list.filter((a) => a.kind === 'target' && !a.hostile).length}</b><span>no-shoot</span></div><div><b>${this.rooms.length}</b><span>kamers</span></div>`
      : `<div><b>${hostiles}</b><span>verdachten</span></div><div><b>${civ}</b><span>burgers</span></div><div><b>${this.rooms.length}</b><span>ruimtes</span></div>`;
    $('briefControls').innerHTML = this.input.touch
      ? 'Links slepen: lopen · Rechts slepen: kijken · Vuurknop ook slepen om te richten · Vizier = richten'
      : 'WASD lopen · Muis kijken · Linkerknop vuren · Rechterknop richten · R herladen · C hurken · Esc pauze';
    const b = this.best[lv.code];
    $('briefBest').textContent = b ? `Beste: ${fmtTime(b.t)}  (${b.g})` : 'Nog geen tijd gezet';
    this.setState('brief');
  }

  beginRun() {
    this.sound.unlock();
    this.setState('countdown');
    this.input.requestLock();
    const s = this.world.start;
    this.player.spawn(s.x, s.z, s.yaw);
    this.cd = this.level.mode === 'targets' ? 1.6 + Math.random() * 1.4 : 1.2;
    this.hud.showBanner(this.level.mode === 'targets' ? 'STANDBY' : this.level.name, this.level.mode === 'targets' ? 'Wacht op de piep' : 'Ga!', '');
    this.fade = 1;
  }

  pause() {
    if (this.state !== 'play') return;
    this.setState('pause');
  }
  resume() {
    this.setState('play');
    this.input.requestLock();
  }

  finishRun() {
    const lv = this.level;
    let missed = 0;
    if (lv.mode === 'targets') {
      missed = this.actors.hostiles.filter((a) => !a.neutralized).length;
      this.penalty += missed * 5;
    }
    const total = this.time + this.penalty;
    const failed = !!this.failed;
    let grade = 'D';
    if (!failed) {
      const p = lv.par;
      grade = total <= p[0] ? 'S' : total <= p[1] ? 'A' : total <= p[2] ? 'B' : total <= p[3] ? 'C' : 'D';
    }
    const prev = this.best[lv.code];
    let isBest = false;
    if (!failed && (!prev || total < prev.t)) {
      this.best[lv.code] = { t: total, g: grade };
      store.set('best', this.best);
      isBest = true;
    }
    const acc = this.weapon.shots ? Math.round(this.hits / this.weapon.shots * 100) : 0;
    $('resTitle').textContent = failed ? 'MISSIE MISLUKT' : lv.mode === 'targets' ? 'PARCOURS VOLTOOID' : 'MISSIE GESLAAGD';
    $('resTitle').className = failed ? 'bad' : 'ok';
    $('resReason').textContent = failed ? this.failed : (isBest ? 'Nieuw persoonlijk record!' : `${lv.name} · LEVEL ${lv.id}`);
    $('resGrade').textContent = failed ? '–' : grade;
    $('resGrade').className = 'grade g' + grade;
    $('resTime').textContent = fmtTime(total);
    const rows = [
      ['Looptijd', fmtTime(this.time)],
      ['Strafseconden', `+${this.penalty} s`],
      ['Trefzekerheid', `${acc}%  (${this.hits}/${this.weapon.shots})`],
    ];
    if (lv.mode === 'targets') {
      rows.push(['Shoot geraakt', `${this.downHostile} / ${this.totalHostile}`]);
      rows.push(['Gemist', `${missed}  (+${missed * 5} s)`]);
      rows.push(['No-shoots', `${this.noShoots}  (+${this.noShoots * 10} s)`]);
    } else {
      rows.push(['Verdachten', `${this.downHostile} / ${this.totalHostile}`]);
      rows.push(['Headshots', `${this.heads}`]);
      rows.push(['Burgers geraakt', `${this.civHits}`]);
      rows.push(['Schade opgelopen', `${Math.round(this.damageTaken)}`]);
    }
    rows.push(['Kamers clear', `${this.roomsCleared} / ${this.rooms.length}`]);
    $('resRows').innerHTML = rows.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
    const p = lv.par;
    $('resPar').innerHTML = `S ≤ ${p[0]}s · A ≤ ${p[1]}s · B ≤ ${p[2]}s · C ≤ ${p[3]}s`;
    $('btnNext').style.display = !failed && this.levelIndex < LEVELS.length - 1 ? '' : 'none';
    if (failed) this.sound.fail(); else this.sound.win();
    this.setState('result');
    this.renderMenu();
  }

  // ---------------- UI ----------------
  bindUI() {
    const tap = (id, fn) => $(id).addEventListener('click', (e) => { e.preventDefault(); this.sound.unlock(); this.sound.ui(); fn(e); });
    tap('btnBriefStart', () => this.beginRun());
    tap('btnBriefBack', () => { this.setState('menu'); });
    tap('btnResume', () => this.resume());
    tap('btnRestart', () => this.startBrief(this.levelIndex));
    tap('btnQuit', () => { this.setState('menu'); });
    tap('btnRetry', () => this.startBrief(this.levelIndex));
    tap('btnNext', () => this.startBrief(this.levelIndex + 1));
    tap('btnMenu', () => { this.setState('menu'); });
    tap('btnSettings', () => this.openSettings());
    tap('btnPauseSettings', () => this.openSettings());
    tap('btnSettingsClose', () => this.closeSettings());
    const sens = $('setSens'), qual = $('setQuality'), assist = $('setAssist'), snd = $('setSound');
    sens.value = this.settings.sens;
    qual.value = this.settings.quality;
    assist.checked = this.settings.assist;
    snd.checked = this.settings.sound;
    $('sensVal').textContent = Number(this.settings.sens).toFixed(2);
    sens.addEventListener('input', () => { this.settings.sens = +sens.value; this.input.sens = +sens.value; $('sensVal').textContent = (+sens.value).toFixed(2); this.saveSettings(); });
    qual.addEventListener('change', () => { this.settings.quality = qual.value; this.engine.setQuality(qual.value === 'auto' ? this.autoQuality() : qual.value); this.saveSettings(); });
    assist.addEventListener('change', () => { this.settings.assist = assist.checked; this.saveSettings(); });
    snd.addEventListener('change', () => { this.settings.sound = snd.checked; this.sound.setEnabled(snd.checked); this.saveSettings(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
    const checkOrient = () => {
      const portrait = this.input.touch && window.innerHeight > window.innerWidth;
      document.body.classList.toggle('portrait', portrait);
      if (portrait) this.pause();
    };
    window.addEventListener('resize', checkOrient);
    checkOrient();
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    $('a2hs').style.display = ios && !standalone ? '' : 'none';
  }

  saveSettings() { store.set('settings', this.settings); }
  openSettings() { $('settings').classList.add('show'); }
  closeSettings() { $('settings').classList.remove('show'); }

  tryFullscreen() {
    const el = document.documentElement;
    if (this.input.touch && !document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      }).catch(() => {});
    }
  }

  renderMenu() {
    const list = $('levelList');
    list.innerHTML = '';
    LEVELS.forEach((lv, i) => {
      const b = this.best[lv.code];
      const card = document.createElement('button');
      card.className = 'lvl';
      card.innerHTML = `
        <div class="lvl-num">0${lv.id}</div>
        <div class="lvl-body">
          <div class="lvl-name">${lv.name}</div>
          <div class="lvl-sub">${lv.sub}</div>
        </div>
        <div class="lvl-best">${b ? `<span class="g g${b.g}">${b.g}</span>${fmtTime(b.t)}` : '<span class="new">NIEUW</span>'}</div>`;
      card.addEventListener('click', () => { this.sound.unlock(); this.sound.ui(); this.startBrief(i); });
      list.appendChild(card);
    });
  }

  // ---------------- lus ----------------
  // handmatig frames doorstappen (testen in een achtergrondtab)
  step(n = 1, ms = 1000 / 60) { for (let i = 0; i < n; i++) this.frame(this.last + ms); }

  frame(t) {
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) return;
    this.clock += dt;
    const E = this.engine;
    const cam = E.camera;
    const st = this.state;
    if (st === 'menu' || st === 'brief' || st === 'loading') {
      // cinematische camera boven de opbouw
      const W = this.world.W, D = this.world.D;
      const a = this.clock * 0.06;
      const R = Math.max(W, D) * 0.62 + 3;
      cam.position.set(W / 2 + Math.cos(a) * R, 5.6 + Math.sin(this.clock * 0.13) * 0.4, D / 2 + Math.sin(a) * R);
      cam.lookAt(W / 2, 0.6, D / 2);
      cam.fov = 58; cam.updateProjectionMatrix();
      this.fx.update(dt, cam);
      E.grade.uniforms.uDamage.value = 0;
      E.grade.uniforms.uHitAmt.value = 0;
      E.grade.uniforms.uFade.value = 0;
    } else if (st === 'countdown' || st === 'play') {
      const inp = this.input.consume();
      if (inp.pause && st === 'play') { this.pause(); }
      const live = st === 'play' && !this.finished;
      // aim-assist (alleen touch)
      let assist = null;
      if (this.input.touch && this.settings.assist && live) {
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        const tgt = this.actors.assistTarget(cam.position, dir, 0.16);
        if (tgt) {
          assist = { friction: 0.5 + Math.min(0.5, tgt.ang / 0.16 * 0.5) };
          const moving = Math.hypot(inp.moveX, inp.moveY) > 0.2 || inp.fire;
          if (moving && tgt.ang > 0.004) {
            const to = tgt.point.clone().sub(cam.position);
            const wantYaw = Math.atan2(-to.x, -to.z);
            const wantPitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
            let dy = wantYaw - this.player.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
            const dp = wantPitch - this.player.pitch;
            const k = Math.min(1, dt * 2.6);
            assist.pull = { yaw: dy * k, pitch: dp * k * 0.7 };
          }
        }
      }
      const pin = st === 'countdown' ? { ...inp, moveX: 0, moveY: 0, fire: false } : inp;
      this.player.update(dt, pin, this.world, this.weapon, this.sound, assist);
      this.actors.pushPlayer(this.player);
      this.world.collide(this.player.pos, this.player.radius, this.player.layer);
      this.player.eye.x = this.player.pos.x; this.player.eye.z = this.player.pos.z;
      this.weapon.update(dt, live ? inp : { ...inp, fire: false, reload: false }, this.player, this);
      if (live) this.time += dt;
      this.lastShotT += dt;
      // regio van de speler
      const reg = this.world.regionAt(this.player.pos.x, this.player.pos.z, this.player.layer);
      if (reg !== this.regionOfPlayer) { this.regionOfPlayer = reg; this.world._curRegion = reg; }
      this.actors.update(dt);
      // finish (level 1)
      if (live && this.world.finish && this.level.mode === 'targets') {
        const f = this.world.finish;
        if (Math.abs(this.player.pos.x - f.x) < 0.62 && Math.abs(this.player.pos.z - f.z) < 0.62) {
          this.finished = true;
          this.endT = 0.9;
          this.sound.beep();
          this.hud.showBanner('FINISH', fmtTime(this.time), 'ok big');
        }
      }
      if (st === 'countdown') {
        this.cd -= dt;
        if (this.cd <= 0) {
          this.setState('play');
          if (this.level.mode === 'targets') this.sound.beep();
          else this.sound.ui(1200);
        }
      }
      if (this.finished) {
        this.endT -= dt;
        if (this.endT <= 0 && this.state === 'play') this.finishRun();
      }
      this.player.applyCamera(cam, this.clock);
      const fovTarget = THREE.MathUtils.lerp(74, 52, this.weapon.ads);
      if (Math.abs(cam.fov - fovTarget) > 0.01) { cam.fov = fovTarget; cam.updateProjectionMatrix(); }
      this.fx.update(dt, cam);
      // HUD
      const objective = this.level.mode === 'targets'
        ? `SCHIJVEN ${this.downHostile}/${this.totalHostile} · KAMERS ${this.roomsCleared}/${this.rooms.length} · NAAR FINISH`
        : `VERDACHTEN ${this.downHostile}/${this.totalHostile} · RUIMTES ${this.roomsCleared}/${this.rooms.length}`;
      this.hud.setObjective(objective);
      this.hud.setTimer(this.time, this.penalty);
      this.hud.setAmmo(this.weapon.mag, this.weapon.magSize, this.weapon.reloading);
      this.hud.setHealth(this.player.health);
      if (this.input.touch) { this.adsBtn.classList.toggle('active', this.input.adsToggle); this.crouchBtn.classList.toggle('active', this.input.crouch); }
      const spreadPx = this.weapon.currentSpread(this.player) / THREE.MathUtils.degToRad(cam.fov / 2) * (E.height / 2);
      this.hud.setCross(spreadPx, this.weapon.ads);
      this.hud.minimap(dt, this.world, this.player, this.actors, this.clock);
      // post-effecten
      const dmg = this.player.alive ? Math.max(0, 1 - this.player.health / 100) : 1;
      E.grade.uniforms.uDamage.value = dmg * (0.75 + Math.sin(this.clock * 6) * 0.08 * dmg);
      this.hitAmt = Math.max(0, (this.hitAmt || 0) - dt * 1.6);
      E.grade.uniforms.uHitAmt.value = this.hitAmt;
      this.fade = Math.max(0, (this.fade || 0) - dt * 1.8);
      E.grade.uniforms.uFade.value = this.fade;
    } else {
      // pauze/resultaat: wereld staat stil maar blijft getekend
      this.fx.update(0, cam);
    }
    E.enemyFlash.intensity = Math.max(0, E.enemyFlash.intensity - dt * 120);
    E.adapt(dt);
    E.render(dt, this.clock);
  }
}

const game = new Game();
window.__game = game;
window.__THREE = THREE;
game.boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('loadText');
  if (el) el.textContent = 'Er ging iets mis bij het laden: ' + e.message;
});
