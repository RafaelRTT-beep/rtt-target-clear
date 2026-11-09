// Speler: lopen, kijken, hurken, trap/entresol, schade en herstel.
import * as THREE from 'three';

const _dir = new THREE.Vector3();

export class Player {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.eye = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.layer = 0;
    this.floorY = 0;
    this.yVis = 0;
    this.crouch = false; this.crouchAmt = 0;
    this.health = 100; this.alive = true;
    this.lastHurt = 99;
    this.speed = 0;
    this.stepDist = 0; this.stepAlt = false;
    this.recoilP = 0; this.recoverP = 0;
    this.shake = 0;
    this.bobT = 0;
    this.radius = 0.27;
    this.lean = 0; this.leanOff = 0; this.leanX = 0; this.leanZ = 0;
  }

  spawn(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.layer = 0; this.floorY = 0; this.yVis = 0;
    this.crouch = false; this.crouchAmt = 0;
    this.health = 100; this.alive = true; this.lastHurt = 99;
    this.recoilP = 0; this.recoverP = 0; this.shake = 0;
    this.nudgeYaw = 0; this.nudgePitch = 0;
    this.lean = 0; this.leanOff = 0; this.leanX = 0; this.leanZ = 0;
  }

  addRecoil(p, y) {
    this.pitch += p;
    this.yaw += y;
    this.recoilP += p;
    this.recoverDelay = 0.11;
  }

  damage(n) {
    if (!this.alive) return;
    this.health -= n;
    this.lastHurt = 0;
    this.shake = Math.min(1, this.shake + 0.5);
    if (this.health <= 0) { this.health = 0; this.alive = false; }
  }

  update(dt, inp, world, weapon, sound, assist) {
    // kijken (+ aim-assist frictie)
    let ly = inp.lookYaw, lp = inp.lookPitch;
    if (assist && assist.friction) { ly *= assist.friction; lp *= assist.friction; }
    const fovK = THREE.MathUtils.lerp(1, 0.62, weapon.ads);
    this.yaw += ly * fovK;
    this.pitch += lp * fovK;
    if (assist && assist.pull) {
      this.yaw += assist.pull.yaw; this.pitch += assist.pull.pitch;
    }
    // camera draait vloeiend een stukje mee naar waar je tikte
    if (this.nudgeYaw || this.nudgePitch) {
      const k = Math.min(1, dt * 16);
      this.yaw += this.nudgeYaw * k; this.pitch += this.nudgePitch * k;
      this.nudgeYaw *= 1 - k; this.nudgePitch *= 1 - k;
      if (Math.abs(this.nudgeYaw) < 1e-4) this.nudgeYaw = 0;
      if (Math.abs(this.nudgePitch) < 1e-4) this.nudgePitch = 0;
    }
    // terugslag herstel
    this.recoverDelay = (this.recoverDelay || 0) - dt;
    if (this.recoilP > 0 && this.recoverDelay <= 0) {
      const r = Math.min(this.recoilP, this.recoilP * dt * 7 + dt * 0.02);
      this.pitch -= r; // volledig terug naar waar je richtte
      this.recoilP -= r;
    }
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
    // hurken
    this.crouch = inp.crouch;
    this.crouchAmt += ((this.crouch ? 1 : 0) - this.crouchAmt) * Math.min(1, dt * 10);
    // bewegen
    if (!this.alive) { this.vel.multiplyScalar(0.8); }
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    const rgtX = Math.cos(this.yaw), rgtZ = -Math.sin(this.yaw);
    let max = 3.7;
    if (weapon.ads > 0.5) max = 2.1;
    if (this.crouch) max = Math.min(max, 1.9);
    max *= 1 - 0.35 * Math.abs(this.lean);
    const mx = this.alive ? inp.moveX : 0, my = this.alive ? inp.moveY : 0;
    const tx = (fwdX * my + rgtX * mx) * max, tz = (fwdZ * my + rgtZ * mx) * max;
    const k = 1 - Math.exp(-dt * (Math.hypot(tx, tz) > 0.01 ? 11 : 14));
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    world.updateLayer(this);
    world.collide(this.pos, this.radius, this.layer);
    world.updateLayer(this);
    const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
    this.speed = moved / Math.max(dt, 1e-4);
    // werkelijke snelheid (na botsing) voor hulzen
    this.vel.x = (this.pos.x - ox) / Math.max(dt, 1e-4) * 0.6 + this.vel.x * 0.4;
    this.vel.z = (this.pos.z - oz) / Math.max(dt, 1e-4) * 0.6 + this.vel.z * 0.4;
    this.floorY = world.floorY(this.pos.x, this.pos.z, this.layer);
    this.yVis += (this.floorY - this.yVis) * Math.min(1, dt * 18);
    this.pos.y = this.yVis;
    // voetstappen
    this.stepDist += moved;
    if (this.stepDist > (this.crouch ? 0.5 : 0.68)) {
      this.stepDist = 0; this.stepAlt = !this.stepAlt;
      sound.step(this.stepAlt);
    }
    // herstel
    this.lastHurt += dt;
    if (this.alive && this.lastHurt > 3.2 && this.health < 100) this.health = Math.min(100, this.health + dt * 38);
    // camera
    this.bobT += moved * 2.4;
    const bob = Math.min(1, this.speed / 3) * (1 - weapon.ads * 0.7);
    const eyeH = THREE.MathUtils.lerp(1.63, 1.1, this.crouchAmt) + Math.abs(Math.sin(this.bobT)) * 0.028 * bob - 0.014 * bob;
    this.eye.set(this.pos.x, this.pos.y + eyeH, this.pos.z);
    // leunen / peeken (telefoon kantelen of Q/E): hoofd schuift opzij, maar nooit door een muur
    const want = this.alive ? THREE.MathUtils.clamp(inp.lean || 0, -1, 1) : 0;
    this.lean += (want - this.lean) * Math.min(1, dt * 9);
    let off = this.lean * 0.38;
    if (Math.abs(off) > 0.005) {
      const sgn = Math.sign(off);
      _dir.set(rgtX * sgn, 0, rgtZ * sgn);
      const hit = world.raycast(this.eye, _dir, Math.abs(off) + 0.2);
      if (hit) off = sgn * Math.max(0, Math.min(Math.abs(off), hit.t - 0.2));
    }
    this.leanOff += (off - this.leanOff) * Math.min(1, dt * 20);
    this.leanX = rgtX * this.leanOff; this.leanZ = rgtZ * this.leanOff;
    this.eye.x += this.leanX; this.eye.z += this.leanZ;
    this.eye.y -= Math.abs(this.leanOff) * 0.08;
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  applyCamera(cam, t) {
    cam.position.copy(this.eye);
    const s = this.shake * this.shake;
    const sx = (Math.sin(t * 61) + Math.sin(t * 37)) * 0.006 * s, sy = (Math.cos(t * 53) + Math.sin(t * 29)) * 0.006 * s;
    cam.rotation.set(this.pitch + sy, this.yaw + sx, Math.sin(this.bobT * 0.5) * 0.004 * Math.min(1, this.speed / 3) - this.lean * 0.17, 'YXZ');
    if (!this.alive) { cam.rotation.z = 0.5; cam.position.y = this.pos.y + 0.35; }
  }
}
