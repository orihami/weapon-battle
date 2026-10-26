// 描画。フィールドは画面の解像度(端末のピクセル密度まで)でそのまま描き、くっきり見せる。

import { createBattle } from './engine.js';

// 今描いている試合のフィールドの広さ(人数が多いと広い)
let ARENA = 600;

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
  poly(ctx, [[x0, -half], [rOut - tip, -half], [rOut, opt.curve ?? 0], [rOut - tip, half], [x0, half]], opt.blade ?? STEEL);
  ctx.save();
  ctx.strokeStyle = opt.edge ?? STEEL_D;
  ctx.beginPath();
  ctx.moveTo(x0 + 2, 0);
  ctx.lineTo(rOut - tip, 0);
  ctx.stroke();
  ctx.restore();
}

function shaft(ctx, rIn, rOut, color = WOOD, h = 6) {
  rect(ctx, rIn, -h / 2, rOut - rIn, h, color);
}

function starShape(ctx, r, fill) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  poly(ctx, pts, fill);
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
  beak(ctx, b) {
    poly(ctx, [[b.rIn, -7], [b.rOut, 0], [b.rIn, 7]], '#f39c12');
  },
  forge(ctx, b) {
    // 鍛冶の剣: 木の棒 → 銅 → 鉄 → 鋼 → 伝説の剣
    const st = b.stage || 0;
    if (st === 0) {
      rect(ctx, b.rIn, -4, b.rOut - b.rIn, 8, '#8d5a2b');
      circle(ctx, b.rIn + (b.rOut - b.rIn) * 0.6, -4, 2.5, '#6b4220', false);
      return;
    }
    if (st === 4) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      rect(ctx, b.rIn + 20, -14, b.rOut - b.rIn - 18, 28, '#fff3b0');
      ctx.restore();
    }
    const metal = ['', '#d4884a', '#c3cad2', '#eef2f6', '#ffe680'][st];
    swordShape(ctx, b.rIn, b.rOut, 5 + st, { blade: metal, edge: st === 1 ? '#a0612e' : STEEL_D, guard: st === 4 ? '#8b3fe0' : GOLD });
  },
  plant(ctx, b) {
    // 種 → 芽 → つぼみ → 花 → 大樹
    const st = b.stage || 0;
    const L = b.rOut - b.rIn;
    if (st === 4) {
      rect(ctx, b.rIn, -6, L - 14, 12, '#6d4c2f');
      circle(ctx, b.rOut - 12, 0, 16, '#3f8f3a');
      circle(ctx, b.rOut - 18, -6, 6, '#5cb85c', false);
      circle(ctx, b.rOut - 6, 6, 3, '#e74c3c', false);
      return;
    }
    rect(ctx, b.rIn, -2.5, L - 6, 5, '#5a9e3a');
    if (st >= 1) {
      poly(ctx, [[b.rIn + L * 0.45, 0], [b.rIn + L * 0.6, -10], [b.rIn + L * 0.7, -2]], '#7cc242');
      poly(ctx, [[b.rIn + L * 0.55, 0], [b.rIn + L * 0.72, 10], [b.rIn + L * 0.8, 2]], '#7cc242');
    }
    if (st === 0) circle(ctx, b.rOut - 5, 0, 6, '#a1724e');
    else if (st === 1) poly(ctx, [[b.rOut - 10, 0], [b.rOut, -6], [b.rOut + 4, 0], [b.rOut, 6]], '#7cc242');
    else if (st === 2) circle(ctx, b.rOut - 5, 0, 7, '#e891b0');
    else {
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5;
        circle(ctx, b.rOut - 6 + Math.cos(a) * 7, Math.sin(a) * 7, 5, '#ff8fc8', false);
      }
      circle(ctx, b.rOut - 6, 0, 4, '#ffd23f');
    }
  },
  crescent(ctx, b) {
    // 月の刃の一片(並ぶと三日月 → 満月)
    const R = (b.rIn + b.rOut) / 2;
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(0, 0, R, -0.3, 0.3);
    ctx.lineWidth = 14;
    ctx.strokeStyle = OUT;
    ctx.stroke();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#f7dc6f';
    ctx.stroke();
    ctx.restore();
  },
  heroBeam(ctx, b) {
    // 変身中だけ出る光の剣
    const len = b.rOut - b.rIn;
    if (len < 10) return;
    rect(ctx, b.rIn, -6, len, 12, '#ffd23f');
    rect(ctx, b.rIn + 4, -2, len - 8, 4, '#ffffff');
  },
  tail(ctx, b) {
    // サソリのしっぽ: 節と毒針
    const len = b.rOut - b.rIn;
    for (let i = 0; i < 4; i++) circle(ctx, b.rIn + (len * (i + 0.5)) / 5, 0, 7 - i * 0.6, '#8b4513');
    poly(ctx, [[b.rOut - 14, -6], [b.rOut + 6, 0], [b.rOut - 14, 6]], '#6b2f0e');
  },
  tentacle(ctx, b) {
    const len = b.rOut - b.rIn;
    ctx.save();
    ctx.lineWidth = 11;
    ctx.strokeStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.moveTo(b.rIn, 0);
    ctx.quadraticCurveTo(b.rIn + len * 0.5, Math.sin(b.rOut) * 10, b.rOut, 0);
    ctx.stroke();
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#e5677f';
    ctx.stroke();
    ctx.restore();
  },
  claw(ctx, b) {
    for (const y of [-6, 6]) poly(ctx, [[b.rIn, y - 3], [b.rOut, y * 0.6], [b.rIn, y + 3]], '#2e7d4f');
  },
  umbrella(ctx, b) {
    // 開いた傘(半円)
    ctx.save();
    ctx.fillStyle = '#e74c8c';
    ctx.beginPath();
    ctx.ellipse(b.rIn + 4, 0, 14, b.w / 2, 0, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  },
  poke(ctx, b) {
    const len = b.rOut - b.rIn;
    if (len < 12) return;
    rect(ctx, b.rIn, -2.5, len, 5, '#5b3418');
  },
  chainball(ctx, b) {
    const len = b.rOut - b.rIn;
    if (len < 10) return;
    for (let x = b.rIn; x < b.rOut - 14; x += 9) circle(ctx, x, 0, 3, '#8a8f99', false);
    circle(ctx, b.rOut - 6, 0, 12, '#4a4f57');
  },
  paddle(ctx, b) {
    rect(ctx, b.rIn, -3, 10, 6, '#7a4a26');
    ctx.save();
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.ellipse(b.rIn + 18, 0, 9, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  },
  knightShield(ctx, b) {
    poly(ctx, [[b.rIn, -b.w / 2], [b.rOut, -b.w / 2.4], [b.rOut + 4, 0], [b.rOut, b.w / 2.4], [b.rIn, b.w / 2]], '#aab7c4');
    rect(ctx, b.rIn + 2, -3, b.rOut - b.rIn, 6, '#c0392b');
  },
  fist(ctx, b) {
    // 腕と拳(のびているときだけ)
    const len = b.rOut - b.rIn;
    if (len < 10) return;
    rect(ctx, b.rIn, -5, len - 10, 10, '#f1c9a5');
    circle(ctx, b.rOut - 6, 0, 10, '#f1c9a5');
  },
  glove(ctx, b) {
    const len = b.rOut - b.rIn;
    if (len < 10) return;
    rect(ctx, b.rIn, -5, len - 12, 10, '#f1c9a5');
    circle(ctx, b.rOut - 8, 0, 12, '#d62828');
  },
  leg(ctx, b) {
    const len = b.rOut - b.rIn;
    if (len < 10) return;
    rect(ctx, b.rIn, -6, len - 8, 12, '#2f4f6f');
    rect(ctx, b.rOut - 12, -8, 14, 16, '#1a1a1a');
  },
  arm(ctx, b) {
    rect(ctx, b.rIn, -6, b.rOut - b.rIn - 8, 12, '#f1c9a5');
    circle(ctx, b.rOut - 6, 0, 9, '#f1c9a5');
  },
  rewind(ctx, b) {
    // 時計の針と目盛り
    rect(ctx, b.rIn, -3, b.rOut - b.rIn, 6, '#6aa0c8');
    poly(ctx, [[b.rOut - 4, -8], [b.rOut + 10, 0], [b.rOut - 4, 8]], '#2f5d80');
  },
  chainsaw(ctx, b, t) {
    rect(ctx, b.rIn, -6, 16, 12, '#e0a21b');
    rect(ctx, b.rIn + 16, -5, b.rOut - b.rIn - 16, 10, '#c9d1da');
    // 動く刃
    ctx.fillStyle = '#4a4f57';
    const off = (t * 120) % 8;
    for (let x = b.rIn + 18 + off; x < b.rOut - 2; x += 8) {
      ctx.fillRect(x, -7, 3, 2);
      ctx.fillRect(x, 5, 3, 2);
    }
  },
  tongue(ctx, b) {
    // カエルの舌: 根元から先まで伸びるピンクの帯
    const len = b.rOut - b.rIn;
    if (len < 8) return;
    rect(ctx, b.rIn, -4, len, 8, '#ff7aa2');
    circle(ctx, b.rOut, 0, 7, '#ff5c8a');
  },
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
  kusarigama(ctx, b) {
    // 鎖(四角を並べる) + 先の鎌
    for (let x = b.rIn; x < b.rOut - 16; x += 9) {
      ctx.fillStyle = Math.floor(x / 9) % 2 ? '#555' : '#999';
      ctx.fillRect(x, -3, 7, 6);
    }
    ctx.beginPath();
    ctx.moveTo(b.rOut - 16, 0);
    ctx.quadraticCurveTo(b.rOut, -4, b.rOut - 4, -26);
    ctx.quadraticCurveTo(b.rOut - 8, -10, b.rOut - 20, -4);
    ctx.closePath();
    ctx.fillStyle = STEEL;
    ctx.fill();
    ctx.stroke();
    rect(ctx, b.rOut - 22, -4, 8, 8, '#5b3418');
  },
  mirror(ctx, b) {
    const cx = (b.rIn + b.rOut) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, 0, 9, b.w / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#c9ecf7';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#c9a227';
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = OUT;
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx - 3, -b.w / 4);
    ctx.lineTo(cx + 2, -b.w / 8);
    ctx.stroke();
    ctx.strokeStyle = OUT;
  },
  clock(ctx, b) {
    shaft(ctx, b.rIn, b.rOut - 12, '#3a3a3a', 6);
    poly(ctx, [[b.rOut - 14, -8], [b.rOut, 0], [b.rOut - 14, 8]], '#e0c36a');
  },
  saber(ctx, b) {
    rect(ctx, b.rIn - 4, -5, 22, 10, '#4a4a4a');
    ctx.save();
    ctx.lineCap = 'round';
    for (const [w, c] of [[16, 'rgba(63,208,255,0.35)'], [8, '#3fd0ff'], [3, '#ffffff']]) {
      ctx.lineWidth = w;
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.moveTo(b.rIn + 20, 0);
      ctx.lineTo(b.rOut, 0);
      ctx.stroke();
    }
    ctx.restore();
  },
  vampire(ctx, b) {
    shaft(ctx, b.rIn, b.rOut - 26, '#3a1220', 6);
    for (const y of [-7, 7]) poly(ctx, [[b.rOut - 30, y - 5], [b.rOut, y * 0.4], [b.rOut - 30, y + 5]], '#f4f0e8');
    circle(ctx, b.rOut - 32, 0, 6, '#8c1c3a');
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
  penguin(ctx) {
    poly(ctx, [[-8, -5], [8, 0], [-8, 5]], '#f39c12');
  },
  frostCircle(ctx) {
    rect(ctx, -10, -2.5, 22, 5, '#5b3418');
    starShape(ctx, 7, '#bfe6ff');
  },
  shrinkRay(ctx) {
    rect(ctx, -8, -6, 18, 12, '#c06bd6');
    rect(ctx, 10, -3, 8, 6, '#7d3c98');
  },
  holyPillar(ctx) {
    rect(ctx, -10, -2.5, 22, 5, '#f5d76e');
    circle(ctx, 14, 0, 5, '#fff9c4');
  },
  golem(ctx) {
    rect(ctx, -8, -8, 16, 16, '#8d7b68');
  },
  banana(ctx) {
    ctx.save();
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(0, 8, 12, -2.6, -0.5);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#f4d03f';
    ctx.stroke();
    ctx.restore();
  },
  pie(ctx) {
    circle(ctx, 4, 0, 10, '#d4a373');
    circle(ctx, 4, -2, 7, '#fffaf0', false);
  },
  tsunami(ctx) {
    circle(ctx, 2, 0, 8, '#2e86c1');
  },
  cactus(ctx) {
    rect(ctx, -4, -9, 8, 18, '#3f9e4d');
    rect(ctx, 4, -4, 6, 4, '#3f9e4d');
  },
  iceSpike(ctx) {
    poly(ctx, [[-8, 6], [0, -12], [8, 6]], '#aed6f1');
  },
  slot(ctx) {
    rect(ctx, -10, -9, 20, 18, '#d4ac0d');
    rect(ctx, -7, -5, 14, 8, '#ffffff');
  },
  magician(ctx) {
    // シルクハット
    rect(ctx, -6, -10, 12, 16, '#1a1a1a');
    rect(ctx, -10, 5, 20, 4, '#1a1a1a');
    rect(ctx, -6, 0, 12, 3, '#c0392b');
  },
  decoy(ctx) {
    circle(ctx, 2, 0, 7, '#95a5a6');
  },
  robot(ctx, ball) {
    if (ball.w.mode === 1) {
      rect(ctx, -6, -6, 22, 12, '#5d6d7e');
      rect(ctx, 14, -3, 8, 6, '#2c3e50');
    } else rect(ctx, -6, -5, 10, 10, '#5d6d7e');
  },
  iai(ctx, ball) {
    if (ball.w.slash > 0) return;
    // さや
    rect(ctx, -14, -3, 34, 6, '#1a1a1a');
    rect(ctx, -16, -5, 4, 10, '#d4ac0d');
  },
  conductor(ctx) {
    rect(ctx, -4, -1.5, 24, 3, '#ffffff');
  },
  ufo(ctx) {
    // 円盤
    ctx.save();
    ctx.fillStyle = '#aab7c4';
    ctx.beginPath();
    ctx.ellipse(0, 0, 8, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  },
  clown(ctx, ball) {
    // ジャグリング中のピン
    for (let i = 0; i < 3; i++) {
      const a = ball.w.t * 6 + (i * Math.PI * 2) / 3;
      rect(ctx, Math.cos(a) * 10 - 3, Math.sin(a) * 14 - 6, 6, 12, i % 2 ? '#ffffff' : '#e74c3c');
    }
  },
  sumo(ctx) {
    // まわし
    rect(ctx, -26, -6, 14, 12, '#2b2b6b');
  },
  judo(ctx) {
    // 黒帯
    rect(ctx, -24, -4, 10, 8, '#1a1a1a');
    rect(ctx, -18, 3, 4, 10, '#1a1a1a');
  },
  palm(ctx, ball) {
    const k = ball.w.timer > 1.15 ? 1.4 : 1;
    ctx.scale(k, k);
    rect(ctx, -2, -9, 10, 18, '#f1c9a5');
    for (let i = 0; i < 4; i++) rect(ctx, 8, -9 + i * 4.5, 6, 3.5, '#f1c9a5');
  },
  bearhug(ctx, ball) {
    if (ball.w.target) {
      rect(ctx, -10, -24, 14, 8, '#6b4220');
      rect(ctx, -10, 16, 14, 8, '#6b4220');
    } else {
      circle(ctx, -2, -10, 6, '#6b4220');
      circle(ctx, -2, 10, 6, '#6b4220');
    }
  },
  ironBody(ctx) {
    // 鉢巻き
    rect(ctx, -28, -4, 8, 8, '#e8484d');
  },
  rush(ctx, ball, t) {
    if (ball.w.on <= 0) {
      circle(ctx, 0, -9, 7, '#f1c9a5');
      circle(ctx, 0, 9, 7, '#f1c9a5');
      return;
    }
    // 連打中: たくさんの拳が見える
    for (let i = 0; i < 5; i++) {
      const y = Math.sin(t * 60 + i * 1.7) * 14;
      const x = 4 + ((t * 300 + i * 13) % 26);
      circle(ctx, x, y, 6, '#f1c9a5');
    }
  },
  cannon(ctx) {
    rect(ctx, -6, -9, 26, 18, '#3a3f47');
    rect(ctx, 18, -11, 6, 22, '#2a2e34');
  },
  charger(ctx) {
    // 角
    poly(ctx, [[-6, -10], [12, -18], [4, -6]], '#f4ead2');
    poly(ctx, [[-6, 10], [12, 18], [4, 6]], '#f4ead2');
  },
  lasso(ctx, ball) {
    if (ball.w.caught) return;
    ctx.beginPath();
    ctx.ellipse(8, 0, 10, 7, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#c2924f';
    ctx.lineWidth = 3;
    ctx.stroke();
  },
  timebomb(ctx, ball) {
    if (ball.w.active) return;
    circle(ctx, 4, 0, 9, '#2b2b2b');
    rect(ctx, -2, -4, 12, 8, '#d63b3b');
  },
  spring(ctx) {
    // 体の下のばね
    ctx.save();
    ctx.strokeStyle = '#9aa3ad';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) ctx.lineTo(-14 + i * 4, i % 2 ? -7 : 7);
    ctx.stroke();
    ctx.restore();
  },
  swap(ctx, ball, t) {
    ctx.rotate(t * 3);
    for (const a of [0, Math.PI]) {
      ctx.save();
      ctx.rotate(a);
      poly(ctx, [[2, -9], [11, -3], [2, 3]], '#e07ad1');
      ctx.restore();
    }
  },
  tesla(ctx) {
    rect(ctx, -3, -10, 6, 20, '#5b6470');
    circle(ctx, 0, -11, 4, '#7fe0ff');
  },
  sniperRifle(ctx) {
    rect(ctx, -8, -3, 34, 6, '#3d4a26');
    rect(ctx, 0, -8, 10, 5, '#222');
  },
  anvil(ctx) {
    poly(ctx, [[-10, -6], [12, -6], [8, 0], [4, 0], [6, 6], [-6, 6], [-4, 0], [-8, 0]], '#5b6470');
  },
  rocketFist(ctx, ball) {
    if (ball.w.out) return;
    circle(ctx, 6, 0, 9, '#d94a3a');
    rect(ctx, -6, -5, 8, 10, '#8a8f99');
  },
  drum(ctx, ball) {
    const k = Math.max(0, ball.w.timer) < 0.08 ? 1.2 : 1;
    ctx.scale(k, k);
    rect(ctx, -9, -8, 18, 16, '#c0392b');
    rect(ctx, -10, -9, 20, 4, '#f4ead2');
  },
  bowling(ctx) {
    circle(ctx, 4, 0, 10, '#2e4a7d');
    for (const [x, y] of [[1, -3], [6, -4], [4, 1]]) circle(ctx, x, y, 1.6, '#0e1a33', false);
  },
  frog(ctx) {
    // 体の前に出っぱった目
    circle(ctx, -10, -8, 6, '#ffffff');
    circle(ctx, -10, 8, 6, '#ffffff');
    circle(ctx, -8, -8, 2.5, '#1a1a1a', false);
    circle(ctx, -8, 8, 2.5, '#1a1a1a', false);
  },
  sakura(ctx, ball, t) {
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5 + t;
      circle(ctx, Math.cos(a) * 6, Math.sin(a) * 6, 5, '#ffc2dc');
    }
    circle(ctx, 0, 0, 3, '#ffe066', false);
  },
  pinball(ctx) {
    circle(ctx, 0, 0, 9, '#c9d1da');
    circle(ctx, -3, -3, 3, '#ffffff', false);
  },
  splitter(ctx, ball, t) {
    ctx.rotate(t * 2);
    rect(ctx, -9, -9, 18, 18, '#5fbf77');
    ctx.beginPath();
    ctx.moveTo(-9, 0);
    ctx.lineTo(9, 0);
    ctx.moveTo(0, -9);
    ctx.lineTo(0, 9);
    ctx.stroke();
  },
  balloon(ctx) {
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(0, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(8, 0, 10, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ff5c8a';
    ctx.fill();
    ctx.stroke();
  },
  cards(ctx) {
    ctx.rotate(-0.3);
    rect(ctx, -6, -9, 12, 18, '#ffffff');
    ctx.rotate(0.5);
    rect(ctx, -4, -9, 12, 18, '#ffffff');
    ctx.fillStyle = '#c0392b';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♥', 2, 0);
  },
  skeleton(ctx) {
    circle(ctx, 0, 0, 9, '#efe9dc');
    circle(ctx, -3, -1, 2.2, '#222', false);
    circle(ctx, 3, -1, 2.2, '#222', false);
  },
  firecracker(ctx, ball, t) {
    rect(ctx, -10, -5, 9, 10, '#e5383b');
    rect(ctx, 1, -5, 9, 10, '#e5383b');
    circle(ctx, 13, -6, 2.5 + Math.sin(t * 30), '#ffcc33', false);
  },
  urchin(ctx) {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 13, Math.sin(a) * 13);
      ctx.stroke();
    }
    circle(ctx, 0, 0, 7, '#3d2c5e');
  },
  plasma(ctx, ball, t) {
    circle(ctx, 0, 0, 9, '#b9a8ff');
    ctx.strokeStyle = '#7b5cff';
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i + t * 9;
      ctx.lineTo(Math.cos(a) * 12, Math.sin(a * 1.7) * 12);
    }
    ctx.stroke();
  },
  chakram(ctx, ball, t) {
    ctx.rotate(t * 12);
    circle(ctx, 0, 0, 11, '#f2c230');
    circle(ctx, 0, 0, 6, '#ffffff');
  },
  butterfly(ctx, ball, t) {
    const f = 0.5 + Math.abs(Math.sin(t * 10)) * 0.5;
    ctx.save();
    ctx.scale(f, 1);
    circle(ctx, -6, -5, 6, '#5ec8e5');
    circle(ctx, 6, -5, 6, '#5ec8e5');
    circle(ctx, -4, 5, 4, '#a7e8f7');
    circle(ctx, 4, 5, 4, '#a7e8f7');
    ctx.restore();
  },
  quake(ctx) {
    rect(ctx, -10, -6, 20, 12, '#8a6a45');
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(-2, -4);
    ctx.lineTo(2, 3);
    ctx.lineTo(8, -2);
    ctx.stroke();
  },
  phoenix(ctx, ball) {
    poly(ctx, [[-12, 6], [0, -12], [12, 6], [0, 2]], ball.w.revived ? '#ffd23f' : '#ff7a1a');
  },
  magnet(ctx) {
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#d64545';
    ctx.beginPath();
    ctx.arc(0, 0, 9, Math.PI * 0.5, Math.PI * 1.5, true);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = OUT;
    rect(ctx, -2, -13, 7, 8, '#dddddd');
    rect(ctx, -2, 5, 7, 8, '#dddddd');
  },
  star(ctx) {
    starShape(ctx, 11, '#f5d742');
  },
  axethrow(ctx) {
    shaft(ctx, -12, 10, '#7a4a26', 5);
    poly(ctx, [[4, -3], [0, -16], [12, -18], [16, -4]], STEEL);
  },
  danmaku(ctx, ball, t) {
    for (let i = 0; i < 5; i++) {
      const a = t * 4 + (i * Math.PI * 2) / 5;
      circle(ctx, Math.cos(a) * 9, Math.sin(a) * 9, 3.5, `hsl(${i * 72},90%,62%)`, false);
    }
  },
  lava(ctx) {
    circle(ctx, 0, 0, 9, '#e8461a');
    circle(ctx, -2, -2, 4, '#ffd23f', false);
  },
  gears(ctx, ball, t) {
    ctx.rotate(t * 3);
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      const rr = i % 2 ? 7 : 11;
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    poly(ctx, pts, '#a88b4a');
  },
  kamaitachi(ctx) {
    ctx.beginPath();
    ctx.arc(-4, 0, 11, -1.2, 1.2);
    ctx.arc(-11, 0, 10, 1.1, -1.1, true);
    ctx.closePath();
    ctx.fillStyle = '#bff2dc';
    ctx.fill();
    ctx.stroke();
  },
  bumper(ctx) {
    circle(ctx, 0, 0, 10, '#ff5fa2');
    circle(ctx, 0, 0, 5, '#ffd1e6');
  },
  prism(ctx) {
    poly(ctx, [[-10, 9], [0, -11], [10, 9]], '#e8dcff');
  },
  ghost(ctx) {
    ctx.beginPath();
    ctx.arc(0, -2, 9, Math.PI, 0);
    ctx.lineTo(9, 9);
    ctx.lineTo(-9, 9);
    ctx.closePath();
    ctx.fillStyle = '#f2f2ff';
    ctx.fill();
    ctx.stroke();
  },
  sticky(ctx) {
    circle(ctx, 0, 0, 9, '#d97a2b');
    circle(ctx, 3, -3, 3, '#ffe0b0', false);
  },
  web(ctx) {
    ctx.save();
    ctx.strokeStyle = '#8a8a96';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(-12 * Math.cos(i * 0.785), -12 * Math.sin(i * 0.785));
      ctx.lineTo(12 * Math.cos(i * 0.785), 12 * Math.sin(i * 0.785));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },
  vine(ctx) {
    poly(ctx, [[-4, 10], [-6, -4], [0, -12], [6, -4], [4, 10]], '#4c9a3a');
  },
  revolver(ctx) {
    rect(ctx, -8, -4, 26, 8, '#555');
    rect(ctx, -12, -2, 8, 14, '#7b4a26');
    circle(ctx, 0, 0, 5, '#888');
  },
  shark(ctx) {
    poly(ctx, [[-8, 8], [4, -12], [10, 8]], '#5c7ea8');
  },
  counter(ctx, ball) {
    const k = Math.min(1, ball.w.rage / 20);
    circle(ctx, 0, 0, 7 + k * 6, `rgba(214,90,90,${0.4 + 0.6 * k})`);
  },
  gravity(ctx, ball, t) {
    circle(ctx, 0, 0, 9, '#7a5fd1');
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    const y = Math.sin(t * 6) * 2;
    ctx.beginPath();
    ctx.moveTo(-4, 3 + y);
    ctx.lineTo(0, -4 + y);
    ctx.lineTo(4, 3 + y);
    ctx.stroke();
    ctx.restore();
  },
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
  slash(ctx, p) {
    // 伝説の剣の斬撃
    ctx.rotate(Math.atan2(p.vy, p.vx));
    ctx.save();
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#fff3b0';
    ctx.beginPath();
    ctx.arc(-6, 0, p.r + 4, -1.1, 1.1);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  },
  kiball(ctx, p) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    circle(ctx, 0, 0, p.r + 5, '#bdefff', false);
    ctx.restore();
    circle(ctx, 0, 0, p.r, '#5ec8f2');
    circle(ctx, -p.r * 0.3, -p.r * 0.3, p.r * 0.35, '#ffffff', false);
  },
  ink(ctx, p) {
    circle(ctx, 0, 0, p.r, '#1a1a2e');
  },
  frostcircle(ctx, p) {
    // 足元の魔法陣(だんだん光る)
    const k = p.age / p.life;
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.5 * k;
    ctx.strokeStyle = '#5dade2';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, p.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI * 2) / 6 + p.age * 2;
      ctx.lineTo(Math.cos(a) * p.r * 0.8, Math.sin(a) * p.r * 0.8);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = 'rgba(190,230,255,0.25)';
    ctx.fill();
    ctx.restore();
  },
  pillar(ctx, p) {
    // 予告の細い光
    ctx.save();
    ctx.globalAlpha = 0.2 + 0.4 * (p.age / p.life);
    ctx.fillStyle = '#f9e79f';
    ctx.fillRect(-4, -p.y, 8, 2000);
    ctx.restore();
  },
  golem(ctx, p) {
    rect(ctx, -p.r, -p.r, p.r * 2, p.r * 2, '#8d7b68');
    rect(ctx, -p.r * 0.6, -p.r * 0.5, 7, 7, '#f4d03f');
    rect(ctx, p.r * 0.2, -p.r * 0.5, 7, 7, '#f4d03f');
    const k = p.punch > 0 ? 18 : 0;
    rect(ctx, (p.face || 1) * (p.r - 2 + k) - 8, -4, 16, 14, '#6e5f4f');
  },
  peel(ctx, p) {
    poly(ctx, [[-12, 4], [-4, -6], [0, 2], [4, -6], [12, 4]], '#f4d03f');
  },
  pie(ctx, p) {
    ctx.rotate(p.age * 6);
    circle(ctx, 0, 0, p.r, '#d4a373');
    circle(ctx, 0, -2, p.r * 0.7, '#fffaf0', false);
  },
  hammerball(ctx, p) {
    circle(ctx, 0, 0, p.r, '#4a4f57');
    circle(ctx, -4, -4, 4, '#8a8f99', false);
  },
  cactus(ctx, p) {
    ctx.save();
    ctx.translate(0, p.r * (1 - p.grow));
    ctx.scale(1, Math.max(0.1, p.grow));
    rect(ctx, -8, -p.r, 16, p.r * 2, '#3f9e4d');
    rect(ctx, -18, -p.r * 0.3, 10, 6, '#3f9e4d');
    rect(ctx, 8, -p.r * 0.6, 10, 6, '#3f9e4d');
    ctx.restore();
  },
  spikeMark(ctx, p) {
    ctx.save();
    ctx.globalAlpha = 0.3 + 0.5 * (p.age / p.life);
    ctx.fillStyle = '#aed6f1';
    ctx.beginPath();
    ctx.ellipse(0, 0, p.r, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
  coin(ctx, p) {
    circle(ctx, 0, 0, p.r, '#f4d03f');
    circle(ctx, 0, 0, p.r * 0.5, '#d4ac0d', false);
  },
  pingball(ctx, p) {
    circle(ctx, 0, 0, p.r, '#ffffff');
  },
  dove(ctx, p) {
    ctx.rotate(Math.atan2(p.vy, p.vx));
    const f = Math.sin(p.age * 18) * 6;
    poly(ctx, [[-8, 0], [0, -10 - f], [4, 0], [0, 10 + f]], '#ffffff');
    circle(ctx, 6, 0, 4, '#ffffff');
  },
  rabbit(ctx, p) {
    circle(ctx, 0, 0, p.r, '#ffffff');
    rect(ctx, -6, -p.r - 10, 4, 12, '#ffffff');
    rect(ctx, 2, -p.r - 10, 4, 12, '#ffffff');
  },
  decoy(ctx, p) {
    ctx.save();
    ctx.globalAlpha = 0.7;
    circle(ctx, 0, 0, p.r, p.color || '#95a5a6');
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, 2);
    ctx.restore();
  },
  note(ctx, p) {
    circle(ctx, -3, 4, 5, '#1c2833');
    rect(ctx, 1, -10, 3, 14, '#1c2833');
  },
  laserbit(ctx, p) {
    ctx.rotate(Math.atan2(p.vy, p.vx));
    rect(ctx, -8, -2, 16, 4, '#76d7c4');
  },
  pin(ctx, p) {
    ctx.rotate(p.age * 12);
    rect(ctx, -3, -9, 6, 18, '#ffffff');
    rect(ctx, -3, -2, 6, 4, '#e74c3c');
  },
  cannonball(ctx, p) {
    circle(ctx, 0, 0, p.r, '#3a3f47');
    circle(ctx, -p.r * 0.35, -p.r * 0.35, p.r * 0.25, '#8a8f99', false);
  },
  loop(ctx, p) {
    ctx.beginPath();
    ctx.ellipse(0, 0, p.r, p.r * 0.7, p.age * 10, 0, Math.PI * 2);
    ctx.strokeStyle = '#c2924f';
    ctx.lineWidth = 4;
    ctx.stroke();
  },
  timebomb(ctx, p) {
    circle(ctx, 0, 0, p.r + 2, '#2b2b2b');
    rect(ctx, -p.r, -3, p.r * 2, 6, '#d63b3b');
    if (p.on) {
      // 残り時間(大きく点滅)
      const left = Math.max(0, p.life - p.age);
      ctx.fillStyle = Math.floor(left * 4) % 2 ? '#ff3030' : '#ffffff';
      ctx.font = `22px ${NUM_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeText(String(Math.ceil(left)), 0, -p.r - 14);
      ctx.fillText(String(Math.ceil(left)), 0, -p.r - 14);
    }
  },
  swapbomb(ctx, p) {
    circle(ctx, 0, 0, p.r, '#e07ad1');
    circle(ctx, 0, 0, p.r * 0.45, Math.floor(p.age * 10) % 2 ? '#ffffff' : '#ff3030', false);
  },
  post(ctx, p) {
    rect(ctx, -4, -12, 8, 24, '#5b6470');
    circle(ctx, 0, -13, 5, '#7fe0ff');
  },
  rifle(ctx, p) {
    ctx.rotate(Math.atan2(p.vy, p.vx));
    ctx.save();
    ctx.globalAlpha = 0.5;
    rect(ctx, -40, -1.5, 40, 3, '#ffd23f');
    ctx.restore();
    rect(ctx, -6, -2.5, 12, 5, '#f2c230');
  },
  anvilShadow(ctx, p) {
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.3 * (p.age / p.life);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 0, p.r * (0.6 + 0.4 * (p.age / p.life)), 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
  anvil(ctx, p) {
    poly(ctx, [[-22, -12], [24, -12], [16, 0], [8, 0], [12, 12], [-12, 12], [-8, 0], [-16, 0]], '#5b6470');
  },
  fist(ctx, p) {
    ctx.rotate(p.angle);
    rect(ctx, -16, -5, 10, 10, '#8a8f99');
    circle(ctx, 2, 0, p.r, '#d94a3a');
    ctx.save();
    ctx.globalAlpha = 0.6;
    circle(ctx, -22, 0, 5 + Math.random() * 3, '#ffb03a', false);
    ctx.restore();
  },
  bowl(ctx, p) {
    ctx.rotate(p.angle);
    circle(ctx, 0, 0, p.r, '#2e4a7d');
    for (const [x, y] of [[-0.2, -0.35], [0.2, -0.4], [0.05, -0.05]]) circle(ctx, x * p.r, y * p.r, p.r * 0.12, '#0e1a33', false);
  },
  petal(ctx, p) {
    ctx.rotate(p.spin);
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffc2dc';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();
  },
  pinball(ctx, p) {
    circle(ctx, 0, 0, p.r, '#c9d1da');
    circle(ctx, -p.r * 0.35, -p.r * 0.35, p.r * 0.3, '#ffffff', false);
  },
  cube(ctx, p) {
    ctx.rotate(p.angle);
    rect(ctx, -p.r, -p.r, p.r * 2, p.r * 2, p.gen > 1 ? '#5fbf77' : '#a8e6b8');
  },
  balloon(ctx, p) {
    ctx.beginPath();
    ctx.moveTo(0, p.r);
    ctx.lineTo(Math.sin(p.age * 6) * 4, p.r + 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, p.r * 0.85, p.r, 0, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${p.hue},85%,62%)`;
    ctx.fill();
    ctx.stroke();
    circle(ctx, -p.r * 0.3, -p.r * 0.4, p.r * 0.22, 'rgba(255,255,255,0.8)', false);
  },
  dart(ctx, p) {
    ctx.rotate(Math.atan2(p.vy, p.vx));
    rect(ctx, -10, -1.5, 14, 3, '#7a4a26');
    poly(ctx, [[4, -3], [10, 0], [4, 3]], STEEL);
    poly(ctx, [[-10, 0], [-14, -4], [-12, 0], [-14, 4]], '#ff5c8a');
  },
  card(ctx, p) {
    ctx.rotate(p.age * 14);
    rect(ctx, -6, -8, 12, 16, '#ffffff');
    ctx.fillStyle = p.suit === 1 || p.suit === 2 ? '#d62828' : '#1a1a1a';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♠♥♦♣'[p.suit], 0, 0);
  },
  skeleton(ctx, p) {
    const step = Math.sin(p.age * 14) * 4;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-4, 4);
    ctx.lineTo(-5 + step, 12);
    ctx.moveTo(4, 4);
    ctx.lineTo(5 - step, 12);
    ctx.stroke();
    rect(ctx, -5, -2, 10, 8, '#efe9dc');
    circle(ctx, 0, -7, 7, '#efe9dc');
    circle(ctx, -2.5, -8, 1.8, '#222', false);
    circle(ctx, 2.5, -8, 1.8, '#222', false);
  },
  bundle(ctx, p) {
    // 爆竹の束(くるくる回りながら飛ぶ)
    ctx.rotate(p.age * 9);
    for (const dx of [-6, 0, 6]) rect(ctx, dx - 3, -8, 6, 16, '#e5383b');
    rect(ctx, -9, -2, 18, 4, '#f2c230');
    circle(ctx, 0, -11, 2 + Math.random() * 2, '#ffcc33', false);
  },
  cracker(ctx, p) {
    rect(ctx, -3, -6, 6, 12, '#e5383b');
    circle(ctx, 0, -9, 2 + Math.random() * 2, '#ffcc33', false);
  },
  spine(ctx, p) {
    ctx.rotate(Math.atan2(p.vy, p.vx));
    poly(ctx, [[-8, -2.5], [9, 0], [-8, 2.5]], '#4b3a73');
  },
  plasma(ctx, p) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    circle(ctx, 0, 0, p.reach, '#7b5cff', false);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(160,140,255,0.9)';
    ctx.lineWidth = 2;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      const a = Math.random() * Math.PI * 2;
      for (let i = 1; i <= 4; i++) {
        const r = (p.reach * i) / 4;
        ctx.lineTo(Math.cos(a + (Math.random() - 0.5) * 0.6) * r, Math.sin(a + (Math.random() - 0.5) * 0.6) * r);
      }
      ctx.stroke();
    }
    ctx.restore();
    circle(ctx, 0, 0, p.r, '#b9a8ff');
    circle(ctx, 0, 0, p.r * 0.5, '#ffffff', false);
  },
  chakram(ctx, p) {
    ctx.rotate(p.angle);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      poly(ctx, [[Math.cos(a) * p.r, Math.sin(a) * p.r], [Math.cos(a + 0.5) * (p.r + 6), Math.sin(a + 0.5) * (p.r + 6)], [Math.cos(a + 0.6) * p.r, Math.sin(a + 0.6) * p.r]], STEEL);
    }
    circle(ctx, 0, 0, p.r, '#f2c230');
    circle(ctx, 0, 0, p.r * 0.5, '#ffffff');
  },
  butterfly(ctx, p) {
    const f = 0.35 + Math.abs(Math.sin(p.age * 14)) * 0.65;
    ctx.rotate(Math.atan2(p.vy, p.vx) + Math.PI / 2);
    ctx.lineWidth = 2;
    ctx.save();
    ctx.scale(f, 1);
    circle(ctx, -6, -3, 6, '#5ec8e5');
    circle(ctx, 6, -3, 6, '#5ec8e5');
    circle(ctx, -4, 5, 4, '#a7e8f7');
    circle(ctx, 4, 5, 4, '#a7e8f7');
    ctx.restore();
    rect(ctx, -1.5, -7, 3, 14, '#2a2a2a');
  },
  skillbolt(ctx, p) {
    ctx.rotate(p.angle || Math.atan2(p.vy, p.vx));
    poly(ctx, [[-8, -4], [9, 0], [-8, 4]], '#ffe680');
  },
  feather(ctx, p) {
    ctx.rotate(Math.atan2(p.vy, p.vx));
    poly(ctx, [[-10, 0], [0, -5], [10, 0], [0, 5]], '#ff9a3a');
    ctx.fillStyle = '#ffe08a';
    ctx.fillRect(-8, -1, 16, 2);
  },
  star(ctx, p) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#fff3a0';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-p.vx * 0.08, -p.vy * 0.08);
    ctx.stroke();
    ctx.restore();
    starShape(ctx, p.r + 4, '#f5d742');
  },
  ministar(ctx, p) {
    ctx.rotate(p.age * 8);
    starShape(ctx, p.r + 2, '#ffe680');
  },
  axe(ctx, p) {
    ctx.rotate(p.angle);
    shaft(ctx, -14, 10, '#7a4a26', 5);
    poly(ctx, [[4, -3], [0, -16], [12, -18], [16, -4]], STEEL);
  },
  orbbullet(ctx, p) {
    circle(ctx, 0, 0, p.r + 1, `hsl(${p.hue},90%,62%)`);
    circle(ctx, 0, 0, p.r * 0.45, '#ffffff', false);
  },
  raindrop(ctx, p) {
    ctx.fillStyle = '#6fa8ff';
    ctx.fillRect(-1.5, -7, 3, 10);
  },
  spiritsword(ctx, p) {
    ctx.rotate(p.angle);
    ctx.save();
    ctx.globalAlpha = 0.85;
    swordShape(ctx, -14, 16, 4, { guard: '#8fd9ff', grip: 6 });
    ctx.restore();
  },
  magma(ctx, p) {
    circle(ctx, 0, 0, p.r + 2, '#e8461a');
    circle(ctx, -2, -2, p.r * 0.5, '#ffd23f', false);
  },
  lava(ctx, p) {
    // 床一面の溶岩(p.x は中央)
    const k = Math.min(1, p.age / 0.25) * Math.min(1, (p.life - p.age) / 0.25);
    ctx.save();
    ctx.globalAlpha = k;
    ctx.fillStyle = '#ff5a1a';
    ctx.fillRect(-ARENA / 2, -14, ARENA, 18);
    ctx.fillStyle = '#ffd23f';
    for (let x = -ARENA / 2; x < ARENA / 2; x += 26) {
      const h = 4 + Math.sin(x * 0.2 + p.age * 10) * 3;
      ctx.fillRect(x, -14 - h, 12, h);
    }
    ctx.restore();
  },
  gear(ctx, p) {
    ctx.rotate(p.angle);
    const pts = [];
    for (let i = 0; i < 20; i++) {
      const a = (i * Math.PI) / 10;
      const rr = i % 2 ? p.r - 4 : p.r + 2;
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    poly(ctx, pts, '#a88b4a');
    circle(ctx, 0, 0, p.r * 0.35, '#5a4a2a');
  },
  wind(ctx, p) {
    ctx.rotate(Math.atan2(p.vy, p.vx));
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(-6, 0, p.r, -1.2, 1.2);
    ctx.arc(-14, 0, p.r * 0.9, 1.1, -1.1, true);
    ctx.closePath();
    ctx.fillStyle = '#bff2dc';
    ctx.fill();
    ctx.strokeStyle = '#4fae86';
    ctx.stroke();
    ctx.restore();
  },
  bumper(ctx, p) {
    const s = 1 + (p.pop > 0 ? 0.25 : 0);
    ctx.scale(s, s);
    circle(ctx, 0, 0, p.r, '#ff5fa2');
    circle(ctx, 0, 0, p.r * 0.6, '#ffd1e6');
    circle(ctx, 0, 0, p.r * 0.25, '#ff5fa2', false);
  },
  prismcharge(ctx, p) {
    const k = p.age / p.life;
    ctx.save();
    ctx.rotate(p.angle);
    ctx.strokeStyle = `rgba(176,124,255,${0.3 + 0.6 * k})`;
    ctx.lineWidth = 2 + k * 3;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(30, 0);
    ctx.lineTo(900, 0);
    ctx.stroke();
    ctx.restore();
  },
  ghost(ctx, p) {
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(0, -2, p.r, Math.PI, 0);
    for (let i = 0; i <= 4; i++) ctx.lineTo(p.r - (i * p.r) / 2, p.r + (i % 2 ? -4 : 2));
    ctx.closePath();
    ctx.fillStyle = '#f2f2ff';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = OUT;
    ctx.fillRect(-6, -5, 3, 5);
    ctx.fillRect(3, -5, 3, 5);
    ctx.restore();
  },
  mirrorbolt(ctx, p) {
    ctx.rotate(p.angle);
    ctx.save();
    ctx.globalAlpha = 0.5;
    rect(ctx, -18, -3, 14, 6, '#c9ecf7');
    ctx.restore();
    poly(ctx, [[-6, -5], [10, 0], [-6, 5]], '#ffffff');
  },
  sticky(ctx, p) {
    const blink = p.stuck && Math.floor(p.age * 10) % 2 === 0;
    circle(ctx, 0, 0, p.r, blink ? '#ff4040' : '#d97a2b');
  },
  webball(ctx, p) {
    circle(ctx, 0, 0, p.r, '#e8e8f0');
  },
  web(ctx, p) {
    const k = Math.min(1, p.age / 0.2) * Math.min(1, (p.life - p.age) / 0.4);
    ctx.save();
    ctx.globalAlpha = 0.8 * k;
    ctx.strokeStyle = '#9a9aa8';
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * p.r, Math.sin(a) * p.r);
      ctx.stroke();
    }
    for (let r = p.r * 0.3; r <= p.r; r += p.r * 0.23) {
      ctx.beginPath();
      for (let i = 0; i <= 8; i++) {
        const a = (i * Math.PI) / 4;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  },
  vine(ctx, p) {
    // 床から上へ伸びるトゲのツタ
    const h = p.height;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.fillStyle = '#4c9a3a';
    ctx.fillRect(-7, -h, 14, h);
    ctx.strokeRect(-7, -h, 14, h);
    ctx.fillStyle = '#d8e8a0';
    for (let y = 20; y < h; y += 24) {
      const s = (y / 24) % 2 ? 1 : -1;
      poly(ctx, [[s * 7, -y], [s * 16, -y - 6], [s * 7, -y - 10]], '#d8e8a0');
    }
    poly(ctx, [[-9, -h], [0, -h - 14], [9, -h]], '#3a7a2c');
    ctx.restore();
  },
  shark(ctx, p) {
    const dir = Math.sign(p.vx) || 1;
    ctx.scale(dir, 1);
    poly(ctx, [[-20, 0], [-8, -10], [14, -8], [22, 0], [14, 8], [-8, 8]], '#5c7ea8');
    poly(ctx, [[-4, -9], [2, -22], [8, -8]], '#4a6890');
    poly(ctx, [[-20, 0], [-28, -9], [-26, 0], [-28, 9]], '#4a6890');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(10, 1, 9, 3);
    ctx.fillStyle = OUT;
    ctx.fillRect(12, -5, 3, 3);
  },
  cwave(ctx, p) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - p.ring / 220);
    ctx.strokeStyle = '#d65a5a';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(0, 0, p.ring, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },
  gorb(ctx, p) {
    circle(ctx, 0, 0, p.r + 3, '#7a5fd1');
    circle(ctx, 0, 0, p.r - 3, '#d9ccff', false);
  },
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
    this.prisms = [];
    this.ko = null;
    this.labels = null; // ボールの上に出す名札 [{ text, color }]
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
    ARENA = world.size;
    for (const e of events) {
      if (e.type === 'hit') {
        const target = world.balls[e.target];
        const color = (world.balls[e.src] || world.balls[(e.target + 1) % world.balls.length]).def.color;
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
      } else if (e.type === 'timestop') {
        const ball = world.balls[e.target];
        this.texts.push({ x: ball.x, y: ball.y - 50, text: '時間停止！', color: '#c9a227', life: 0.9, age: 0, size: 24, jp: true });
        this.rings.push({ x: ball.x, y: ball.y, r0: 80, r1: ball.r, life: 0.3, age: 0, color: '#e0c36a' });
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
      } else if (e.type === 'pillar') {
        // 光の柱(天井から床まで)
        this.beams.push({ x: e.x, y: 0, angle: Math.PI / 2, width: 46, len: ARENA, colors: ['rgba(255,240,150,0.4)', '#fff3b0', '#ffffff'], life: 0.35, age: 0 });
        this.flashA = Math.max(this.flashA, 0.15);
      } else if (e.type === 'icespike') {
        for (let i = 0; i < 3; i++) this.particles.push({ x: e.x + (Math.random() - 0.5) * 30, y: ARENA - 4, vx: (Math.random() - 0.5) * 120, vy: -200 - Math.random() * 300, life: 0.5, age: 0, color: '#d6eaf8', size: 6 });
        this.beams.push({ x: e.x, y: ARENA, angle: -Math.PI / 2, width: 40, len: e.h, colors: ['rgba(120,190,240,0.4)', '#aed6f1', '#ffffff'], life: 0.3, age: 0 });
      } else if (e.type === 'jackpot') {
        this.texts.push({ x: e.x, y: e.y - 70, text: '大当たり！', color: '#d62828', life: 1.2, age: 0, size: 30, jp: true });
        this.flashA = Math.max(this.flashA, 0.4);
      } else if (e.type === 'iai') {
        this.flashA = Math.max(this.flashA, 0.2);
        this.texts.push({ x: e.x, y: e.y - 60, text: '斬！', color: '#922b21', life: 0.6, age: 0, size: 28, jp: true });
      } else if (e.type === 'shock') {
        // スキルの衝撃波(つむじ風・光の覚醒など)
        this.rings.push({ x: e.x, y: e.y, r0: 20, r1: e.r, life: 0.35, age: 0, color: e.color, fill: true });
        this.shake = Math.min(10, this.shake + 3);
      } else if (e.type === 'boom') {
        const potion = e.kind === 'potion';
        this.rings.push({ x: e.x, y: e.y, r0: e.radius * 0.3, r1: e.radius, life: 0.3, age: 0, color: potion ? '#d6335a' : '#ff7a1a', fill: true, strong: true });
        this.rings.push({ x: e.x, y: e.y, r0: 4, r1: e.radius * 0.6, life: 0.14, age: 0, color: '#fff3b0', fill: true, strong: true });
        this.burst(e.x, e.y, 12, potion ? '#ff8fb0' : '#ffb03a', 1.3);
        this.shake = Math.min(12, this.shake + 4);
      } else if (e.type === 'out' && world.balls.length > 2 && !world.over) {
        // 3人以上: 途中で倒れた人
        const ball = world.balls[e.target];
        this.burst(ball.x, ball.y, 40, ball.def.color, 2.2);
        this.rings.push({ x: ball.x, y: ball.y, r0: ball.r, r1: 180, life: 0.45, age: 0, color: ball.def.color, fill: true, strong: true });
        this.texts.push({ x: ball.x, y: ball.y - 50, text: 'OUT', color: '#222', life: 1.2, age: 0, size: 34 });
        this.shake = Math.min(18, this.shake + 10);
      } else if (e.type === 'end') {
        const outs = world.outOrder || [];
        const loser = world.balls.length === 2 ? world.balls[1 - e.winner] : world.balls[outs[outs.length - 1]];
        if (loser && loser.dead) {
          // K.O.!: 大きな文字・白いフラッシュ・強い揺れ・飛び散る破片
          this.burst(loser.x, loser.y, 60, loser.def.color, 2.6);
          this.burst(loser.x, loser.y, 30, '#ffffff', 2);
          this.rings.push({ x: loser.x, y: loser.y, r0: loser.r, r1: 260, life: 0.5, age: 0, color: loser.def.color, fill: true, strong: true });
          this.ko = { age: 0, life: 1.6 };
          this.flashA = 0.7;
          this.shake = 22;
        }
      } else if (e.type === 'quake') {
        this.shake = Math.min(16, this.shake + 7);
        for (let i = 0; i < 16; i++) {
          this.particles.push({ x: Math.random() * ARENA, y: ARENA - 4, vx: (Math.random() - 0.5) * 120, vy: -150 - Math.random() * 250, life: 0.5, age: 0, color: '#a07a50', size: 6 });
        }
      } else if (e.type === 'rebirth') {
        const ball = world.balls[e.target];
        this.texts.push({ x: ball.x, y: ball.y - 55, text: '復活！', color: '#ff7a1a', life: 1.2, age: 0, size: 30, jp: true });
        this.burst(ball.x, ball.y, 40, '#ffb03a', 2);
        this.rings.push({ x: ball.x, y: ball.y, r0: 10, r1: 140, life: 0.5, age: 0, color: '#ff7a1a', fill: true, strong: true });
        this.flashA = Math.max(this.flashA, 0.4);
      } else if (e.type === 'combo') {
        this.texts.push({ x: e.x, y: e.y - 52, text: `${e.n}コンボ`, color: '#ff7a1a', life: 0.6, age: 0, size: 18 + Math.min(14, e.n), jp: true });
      } else if (e.type === 'crit') {
        this.texts.push({ x: e.x, y: e.y - 44, text: '会心！', color: '#ff3b3b', life: 0.7, age: 0, size: 22, jp: true });
      } else if (e.type === 'dodge') {
        const ball = world.balls[e.target];
        this.texts.push({ x: ball.x, y: ball.y - 46, text: 'ミス', color: '#7a8a99', life: 0.6, age: 0, size: 20, jp: true });
      } else if (e.type === 'guts') {
        const ball = world.balls[e.target];
        this.texts.push({ x: ball.x, y: ball.y - 55, text: '根性！', color: '#e8484d', life: 1.1, age: 0, size: 28, jp: true });
        this.burst(ball.x, ball.y, 24, '#ffd23f', 1.6);
        this.flashA = Math.max(this.flashA, 0.3);
      } else if (e.type === 'magnet') {
        this.rings.push({ x: e.x, y: e.y, r0: 4, r1: 22, life: 0.2, age: 0, color: '#d64545' });
      } else if (e.type === 'evolve') {
        // 大器晩成の武器の進化・レベルアップ・変身
        const ball = world.balls[e.target];
        const c = e.color || '#8b3fe0';
        this.texts.push({ x: ball.x, y: ball.y - ball.r - 34, text: e.text, color: c, life: 1.3, age: 0, size: 28, jp: true });
        this.rings.push({ x: ball.x, y: ball.y, r0: ball.r, r1: ball.r * 3, life: 0.45, age: 0, color: c, fill: true, strong: true });
        this.burst(ball.x, ball.y, 24, '#ffffff', 1.6);
        this.flashA = Math.max(this.flashA, 0.2);
      } else if (e.type === 'prism') {
        this.prisms.push({ segs: e.segs, age: 0, life: 0.35 });
        this.shake = Math.min(14, this.shake + 6);
        this.flashA = Math.max(this.flashA, 0.2);
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
    for (const b of this.prisms) b.age += dt;
    this.prisms = this.prisms.filter((b) => b.age < b.life);
    if (this.ko) {
      this.ko.age += dt;
      if (this.ko.age > this.ko.life) this.ko = null;
    }
    this.beams = this.beams.filter((b) => b.age < b.life);
    this.flashA = Math.max(0, this.flashA - dt * 3);
    this.bolts = this.bolts.filter((b) => b.age < b.life);
    this.rings = this.rings.filter((r) => r.age < r.life);
  }

  draw(world) {
    const ctx = this.ctx;
    const t = this.time;
    const W = this.canvas.width;
    ARENA = world.size;
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
        // 透明(カメレオン)
        ctx.save();
        if (b.alpha !== undefined && b.alpha < 1) ctx.globalAlpha = b.alpha;
        this.drawWeapon(ctx, b, t);
        this.drawBall(ctx, b);
        this.drawOver(ctx, b);
        ctx.restore();
        if (b.pieT > 0) {
          // 顔にパイ
          b.pieT -= 1 / 60;
          circle(ctx, b.x, b.y - b.r * 0.2, b.r * 0.6, '#fffaf0', false);
        }
        if (b.inkT > 0) {
          b.inkT -= 1 / 60;
          ctx.save();
          ctx.globalAlpha = 0.6;
          circle(ctx, b.x + b.r * 0.3, b.y - b.r * 0.3, b.r * 0.45, '#1a1a2e', false);
          ctx.restore();
        }
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
    for (const pr of this.prisms) {
      // 虹色の反射レーザー
      const k = pr.age / pr.life;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.lineCap = 'round';
      pr.segs.forEach(([x1, y1, x2, y2], i) => {
        for (const [w, c] of [[22, `hsla(${(i * 70 + 270) % 360},90%,60%,0.35)`], [9, `hsl(${(i * 70 + 270) % 360},90%,65%)`], [3, '#ffffff']]) {
          ctx.lineWidth = w;
          ctx.strokeStyle = c;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      });
      ctx.restore();
    }
    for (const bm of this.beams) {
      // レーザー: 太い光の帯
      const k = bm.age / bm.life;
      const ex = bm.x + Math.cos(bm.angle) * (bm.len ?? 1000);
      const ey = bm.y + Math.sin(bm.angle) * (bm.len ?? 1000);
      const [c0, c1, c2] = bm.colors || ['rgba(255,60,90,0.35)', '#ff3355', '#ffffff'];
      ctx.save();
      for (const [w, c] of [[bm.width * 2.2, c0], [bm.width, c1], [bm.width * 0.4, c2]]) {
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
        // どんな色のボールでも(白っぽいボールや、当たって白く光ったときも)読めるように黒い縁取りを付ける
        main.lineWidth = 6;
        main.lineJoin = 'round';
        main.strokeStyle = '#1a1a1a';
        main.strokeText(String(hp), b.x, b.y + 1);
        main.fillStyle = b.flash > 0 ? '#ff5a5a' : '#ffffff';
        main.fillText(String(hp), b.x, b.y + 1);
        // 3人以上などで「どれが誰か」を出す名札(P1 など)
        const tag = this.labels && this.labels[b.id];
        if (tag) {
          main.font = `22px ${NUM_FONT}`;
          const w = main.measureText(tag.text).width + 14;
          const ty = b.y - b.r - 20;
          main.fillStyle = tag.color;
          main.strokeStyle = OUT;
          main.lineWidth = 3;
          main.beginPath();
          if (main.roundRect) main.roundRect(b.x - w / 2, ty - 13, w, 26, 7);
          else main.rect(b.x - w / 2, ty - 13, w, 26);
          main.fill();
          main.stroke();
          main.fillStyle = '#ffffff';
          main.fillText(tag.text, b.x, ty + 1);
        }
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
    if (this.ko) {
      const k = this.ko.age / this.ko.life;
      const pop = k < 0.15 ? 0.4 + (k / 0.15) * 0.8 : 1.2 - Math.min(0.2, (k - 0.15));
      main.save();
      main.globalAlpha = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
      main.translate(ARENA / 2, ARENA / 2);
      main.rotate(-0.08);
      main.scale(pop, pop);
      main.font = `130px ${NUM_FONT}`;
      main.lineWidth = 14;
      main.strokeStyle = '#161616';
      main.strokeText('K.O.!', 0, 0);
      main.fillStyle = '#ffd23f';
      main.fillText('K.O.!', 0, 0);
      main.restore();
    }
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
    } else if (id === 'ember') {
      // 火種の炎(大きくなるほど赤く)
      const R = b.r + b.w.rad;
      const k = Math.min(1, b.w.stage / 3);
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.05 * Math.sin(t * 12);
      ctx.fillStyle = k > 0.6 ? '#e8481a' : '#ff9a3c';
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const rr = R * (0.92 + 0.08 * Math.sin(a * 5 + t * 9));
        ctx.lineTo(b.x + Math.cos(a) * rr, b.y + Math.sin(a) * rr);
      }
      ctx.fill();
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
      ctx.rotate((bl.free ? bl.rot : b.angle) + bl.off);
      // 動画のドット絵のように太めに見せる(当たり判定の太さは変えない)
      ctx.scale(1, 1.5);
      fn(ctx, bl, t);
      ctx.restore();
    }
    if (def.id === 'egg' && b.w.stage >= 3) {
      // ドラゴンの翼と、火の息
      ctx.save();
      const flap = Math.sin(t * 10) * 0.25;
      for (const s of [-1, 1]) {
        const a = b.angle + Math.PI + s * (1.2 + flap);
        const x = b.x + Math.cos(a) * (b.r + 30);
        const y = b.y + Math.sin(a) * (b.r + 30);
        const a1 = b.angle + Math.PI + s * 0.6;
        poly(ctx, [[b.x, b.y], [x, y], [b.x + Math.cos(a1) * (b.r + 14), b.y + Math.sin(a1) * (b.r + 14)]], '#1e6b45');
      }
      if (b.w.breath > 0) {
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = '#ff7a1a';
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(b.angle) * b.r, b.y + Math.sin(b.angle) * b.r);
        ctx.arc(b.x, b.y, b.r + 170, b.angle - 0.45, b.angle + 0.45);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(b.angle) * b.r, b.y + Math.sin(b.angle) * b.r);
        ctx.arc(b.x, b.y, b.r + 110, b.angle - 0.25, b.angle + 0.25);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    } else if (def.id === 'hero' && b.w.on > 0) {
      // 変身中: 金色のオーラ
      ctx.save();
      ctx.globalAlpha = 0.45 + 0.2 * Math.sin(t * 14);
      circle(ctx, b.x, b.y, b.r + 12, '#ffd23f', false);
      ctx.restore();
    } else if (def.id === 'moon' && b.w.stage >= 3 && b.w.timer > 2.7) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      circle(ctx, b.x, b.y, b.r + 140, '#fff6c2', false);
      ctx.restore();
    }
    if (def.id === 'turtle' && b.w.shell > 0) {
      // 甲羅にこもっている
      ctx.save();
      circle(ctx, b.x, b.y, b.r + 6, '#3d6b28');
      ctx.strokeStyle = '#a3c96a';
      ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        const a = b.angle + (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x + Math.cos(a) * (b.r + 4), b.y + Math.sin(a) * (b.r + 4));
        ctx.stroke();
      }
      ctx.restore();
    } else if (def.id === 'windBarrier') {
      ctx.save();
      ctx.strokeStyle = 'rgba(120,210,190,0.6)';
      ctx.lineWidth = 3;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 26 + k * 4, b.w.spin + k * 2, b.w.spin + k * 2 + 2.2);
        ctx.stroke();
      }
      ctx.restore();
    } else if (def.id === 'tsunami' && b.w.wave) {
      // おしよせる波
      const v = b.w.wave;
      ctx.save();
      ctx.fillStyle = 'rgba(46,134,193,0.55)';
      ctx.beginPath();
      ctx.moveTo(v.x - v.dir * 140, ARENA);
      ctx.lineTo(v.x - v.dir * 140, ARENA - v.h * 0.6);
      ctx.quadraticCurveTo(v.x - v.dir * 30, ARENA - v.h * 1.1, v.x + v.dir * 30, ARENA - v.h * 0.7);
      ctx.lineTo(v.x + v.dir * 20, ARENA);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.restore();
    } else if (def.id === 'slot') {
      // スロットの目(回っている間と、止まった直後)
      if (b.w.spin > 0 || b.w.timer > 1.6) {
        ctx.save();
        rect(ctx, b.x - 40, b.y - b.r - 44, 80, 30, '#2c2c2c');
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        b.w.reels.forEach((sym, i) => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(b.x - 37 + i * 25, b.y - b.r - 41, 23, 24);
          ctx.fillStyle = sym === '7' ? '#d62828' : '#1a1a1a';
          ctx.fillText(sym, b.x - 25.5 + i * 25, b.y - b.r - 28);
        });
        ctx.restore();
      }
    } else if (def.id === 'bubbleGum' && b.w.size > 0) {
      ctx.save();
      ctx.globalAlpha = 0.8;
      circle(ctx, b.w.bx, b.w.by, b.w.size, '#ff8fc8');
      circle(ctx, b.w.bx - b.w.size * 0.35, b.w.by - b.w.size * 0.35, b.w.size * 0.2, '#ffffff', false);
      ctx.restore();
    } else if (def.id === 'shrinkRay' && b.w.beam > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(192,107,214,0.85)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x + Math.cos(b.w.beamA) * 1400, b.y + Math.sin(b.w.beamA) * 1400);
      ctx.stroke();
      ctx.restore();
    } else if (def.id === 'ufo' && b.w.lift > 0 && b.w.target) {
      // 吸い上げる光線
      const o = b.w.target;
      ctx.save();
      ctx.fillStyle = 'rgba(163,247,230,0.35)';
      ctx.beginPath();
      ctx.moveTo(b.x - 14, b.y);
      ctx.lineTo(b.x + 14, b.y);
      ctx.lineTo(o.x + o.r + 10, o.y + o.r);
      ctx.lineTo(o.x - o.r - 10, o.y + o.r);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (def.id === 'lasso' && b.w.caught) {
      // 捕まえた相手へのロープ
      ctx.save();
      ctx.strokeStyle = '#c2924f';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.w.caught.x, b.w.caught.y);
      ctx.stroke();
      ctx.restore();
    } else if (def.id === 'tesla') {
      // 柱どうしの電気(ジグザグ)
      const posts = b.w.posts.filter((p) => !p.dead);
      ctx.save();
      ctx.strokeStyle = 'rgba(80,200,255,0.9)';
      ctx.lineWidth = 3;
      for (let i = 0; i + 1 < posts.length; i++) {
        const a = posts[i];
        const c = posts[i + 1];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y - 13);
        for (let k = 1; k < 8; k++) {
          const f = k / 8;
          ctx.lineTo(a.x + (c.x - a.x) * f + (Math.random() - 0.5) * 10, a.y - 13 + (c.y - a.y) * f + (Math.random() - 0.5) * 10);
        }
        ctx.lineTo(c.x, c.y - 13);
        ctx.stroke();
      }
      ctx.restore();
    } else if (def.id === 'sniperRifle' && b.w.aiming) {
      // ねらいの赤い線
      ctx.save();
      ctx.strokeStyle = 'rgba(255,40,40,0.55)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x + Math.cos(b.angle) * 1400, b.y + Math.sin(b.angle) * 1400);
      ctx.stroke();
      ctx.restore();
    } else if (def.id === 'shadow') {
      // 影: うっすら黒いもや
      ctx.save();
      ctx.globalAlpha = 0.25;
      circle(ctx, b.x - b.vx * 0.03, b.y - b.vy * 0.03, b.r + 6, '#3b2a5c', false);
      ctx.restore();
    }
    if (def.id === 'drones') {
      for (const [x, y] of def.drones(b)) {
        rect(ctx, x - 9, y - 4, 18, 8, '#5f7d8c');
        ctx.fillStyle = 'rgba(200,220,230,0.8)';
        ctx.fillRect(x - 13, y - 7, 8, 2);
        ctx.fillRect(x + 5, y - 7, 8, 2);
      }
    } else if (def.id === 'wrecking') {
      const w = b.w;
      for (let i = 1; i < 18; i++) {
        const k = i / 18;
        ctx.fillStyle = i % 2 ? '#555' : '#999';
        ctx.fillRect(ARENA / 2 + (w.hx - ARENA / 2) * k - 3, w.hy * k - 3, 6, 6);
      }
      circle(ctx, w.hx, w.hy, 30, '#3a3a40');
      circle(ctx, w.hx - 9, w.hy - 9, 8, '#6a6a74', false);
    } else if (def.id === 'storm') {
      const w = b.w;
      ctx.save();
      ctx.globalAlpha = 0.9;
      for (const [dx, dy, r] of [[-34, 6, 22], [-10, -6, 28], [20, 2, 24], [40, 8, 18]]) circle(ctx, w.cx + dx, w.cy + dy, r, '#7d8ba3', false);
      ctx.restore();
    } else if (def.id === 'spirit') {
      const n = Math.floor(b.w.n);
      ctx.save();
      ctx.globalAlpha = 0.75;
      for (let i = 0; i < n; i++) {
        const a = b.angle + (i * Math.PI * 2) / n;
        ctx.save();
        ctx.translate(b.x + Math.cos(a) * 58, b.y + Math.sin(a) * 58);
        ctx.rotate(a + Math.PI / 2);
        swordShape(ctx, -16, 16, 4, { guard: '#8fd9ff', grip: 6 });
        ctx.restore();
      }
      ctx.restore();
    } else if (def.id === 'orbital') {
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

  // ボールより上に描くもの(大器晩成の武器の今の姿など)
  drawOver(ctx, b) {
    const id = b.def.id;
    const w = b.w;
    const x = b.x;
    const y = b.y;
    const r = b.r;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUT;
    if (id === 'egg') {
      if (w.stage === 0) {
        // ひび
        ctx.beginPath();
        ctx.moveTo(x - r * 0.7, y - r * 0.1);
        for (let i = 1; i <= 6; i++) ctx.lineTo(x - r * 0.7 + (i * r * 1.4) / 6, y - r * 0.1 + (i % 2 ? -7 : 5));
        ctx.stroke();
      } else if (w.stage === 1) {
        poly(ctx, [[x - 5, y - r + 2], [x, y - r - 12], [x + 5, y - r + 2]], '#ffb300');
      } else if (w.stage === 2) {
        for (let i = -1; i <= 1; i++) circle(ctx, x + i * 8, y - r - 4 - (i ? 0 : 4), 6, '#e8484d');
      } else {
        for (const s of [-1, 1]) poly(ctx, [[x + s * 10, y - r + 6], [x + s * 18, y - r - 16], [x + s * 22, y - r + 10]], '#f2e6c8');
      }
    } else if (id === 'pebble') {
      circle(ctx, x - r * 0.35, y - r * 0.2, r * 0.18, '#7d7d7d', false);
      circle(ctx, x + r * 0.3, y + r * 0.3, r * 0.14, '#7d7d7d', false);
      if (w.stage >= 2) {
        ctx.strokeStyle = '#5f5f5f';
        ctx.beginPath();
        ctx.moveTo(x + r * 0.1, y - r * 0.7);
        ctx.lineTo(x - r * 0.1, y - r * 0.2);
        ctx.lineTo(x + r * 0.2, y + r * 0.1);
        ctx.stroke();
      }
    } else if (id === 'piggy') {
      for (const s of [-1, 1]) poly(ctx, [[x + s * r * 0.3, y - r * 0.85], [x + s * r * 0.6, y - r * 1.2], [x + s * r * 0.75, y - r * 0.6]], '#f08aaf');
      ctx.fillStyle = '#e57399';
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.15, r * 0.32, r * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      rect(ctx, x - 9, y - r - 4, 18, 5, '#5a2a3a');
      // 貯まり具合
      const k = Math.min(1, w.coins / w.goal);
      ctx.fillStyle = '#f4d03f';
      ctx.fillRect(x - r * 0.6, y + r * 0.6, r * 1.2 * k, 5);
    } else if (id === 'monk') {
      rect(ctx, x - r * 0.95, y - r * 0.45, r * 1.9, 7, '#ffffff');
    } else if (id === 'apprentice') {
      poly(ctx, [[x - r * 0.8, y - r * 0.6], [x + r * 0.1, y - r * 1.7], [x + r * 0.8, y - r * 0.6]], '#3a3c8c');
      ctx.save();
      ctx.translate(x - r * 0.05, y - r * 1.05);
      starShape(ctx, 6, '#ffd23f');
      ctx.restore();
    } else if (id === 'hero') {
      rect(ctx, x - r * 0.75, y - r * 0.35, r * 1.5, r * 0.32, w.on > 0 ? '#ffd23f' : '#1a1a1a');
      // ゲージ
      if (w.on <= 0) {
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(x - r * 0.6, y + r * 0.55, r * 1.2 * Math.min(1, w.gauge / w.need), 5);
      }
    } else if (id === 'ember') {
      ctx.save();
      ctx.translate(x, y - r * 0.15);
      const s = 0.8 + w.stage * 0.25;
      ctx.scale(s, s);
      poly(ctx, [[-10, 8], [-12, -4], [-4, -10], [0, -22], [6, -10], [12, -4], [10, 8]], '#ff6a1a');
      poly(ctx, [[-5, 8], [-5, 0], [0, -10], [5, 0], [5, 8]], '#ffd23f');
      ctx.restore();
    }
    ctx.restore();
  }

  drawBall(ctx, b) {
    ctx.save();
    if (b.awaken > 0) {
      // 武器進化: 段階が上がるほど光のトゲが増え、色が変わる(改 橙 → 真 桃 → 極 紫 → 神 金)
      const tier = b.awaken;
      const color = ['#ff7a1a', '#ff3d9a', '#8b3fe0', '#f2c230'][Math.min(3, tier - 1)];
      const n = 6 + Math.min(10, tier * 2);
      const spin = this.time * (1 + tier * 0.4);
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.15 * Math.sin(this.time * 6);
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < n * 2; i++) {
        const a = spin + (i * Math.PI) / n;
        const r = i % 2 ? b.r + 4 : b.r + 14 + Math.min(16, tier * 3);
        const x = b.x + Math.cos(a) * r;
        const y = b.y + Math.sin(a) * r;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.lineWidth = 3;
    circle(ctx, b.x, b.y, b.r, b.flash > 0 ? '#ffffff' : b.color || b.def.color);
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
    if (b.barrier > 0) {
      // バリア: 青い泡
      ctx.save();
      ctx.strokeStyle = 'rgba(80,170,255,0.8)';
      ctx.fillStyle = 'rgba(80,170,255,0.12)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    if (b.freeze > 0) {
      // 時間停止中: 灰色の膜と時計の針
      ctx.save();
      ctx.fillStyle = 'rgba(120,120,120,0.45)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (b.gravFlip > 0) {
      // 重力反転中: 上向きの矢印
      ctx.save();
      ctx.strokeStyle = '#7a5fd1';
      ctx.lineWidth = 4;
      for (const dx of [-14, 14]) {
        const y = b.y + b.r + 12;
        ctx.beginPath();
        ctx.moveTo(b.x + dx - 6, y);
        ctx.lineTo(b.x + dx, y - 8);
        ctx.lineTo(b.x + dx + 6, y);
        ctx.stroke();
      }
      ctx.restore();
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
  if (def.id === 'copycat') {
    // ものまね: 灰色のボールに「?」
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.lineWidth = size / 30;
    ctx.strokeStyle = OUT;
    circle(ctx, size * 0.42, size * 0.58, size * 0.22, '#b9b9b9');
    ctx.fillStyle = OUT;
    ctx.font = `bold ${size * 0.26}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', size * 0.42, size * 0.59);
    ctx.font = `${size * 0.3}px sans-serif`;
    ctx.fillText('🪞', size * 0.76, size * 0.26);
    return;
  }
  const world = createBattle(def, def, 1);
  ARENA = world.size;
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
  r.drawOver(ctx, b);
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
Renderer.Icon.prototype.drawOver = Renderer.prototype.drawOver;

