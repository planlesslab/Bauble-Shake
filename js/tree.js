// Renders the glass Christmas tree as SVG and animates ornaments flying off.

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, parent) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
};

// Small seeded RNG so everyone's tree looks the same in a given round.
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 1e6) / 1e6;
  };
}

// Tiers: [topY, bottomY, topHalfWidth, bottomHalfWidth], drawn bottom-up.
const TIERS = [
  [52, 118, 0, 36],
  [96, 172, 16, 60],
  [150, 232, 28, 86],
  [208, 298, 40, 110],
  [272, 368, 52, 134],
];

const BALL_COLOURS = [
  ["#ff6b70", "#c3121c"], // red
  ["#fff1b8", "#d9a227"], // gold
  ["#b9ffd2", "#178a46"], // green
  ["#ffffff", "#8aa3ad"], // silver
];
const GIFT_COLOURS = ["#e8323c", "#f2b33d", "#34c472", "#dfe8ec"];

export class Tree {
  constructor(container, { count = 40, seed = 1 } = {}) {
    this.container = container;
    this.count = count;
    this.random = rng(seed);
    this.flying = [];
    this.raf = null;
    this.build();
  }

  get remaining() { return this.ornaments.length; }
  get total() { return this.count; }

  build() {
    this.container.innerHTML = "";
    const svg = el("svg", { viewBox: "0 0 300 440", "aria-label": "Christmas tree" }, this.container);
    this.svg = svg;
    const defs = el("defs", {}, svg);

    // Glass gradients for the left/right faces of each tier.
    const lg = el("linearGradient", { id: "faceL", x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": "#7dffb3", "stop-opacity": "0.55" }, lg);
    el("stop", { offset: "1", "stop-color": "#0d7a3e", "stop-opacity": "0.55" }, lg);
    const rg = el("linearGradient", { id: "faceR", x1: 1, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": "#e8fff1", "stop-opacity": "0.45" }, rg);
    el("stop", { offset: "1", "stop-color": "#1fa85a", "stop-opacity": "0.5" }, rg);

    const glow = el("filter", { id: "glow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, defs);
    el("feGaussianBlur", { stdDeviation: "3", result: "b" }, glow);
    const merge = el("feMerge", {}, glow);
    el("feMergeNode", { in: "b" }, merge);
    el("feMergeNode", { in: "SourceGraphic" }, merge);

    const bigGlow = el("filter", { id: "bigGlow", x: "-100%", y: "-100%", width: "300%", height: "300%" }, defs);
    el("feGaussianBlur", { stdDeviation: "8" }, bigGlow);

    BALL_COLOURS.forEach(([light, dark], i) => {
      const g = el("radialGradient", { id: `ball${i}`, cx: "0.35", cy: "0.3", r: "0.75" }, defs);
      el("stop", { offset: "0", "stop-color": "#ffffff" }, g);
      el("stop", { offset: "0.25", "stop-color": light }, g);
      el("stop", { offset: "1", "stop-color": dark }, g);
    });

    // Soft halo behind the tree.
    el("ellipse", { cx: 150, cy: 250, rx: 120, ry: 170, fill: "#34c472", opacity: 0.18, filter: "url(#bigGlow)" }, svg);

    // Base / stand.
    const base = el("g", {}, svg);
    el("ellipse", { cx: 150, cy: 405, rx: 120, ry: 14, fill: "#ffd56b", opacity: 0.18, filter: "url(#bigGlow)" }, base);
    el("polygon", { points: "112,368 188,368 196,392 104,392", fill: "#1d2a25", stroke: "rgba(255,255,255,.35)" }, base);
    el("polygon", { points: "104,392 196,392 196,402 104,402", fill: "#121b17", stroke: "rgba(255,255,255,.2)" }, base);

    // Light swirls behind the tree.
    const swirlsBack = el("g", { opacity: 0.55 }, svg);
    this.drawSwirls(swirlsBack, 0);

    this.body = el("g", { class: "tree-body" }, svg);
    for (let i = TIERS.length - 1; i >= 0; i--) this.drawTier(this.body, TIERS[i]);
    // Centre trunk-of-light line.
    el("line", { x1: 150, y1: 60, x2: 150, y2: 368, stroke: "rgba(255,255,255,.35)", "stroke-width": 1 }, this.body);

    this.ornLayer = el("g", {}, this.body);

    // Swirls in front, fainter.
    const swirlsFront = el("g", { opacity: 0.8 }, svg);
    this.drawSwirls(swirlsFront, 1);

    this.flyLayer = el("g", {}, svg);
    this.placeOrnaments();
  }

  drawTier(parent, [top, bottom, tw, bw]) {
    const g = el("g", {}, parent);
    const cx = 150;
    // left face, right face
    el("polygon", { points: `${cx - tw},${top} ${cx},${top} ${cx},${bottom} ${cx - bw},${bottom}`, fill: "url(#faceL)" }, g);
    el("polygon", { points: `${cx},${top} ${cx + tw},${top} ${cx + bw},${bottom} ${cx},${bottom}`, fill: "url(#faceR)" }, g);
    // edges
    el("polygon", {
      points: `${cx - tw},${top} ${cx + tw},${top} ${cx + bw},${bottom} ${cx - bw},${bottom}`,
      fill: "none", stroke: "rgba(220,255,235,.6)", "stroke-width": 1,
    }, g);
    // glowing lower rim
    el("line", {
      x1: cx - bw, y1: bottom, x2: cx + bw, y2: bottom,
      stroke: "#fff3c4", "stroke-width": 1.6, opacity: 0.85, filter: "url(#glow)",
    }, g);
  }

  drawSwirls(parent, front) {
    const rings = [[175, 70, 10], [255, 105, 14], [330, 140, 16]];
    rings.forEach(([cy, rx, ry], i) => {
      const e = el("ellipse", {
        cx: 150, cy, rx, ry,
        fill: "none",
        stroke: i % 2 ? "#fff3c4" : "#ffffff",
        "stroke-width": front ? 1.4 : 2.2,
        "stroke-linecap": "round",
        "stroke-dasharray": front ? "40 260" : "90 200",
        filter: "url(#glow)",
      }, parent);
      e.animate(
        [{ strokeDashoffset: 0 }, { strokeDashoffset: front ? -600 : 600 }],
        { duration: 2600 + i * 700, iterations: Infinity }
      );
    });
  }

  halfWidthAt(y) {
    // Widest tier covering y (tiers overlap).
    let w = 0;
    for (const [top, bottom, tw, bw] of TIERS) {
      if (y >= top && y <= bottom) w = Math.max(w, tw + ((y - top) / (bottom - top)) * (bw - tw));
    }
    return w;
  }

  placeOrnaments() {
    const r = this.random;
    const spots = [];
    const balls = this.count - 1; // the star is the last decoration
    let guard = 0;
    while (spots.length < balls && guard++ < 6000) {
      const y = 78 + r() * 284;
      const hw = this.halfWidthAt(y) - 10;
      if (hw < 6) continue;
      const x = 150 + (r() * 2 - 1) * hw;
      const minD = guard > 4000 ? 11 : 17;
      if (spots.some((s) => (s.x - x) ** 2 + (s.y - y) ** 2 < minD * minD)) continue;
      spots.push({ x, y });
    }

    this.ornaments = [];
    spots.forEach(({ x, y }) => {
      const roll = r();
      const g = el("g", { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` }, this.ornLayer);
      if (roll < 0.72) {
        const c = Math.floor(r() * BALL_COLOURS.length);
        const rad = 6 + r() * 3;
        el("line", { x1: 0, y1: -rad - 4, x2: 0, y2: -rad, stroke: "#ffe7a3", "stroke-width": 1 }, g);
        el("circle", { r: rad, fill: `url(#ball${c})`, filter: "url(#glow)" }, g);
      } else if (roll < 0.9) {
        const c = GIFT_COLOURS[Math.floor(r() * GIFT_COLOURS.length)];
        el("rect", { x: -6, y: -6, width: 12, height: 12, rx: 1.5, fill: c, "fill-opacity": 0.75, stroke: "#fff", "stroke-opacity": 0.7 }, g);
        el("rect", { x: -1, y: -6, width: 2, height: 12, fill: "#fff", opacity: 0.85 }, g);
        el("rect", { x: -6, y: -1, width: 12, height: 2, fill: "#fff", opacity: 0.85 }, g);
      } else {
        el("polygon", { points: starPoints(0, 0, 7, 3), fill: "#ffd56b", filter: "url(#glow)" }, g);
      }
      this.ornaments.push({ g, x, y });
    });

    // Shuffle removal order; star goes last.
    for (let i = this.ornaments.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [this.ornaments[i], this.ornaments[j]] = [this.ornaments[j], this.ornaments[i]];
    }

    const star = el("g", { transform: "translate(150 44)" }, this.ornLayer);
    el("polygon", { points: starPoints(0, 0, 26, 11), fill: "#ffd56b", opacity: 0.7, filter: "url(#bigGlow)", class: "star-glow" }, star);
    el("polygon", { points: starPoints(0, 0, 18, 8), fill: "#fff3c4", "fill-opacity": 0.35, stroke: "#ffd56b", "stroke-width": 2, filter: "url(#glow)" }, star);
    this.ornaments.unshift({ g: star, x: 150, y: 44, isStar: true }); // pop() takes from end, so star is last
  }

  /** Knock off up to n ornaments. dir = -1 (left) or 1 (right). Returns number removed. */
  knock(n = 1, dir = 1) {
    let removed = 0;
    for (let i = 0; i < n && this.ornaments.length; i++) {
      const o = this.ornaments.pop();
      this.launch(o, dir);
      removed++;
    }
    this.body.classList.remove("sway-l", "sway-r");
    void this.body.getBoundingClientRect(); // restart animation
    this.body.classList.add(dir < 0 ? "sway-l" : "sway-r");
    return removed;
  }

  /** Instantly remove k ornaments without animation (used when resuming). */
  removeInstantly(k) {
    for (let i = 0; i < k && this.ornaments.length; i++) this.ornaments.pop().g.remove();
  }

  launch(o, dir) {
    this.flyLayer.appendChild(o.g);
    const r = Math.random;
    const p = {
      g: o.g, x: o.x, y: o.y,
      vx: dir * (90 + r() * 220) + (r() - 0.5) * 80,
      vy: -(160 + r() * 260),
      rot: 0, vr: (r() - 0.5) * 900,
      t: 0,
    };
    this.flying.push(p);
    this.sparkle(o.x, o.y);
    if (!this.raf) this.loop(performance.now());
  }

  sparkle(x, y) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const c = el("circle", { cx: x, cy: y, r: 1.6, fill: i % 2 ? "#fff3c4" : "#ffffff" }, this.flyLayer);
      c.animate(
        [
          { transform: "translate(0,0)", opacity: 1 },
          { transform: `translate(${Math.cos(a) * 18}px, ${Math.sin(a) * 18}px)`, opacity: 0 },
        ],
        { duration: 450, easing: "ease-out" }
      ).onfinish = () => c.remove();
    }
  }

  loop(last) {
    this.raf = requestAnimationFrame((now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      this.flying = this.flying.filter((p) => {
        p.t += dt;
        p.vy += 900 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.g.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.rot.toFixed(0)})`);
        p.g.setAttribute("opacity", Math.max(0, 1 - p.t / 1.6).toFixed(2));
        if (p.t > 1.6) { p.g.remove(); return false; }
        return true;
      });
      if (this.flying.length) this.loop(now);
      else this.raf = null;
    });
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.container.innerHTML = "";
  }
}

function starPoints(cx, cy, outer, inner) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + Math.cos(a) * rad).toFixed(1)},${(cy + Math.sin(a) * rad).toFixed(1)}`);
  }
  return pts.join(" ");
}
