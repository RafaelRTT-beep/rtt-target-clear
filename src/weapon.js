// Het wapen in beeld (viewmodel), vuren, terugslag, richten en herladen.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const BORE = -0.072; // loop-as onder de vizierlijn

function m(geo, mat, parent, x, y, z, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Mesh(geo, mat);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  parent.add(o);
  return o;
}
const rb = (w, h, d, r = 0.006, s = 2) => new RoundedBoxGeometry(w, h, d, s, r);
const cyl = (r1, r2, len, seg = 16) => new THREE.CylinderGeometry(r1, r2, len, seg).rotateX(Math.PI / 2);

function taper(a, b, r1, r2, mat, parent) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r2, r1, len, 14, 1, false);
  const o = new THREE.Mesh(g, mat);
  o.position.copy(a).add(b).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
  parent.add(o);
  const s = new THREE.Mesh(new THREE.SphereGeometry(r1, 12, 8), mat); s.position.copy(a); parent.add(s);
  return o;
}

function limbBetween(a, b, r, mat, parent) {
  const len = a.distanceTo(b);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r), 4, 12);
  const o = new THREE.Mesh(g, mat);
  o.position.copy(a).add(b).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
  parent.add(o);
  return o;
}

export class Weapon {
  constructor(engine, T, sound, fx) {
    this.engine = engine; this.T = T; this.sound = sound; this.fx = fx;
    this.magSize = 30;
    this.mag = 30;
    this.reloadT = 0; this.reloading = false;
    this.fireCD = 0;
    this.ads = 0;
    this.spread = 0;
    this.bloom = 0;
    this.kickPos = 0; this.kickVel = 0;
    this.kickRot = 0; this.kickRotVel = 0;
    this.sway = new THREE.Vector2(); this.swayV = new THREE.Vector2();
    this.bob = 0;
    this.flashT = 0;
    this.shots = 0;
    this.build();
  }

  build() {
    const T = this.T;
    const black = new THREE.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0.55, roughness: 0.36 });
    const black2 = new THREE.MeshStandardMaterial({ color: 0x232427, metalness: 0.4, roughness: 0.55 });
    const rail = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, metalness: 0.6, roughness: 0.4, map: T.rail });
    rail.map = T.rail.clone(); rail.map.repeat.set(1, 6); rail.map.wrapT = THREE.RepeatWrapping; rail.map.needsUpdate = true;
    const fde = new THREE.MeshStandardMaterial({ color: 0x8b775a, roughness: 0.68, metalness: 0.05 });
    const poly = new THREE.MeshStandardMaterial({ color: 0x1e1f21, roughness: 0.78 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.9 });
    const glovePad = new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.9 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.97 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x5a5c60, metalness: 0.9, roughness: 0.3 });
    this.mats = [black, black2, rail, fde, poly, glove, glovePad, sleeve, steel];

    const rig = new THREE.Group(); // beweegt (ADS/zwaai)
    const gun = new THREE.Group();  // terugslag
    rig.add(gun);
    this.engine.vmScene.add(rig);
    this.rig = rig; this.gun = gun;
    const y = BORE;
    // upper receiver + rail
    m(rb(0.046, 0.05, 0.27, 0.006), black, gun, 0, y + 0.01, -0.07);
    m(rb(0.03, 0.012, 0.25, 0.002), rail, gun, 0, y + 0.041, -0.07);
    // ejection port + forward assist
    m(rb(0.004, 0.018, 0.05, 0.002), steel, gun, 0.024, y + 0.008, -0.04);
    m(cyl(0.008, 0.008, 0.03, 10), black, gun, 0.024, y + 0.022, 0.01, 0, 0.25, 0);
    // charging handle
    m(rb(0.03, 0.012, 0.03, 0.003), black2, gun, 0, y + 0.032, 0.075);
    // lower receiver + magwell
    m(rb(0.044, 0.045, 0.2, 0.006), black, gun, 0, y - 0.035, -0.02);
    m(rb(0.04, 0.05, 0.075, 0.006), black, gun, 0, y - 0.075, -0.075);
    // trigger guard + trigger
    m(new THREE.TorusGeometry(0.02, 0.003, 6, 12, Math.PI), black, gun, 0, y - 0.062, -0.01, 0, Math.PI / 2, Math.PI);
    m(rb(0.004, 0.022, 0.006, 0.0015), steel, gun, 0, y - 0.07, -0.012, 0.3);
    // pistolgrip
    m(rb(0.032, 0.11, 0.05, 0.01), poly, gun, 0, y - 0.105, 0.028, -0.32);
    // magazijn (los voor het herladen)
    const magG = new THREE.Group();
    magG.position.set(0, y - 0.09, -0.075);
    gun.add(magG);
    const mshape = new THREE.Shape();
    mshape.moveTo(-0.032, 0); mshape.lineTo(0.032, 0);
    mshape.quadraticCurveTo(0.04, -0.09, 0.07, -0.17);
    mshape.lineTo(0.008, -0.19);
    mshape.quadraticCurveTo(-0.02, -0.1, -0.032, 0);
    const mg = new THREE.ExtrudeGeometry(mshape, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 8 });
    mg.translate(0, 0, -0.013);
    mg.rotateY(Math.PI / 2);
    m(mg, fde, magG, 0, 0, 0);
    m(rb(0.03, 0.012, 0.075, 0.003), poly, magG, 0, -0.18, 0.028, 0.35);
    this.magG = magG;
    // handguard (M-LOK)
    m(rb(0.056, 0.058, 0.33, 0.012, 3), fde, gun, 0, y + 0.004, -0.355);
    for (let i = 0; i < 4; i++) {
      for (const sx of [-1, 1]) m(rb(0.004, 0.012, 0.035, 0.002), poly, gun, sx * 0.029, y - 0.004, -0.25 - i * 0.065);
      m(rb(0.012, 0.004, 0.035, 0.002), poly, gun, 0, y - 0.027, -0.25 - i * 0.065);
    }
    m(rb(0.026, 0.01, 0.3, 0.002), rail, gun, 0, y + 0.037, -0.355);
    // loop + flash hider + gasblok
    m(cyl(0.0085, 0.0085, 0.12), black, gun, 0, y + 0.002, -0.58);
    m(cyl(0.012, 0.012, 0.055, 12), black2, gun, 0, y + 0.002, -0.66);
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + 0.4;
      m(rb(0.003, 0.003, 0.03, 0.001), new THREE.MeshBasicMaterial({ color: 0x050505 }), gun, Math.cos(a) * 0.0125, y + 0.002 + Math.sin(a) * 0.0125, -0.665);
    }
    // wapenlamp rechts op de handguard
    m(cyl(0.013, 0.013, 0.09, 14), black, gun, 0.036, y - 0.002, -0.43);
    m(cyl(0.015, 0.015, 0.02, 14), black2, gun, 0.036, y - 0.002, -0.48);
    m(new THREE.CircleGeometry(0.012, 14), new THREE.MeshStandardMaterial({ color: 0xdfe8ff, emissive: 0x404858, roughness: 0.1 }), gun, 0.036, y - 0.002, -0.4905, 0, Math.PI, 0);
    // buffer tube + kolf
    m(cyl(0.015, 0.015, 0.16, 14), black, gun, 0, y - 0.005, 0.15);
    m(rb(0.042, 0.075, 0.15, 0.012, 3), fde, gun, 0, y - 0.022, 0.22);
    m(rb(0.044, 0.09, 0.02, 0.006), poly, gun, 0, y - 0.03, 0.3);
    // red dot (Aimpoint-achtig) + montage
    m(rb(0.028, 0.026, 0.04, 0.004), black, gun, 0, -0.036, -0.04);
    const tubeMat = black.clone(); tubeMat.side = THREE.DoubleSide; this.mats.push(tubeMat);
    m(new THREE.CylinderGeometry(0.021, 0.021, 0.085, 28, 1, true).rotateX(Math.PI / 2), tubeMat, gun, 0, 0, -0.04);
    for (const z of [0.0, -0.08]) {
      m(new THREE.TorusGeometry(0.0225, 0.0045, 10, 32), black2, gun, 0, 0, z);
      m(new THREE.CylinderGeometry(0.0265, 0.0265, 0.012, 32, 1, true).rotateX(Math.PI / 2), tubeMat, gun, 0, 0, z);
    }
    // voorlens met lichte coating
    const coat = new THREE.MeshStandardMaterial({ color: 0x6a8cb0, metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.12, depthWrite: false });
    this.mats.push(coat);
    m(new THREE.CircleGeometry(0.02, 28), coat, gun, 0, 0, -0.083);
    m(cyl(0.008, 0.008, 0.016, 10).rotateX(Math.PI / 2), black2, gun, 0, 0.033, -0.045);
    m(cyl(0.008, 0.008, 0.016, 10).rotateY(Math.PI / 2), black2, gun, 0.034, 0, -0.045);
    // lens met reticle
    const lensMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uBright: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uBright;
        void main(){
          vec2 c = vUv - 0.5; float r = length(c);
          float dotv = smoothstep(0.026, 0.01, r);
          float glow = smoothstep(0.06, 0.0, r) * 0.25;
          vec3 tint = mix(vec3(0.25,0.35,0.45), vec3(0.6,0.75,0.9), smoothstep(-0.5,0.5,c.y+c.x));
          vec3 col = vec3(3.2,0.12,0.08) * dotv * uBright + vec3(1.2,0.05,0.03) * glow * uBright + tint * 0.1;
          float a = clamp(dotv + glow * 0.8 + 0.06 + smoothstep(0.4,0.5,r) * 0.5, 0.0, 1.0);
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.lens = m(new THREE.CircleGeometry(0.019, 28), lensMat, gun, 0, 0, 0.0065);
    this.mats.push(lensMat);
    // mondingsvuur
    const fm = new THREE.MeshBasicMaterial({ map: this.T.flash, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(3, 2.4, 1.6) });
    this.mats.push(fm);
    const flash = new THREE.Group();
    flash.position.set(0, y + 0.002, -0.7);
    gun.add(flash);
    const fp = new THREE.PlaneGeometry(0.16, 0.16);
    const f1 = m(fp, fm, flash, 0, 0, 0);
    const f2 = m(new THREE.PlaneGeometry(0.26, 0.09).translate(0, 0, 0), fm, flash, 0, 0, -0.06, 0, Math.PI / 2, 0);
    const f3 = m(new THREE.PlaneGeometry(0.26, 0.09), fm, flash, 0, 0, -0.06, Math.PI / 2, Math.PI / 2, 0);
    void f1; void f2; void f3;
    flash.visible = false;
    this.flash = flash;
    this.muzzleLocal = new THREE.Vector3(0, y, -0.69);

    // handen
    const v3 = (a, b, c) => new THREE.Vector3(a, b, c);
    const hands = new THREE.Group();
    gun.add(hands);
    // rechterhand op de pistolgrip
    m(rb(0.05, 0.085, 0.07, 0.018, 3), glove, hands, 0.006, y - 0.1, 0.042, -0.3);
    m(rb(0.052, 0.03, 0.02, 0.01), glovePad, hands, 0.006, y - 0.09, 0.006, -0.3);
    limbBetween(v3(0.018, y - 0.045, 0.02), v3(0.03, y - 0.045, -0.035), 0.009, glove, hands); // trekkervinger langs de body
    limbBetween(v3(-0.024, y - 0.05, 0.035), v3(-0.026, y - 0.03, -0.01), 0.01, glove, hands); // duim
    // rechter onderarm: handschoen-manchet + taps toelopende mouw
    taper(v3(0.012, y - 0.135, 0.07), v3(0.035, y - 0.19, 0.13), 0.03, 0.034, glove, hands);
    taper(v3(0.035, y - 0.19, 0.13), v3(0.15, y - 0.36, 0.42), 0.036, 0.05, sleeve, hands);
    m(new THREE.TorusGeometry(0.036, 0.007, 8, 18), glovePad, hands, 0.035, y - 0.19, 0.13, 1.0, 0.3, 0);
    // linkerhand onder de handguard
    m(rb(0.062, 0.035, 0.09, 0.015, 3), glove, hands, -0.012, y - 0.04, -0.38, 0, 0, 0.35);
    for (let i = 0; i < 4; i++) limbBetween(v3(-0.03, y - 0.03, -0.35 - i * 0.02), v3(-0.032, y + 0.018, -0.352 - i * 0.02), 0.0085, glove, hands);
    limbBetween(v3(0.02, y - 0.03, -0.36), v3(0.034, y + 0.01, -0.395), 0.009, glove, hands);
    taper(v3(-0.025, y - 0.055, -0.36), v3(-0.06, y - 0.11, -0.3), 0.028, 0.032, glove, hands);
    taper(v3(-0.06, y - 0.11, -0.3), v3(-0.2, y - 0.33, -0.02), 0.034, 0.05, sleeve, hands);
    m(new THREE.TorusGeometry(0.034, 0.007, 8, 18), glovePad, hands, -0.06, y - 0.11, -0.3, 1.0, -0.4, 0);

    // poses
    this.hipPos = new THREE.Vector3(0.145, -0.148, -0.39);
    this.hipRot = new THREE.Euler(0.03, 0.07, -0.04);
    this.adsPos = new THREE.Vector3(0, 0, -0.2);
    this.adsRot = new THREE.Euler(0, 0, 0);
    this.rig.position.copy(this.hipPos);
    this.rig.traverse((o) => { o.frustumCulled = false; });
  }

  get canFire() { return !this.reloading && this.mag > 0; }

  startReload() {
    if (this.reloading || this.mag === this.magSize) return;
    this.reloading = true;
    this.reloadT = 0;
    this.reloadSteps = [false, false, false];
  }

  // spread (radialen) voor dit moment
  currentSpread(player) {
    const mv = Math.min(1, player.speed / 3.2);
    const hip = 0.016 + mv * 0.022 + (player.crouch ? -0.004 : 0);
    const ads = 0.0018 + mv * 0.006;
    return THREE.MathUtils.lerp(hip, ads, this.ads) + this.bloom;
  }

  update(dt, input, player, game) {
    // ADS
    const wantAds = input.ads && !this.reloading;
    this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * 13);
    // vuren
    this.fireCD -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 0.05);
    if (input.fire && this.fireCD <= 0 && player.alive && game.canShoot) {
      if (this.reloading) { /* niets */ }
      else if (this.mag <= 0) { this.sound.dry(); this.fireCD = 0.3; this.startReload(); }
      else this.fire(player, game);
    }
    if (input.reload) this.startReload();
    // herladen
    let rx = 0, rz = 0, ry = 0, magDrop = 0;
    if (this.reloading) {
      this.reloadT += dt;
      const t = this.reloadT;
      const D = 2.0;
      const k = Math.sin(Math.min(1, t / D) * Math.PI);
      rx = k * 0.35; rz = k * 0.55; ry = k * -0.2;
      if (t > 0.3 && t < 1.25) magDrop = t < 0.6 ? (t - 0.3) / 0.3 : t < 0.9 ? 1 : 1 - (t - 0.9) / 0.35;
      if (t > 0.3 && !this.reloadSteps[0]) { this.reloadSteps[0] = true; this.sound.reload(0); }
      if (t > 1.2 && !this.reloadSteps[1]) { this.reloadSteps[1] = true; this.sound.reload(1); }
      if (t > 1.6 && !this.reloadSteps[2]) { this.reloadSteps[2] = true; this.sound.reload(2); }
      if (t >= D) { this.reloading = false; this.mag = this.magSize; }
    }
    this.magG.position.y = BORE - 0.09 - magDrop * 0.35;
    this.magG.position.z = -0.075 + magDrop * 0.05;
    this.magG.visible = !(this.reloadT > 0.55 && this.reloadT < 0.95 && this.reloading);
    // terugslag-veer
    const k1 = 380, c1 = 26;
    this.kickVel += (-k1 * this.kickPos - c1 * this.kickVel) * dt;
    this.kickPos += this.kickVel * dt;
    this.kickRotVel += (-k1 * this.kickRot - c1 * this.kickRotVel) * dt;
    this.kickRot += this.kickRotVel * dt;
    // zwaai door kijken
    const sw = 1 - this.ads * 0.7;
    this.swayV.x += (-input.lookDX * 0.0009 * sw - this.sway.x) * Math.min(1, dt * 10);
    this.swayV.y += (input.lookDY * 0.0009 * sw - this.sway.y) * Math.min(1, dt * 10);
    this.sway.x += (THREE.MathUtils.clamp(this.swayV.x, -0.05, 0.05) - this.sway.x) * Math.min(1, dt * 8);
    this.sway.y += (THREE.MathUtils.clamp(this.swayV.y, -0.05, 0.05) - this.sway.y) * Math.min(1, dt * 8);
    this.swayV.multiplyScalar(Math.max(0, 1 - dt * 6));
    // loopbeweging
    this.bob += dt * player.speed * 2.6;
    const bobAmt = Math.min(1, player.speed / 3) * (1 - this.ads * 0.8);
    const bx = Math.sin(this.bob) * 0.009 * bobAmt;
    const by = -Math.abs(Math.cos(this.bob)) * 0.008 * bobAmt;
    const breath = Math.sin(performance.now() * 0.0016) * 0.0016 * (1 - this.ads * 0.85);
    // samenstellen
    const a = this.ads;
    const P = this.rig.position;
    P.lerpVectors(this.hipPos, this.adsPos, a);
    P.x += bx + this.sway.x * 0.6; P.y += by + this.sway.y * 0.6 + breath + (player.crouch ? -0.01 : 0) * (1 - a);
    this.rig.rotation.set(
      THREE.MathUtils.lerp(this.hipRot.x, this.adsRot.x, a) + rx + this.sway.y * 2,
      THREE.MathUtils.lerp(this.hipRot.y, this.adsRot.y, a) + ry + this.sway.x * 2,
      THREE.MathUtils.lerp(this.hipRot.z, this.adsRot.z, a) + rz + this.sway.x * 1.5,
    );
    this.gun.position.set(0, 0, this.kickPos);
    this.gun.rotation.set(this.kickRot, 0, 0);
    // flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) { this.flash.visible = false; this.engine.vmFlash.intensity = 0; this.engine.flashLight.intensity = 0; }
    }
  }

  fire(player, game) {
    this.fireCD = 0.086;
    this.mag--;
    this.shots++;
    const spread = this.currentSpread(player);
    this.bloom = Math.min(0.035, this.bloom + 0.0045 * (1 - this.ads * 0.6));
    // richting met spreiding
    const cam = this.engine.camera;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const r = Math.sqrt(Math.random()) * spread, th = Math.random() * Math.PI * 2;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    dir.addScaledVector(right, Math.cos(th) * r).addScaledVector(up, Math.sin(th) * r).normalize();
    game.fireShot(cam.position.clone(), dir);
    // terugslag
    this.kickVel += 1.6 + Math.random() * 0.3;
    this.kickRotVel += 3.2 + Math.random() * 0.8;
    const kp = (0.011 + Math.random() * 0.005) * (1 - this.ads * 0.35) * (player.crouch ? 0.8 : 1);
    player.addRecoil(kp, (Math.random() - 0.45) * 0.006);
    // flash
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.5;
    this.flash.scale.set(s, s, s);
    this.flashT = 0.035;
    this.engine.vmFlash.position.set(this.rig.position.x, this.rig.position.y - 0.05, this.rig.position.z - 0.4);
    this.engine.vmFlash.intensity = 4;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.engine.flashLight.position.copy(cam.position).addScaledVector(fwd, 0.9);
    this.engine.flashLight.intensity = 9;
    this.sound.shot();
    // rook bij de monding (wereldpositie benaderen)
    const mpos = cam.position.clone().addScaledVector(fwd, 0.75).addScaledVector(right, 0.12 * (1 - this.ads)).addScaledVector(up, -0.1 + 0.03 * this.ads);
    this.fx.muzzle(mpos, fwd);
    // huls
    const epos = cam.position.clone().addScaledVector(fwd, 0.3).addScaledVector(right, 0.09 * (1 - this.ads) + 0.04).addScaledVector(up, -0.06);
    const vel = right.clone().multiplyScalar(2.2 + Math.random()).addScaledVector(up, 1.6 + Math.random() * 0.8).addScaledVector(fwd, 0.4).add(player.vel);
    this.fx.casing(epos, vel, player.floorY);
  }

  reset() {
    this.mag = this.magSize; this.reloading = false; this.reloadT = 0; this.ads = 0;
    this.kickPos = this.kickVel = this.kickRot = this.kickRotVel = 0;
    this.bloom = 0; this.shots = 0; this.flash.visible = false;
  }
}
