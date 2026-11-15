// Player movement: acceleration, friction, gravity, crouch and jump, resolved as a box
// against the world's colliders via collide.moveActor, one axis at a time, so a wall
// never swallows the player. Health and damage live here too.
import * as THREE from 'three';
import { moveActor } from './collide.js';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createPlayer(colliders) {
  const player = {
    position: new THREE.Vector3(0, 0, 14),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
    health: 100,
    alive: true,
  };
  const wish = new THREE.Vector3();

  function overlapsHeight(height) {
    // Cheap headroom test for standing back up: a box of the given height at the feet.
    const min = new THREE.Vector3(player.position.x - RADIUS, player.position.y + 0.02, player.position.z - RADIUS);
    const max = new THREE.Vector3(player.position.x + RADIUS, player.position.y + height - 0.02, player.position.z + RADIUS);
    const probe = new THREE.Box3(min, max);
    for (const c of colliders) if (probe.intersectsBox(c)) return true;
    return false;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(1.45, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  function step(dt, keys) {
    if (!player.alive) return;
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !player.crouching) {
      player.crouching = true;
      player.height = CROUCH_HEIGHT;
    } else if (!crouching && player.crouching && !overlapsHeight(STAND_HEIGHT)) {
      player.crouching = false;
      player.height = STAND_HEIGHT;
    }
    const eyeTarget = player.crouching ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = player.crouching ? CROUCH_SPEED : WALK_SPEED;
    const blend = Math.min(1, (player.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    player.velocity.x += (wish.x * speed - player.velocity.x) * blend;
    player.velocity.z += (wish.z * speed - player.velocity.z) * blend;
    if (player.onGround && wish.lengthSq() === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      player.velocity.x *= damp;
      player.velocity.z *= damp;
    }

    if (keys.has('Space') && player.onGround) {
      player.velocity.y = JUMP_SPEED;
      player.onGround = false;
    }
    player.velocity.y -= GRAVITY * dt;
    player.velocity.y = Math.max(-30, player.velocity.y);

    const vyBefore = player.velocity.y;
    const flags = moveActor(player.position, player.velocity, dt, colliders, RADIUS, player.height);
    player.onGround = flags.hitY && vyBefore <= 0;
  }

  return {
    state: player,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(player.velocity.x, player.velocity.z);
    },
    damage(amount) {
      if (!player.alive) return false;
      player.health = Math.max(0, player.health - amount);
      if (player.health <= 0) {
        player.alive = false;
        return true;
      }
      return false;
    },
    reset(x, z, yaw) {
      player.position.set(x, 0, z);
      player.velocity.set(0, 0, 0);
      player.yaw = yaw;
      player.pitch = 0;
      player.eye = STAND_EYE;
      player.height = STAND_HEIGHT;
      player.crouching = false;
      player.onGround = true;
      player.health = 100;
      player.alive = true;
    },
  };
}
