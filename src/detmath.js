// どのブラウザ・どの端末でも「まったく同じ答え」になる数学関数。試合の計算(engine・武器・スキル・ボス)はこれを使う。
//
// Math.sin・cos・atan2・hypot・** の答えは、ブラウザ(Chrome / Safari / Firefox)ごとに最後の桁が少しちがうことがある。
// ボールの動きはその差がどんどん大きくなるので、オンラインで人によって試合の結果が変わってしまった(2026-11-04)。
// ここでは、どこでも答えが同じと決まっている + - * / と Math.sqrt・floor・round だけで計算する(fdlibm と同じ手順)。
// 描画(render.js)は見た目だけなので、ふつうの Math のままでよい。

// ---- sin・cos ----
const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417e0; // π/2 を3つに分けたもの(かけ算の誤差が出ないように)
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_3 = 2.02226624871116645580e-21;
const S1 = -1.66666666666666324348e-1, S2 = 8.33333333332248946124e-3, S3 = -1.98412698298579493134e-4,
  S4 = 2.75573137070700676789e-6, S5 = -2.50507602534068634195e-8, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2, C2 = -1.38888888888741095749e-3, C3 = 2.48015872894767294178e-5,
  C4 = -2.75573143513906633035e-7, C5 = 2.08757232129817482790e-9, C6 = -1.13596475577881948265e-11;

function ksin(x) {
  const z = x * x;
  return x + x * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}

function kcos(x) {
  const z = x * x;
  return 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
}

// x = n·(π/2) + r(|r| ≤ π/4)
function reduce(x) {
  const n = Math.round(x * INV_PIO2);
  const r = x - n * PIO2_1 - n * PIO2_2 - n * PIO2_3;
  return [((n % 4) + 4) % 4, r];
}

function sin(x) {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) < 7.85398163397448278999e-1) return ksin(x);
  const [q, r] = reduce(x);
  return q === 0 ? ksin(r) : q === 1 ? kcos(r) : q === 2 ? -ksin(r) : -kcos(r);
}

function cos(x) {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) < 7.85398163397448278999e-1) return kcos(x);
  const [q, r] = reduce(x);
  return q === 0 ? kcos(r) : q === 1 ? -ksin(r) : q === 2 ? -kcos(r) : ksin(r);
}

// ---- atan・atan2 ----
const ATANHI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800e0];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.11111104054623557880e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2,
  4.97687799461593236017e-2, -3.65315727442169155270e-2, 1.62858201153657823623e-2,
];
const PI = 3.14159265358979311600e0;
const PI_LO = 1.2246467991473531772e-16;

function atan(v) {
  if (Number.isNaN(v)) return NaN;
  const neg = v < 0;
  let x = Math.abs(v);
  let id;
  if (x >= 7.378697629483821e19) return neg ? -(ATANHI[3] + ATANLO[3]) : ATANHI[3] + ATANLO[3];
  if (x < 0.4375) {
    if (x < 7.450580596923828e-9) return v;
    id = -1;
  } else if (x < 1.1875) {
    if (x < 0.6875) {
      id = 0;
      x = (2 * x - 1) / (2 + x);
    } else {
      id = 1;
      x = (x - 1) / (x + 1);
    }
  } else if (x < 2.4375) {
    id = 2;
    x = (x - 1.5) / (1 + 1.5 * x);
  } else {
    id = 3;
    x = -1 / x;
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) {
    const r = x - x * (s1 + s2);
    return neg ? -r : r;
  }
  const r = ATANHI[id] - (x * (s1 + s2) - ATANLO[id] - x);
  return neg ? -r : r;
}

function atan2(y, x) {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  const yNeg = y < 0 || Object.is(y, -0);
  if (y === 0) {
    if (x > 0 || Object.is(x, 0)) return y;
    return yNeg ? -PI : PI;
  }
  if (x === 0) return yNeg ? -PI / 2 : PI / 2;
  if (!Number.isFinite(x)) {
    if (!Number.isFinite(y)) {
      const a = x > 0 ? PI / 4 : (3 * PI) / 4;
      return yNeg ? -a : a;
    }
    if (x > 0) return yNeg ? -0 : 0;
    return yNeg ? -PI : PI;
  }
  if (!Number.isFinite(y)) return yNeg ? -PI / 2 : PI / 2;
  const z = atan(Math.abs(y / x));
  if (x > 0) return yNeg ? -z : z;
  return yNeg ? z - PI_LO - PI : PI - (z - PI_LO);
}

// ---- hypot・べき乗 ----
function hypot(...v) {
  let s = 0;
  for (const a of v) s += a * a;
  return Math.sqrt(s);
}

/** x の n 乗(n は整数)。かけ算をくり返すので、どこでも同じ答え。 */
export function powi(x, n) {
  let r = 1;
  let b = x;
  let e = Math.abs(Math.trunc(n));
  while (e > 0) {
    if (e & 1) r *= b;
    b *= b;
    e >>>= 1;
  }
  return n < 0 ? 1 / r : r;
}

/** 試合の計算で使う Math(sin・cos・atan2・hypot だけ差しかえ。ほかはふつうの Math と同じ) */
export const M = Object.freeze({
  ...Object.fromEntries(Object.getOwnPropertyNames(Math).map((k) => [k, Math[k]])),
  sin,
  cos,
  atan,
  atan2,
  hypot,
});
