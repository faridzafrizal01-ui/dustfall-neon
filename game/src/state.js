// One central state object for the round. Subsystems (player, bots, weapons, bomb) own
// their own live numbers; this holds the round, the money, the score and the bomb phase,
// so main.js never keeps a second copy of any of them.
export const ROUND_TIME = 100;
export const BOMB_FUSE = 35;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const BUY_TIME = 14;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const SMOKE_PRICE = 250;
export const SMOKE_MAX = 2;
export const GRENADE_PRICE = 300;
export const GRENADE_MAX = 2;

export function createState() {
  return {
    mode: 'menu', // 'menu' | 'buy' | 'playing' | 'roundEnd'
    round: 1,
    scoreUs: 0,
    scoreThem: 0,
    money: START_MONEY,
    timer: ROUND_TIME,
    bombSite: null, // 'A' | 'B' | null
    bomb: 'idle', // 'idle' | 'planting' | 'planted' | 'defusing' | 'defused' | 'detonated'
    bombProgress: 0, // 0..1 channel progress for plant / defuse
    fuse: 0, // seconds left once planted
    kills: 0,
    deaths: 0,
    roundResult: null, // { win: boolean, reason: string }
    owned: { rifle: false, smg: false, grenades: 0, smokes: 0 },
    weapon: 'pistol',
    buyOpen: false,
  };
}

export function resetRound(state) {
  state.timer = ROUND_TIME;
  state.bombSite = null;
  state.bomb = 'idle';
  state.bombProgress = 0;
  state.fuse = 0;
  state.roundResult = null;
}
