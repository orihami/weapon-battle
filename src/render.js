// 描画。フィールドは低解像度のキャンバスに描いてから拡大し、ドット絵っぽく見せる。
// HPの数字やダメージ表示は文字がつぶれないよう高解像度側に描く。

import { ARENA, createBattle } from './engine.js';

const LOW = 168; // 低解像度キャンバスの1辺(px)。小さいほどドットが粗くなる
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
    this.low = document.createElement('canvas');
    this.low.width = LOW;
    this.low.height = LOW;
    this.lctx = this.low.getContext('2d');
    this.particles = [];
    this.texts = [];
    this.rings = [];
    this.bolts = [];
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
      } else if (e.type === 'heal') {
        this.texts.push({ x: e.x, y: e.y - 40, text: '+' + Math.round(e.amount), color: '#2fc23a', life: 0.8, age: 0, size: 18 });
      } else if (e.type === 'parry' || e.type === 'block') {
        this.burst(e.x, e.y, 8, '#ffd23f');
        this.rings.push({ x: e.x, y: e.y, r0: 6, r1: 30, life: 0.25, age: 0, color: '#ffd23f' });
      } else if (e.type === 'zap') {
        this.bolts.push({ x: e.x, y: e.y, life: 0.22, age: 0, seed: Math.random() * 1000 });
        this.burst(e.x, e.y, 10, '#f4d03f');
        this.shake = Math.min(10, this.shake + 3);
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
    this.bolts = this.bolts.filter((b) => b.age < b.life);
    this.rings = this.rings.filter((r) => r.age < r.life);
  }

  draw(world) {
    const ctx = this.lctx;
    const t = this.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, LOW, LOW);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    ctx.setTransform(LOW / ARENA, 0, 0, LOW / ARENA, sx * (LOW / ARENA), sy * (LOW / ARENA));
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
        fn(ctx, p);
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
      // 稲妻: 上からジグザグに落ちる線
      ctx.save();
      ctx.globalAlpha = 1 - bo.age / bo.life;
      for (const [w, c] of [[10, '#ffffff'], [5, '#f4d03f']]) {
        ctx.lineWidth = w;
        ctx.strokeStyle = c;
        ctx.beginPath();
        ctx.moveTo(bo.x + Math.sin(bo.seed) * 30, 0);
        const n = 7;
        for (let i = 1; i <= n; i++) {
          const y = (bo.y * i) / n;
          const x = i === n ? bo.x : bo.x + Math.sin(bo.seed + i * 1.7) * 26;
          ctx.lineTo(x, y);
        }
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

    // 拡大して本番キャンバスへ
    const main = this.ctx;
    const W = this.canvas.width;
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.imageSmoothingEnabled = false;
    main.drawImage(this.low, 0, 0, W, W);
    const s = W / ARENA;
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
      main.font = `${tx.size}px ${NUM_FONT}`;
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

