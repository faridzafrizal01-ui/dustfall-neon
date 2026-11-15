// Minimap: a small 2D canvas in the HUD corner that shows the Neon Dockyard from
// above, so the Sentinel can read the round at a glance. It draws the static
// layout (outer walls, quay wall, container tower, the two site zones), then the
// live round: the player's arrow, alive Raiders as dots, smoke clouds as grey
// discs, and a blinking marker where the device is planted. It never touches the
// simulation; main.js pushes the live state in once per frame.
//
// World coordinates: x runs -22..22 (west..east), z runs -17..17 (north..south).
// The canvas maps north (-z) to the top, so py grows as z grows. The scale is
// uniform, 4 px per metre, and the map is centred on the canvas.
const WORLD = { minX: -22, maxX: 22, minZ: -17, maxZ: 17 };
const SCALE = 4;
const MARGIN = 4;

function toPx(x, z, w, h) {
  const spanX = WORLD.maxX - WORLD.minX;
  const spanZ = WORLD.maxZ - WORLD.minZ;
  const ox = (w - spanX * SCALE) / 2;
  const oy = (h - spanZ * SCALE) / 2;
  return [ox + (x - WORLD.minX) * SCALE, oy + (z - WORLD.minZ) * SCALE];
}

function siteColor(site, palette) {
  return site === 'A' ? palette.accent : palette.pink;
}

export function createMinimap(canvas, map, palette) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const sites = map.sites;

  // Static geometry, precomputed once: the rectangles the map is built from.
  // [x, z, width, depth] in world metres, centred on (x, z).
  const walls = [
    // Outer walls (drawn as a border frame).
    { x: 0, z: -17.3, w: 45.2, d: 0.6 },
    { x: 0, z: 17.3, w: 45.2, d: 0.6 },
    { x: -22.3, z: 0, w: 0.6, d: 35.2 },
    { x: 22.3, z: 0, w: 0.6, d: 35.2 },
    // Quay wall at z = 4, three blocks with two gaps.
    { x: -8.5, z: 4, w: 3, d: 0.6 },
    { x: 0, z: 4, w: 6, d: 0.6 },
    { x: 8.5, z: 4, w: 3, d: 0.6 },
    // Container tower, centre.
    { x: 0, z: -3, w: 7, d: 5 },
    // Site A crates, site B containers, north cover walls.
    { x: -16.5, z: -6, w: 2.5, d: 1.2 },
    { x: 19, z: -7, w: 3, d: 1.2 },
    { x: -6, z: -15.5, w: 2.2, d: 1.2 },
    { x: 6, z: -15.5, w: 2.2, d: 1.2 },
  ];

  function drawRect(x, z, w, d, fill) {
    const [px, py] = toPx(x - w / 2, z - d / 2, W, H);
    ctx.fillStyle = fill;
    ctx.fillRect(px, py, w * SCALE, d * SCALE);
  }

  function drawCircle(x, z, r, fill, stroke) {
    const [px, py] = toPx(x, z, W, H);
    ctx.beginPath();
    ctx.arc(px, py, r * SCALE, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function drawPlayer(px, pz, yaw) {
    const [cx, cy] = toPx(px, pz, W, H);
    // Facing: yaw 0 looks north (-z). Canvas angle for the arrow tip.
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const ang = Math.atan2(fz, fx);
    const len = 7;
    const spread = 0.5;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(len, 0);
    ctx.lineTo(-len * 0.7, len * spread);
    ctx.lineTo(-len * 0.35, 0);
    ctx.lineTo(-len * 0.7, -len * spread);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function drawStatic() {
    // Background: dark night panel with a thin border.
    ctx.fillStyle = 'rgba(8, 12, 24, 0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    // Walls and cover, in muted steel.
    for (const r of walls) drawRect(r.x, r.z, r.w, r.d, 'rgba(150, 160, 185, 0.55)');
    // Site zones: a translucent disc and a letter, cyan A / pink B.
    for (const key of ['A', 'B']) {
      const s = sites[key];
      const col = siteColor(key, palette);
      drawCircle(s.x, s.z, s.radius, hexA(col, 0.16), hexA(col, 0.9));
      const [lx, ly] = toPx(s.x, s.z, W, H);
      ctx.fillStyle = hexA(col, 1);
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(key, lx, ly);
    }
  }

  function hexA(hex, alpha) {
    // '#rrggbb' -> 'rgba(r,g,b,alpha)'.
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function drawClouds(clouds) {
    for (const c of clouds) {
      drawCircle(c.x, c.z, 3.5, 'rgba(154, 167, 189, 0.5)');
    }
  }

  function drawBots(bots) {
    for (const b of bots) {
      if (!b.alive) continue;
      drawCircle(b.pos.x, b.pos.z, 0.55, '#ff7a1a', 'rgba(0,0,0,0.5)');
    }
  }

  function drawBomb(bomb, now) {
    // bomb.state: 'idle' | 'planting' | 'planted' | 'defusing' | 'defused'.
    if (bomb.state !== 'planted' && bomb.state !== 'planting') return;
    const s = sites[bomb.site];
    if (!s) return;
    // Blink: on for the first 0.6 s of each second.
    const on = (now % 1) < 0.6;
    if (!on) return;
    drawCircle(s.x, s.z, 0.9, '#ff2d2d', '#ffffff');
  }

  return {
    update(player, bots, clouds, bomb, now) {
      ctx.clearRect(0, 0, W, H);
      drawStatic();
      drawClouds(clouds);
      drawBots(bots);
      drawBomb(bomb, now);
      drawPlayer(player.position.x, player.position.z, player.yaw);
    },
  };
}
