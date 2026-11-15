// Two grenades. The Spark HE grenade: thrown in an arc, bounces, then explodes after
// a short fuse with area damage. The Vapor smoke grenade: thrown the same way, pops
// into a cloud on its first impact (or when its fuse runs out) that hangs for twelve
// seconds and blocks line of sight — bots cannot see through it, and neither can the
// player's hitscan. One reusable explosion effect so the hot path allocates nothing;
// a smoke cloud is built once, at deploy time, and only fades afterwards.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const FUSE = 1.6;
const RADIUS = 5.5;
const MAX_DAMAGE = 110;
const MIN_DAMAGE = 20;
const GRAVITY = 14;
const BOUNCE = 0.35;
const SPHERE_R = 0.12;

// Smoke: a cloud hanging at chest height, wide enough to hide a crossing.
export const SMOKE_DURATION = 12;
export const SMOKE_RADIUS = 3.5;
const SMOKE_Y = 1.2;
// Fixed puff offsets so every cloud has the same shape (no randomness at deploy).
const PUFFS = [
  [0, 0, 0, 1.6], [1.5, 0.3, 0.6, 1.2], [-1.4, 0.2, 0.8, 1.15],
  [0.7, -0.3, -1.3, 1.25], [-0.8, 0.4, -1.2, 1.1], [1.9, -0.1, -0.7, 1.0],
  [-1.9, -0.2, -0.5, 1.0], [0.3, 0.6, 1.5, 1.05], [-0.3, -0.5, 1.4, 0.95],
];

export function createGrenades(scene, colliders, audio) {
  const active = [];
  const clouds = [];
  const ballGeo = new THREE.SphereGeometry(SPHERE_R, 10, 8);
  const ballMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.4, metalness: 0.5 });
  const shellMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.8, depthWrite: false,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), shellMat);
  shell.visible = false;
  scene.add(shell);
  const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 18);
  scene.add(light);
  let fxTime = 0;
  let fxPos = new THREE.Vector3();

  const tmp = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const puffGeo = new THREE.SphereGeometry(1, 12, 10);

  function throwFrom(origin, dir, speed = 13, kind = 'he') {
    const mesh = new THREE.Mesh(ballGeo, ballMat);
    mesh.position.copy(origin);
    mesh.castShadow = true;
    scene.add(mesh);
    active.push({
      mesh, kind,
      vel: new THREE.Vector3(dir.x * speed, dir.y * speed + 2.2, dir.z * speed),
      fuse: FUSE,
      bouncedAt: 0,
    });
  }

  // Build a smoke cloud at a world position. Returns the cloud record.
  function spawnCloud(pos, now) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x9aa7bd), transparent: true, opacity: 0, depthWrite: false,
    });
    const group = new THREE.Group();
    for (const [ox, oy, oz, s] of PUFFS) {
      const puff = new THREE.Mesh(puffGeo, mat);
      puff.position.set(ox, oy, oz);
      puff.scale.setScalar(s);
      group.add(puff);
    }
    group.position.set(pos.x, SMOKE_Y, pos.z);
    scene.add(group);
    const cloud = { group, mat, pos: new THREE.Vector3(pos.x, SMOKE_Y, pos.z), born: now, until: now + SMOKE_DURATION };
    clouds.push(cloud);
    audio.smoke();
    return cloud;
  }

  function explode(g, now, damageFn) {
    const pos = g.mesh.position;
    fxPos.copy(pos);
    fxTime = 0.45;
    shell.position.copy(pos);
    shell.visible = true;
    light.position.copy(pos);
    light.intensity = 60;
    audio.explosion();
    damageFn(pos, RADIUS, MAX_DAMAGE, MIN_DAMAGE);
    scene.remove(g.mesh);
  }

  // Segment-sphere test: does the straight segment from a to b pass through a cloud?
  function segHitsCloud(a, b, cloud) {
    const cx = cloud.pos.x - a.x;
    const cy = cloud.pos.y - a.y;
    const cz = cloud.pos.z - a.z;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-9) return false;
    let t = (cx * dx + cy * dy + cz * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t - cloud.pos.x;
    const py = a.y + dy * t - cloud.pos.y;
    const pz = a.z + dz * t - cloud.pos.z;
    const r = SMOKE_RADIUS;
    return px * px + py * py + pz * pz < r * r;
  }

  // True when a smoke cloud sits on the straight segment from a to b.
  function blocksSight(a, b) {
    for (let i = 0; i < clouds.length; i += 1) {
      if (segHitsCloud(a, b, clouds[i])) return true;
    }
    return false;
  }

  // Distance along the ray origin + dir*t to the first cloud surface, or Infinity.
  // The ray direction must be normalised; maxDist caps the search.
  function rayBlocked(origin, dir, maxDist) {
    let best = Infinity;
    for (let i = 0; i < clouds.length; i += 1) {
      const c = clouds[i].pos;
      const ox = origin.x - c.x;
      const oy = origin.y - c.y;
      const oz = origin.z - c.z;
      // Ray-sphere: |o + t d - c|^2 = r^2. d is unit, so a = 1.
      const b = 2 * (ox * dir.x + oy * dir.y + oz * dir.z);
      const cc = ox * ox + oy * oy + oz * oz - SMOKE_RADIUS * SMOKE_RADIUS;
      const disc = b * b - 4 * cc;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      const t0 = (-b - sq) / 2;
      const t1 = (-b + sq) / 2;
      const t = t0 >= 0 ? t0 : t1;
      if (t >= 0 && t < best && t <= maxDist) best = t;
    }
    return best;
  }

  function removeCloud(i) {
    const cloud = clouds[i];
    scene.remove(cloud.group);
    cloud.mat.dispose();
    clouds.splice(i, 1);
  }

  function step(dt, now, damageFn) {
    // Explosion effect.
    if (fxTime > 0) {
      fxTime -= dt;
      const t = 1 - fxTime / 0.45;
      shell.scale.setScalar(0.5 + t * RADIUS);
      shellMat.opacity = 0.8 * (1 - t);
      light.intensity = 60 * (1 - t);
      if (fxTime <= 0) { shell.visible = false; light.intensity = 0; }
    }
    // Smoke clouds: fade in, hold, fade out, then remove.
    for (let i = clouds.length - 1; i >= 0; i -= 1) {
      const cloud = clouds[i];
      const age = now - cloud.born;
      const left = cloud.until - now;
      if (left <= 0) { removeCloud(i); continue; }
      const fadeIn = Math.min(1, age / 0.4);
      const fadeOut = Math.min(1, left / 2);
      cloud.mat.opacity = 0.55 * Math.min(fadeIn, fadeOut);
      const grow = 1 + 0.15 * Math.min(1, age / 3);
      cloud.group.scale.setScalar(grow);
    }
    for (let i = active.length - 1; i >= 0; i -= 1) {
      const g = active[i];
      g.fuse -= dt;
      g.vel.y -= GRAVITY * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      const p = g.mesh.position;
      let popped = false;
      // Ground bounce.
      if (p.y < SPHERE_R) {
        p.y = SPHERE_R;
        g.vel.y = Math.abs(g.vel.y) * BOUNCE;
        g.vel.x *= 0.8;
        g.vel.z *= 0.8;
        if (now - g.bouncedAt > 0.15) { audio.bounce(); g.bouncedAt = now; }
        if (g.kind === 'smoke') popped = true;
      }
      // Box bounce: push out along the smallest penetration and reflect.
      for (let j = 0; j < colliders.length; j += 1) {
        const b = colliders[j];
        closest.set(
          Math.max(b.min.x, Math.min(p.x, b.max.x)),
          Math.max(b.min.y, Math.min(p.y, b.max.y)),
          Math.max(b.min.z, Math.min(p.z, b.max.z)),
        );
        tmp.subVectors(p, closest);
        const d2 = tmp.lengthSq();
        if (d2 < SPHERE_R * SPHERE_R && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          tmp.multiplyScalar(1 / d);
          p.copy(closest).addScaledVector(tmp, SPHERE_R);
          const vn = g.vel.dot(tmp);
          if (vn < 0) {
            g.vel.addScaledVector(tmp, -vn * (1 + BOUNCE));
            g.vel.multiplyScalar(0.85);
            if (now - g.bouncedAt > 0.15) { audio.bounce(); g.bouncedAt = now; }
            if (g.kind === 'smoke') popped = true;
          }
        }
      }
      if (g.kind === 'smoke' && (popped || g.fuse <= 0)) {
        spawnCloud(p, now);
        scene.remove(g.mesh);
        active.splice(i, 1);
      } else if (g.kind === 'he' && g.fuse <= 0) {
        explode(g, now, damageFn);
        active.splice(i, 1);
      }
    }
  }

  return {
    throwFrom,
    spawnCloud,
    blocksSight,
    rayBlocked,
    step,
    count() { return active.length; },
    cloudCount() { return clouds.length; },
    clear() {
      for (const g of active) scene.remove(g.mesh);
      active.length = 0;
      for (let i = clouds.length - 1; i >= 0; i -= 1) removeCloud(i);
      shell.visible = false;
      light.intensity = 0;
      fxTime = 0;
    },
  };
}
