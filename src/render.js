// 描画。フィールドは画面の解像度(端末のピクセル密度まで)でそのまま描き、くっきり見せる。

import { ARENA, createBattle } from './engine.js';

const OUT = '#1a1a1a';
const STEEL = '#e9edf2';
const STEEL_D = '#9aa3ad';
const WOOD = '#7a4a26';
const GOLD = '#f2c230';

export const NUM_FONT = '"Anton", "Impact", "Arial Black", sans-serif';

function textColorFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 110 ? '#ffffff' : '#111111';
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function hslHex(h) {
  // hexA() で使うため HSL(彩度95%・明度60%)を #rrggbb にする
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const a = 0.95 * Math.min(0.6, 0.4);
    const c = 0.6 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function poly(ctx, pts, fill) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
}

function rect(ctx, x, y, w, h, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
}

function circle(ctx, x, y, r, fill, stroke = true) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) ctx.stroke();
}

// 剣タイプ(剣・短剣・刀)。+x方向に rIn から rOut まで
function swordShape(ctx, rIn, rOut, half, opt = {}) {
  const grip = opt.grip ?? 16;
  rect(ctx, rIn, -3.5, grip, 7, opt.gripColor ?? WOOD);
  rect(ctx, rIn + grip, -half - 7, 6, (half + 7) * 2, opt.guard ?? GOLD);
  const x0 = rIn + grip + 6;
  const tip = Math.min(18, (rOut - x0) * 0.35);
  poly(ctx, [[x0, -half], [rOut - tip, -half], [rOut, opt.curve ?? 0], [rOut - tip, half], [x0, half]], STEEL);
  ctx.save();
  ctx.strokeStyle = STEEL_D;
  ctx.beginPath();
  ctx.moveTo(x0 + 2, 0);
  ctx.lineTo(rOut - tip, 0);
  ctx.stroke();
  ctx.restore();
}

function shaft(ctx, rIn, rOut, color = WOOD, h = 6) {
  rect(ctx, rIn, -h / 2, rOut - rIn, h, color);
}

function shurikenShape(ctx, r) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rr = i % 2 ? r * 0.35 : r;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  poly(ctx, pts, '#b8c0cc');
  circle(ctx, 0, 0, 2, '#333', false);
}

function sawShape(ctx, r) {
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    const rr = i % 2 ? r * 0.8 : r + 3;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  poly(ctx, pts, '#c9d1da');
  circle(ctx, 0, 0, r * 0.35, '#6c727a');
}

const BLADE_SPRITES = {
  sword(ctx, b) {
    swordShape(ctx, b.rIn, b.rOut, 7);
  },
  dagger(ctx, b) {
    swordShape(ctx, b.rIn, b.rOut, 5.5, { grip: 12 });
  },
  greatsword(ctx, b) {
    swordShape(ctx, b.rIn, b.rOut, 11, { grip: 20, guard: '#6d7fa3' });
  },
  squeaky(ctx, b) {
    shaft(ctx, b.rIn, b.rOut - 20, '#ffd23f', 7);
    rect(ctx, b.rOut - 24, -b.w * 1.1, 24, b.w * 2.2, '#ff7eb6');
    rect(ctx, b.rOut - 24, -b.w * 1.1, 6, b.w * 2.2, '#e0559a');
  },
  drill(ctx, b) {
    shaft(ctx, b.rIn, b.rIn + 20, '#5b5b5b', 12);
    poly(ctx, [[b.rIn + 18, -13], [b.rOut, 0], [b.rIn + 18, 13]], '#c9a227');
    ctx.save();
    ctx.strokeStyle = '#8a6d1a';
    const t = performance.now() / 60;
    for (let x = b.rIn + 26 + (t % 12); x < b.rOut - 6; x += 12) {
      const h = 13 * (1 - (x - b.rIn - 18) / (b.rOut - b.rIn - 18));
      ctx.beginPath();
      ctx.moveTo(x, -h);
      ctx.lineTo(x + 6, h);
      ctx.stroke();
    }
    ctx.restore();
  },
  dual(ctx, b) {
    swordShape(ctx, b.rIn, b.rOut, 6, { guard: '#d94f8a' });
  },
  katana(ctx, b) {
    swordShape(ctx, b.rIn, b.rOut, 3.5, { grip: 20, gripColor: '#222', guard: '#c9a227', curve: -3 });
  },
  spear(ctx, b) {
    shaft(ctx, b.rIn, b.rOut - 24, WOOD, 6);
    poly(ctx, [[b.rOut - 28, -9], [b.rOut, 0], [b.rOut - 28, 9]], STEEL);
  },
  whip(ctx, b, t) {
    ctx.save();
    ctx.lineWidth = 7;
    ctx.strokeStyle = OUT;
    const pts = [];
    for (let x = b.rIn; x <= b.rOut; x += 6) {
      const k = (x - b.rIn) / (b.rOut - b.rIn);
      pts.push([x, Math.sin(x * 0.08 - t * 14) * 6 * k]);
    }
    for (const pass of [[7, OUT], [4, '#b0702c']]) {
      ctx.lineWidth = pass[0];
      ctx.strokeStyle = pass[1];
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    ctx.restore();
    rect(ctx, b.rIn - 4, -4, 16, 8, '#5b3418');
  },
  axe(ctx, b) {
    shaft(ctx, b.rIn, b.rOut, WOOD, 7);
    const x = b.rOut - 26;
    poly(ctx, [[x, -4], [x - 6, -24], [x + 10, -30], [x + 24, -22], [x + 22, -4]], STEEL);
  },
  hammer(ctx, b) {
    shaft(ctx, b.rIn, b.rOut - 20, WOOD, 7);
    rect(ctx, b.rOut - 24, -b.w * 1.2, 24, b.w * 2.4, '#8d939c');
    rect(ctx, b.rOut - 24, -b.w * 1.2, 6, b.w * 2.4, '#6c727a');
  },
  scythe(ctx, b) {
    shaft(ctx, b.rIn, b.rOut, '#5b3418', 6);
    ctx.beginPath();
    ctx.moveTo(b.rOut, 0);
    ctx.quadraticCurveTo(b.rOut - 8, 34, b.rOut - 50, 44);
    ctx.quadraticCurveTo(b.rOut - 18, 28, b.rOut - 10, 2);
    ctx.closePath();
    ctx.fillStyle = STEEL;
    ctx.fill();
    ctx.stroke();
  },
  trident(ctx, b) {
    shaft(ctx, b.rIn, b.rOut - 26, WOOD, 6);
    const x = b.rOut - 28;
    rect(ctx, x - 2, -14, 6, 28, GOLD);
    for (const y of [-12, 0, 12]) poly(ctx, [[x, y - 3], [b.rOut - (y ? 6 : 0), y - 3], [b.rOut + 4 - (y ? 6 : 0), y], [b.rOut - (y ? 6 : 0), y + 3], [x, y + 3]], GOLD);
  },
  scepter(ctx, b) {
    shaft(ctx, b.rIn, b.rOut - 16, WOOD, 6);
    rect(ctx, b.rOut - 22, -8, 6, 16, GOLD);
    circle(ctx, b.rOut - 6, 0, 11, '#43c24a');
    circle(ctx, b.rOut - 9, -3, 3, '#c8ffb0', false);
  },
  lance(ctx, b) {
    poly(ctx, [[b.rIn + 18, -11], [b.rOut, 0], [b.rIn + 18, 11]], STEEL);
    ctx.save();
    ctx.strokeStyle = STEEL_D;
    for (let x = b.rIn + 34; x < b.rOut - 20; x += 22) {
      const h = 11 * (1 - (x - b.rIn - 18) / (b.rOut - b.rIn - 18));
      ctx.beginPath();
      ctx.moveTo(x, -h);
      ctx.lineTo(x + 8, h);
      ctx.stroke();
    }
    ctx.restore();
    poly(ctx, [[b.rIn, -6], [b.rIn + 18, -14], [b.rIn + 18, 14], [b.rIn, 6]], '#6b3d1f');
  },
  shield(ctx, b) {
    const cx = (b.rIn + b.rOut) / 2;
    const ry = b.w / 2;
    ctx.beginPath();
    ctx.ellipse(cx, 0, 12, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#8b5a2b';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = OUT;
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#c7ccd3';
    ctx.stroke();
    ctx.save();
    ctx.strokeStyle = '#5e3a1a';
    for (let y = -ry + 8; y < ry - 4; y += 9) {
      ctx.beginPath();
      ctx.moveTo(cx - 9, y);
      ctx.lineTo(cx + 9, y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = OUT;
    circle(ctx, cx, 0, 5, '#c7ccd3');
  },
};

// 遠距離武器などの「手に持っている物」
const HELD = {
  clone(ctx, ball) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    circle(ctx, 0, 0, 9, ball.def.color);
    ctx.restore();
  },
  curse(ctx) {
    circle(ctx, 0, -8, 7, '#d8b48a');
    rect(ctx, -6, -2, 12, 14, '#7a2f5c');
    ctx.beginPath();
    ctx.moveTo(-4, -10);
    ctx.lineTo(-1, -7);
    ctx.moveTo(1, -10);
    ctx.lineTo(4, -7);
    ctx.stroke();
  },
  blizzard(ctx) {
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI) / 3);
      ctx.beginPath();
      ctx.moveTo(-11, 0);
      ctx.lineTo(11, 0);
      ctx.stroke();
      ctx.restore();
    }
  },
  hook(ctx, ball) {
    if (ball.w.out) return;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(4, 0, 9, -1.8, 1.8);
    ctx.stroke();
    ctx.lineWidth = 2.5;
  },
  snake(ctx) {
    circle(ctx, 0, 0, 8, '#3f8f3a');
  },
  knives(ctx) {
    poly(ctx, [[-6, -3], [10, -1], [14, 0], [10, 1], [-6, 3]], STEEL);
  },
  dice(ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(-9, -9, 18, 18, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = OUT;
    ctx.fillRect(-2, -2, 4, 4);
  },
  javelin(ctx) {
    shaft(ctx, -14, 16, '#b3863c', 4);
    poly(ctx, [[14, -5], [26, 0], [14, 5]], STEEL);
  },
  spellbook(ctx) {
    rect(ctx, -11, -9, 22, 18, '#6a4fc9');
    rect(ctx, -1, -9, 2, 18, '#f2c230');
  },
  water(ctx) {
    rect(ctx, -12, -6, 22, 12, '#3aa0ff');
    rect(ctx, 10, -3, 8, 6, '#ffd23f');
  },
  blackhole(ctx) {
    circle(ctx, 0, 0, 10, '#0b0614');
    ctx.strokeStyle = '#b48cff';
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, 4);
    ctx.stroke();
  },
  fireworks(ctx) {
    poly(ctx, [[-10, -5], [8, -5], [14, 0], [8, 5], [-10, 5]], '#ff3f8e');
  },
  laser(ctx) {
    rect(ctx, -10, -7, 24, 14, '#5a1a24');
    rect(ctx, 14, -3, 10, 6, '#e8233f');
  },
  slime(ctx) {
    poly(ctx, [[-10, 6], [-8, -4], [0, -10], [8, -4], [10, 6]], '#4fd36b');
  },
  tornado(ctx) {
    poly(ctx, [[-12, -10], [12, -10], [3, 12], [-3, 12]], '#9fb4c7');
  },
  yoyo(ctx, ball) {
    if (ball.w.out) return;
    circle(ctx, 0, 0, 10, '#e04848');
  },
  bats(ctx) {
    poly(ctx, [[0, -3], [-14, -8], [-8, 4], [0, 2], [8, 4], [14, -8]], '#3a2448');
  },
  ricochet(ctx) {
    rect(ctx, -10, -5, 22, 10, '#8a6d1a');
    rect(ctx, 10, -3, 8, 6, '#c9a227');
  },
  rocket(ctx) {
    rect(ctx, -14, -7, 30, 14, '#4f5b4a');
    circle(ctx, 16, 0, 6, '#d1452f');
  },
  sonic(ctx, ball, t) {
    circle(ctx, 0, 0, 8, '#2a8aa0');
    ctx.strokeStyle = `rgba(74,198,224,${0.5 + 0.5 * Math.sin(t * 10)})`;
    ctx.beginPath();
    ctx.arc(0, 0, 14, -1, 1);
    ctx.stroke();
  },
  snowball(ctx) {
    circle(ctx, 0, 0, 9, '#f4fbff');
  },
  cluster(ctx, ball, t) {
    circle(ctx, 0, 0, 11, '#3a2b2b');
    circle(ctx, -4, -3, 3, '#e0662a', false);
    circle(ctx, 4, 3, 3, '#e0662a', false);
    circle(ctx, 13, -13, 3 + Math.sin(t * 30), '#ffcc33', false);
  },
  mine(ctx) {
    rect(ctx, -11, -5, 22, 10, '#5b6630');
    circle(ctx, 0, -6, 4, '#e8484d');
  },
  meteor(ctx, ball, t) {
    circle(ctx, 0, 0, 9 + Math.sin(t * 8), '#b5482b');
    circle(ctx, -3, -3, 3, '#ffb35c', false);
  },
  missile(ctx) {
    rect(ctx, -12, -8, 20, 16, '#5f6f86');
    rect(ctx, 8, -4, 8, 8, '#2f3a48');
  },
  shuriken(ctx, ball, t) {
    ctx.rotate(t * 10);
    shurikenShape(ctx, 10);
  },
  bees(ctx) {
    poly(ctx, [[-10, 12], [-12, -6], [0, -14], [12, -6], [10, 12]], '#e8b321');
    ctx.fillStyle = OUT;
    ctx.fillRect(-4, 2, 8, 6);
  },
  gatling(ctx, ball, t) {
    rect(ctx, -10, -9, 16, 18, '#4a564c');
    for (const y of [-6, 0, 6]) rect(ctx, 6, y - 2 + Math.sin(t * 40 + y) * 0.8, 20, 4, '#9aa3ad');
  },
  lightning(ctx) {
    poly(ctx, [[-4, -16], [8, -16], [2, -2], [10, -2], [-6, 18], [-1, 3], [-9, 3]], '#f4d03f');
  },
  saw(ctx, ball, t) {
    ctx.rotate(t * 12);
    sawShape(ctx, 11);
  },
  flame(ctx, ball, t) {
    rect(ctx, -12, -6, 26, 12, '#7a2c1a');
    circle(ctx, 18, 0, 5 + Math.sin(t * 40) * 2, '#ffb03a', false);
  },
  gas(ctx) {
    rect(ctx, -9, -13, 18, 26, '#6fbf3f');
    rect(ctx, -4, -18, 8, 6, '#3c3c3c');
  },
  orb(ctx) {
    rect(ctx, -10, 8, 20, 6, '#6b3d1f');
    circle(ctx, 0, -2, 11, '#4aa8f0');
    circle(ctx, -4, -6, 3.5, '#d8f4ff', false);
  },
  bomb(ctx, ball, t) {
    circle(ctx, 0, 0, 10, '#2b2b2b');
    ctx.beginPath();
    ctx.moveTo(6, -7);
    ctx.lineTo(11, -13);
    ctx.stroke();
    circle(ctx, 12, -14, 3 + Math.sin(t * 30), '#ffcc33', false);
  },
  crossbow(ctx) {
    rect(ctx, -14, -3, 30, 6, '#5b3418');
    ctx.beginPath();
    ctx.moveTo(8, -18);
    ctx.quadraticCurveTo(20, 0, 8, 18);
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#7a4a26';
    ctx.stroke();
    ctx.strokeStyle = OUT;
    ctx.beginPath();
    ctx.moveTo(8, -18);
    ctx.lineTo(-2, 0);
    ctx.lineTo(8, 18);
    ctx.stroke();
  },
  bow(ctx) {
    ctx.beginPath();
    ctx.arc(-6, 0, 20, -1.1, 1.1);
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#9a6b3d';
    ctx.stroke();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-6 + 20 * Math.cos(-1.1), 20 * Math.sin(-1.1));
    ctx.lineTo(-6 + 20 * Math.cos(1.1), 20 * Math.sin(1.1));
    ctx.stroke();
    ctx.lineWidth = 2.5;
  },
  potion(ctx) {
    rect(ctx, -4, -14, 8, 7, '#e8e8e8');
    circle(ctx, 0, 2, 11, '#d6335a');
    circle(ctx, -4, -1, 3, '#ffb3c4', false);
  },
  wand(ctx, ball, t) {
    shaft(ctx, -10, 22, '#5b3418', 5);
    circle(ctx, 24, 0, 6 + Math.sin(t * 20), '#ff8a1f');
  },
  ice(ctx) {
    shaft(ctx, -10, 20, '#cfe8ff', 5);
    poly(ctx, [[18, 0], [26, -8], [34, 0], [26, 8]], '#8fd3ff');
  },
  boomerang(ctx, ball) {
    if (ball.w.out) return;
    ctx.rotate(0.6);
    poly(ctx, [[-4, -18], [6, -2], [-4, 18], [0, 2]], '#d1a03f');
  },
};

const PROJ = {
  clone(ctx, p) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    circle(ctx, 0, 0, p.r, p.color);
    ctx.rotate(p.angle);
    swordShape(ctx, p.r - 4, p.r + 26, 4);
    ctx.restore();
  },
  needle(ctx, p) {
    ctx.rotate(p.angle || Math.atan2(p.vy, p.vx));
    rect(ctx, -10, -1.5, 18, 3, '#d9d9d9');
    circle(ctx, -10, 0, 2.5, '#7a2f5c', false);
  },
  icicle(ctx, p) {
    ctx.rotate(Math.atan2(p.vy, p.vx));
    poly(ctx, [[-12, -5], [12, 0], [-12, 5]], '#d6f0ff');
  },
  hook(ctx, p, world) {
    const owner = world.balls[p.owner];
    ctx.save();
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(owner.x - p.x, owner.y - p.y);
    ctx.stroke();
    ctx.restore();
    ctx.rotate(p.angle);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(4, 0, 9, -1.8, 1.8);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    circle(ctx, -4, 0, 4, '#9aa3ad');
  },
  snake(ctx, p) {
    const dir = Math.sign(p.vx) || 1;
    for (let i = 4; i >= 0; i--) {
      const x = -dir * i * 7;
      const y = Math.sin(p.wig - i * 0.9) * 4;
      circle(ctx, x, y, i === 0 ? p.r : p.r * (0.85 - i * 0.08), i % 2 ? '#2f6e2b' : '#3f8f3a');
    }
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(dir * 3 - 1.5, -4, 3, 3);
  },
  knife(ctx, p) {
    ctx.rotate(Math.atan2(p.vy, p.vx));
    rect(ctx, -12, -2.5, 8, 5, '#5b3418');
    poly(ctx, [[-4, -3.5], [10, -1], [14, 0], [10, 1], [-4, 3.5]], STEEL);
  },
  die(ctx, p) {
    ctx.rotate(p.angle);
    const r = p.r;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(-r, -r, r * 2, r * 2, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = OUT;
    const pips = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }[p.face] || [];
    for (const [x, y] of pips) {
      ctx.beginPath();
      ctx.arc(x * r * 0.5, y * r * 0.5, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  javelin(ctx, p) {
    ctx.rotate(p.angle);
    shaft(ctx, -30, 10, '#b3863c', 4);
    poly(ctx, [[8, -5], [22, 0], [8, 5]], STEEL);
  },
  arcane(ctx, p) {
    circle(ctx, 0, 0, p.r + 2, '#b9a6ff');
    circle(ctx, 0, 0, p.r - 1, '#ffffff', false);
  },
  water(ctx, p) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    circle(ctx, 0, 0, p.r, '#7cc4ff', false);
    circle(ctx, -1.5, -1.5, p.r * 0.4, '#e6f4ff', false);
    ctx.restore();
  },
  hole(ctx, p) {
    const k = Math.min(1, p.age / 0.3) * Math.min(1, (p.life - p.age) / 0.3);
    ctx.save();
    ctx.globalAlpha = 0.25 * k;
    circle(ctx, 0, 0, p.r * 2.2, '#7b4fd6', false);
    ctx.globalAlpha = k;
    ctx.rotate(p.age * 6);
    ctx.strokeStyle = '#b48cff';
    ctx.lineWidth = 4;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, p.r * (0.6 + i * 0.25), i * 2, i * 2 + 2.2);
      ctx.stroke();
    }
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2.5;
    circle(ctx, 0, 0, p.r * 0.55, '#0b0614');
    ctx.restore();
  },
  rocketup(ctx, p) {
    ctx.rotate(Math.atan2(p.vy, p.vx));
    poly(ctx, [[-8, -4], [6, -4], [11, 0], [6, 4], [-8, 4]], '#ff3f8e');
    circle(ctx, -12, 0, 3 + Math.random() * 2, '#ffd23f', false);
  },
  spark(ctx, p) {
    const k = p.age / p.life;
    ctx.save();
    ctx.globalAlpha = 1 - k * 0.5;
    circle(ctx, 0, 0, p.r * (1.2 - k * 0.5), `hsl(${p.hue},95%,60%)`, false);
    circle(ctx, 0, 0, p.r * 0.5, '#ffffff', false);
    ctx.restore();
  },
  laser(ctx, p) {
    if (p.age >= p.charge) return;
    // 溜め: 細い照準線
    const k = p.age / p.charge;
    ctx.save();
    ctx.rotate(p.angle);
    ctx.strokeStyle = `rgba(232,35,63,${0.25 + 0.5 * k})`;
    ctx.lineWidth = 1.5 + k * 3;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(30, 0);
    ctx.lineTo(1000, 0);
    ctx.stroke();
    ctx.restore();
    circle(ctx, Math.cos(p.angle) * 46, Math.sin(p.angle) * 46, 4 + k * 8, '#ff6680', false);
  },
  slime(ctx, p) {
    const sq = 1 + Math.sin(p.age * 14) * 0.12;
    ctx.save();
    ctx.scale(sq, 1 / sq);
    poly(ctx, [[-p.r, p.r * 0.6], [-p.r * 0.8, -p.r * 0.4], [0, -p.r], [p.r * 0.8, -p.r * 0.4], [p.r, p.r * 0.6]], '#4fd36b');
    ctx.fillStyle = OUT;
    ctx.fillRect(-p.r * 0.4, -p.r * 0.2, 3, 3);
    ctx.fillRect(p.r * 0.2, -p.r * 0.2, 3, 3);
    ctx.restore();
  },
  tornado(ctx, p) {
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#7f95a8';
    ctx.lineWidth = 5;
    for (let i = 0; i < 5; i++) {
      const y = p.r - i * (p.r * 0.45);
      const w = p.r * (0.35 + i * 0.18);
      ctx.beginPath();
      ctx.ellipse(Math.sin(p.angle + i) * 6, y, w, w * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  },
  yoyo(ctx, p, world) {
    const owner = world.balls[p.owner];
    ctx.save();
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(owner.x - p.x, owner.y - p.y);
    ctx.stroke();
    ctx.restore();
    ctx.rotate(p.angle);
    circle(ctx, 0, 0, p.r, '#e04848');
    rect(ctx, -p.r, -2, p.r * 2, 4, '#ffffff');
  },
  bat(ctx, p) {
    const f = Math.sin(p.flap) * 0.6;
    ctx.rotate(Math.atan2(p.vy, p.vx) + Math.PI / 2);
    poly(ctx, [[0, -3], [-14, -6 + f * 10], [-8, 4], [0, 2], [8, 4], [14, -6 + f * 10]], '#3a2448');
    circle(ctx, 0, 0, 4, '#5b3a6e');
  },
  ricochet(ctx, p) {
    ctx.save();
    ctx.globalAlpha = 0.4;
    circle(ctx, -p.vx * 0.02, -p.vy * 0.02, p.r * 0.8, '#ffd23f', false);
    ctx.restore();
    circle(ctx, 0, 0, p.r, '#ffcf33');
  },
  rocket(ctx, p) {
    ctx.rotate(p.angle || Math.atan2(p.vy, p.vx));
    poly(ctx, [[-12, -5], [6, -5], [14, 0], [6, 5], [-12, 5]], '#d1452f');
    poly(ctx, [[-12, -5], [-16, -10], [-8, -5]], '#7a2c1a');
    poly(ctx, [[-12, 5], [-16, 10], [-8, 5]], '#7a2c1a');
    circle(ctx, -18, 0, 4 + Math.random() * 3, '#ffb03a', false);
  },
  wave(ctx, p) {
    if (p.ring <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - p.ring / 170);
    ctx.strokeStyle = '#4ac6e0';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, p.ring, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },
  snow(ctx, p) {
    circle(ctx, 0, 0, p.r, '#f4fbff');
    circle(ctx, -p.r * 0.3, -p.r * 0.3, p.r * 0.3, '#d6ecff', false);
  },
  minibomb(ctx, p) {
    circle(ctx, 0, 0, p.r, '#3a2b2b');
    circle(ctx, p.r * 0.5, -p.r * 0.7, 2, '#ffcc33', false);
  },
  mine(ctx, p) {
    const armed = p.age >= 0.6;
    rect(ctx, -p.r, -p.r * 0.45, p.r * 2, p.r * 0.9, '#5b6630');
    circle(ctx, 0, -p.r * 0.5, 3.5, armed && Math.floor(p.age * 3) % 2 === 0 ? '#ff3030' : '#7a2020');
  },
  meteor(ctx, p) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    circle(ctx, -p.vx * 0.04, -p.vy * 0.04, p.r * 0.8, '#ffb35c', false);
    ctx.restore();
    circle(ctx, 0, 0, p.r, '#b5482b');
    circle(ctx, -4, -4, 4, '#e07a4a', false);
  },
  missile(ctx, p) {
    ctx.rotate(p.angle);
    poly(ctx, [[-10, -4], [6, -4], [12, 0], [6, 4], [-10, 4]], '#cfd6de');
    circle(ctx, -14, 0, 3 + Math.random() * 2, '#ff9a1a', false);
  },
  shuriken(ctx, p) {
    ctx.rotate(p.angle);
    shurikenShape(ctx, p.r + 3);
  },
  bee(ctx, p) {
    ctx.rotate(p.angle);
    ctx.save();
    ctx.globalAlpha = 0.7;
    circle(ctx, -1, -6, 4, '#ffffff', false);
    circle(ctx, -1, 6, 4, '#ffffff', false);
    ctx.restore();
    circle(ctx, 0, 0, p.r + 1, '#e8b321');
    ctx.fillStyle = OUT;
    ctx.fillRect(-2, -p.r, 3, p.r * 2);
  },
  bullet(ctx, p) {
    circle(ctx, 0, 0, p.r, '#ffd23f');
  },
  zap(ctx, p) {
    const k = Math.min(1, p.age / p.life);
    ctx.save();
    ctx.strokeStyle = `rgba(244,208,63,${0.4 + 0.6 * k})`;
    ctx.lineWidth = 4;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, p.r * (1.4 - 0.4 * k), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },
  saw(ctx, p) {
    ctx.rotate(p.angle);
    sawShape(ctx, p.r);
  },
  flame(ctx, p) {
    const k = p.age / p.life;
    ctx.save();
    ctx.globalAlpha = 1 - k * 0.6;
    circle(ctx, 0, 0, p.r * (0.8 + k * 1.4), k < 0.4 ? '#ffd23f' : '#ff6a1a', false);
    ctx.restore();
  },
  gas(ctx, p) {
    const k = p.age / p.life;
    ctx.save();
    ctx.globalAlpha = 0.35 * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
    circle(ctx, 0, 0, p.r, '#6fbf3f', false);
    circle(ctx, p.r * 0.3, -p.r * 0.2, p.r * 0.6, '#9be06a', false);
    ctx.restore();
  },
  bolt(ctx, p) {
    ctx.rotate(Math.atan2(p.vy, p.vx));
    shaft(ctx, -16, 8, '#5b3418', 3);
    poly(ctx, [[6, -5], [14, 0], [6, 5]], STEEL);
  },
  arrow(ctx, p) {
    ctx.rotate(Math.atan2(p.vy, p.vx));
    shaft(ctx, -18, 8, '#a87b4f', 3);
    poly(ctx, [[6, -4], [13, 0], [6, 4]], STEEL);
    poly(ctx, [[-18, -5], [-12, 0], [-18, 5]], '#e8e8e8');
  },
  bomb(ctx, p) {
    const left = p.life - p.age;
    const blink = left < 0.5 && Math.floor(left * 20) % 2 === 0;
    circle(ctx, 0, 0, p.r, blink ? '#ff4040' : '#2b2b2b');
    circle(ctx, p.r * 0.6, -p.r * 0.8, 3, '#ffcc33', false);
  },
  potion(ctx, p) {
    ctx.rotate(p.angle);
    rect(ctx, -3, -12, 6, 6, '#e8e8e8');
    circle(ctx, 0, 1, p.r, '#d6335a');
  },
  fireball(ctx, p) {
    circle(ctx, 0, 0, p.r + 3, '#ff6a1a');
    circle(ctx, 0, 0, p.r - 2, '#ffd23f', false);
  },
  frost(ctx, p) {
    ctx.rotate(Math.atan2(p.vy, p.vx));
    poly(ctx, [[-10, 0], [0, -7], [12, 0], [0, 7]], '#9fdcff');
  },
  boomerang(ctx, p) {
    ctx.rotate(p.angle);
    poly(ctx, [[-4, -18], [6, -2], [-4, 18], [0, 2]], '#d1a03f');
  },
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.texts = [];
    this.rings = [];
    this.bolts = [];
    this.lastSurge = {};
    this.beams = [];
    this.flashA = 0;
    this.shake = 0;
    this.time = 0;
  }

  resize(cssSize) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.style.width = cssSize + 'px';
    this.canvas.style.height = cssSize + 'px';
    this.canvas.width = Math.round(cssSize * dpr);
    this.canvas.height = Math.round(cssSize * dpr);
  }

  // エンジンからのイベントを見た目の演出に変える
  addEvents(world, events) {
    for (const e of events) {
      if (e.type === 'hit') {
        const target = world.balls[e.target];
        const color = world.balls[1 - e.target].def.color;
        const dot = e.kind === 'poison' || e.kind === 'burn';
        if (!dot) {
          this.burst(e.x, e.y, 6 + Math.min(10, e.amount), color);
          this.shake = Math.min(10, this.shake + Math.min(6, e.amount * 0.6));
        }
        this.texts.push({
          x: target.x + (Math.random() - 0.5) * 30,
          y: target.y - target.r - 6,
          text: '-' + (e.amount >= 10 ? Math.round(e.amount) : Math.round(e.amount * 10) / 10),
          color: dot ? (e.kind === 'poison' ? '#8b3fe0' : '#ff6a1a') : '#e8484d',
          life: 0.7,
          age: 0,
          size: dot ? 14 : 18 + Math.min(14, e.amount),
        });
      } else if (e.type === 'surge') {
        // 逆境ブースト: 同じボールで連続しないよう少し間をあける
        const last = this.lastSurge[e.target] ?? -1;
        if (this.time - last > 0.8) {
          this.lastSurge[e.target] = this.time;
          const ball = world.balls[e.target];
          this.texts.push({ x: ball.x, y: ball.y - ball.r - 26, text: '逆境！', color: ball.def.color, life: 0.9, age: 0, size: 22, jp: true });
          this.rings.push({ x: ball.x, y: ball.y, r0: ball.r, r1: ball.r * 2.2, life: 0.35, age: 0, color: ball.def.color });
        }
      } else if (e.type === 'heal') {
        this.texts.push({ x: e.x, y: e.y - 40, text: '+' + Math.round(e.amount), color: '#2fc23a', life: 0.8, age: 0, size: 18 });
      } else if (e.type === 'parry' || e.type === 'block') {
        this.burst(e.x, e.y, 8, '#ffd23f');
        this.rings.push({ x: e.x, y: e.y, r0: 6, r1: 30, life: 0.25, age: 0, color: '#ffd23f' });
      } else if (e.type === 'zap') {
        this.bolts.push({ x: e.x, y: e.y, life: e.big ? 0.32 : 0.24, age: 0, seed: Math.random() * 1000, big: e.big !== false });
        this.burst(e.x, e.y, e.big === false ? 10 : 18, '#bfe0ff', 1.4);
        this.rings.push({ x: e.x, y: e.y, r0: 10, r1: e.big === false ? 50 : 70, life: 0.25, age: 0, color: '#9fd0ff', fill: true, strong: true });
        this.shake = Math.min(14, this.shake + (e.big === false ? 4 : 7));
        this.flashA = Math.max(this.flashA, e.big === false ? 0.25 : 0.4);
      } else if (e.type === 'roll') {
        // サイコロの出目。大きいほど派手に
        const big = e.value >= e.max * 0.8;
        this.texts.push({ x: e.x, y: e.y - 30, text: '🎲' + e.value, color: big ? '#e8484d' : '#333333', life: 0.9, age: 0, size: big ? 30 : 20 });
        if (big) this.shake = Math.min(12, this.shake + 5);
      } else if (e.type === 'slam') {
        const ball = world.balls[e.target];
        this.texts.push({ x: ball.x, y: ball.y - 50, text: '壁ドン！', color: '#ff4f9a', life: 0.9, age: 0, size: 26, jp: true });
        this.burst(ball.x, ball.y, 20, '#ff7eb6', 1.5);
        this.shake = Math.min(14, this.shake + 8);
      } else if (e.type === 'laser') {
        this.beams.push({ x: e.x, y: e.y, angle: e.angle, width: e.width, life: 0.3, age: 0 });
        this.shake = Math.min(14, this.shake + 8);
        this.flashA = Math.max(this.flashA, 0.3);
      } else if (e.type === 'burst') {
        // 花火が弾けた
        const c = `hsl(${e.hue},95%,60%)`;
        this.rings.push({ x: e.x, y: e.y, r0: 6, r1: 60, life: 0.3, age: 0, color: hslHex(e.hue), fill: true });
        this.burst(e.x, e.y, 10, c, 1.2);
      } else if (e.type === 'boom') {
        const potion = e.kind === 'potion';
        this.rings.push({ x: e.x, y: e.y, r0: e.radius * 0.3, r1: e.radius, life: 0.3, age: 0, color: potion ? '#d6335a' : '#ff7a1a', fill: true, strong: true });
        this.rings.push({ x: e.x, y: e.y, r0: 4, r1: e.radius * 0.6, life: 0.14, age: 0, color: '#fff3b0', fill: true, strong: true });
        this.burst(e.x, e.y, 12, potion ? '#ff8fb0' : '#ffb03a', 1.3);
        this.shake = Math.min(12, this.shake + 4);
      } else if (e.type === 'end') {
        const loser = world.balls[1 - e.winner];
        if (loser && loser.dead) this.burst(loser.x, loser.y, 40, loser.def.color, 2.2);
      }
    }
  }

  burst(x, y, n, color, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (80 + Math.random() * 260) * power;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.4, age: 0, color, size: 4 + Math.random() * 6 });
    }
  }

  update(dt) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 40);
    for (const p of this.particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - dt * 3;
      p.vy *= 1 - dt * 3;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const t of this.texts) t.age += dt;
    this.texts = this.texts.filter((t) => t.age < t.life);
    for (const r of this.rings) r.age += dt;
    for (const b of this.bolts) b.age += dt;
    for (const b of this.beams) b.age += dt;
    this.beams = this.beams.filter((b) => b.age < b.life);
    this.flashA = Math.max(0, this.flashA - dt * 3);
    this.bolts = this.bolts.filter((b) => b.age < b.life);
    this.rings = this.rings.filter((r) => r.age < r.life);
  }

  draw(world) {
    const ctx = this.ctx;
    const t = this.time;
    const W = this.canvas.width;
    const s = W / ARENA;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, W);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    ctx.setTransform(s, 0, 0, s, sx * s, sy * s);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = OUT;

    if (world) {
      for (const b of world.balls) this.drawUnder(ctx, b, t);
      for (const p of world.projectiles) {
        const fn = PROJ[p.kind];
        if (!fn) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        fn(ctx, p, world);
        ctx.restore();
      }
      for (const b of world.balls) {
        if (b.dead) continue;
        this.drawWeapon(ctx, b, t);
        this.drawBall(ctx, b);
      }
    }
    for (const r of this.rings) {
      const k = r.age / r.life;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * k, 0, Math.PI * 2);
      if (r.fill) {
        ctx.fillStyle = hexA(r.color, (r.strong ? 0.75 : 0.35) * (1 - k));
        ctx.fill();
      }
      ctx.save();
      ctx.strokeStyle = hexA(r.color, 1 - k);
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.restore();
    }
    for (const bo of this.bolts) {
      // 稲妻: 上からジグザグに落ちる太い線 + 枝分かれ
      const k = bo.age / bo.life;
      const pts = [[bo.x + Math.sin(bo.seed) * 40, 0]];
      const n = 9;
      for (let i = 1; i <= n; i++) {
        const y = (bo.y * i) / n;
        pts.push([i === n ? bo.x : bo.x + Math.sin(bo.seed + i * 1.7) * (bo.big ? 34 : 22), y]);
      }
      const branches = [];
      for (let i = 2; i < n - 1; i += 3) {
        const [x, y] = pts[i];
        const dir = Math.sin(bo.seed * 3 + i) > 0 ? 1 : -1;
        branches.push([[x, y], [x + dir * 30, y + 26], [x + dir * 44, y + 60]]);
      }
      ctx.save();
      ctx.globalAlpha = 1 - k;
      const width = bo.big ? 1 : 0.65;
      for (const [w, c] of [[26 * width, 'rgba(120,170,255,0.35)'], [13 * width, '#ffffff'], [6 * width, '#9fd0ff']]) {
        ctx.lineWidth = w;
        ctx.strokeStyle = c;
        for (const line of [pts, ...branches]) {
          ctx.beginPath();
          line.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.stroke();
        }
      }
      // 落ちた場所の光
      ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - k)})`;
      ctx.beginPath();
      ctx.arc(bo.x, bo.y, (bo.big ? 44 : 30) * (0.6 + k), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    for (const bm of this.beams) {
      // レーザー: 太い光の帯
      const k = bm.age / bm.life;
      const ex = bm.x + Math.cos(bm.angle) * 1000;
      const ey = bm.y + Math.sin(bm.angle) * 1000;
      ctx.save();
      for (const [w, c] of [[bm.width * 2.2, 'rgba(255,60,90,0.35)'], [bm.width, '#ff3355'], [bm.width * 0.4, '#ffffff']]) {
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = w * (1 - k * 0.5);
        ctx.strokeStyle = c;
        ctx.beginPath();
        ctx.moveTo(bm.x, bm.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const p of this.particles) {
      const k = 1 - p.age / p.life;
      ctx.fillStyle = p.color;
      const s = p.size * k + 2;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }

    const main = ctx;
    main.setTransform(1, 0, 0, 1, 0, 0);
    if (this.flashA > 0) {
      // 雷やレーザーの瞬間に画面が白く光る
      main.fillStyle = `rgba(235,245,255,${this.flashA})`;
      main.fillRect(0, 0, W, W);
    }
    main.setTransform(s, 0, 0, s, sx * s, sy * s);
    main.textAlign = 'center';
    main.textBaseline = 'middle';
    if (world) {
      for (const b of world.balls) {
        if (b.dead) continue;
        const hp = Math.ceil(b.hp);
        main.font = `${hp >= 100 ? 34 : 40}px ${NUM_FONT}`;
        main.fillStyle = b.flash > 0 ? '#e8484d' : textColorFor(b.def.color);
        main.fillText(String(hp), b.x, b.y + 1);
      }
    }
    for (const tx of this.texts) {
      const k = tx.age / tx.life;
      main.globalAlpha = 1 - k * k;
      main.font = tx.jp ? `bold ${tx.size}px "DotGothic16", sans-serif` : `${tx.size}px ${NUM_FONT}`;
      main.lineWidth = 4;
      main.strokeStyle = '#ffffff';
      main.strokeText(tx.text, tx.x, tx.y - k * 30);
      main.fillStyle = tx.color;
      main.fillText(tx.text, tx.x, tx.y - k * 30);
    }
    main.globalAlpha = 1;
  }

  // ボールより下に描くもの(オーラ・渦・トゲなど)
  drawUnder(ctx, b, t) {
    if (b.dead) return;
    const id = b.def.id;
    if (id === 'orb') {
      const fade = b.w.phase > 0.8 ? 1 - (b.w.phase - 0.8) / 0.2 : 1;
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.w.cur, 0, Math.PI * 2);
      ctx.fillStyle = hexA('#5ad6c4', 0.13);
      ctx.fill();
      ctx.save();
      ctx.strokeStyle = hexA('#5ad6c4', 0.7);
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    } else if (id === 'trident') {
      ctx.save();
      ctx.strokeStyle = 'rgba(120,120,190,0.35)';
      ctx.lineWidth = 5;
      const R = 70 + b.w.pull * 12;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        for (let i = 0; i <= 40; i++) {
          const f = i / 40;
          const a = t * 3 + k * 2.09 + f * 4;
          const r = 20 + f * R;
          const x = b.x + Math.cos(a) * r;
          const y = b.y + Math.sin(a) * r;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    } else if (id === 'unarmed') {
      const sp = Math.hypot(b.vx, b.vy) || 1;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(b.x - (b.vx / sp) * i * 14, b.y - (b.vy / sp) * i * 14, b.r * (1 - i * 0.18), 0, Math.PI * 2);
        ctx.fillStyle = hexA(b.def.color, 0.25 - i * 0.06);
        ctx.fill();
      }
    }
  }

  drawWeapon(ctx, b, t) {
    const def = b.def;
    for (const bl of b.blades) {
      const fn = BLADE_SPRITES[bl.sprite];
      if (!fn) continue;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle + bl.off);
      // 動画のドット絵のように太めに見せる(当たり判定の太さは変えない)
      ctx.scale(1, 1.5);
      fn(ctx, bl, t);
      ctx.restore();
    }
    if (def.id === 'orbital') {
      for (const [x, y] of def.orbiters(b)) circle(ctx, x, y, 9, def.color);
    } else if (def.id === 'flail') {
      const w = b.w;
      const d = Math.hypot(w.hx - b.x, w.hy - b.y);
      const n = Math.max(2, Math.floor(d / 9));
      for (let i = 1; i < n; i++) {
        const k = i / n;
        const x = b.x + (w.hx - b.x) * k;
        const y = b.y + (w.hy - b.y) * k;
        ctx.fillStyle = i % 2 ? '#444' : '#888';
        ctx.fillRect(x - 3, y - 3, 6, 6);
      }
      ctx.save();
      ctx.translate(w.hx, w.hy);
      ctx.rotate(t * 6);
      const s = w.size;
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        poly(ctx, [[Math.cos(a - 0.3) * s, Math.sin(a - 0.3) * s], [Math.cos(a) * (s + 8), Math.sin(a) * (s + 8)], [Math.cos(a + 0.3) * s, Math.sin(a + 0.3) * s]], '#9aa3ad');
      }
      circle(ctx, 0, 0, s, '#d7dde4');
      ctx.restore();
    } else if (def.id === 'spike') {
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = b.angle + (i * Math.PI * 2) / n;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const px = -s;
        const py = c;
        const base = b.r - 2;
        const len = b.r + 10 + Math.min(14, b.w.thorns);
        poly(ctx, [[b.x + c * base + px * 7, b.y + s * base + py * 7], [b.x + c * len, b.y + s * len], [b.x + c * base - px * 7, b.y + s * base - py * 7]], '#c8cfb0');
      }
    }
    const held = HELD[def.id];
    if (held) {
      ctx.save();
      ctx.translate(b.x + Math.cos(b.angle) * (b.r + 16), b.y + Math.sin(b.angle) * (b.r + 16));
      ctx.rotate(b.angle);
      ctx.scale(1.5, 1.5);
      held(ctx, b, t);
      ctx.restore();
    }
  }

  drawBall(ctx, b) {
    ctx.save();
    ctx.lineWidth = 3;
    circle(ctx, b.x, b.y, b.r, b.flash > 0 ? '#ffffff' : b.def.color);
    if (b.poison > 0) {
      ctx.strokeStyle = '#8b3fe0';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (b.burnT > 0) {
      ctx.fillStyle = 'rgba(255,120,30,0.6)';
      ctx.fillRect(b.x - 4 + Math.sin(this.time * 30) * 10, b.y - b.r - 10, 8, 8);
    }
    if (b.curse > 0) {
      // 呪い: 紫の点線の輪(呪いが多いほど太い)
      ctx.save();
      ctx.strokeStyle = '#7a2f5c';
      ctx.lineWidth = Math.min(8, 2 + b.curse * 0.3);
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (b.slow > 0) {
      ctx.strokeStyle = '#9fdcff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (b.stun > 0) {
      for (let i = 0; i < 3; i++) {
        const a = this.time * 6 + (i * Math.PI * 2) / 3;
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(b.x + Math.cos(a) * 22 - 4, b.y - b.r - 8 + Math.sin(a) * 6 - 4, 8, 8);
      }
    }
    ctx.restore();
  }
}

// 武器選択画面用のアイコン(その武器を持ったボールを1つ描く)
export function drawIcon(canvas, def) {
  const world = createBattle(def, def, 1);
  const b = world.balls[0];
  b.x = 300;
  b.y = 300;
  b.angle = -Math.PI / 4;
  if (def.id === 'flail') {
    b.w.hx = b.x + Math.cos(b.angle) * b.w.len;
    b.w.hy = b.y + Math.sin(b.angle) * b.w.len;
  }
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  // ボールと武器がちょうど収まる範囲(1辺190)を切り取って描く
  const view = 190;
  const scale = size / view;
  const cx = 300 + 42;
  const cy = 300 - 42;
  ctx.clearRect(0, 0, size, size);
  ctx.setTransform(scale, 0, 0, scale, size / 2 - cx * scale, size / 2 - cy * scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUT;
  const r = new Renderer.Icon();
  r.drawWeapon(ctx, b, 0);
  r.drawBall(ctx, b);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// アイコン用: キャンバスを持たない軽い描画器
Renderer.Icon = class {
  constructor() {
    this.time = 0;
  }
};
Renderer.Icon.prototype.drawWeapon = Renderer.prototype.drawWeapon;
Renderer.Icon.prototype.drawBall = Renderer.prototype.drawBall;

