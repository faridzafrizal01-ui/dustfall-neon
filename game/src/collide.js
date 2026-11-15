// Shared collision helpers. Everything is an axis-aligned box; the ground is a flat y=0
// plane. No allocation in the hot path: callers pass reusable scratch objects.
import * as THREE from 'three';

// A box collider: min/max corners. Helper so map.js can build them from centre + size.
export function makeBox(cx, cy, cz, w, h, d) {
  return new THREE.Box3(
    new THREE.Vector3(cx - w / 2, cy - h / 2, cz - d / 2),
    new THREE.Vector3(cx + w / 2, cy + h / 2, cz + d / 2),
  );
}

// Slab test: does the ray origin + dir*t (t in [0, maxDist]) hit the box? Returns the
// smallest t, or Infinity. Used for line of sight and grenade bounces.
export function rayBox(origin, dir, box, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const mn = [box.min.x, box.min.y, box.min.z];
  const mx = [box.max.x, box.max.y, box.max.z];
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return Infinity;
    } else {
      const inv = 1 / d[i];
      let t0 = (mn[i] - o[i]) * inv;
      let t1 = (mx[i] - o[i]) * inv;
      if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
      if (t0 > tmin) tmin = t0;
      if (t1 < tmax) tmax = t1;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// True when nothing blocks the straight segment from a to b (eye height to eye height).
export function hasLineOfSight(a, b, colliders) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const dist = dir.length();
  if (dist < 1e-6) return true;
  dir.multiplyScalar(1 / dist);
  for (let i = 0; i < colliders.length; i += 1) {
    const t = rayBox(a, dir, colliders[i], dist);
    if (t < dist - 0.05) return false;
  }
  return true;
}

// Move an upright box (radius r, height h, feet at pos.y) against the colliders, one axis
// at a time so a wall never swallows the actor. pos and vel are mutated in place.
// Returns { hitX, hitZ, hitY } flags for the caller. Reuses the scratch box.
const probe = new THREE.Box3();
export function moveActor(pos, vel, dt, colliders, radius, height) {
  const flags = { hitX: false, hitZ: false, hitY: false };
  const nx = pos.x + vel.x * dt;
  probe.min.set(nx - radius, pos.y + 0.04, pos.z - radius);
  probe.max.set(nx + radius, pos.y + height - 0.04, pos.z + radius);
  let blocked = false;
  for (let i = 0; i < colliders.length; i += 1) {
    if (probe.intersectsBox(colliders[i])) { blocked = true; break; }
  }
  if (!blocked) pos.x = nx; else { vel.x = 0; flags.hitX = true; }
  const nz = pos.z + vel.z * dt;
  probe.min.set(pos.x - radius, pos.y + 0.04, nz - radius);
  probe.max.set(pos.x + radius, pos.y + height - 0.04, nz + radius);
  blocked = false;
  for (let i = 0; i < colliders.length; i += 1) {
    if (probe.intersectsBox(colliders[i])) { blocked = true; break; }
  }
  if (!blocked) pos.z = nz; else { vel.z = 0; flags.hitZ = true; }
  const ny = pos.y + vel.y * dt;
  probe.min.set(pos.x - radius, ny, pos.z - radius);
  probe.max.set(pos.x + radius, ny + height, pos.z + radius);
  blocked = false;
  let top = -Infinity;
  for (let i = 0; i < colliders.length; i += 1) {
    if (probe.intersectsBox(colliders[i])) {
      blocked = true;
      if (vel.y <= 0 && colliders[i].max.y > top) top = colliders[i].max.y;
    }
  }
  if (!blocked) {
    pos.y = ny;
  } else if (vel.y <= 0) {
    pos.y = Math.max(0, top);
    vel.y = 0;
    flags.hitY = true;
  } else {
    vel.y = 0;
    flags.hitY = true;
  }
  if (pos.y < 0) { pos.y = 0; vel.y = 0; flags.hitY = true; }
  return flags;
}
