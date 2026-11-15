// NEONDOCK map, rewritten fresh for threejs-fps-02. A night container dockyard,
// 44 x 34 m, with two bomb sites behind a gated quay wall. The quay wall only
// opens at two gaps; the flanks stay open as alleys. A container tower sits in
// the middle and forces every approach around it. Bots walk a 32-node waypoint
// graph with BFS. All art is box/cylinder geometry plus neon glow strips.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeBox } from './collide.js';

const W = 22; // half width
const D = 17; // half depth
const WALL = 4.5; // outer wall height

export const SITES = {
  A: { name: 'Crane', x: -16, z: -12, radius: 3.4, color: 'accent' },
  B: { name: 'Pier', x: 16, z: -12, radius: 3.4, color: 'pink' },
};

export const PLAYER_SPAWN = { x: 0, z: -13.5, yaw: Math.PI };
export const BOT_SPAWNS = [
  { x: -14, z: 14.5, yaw: 0 },
  { x: -5, z: 14.5, yaw: 0 },
  { x: 5, z: 14.5, yaw: 0 },
  { x: 14, z: 14.5, yaw: 0 },
];

// Waypoint graph. Bots BFS from their nearest node to a site node. Raiders come
// from the south staging yard, through the quay-wall gaps or the flank alleys,
// around the tower, to the sites. The Sentinel starts north, between the sites.
const NODES = [
  [-14, 14.5], [-5, 14.5], [5, 14.5], [14, 14.5], // 0-3 bot spawns
  [-10, 10], [0, 11], [10, 10],                   // 4-6 south yard
  [-5, 4], [5, 4],                                 // 7-8 quay-wall gaps
  [-7, -3], [7, -3], [0, -9],                     // 9-11 tower ring
  [-9, -11], [9, -11],                             // 12-13 north approaches
  [-20, -12], [-20, -4], [-20, 10],               // 14-16 west alley
  [20, -12], [20, -4], [20, 10],                  // 17-19 east alley
  [-16, -12], [16, -12],                           // 20-21 sites A, B
  [-10, -8], [10, -8], [-10, 8], [10, 8],         // 22-25 connectors
  [-13, -8], [-18, -14], [13, -8], [18, -14],     // 26-29 hold spots
  [-6, -14], [6, -14],                             // 30-31 north edge
];
const EDGES = [
  [0, 4], [0, 16], [1, 5], [1, 4], [2, 5], [2, 6], [3, 6], [3, 19],
  [4, 5], [5, 6], [4, 24], [6, 25], [24, 25],
  [24, 7], [25, 8],
  [7, 9], [8, 10],
  [9, 11], [10, 11], [9, 22], [10, 23],
  [11, 12], [11, 13], [12, 20], [13, 21], [12, 22], [13, 23], [12, 30], [13, 31], [30, 31],
  [14, 15], [15, 16], [17, 18], [18, 19],
  [14, 20], [17, 21], [14, 27], [17, 29],
  [15, 24], [18, 25], [16, 24], [19, 25],
  [22, 26], [23, 28], [26, 20], [28, 21],
];
export const SITE_NODE = { A: 20, B: 21 };
export const HOLD_NODES = { A: [26, 27, 22], B: [28, 29, 23] };

export function createMap(scene) {
  const root = new THREE.Group();
  scene.add(root);

  // One standard material per palette entry; neon glow is MeshBasic (unlit).
  const mats = {};
  for (const name of Object.keys(PALETTE)) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: (name === 'accent' || name === 'pink' || name === 'ink') ? 0.5 : 0.95,
      metalness: name === 'rust' ? 0.35 : 0.04,
    });
  }
  const glowCyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });
  const glowPink = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.pink) });
  const glow = (kind) => (kind === 'pink' ? glowPink : glowCyan);

  const colliders = [];
  const shootables = [];

  function addBox(w, h, d, x, y, z, mat, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    if (solid) {
      colliders.push(makeBox(x, y, z, w, h, d));
      shootables.push(mesh);
    }
    return mesh;
  }

  function addGlow(w, h, d, x, y, z, kind) {
    // A neon strip: visual only, never a collider, never shootable.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glow(kind));
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  }

  // Ground slab and the four outer walls.
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(W * 2 + 1.2, 0.4, D * 2 + 1.2),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ground), roughness: 0.55, metalness: 0.15 }),
  );
  ground.position.set(0, -0.2, 0);
  ground.receiveShadow = true;
  root.add(ground);
  addBox(0.6, WALL, D * 2 + 1.2, -W - 0.3, WALL / 2, 0, 'surface');
  addBox(0.6, WALL, D * 2 + 1.2, W + 0.3, WALL / 2, 0, 'surface');
  addBox(W * 2 + 1.2, WALL, 0.6, 0, WALL / 2, -D - 0.3, 'surface');
  addBox(W * 2 + 1.2, WALL, 0.6, 0, WALL / 2, D + 0.3, 'surface');

  // Quay wall at z = 4: three blocks, two gaps (x -7..-3 and 3..7). The middle
  // of the map is gated; the flank alleys stay open.
  addBox(3, 3.2, 0.6, -8.5, 1.6, 4, 'surface');
  addBox(6, 3.2, 0.6, 0, 1.6, 4, 'surface');
  addBox(3, 3.2, 0.6, 8.5, 1.6, 4, 'surface');
  addGlow(2.4, 0.14, 0.14, -8.5, 3.3, 4, 'accent');
  addGlow(2.4, 0.14, 0.14, 0, 3.3, 4, 'pink');
  addGlow(2.4, 0.14, 0.14, 8.5, 3.3, 4, 'accent');

  // Central container tower: a two-tier stack the bots must walk around.
  addBox(7, 2.4, 5, 0, 1.2, -3, 'rust');
  addBox(5, 2.4, 3.5, 0, 3.6, -3, 'hairline');
  addGlow(0.16, 4.4, 0.16, -3.4, 2.2, -0.4, 'pink');
  addGlow(0.16, 4.4, 0.16, 3.4, 2.2, -0.4, 'accent');

  // Site A — the Crane: a tall mast with a jib beam, plus containers and a crate.
  addBox(1.5, 8, 1.5, -20, 4, -14, 'surface');
  addGlow(0.2, 7.2, 0.2, -20, 4, -13.2, 'accent');
  const jib = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 0.8), mats.hairline);
  jib.position.set(-16, 7.5, -14);
  jib.castShadow = true;
  root.add(jib);
  addBox(2.5, 2.4, 1.2, -16.5, 1.2, -6, 'rust');
  addBox(1.6, 1.1, 1.6, -14, 0.55, -9, 'hairline');

  // Site B — the Pier: a stacked container pair and a crate.
  addBox(3, 2.4, 1.2, 19, 1.2, -7, 'rust');
  addBox(3, 2.4, 1.2, 18, 3.6, -7, 'hairline');
  addBox(1.6, 1.1, 1.6, 14, 0.55, -9, 'hairline');
  addGlow(2.6, 0.14, 0.14, 18.5, 2.5, -6.3, 'pink');

  // Low cover: two walls on the north edge, one south of the tower.
  addBox(2.2, 1.1, 1.2, -6, 0.55, -15.5, 'hairline');
  addBox(2.2, 1.1, 1.2, 6, 0.55, -15.5, 'hairline');
  addBox(3.2, 1.1, 0.8, 0, 0.55, 1, 'hairline');

  // Crates in the staging yard (south) and in the alleys (off the lane lines).
  addBox(1.6, 1.1, 1.6, -12, 0.55, 11, 'hairline');
  addBox(1.6, 1.1, 1.6, 12, 0.55, 11, 'hairline');
  addBox(2, 1.1, 2, -4, 0.55, 13, 'hairline');
  addBox(2, 1.1, 2, 4, 0.55, 13, 'hairline');
  addBox(1.6, 1.1, 1.6, -18, 0.55, 0, 'hairline');
  addBox(1.6, 1.1, 1.6, 18, 0.55, 0, 'hairline');

  // Distant silhouettes outside the walls, for depth through the fog.
  addBox(6, 9, 6, -30, 4.5, -8, 'canvas', false);
  addBox(5, 7, 5, 30, 3.5, -14, 'canvas', false);
  addBox(8, 12, 4, 4, 6, -30, 'canvas', false);
  addBox(4, 6, 4, -34, 3, 10, 'canvas', false);
  addGlow(5.8, 0.2, 0.2, -30, 9.1, -8, 'accent');
  addGlow(4.8, 0.2, 0.2, 30, 7.1, -14, 'pink');

  // Site markers: a flat ring on the ground plus a translucent beacon pillar,
  // cyan for A, magenta for B.
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const c = new THREE.Color(PALETTE[s.color]);
    const ringMat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.28, depthWrite: false });
    const pillarMat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.07, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(s.radius, s.radius, 0.06, 28), ringMat);
    ring.position.set(s.x, 0.03, s.z);
    ring.receiveShadow = true;
    root.add(ring);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 7, 12, 1, true), pillarMat);
    pillar.position.set(s.x, 3.5, s.z);
    root.add(pillar);
  }

  // Night lighting: a cold moon from the north-east, a dim blue sky fill, and
  // neon point lights at both sites and the tower so the dark reads.
  const sky = new THREE.HemisphereLight(new THREE.Color('#2a3a5f'), new THREE.Color('#0e1424'), 0.7);
  scene.add(sky);
  const moon = new THREE.DirectionalLight(new THREE.Color('#8fb4ff'), 1.4);
  moon.position.set(18, 20, -8);
  moon.target.position.set(-4, 0, 4);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -30;
  moon.shadow.camera.right = 30;
  moon.shadow.camera.top = 30;
  moon.shadow.camera.bottom = -30;
  moon.shadow.camera.far = 80;
  moon.shadow.bias = -0.0006;
  scene.add(moon, moon.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#3a4a7a'), 0.4);
  fill.position.set(-14, 10, 16);
  scene.add(fill);
  const lampA = new THREE.PointLight(new THREE.Color(PALETTE.accent), 20, 18);
  lampA.position.set(-16, 3, -12);
  scene.add(lampA);
  const lampB = new THREE.PointLight(new THREE.Color(PALETTE.pink), 20, 18);
  lampB.position.set(16, 3, -12);
  scene.add(lampB);
  const lampTower = new THREE.PointLight(new THREE.Color(PALETTE.pink), 15, 15);
  lampTower.position.set(0, 4, -3);
  scene.add(lampTower);

  // Waypoint adjacency list.
  const adj = NODES.map(() => []);
  for (const [a, b] of EDGES) {
    adj[a].push(b);
    adj[b].push(a);
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < NODES.length; i += 1) {
      const dx = NODES[i][0] - x;
      const dz = NODES[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // BFS over the waypoint graph. Returns an array of {x, z} steps, or [] if unreachable.
  function findPath(fromX, fromZ, toNode) {
    const start = nearestNode(fromX, fromZ);
    const prev = new Array(NODES.length).fill(-1);
    const queue = [start];
    prev[start] = start;
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === toNode) break;
      for (const next of adj[cur]) {
        if (prev[next] === -1) {
          prev[next] = cur;
          queue.push(next);
        }
      }
    }
    if (prev[toNode] === -1) return [];
    const ids = [];
    let cur = toNode;
    while (cur !== start) { ids.push(cur); cur = prev[cur]; }
    ids.reverse();
    return ids.map((id) => ({ x: NODES[id][0], z: NODES[id][1] }));
  }

  function siteAt(x, z) {
    for (const key of ['A', 'B']) {
      const s = SITES[key];
      const dx = x - s.x;
      const dz = z - s.z;
      if (dx * dx + dz * dz <= s.radius * s.radius) return key;
    }
    return null;
  }

  return {
    colliders, shootables, group: root,
    sites: SITES,
    playerSpawn: PLAYER_SPAWN,
    botSpawns: BOT_SPAWNS,
    siteNode: SITE_NODE,
    holdNodes: HOLD_NODES,
    nodePos(id) { return { x: NODES[id][0], z: NODES[id][1] }; },
    findPath,
    siteAt,
  };
}
