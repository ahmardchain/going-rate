// Small UI effects, ported to vanilla JS/CSS from Magic UI components
// (https://magicui.design, also published on 21st.dev), MIT License, Copyright (c) Magic UI.
//   - Border Beam:   <div class="beam-host"> gets a light that travels its border.
//   - Number Ticker: <span data-ticker="12.5" data-decimals="2" data-prefix="$"> counts up on view.
//   - Shimmer Button: CSS only, see .shimmer in style.css.

/** Adds a Border Beam to an element (props mirror Magic UI's defaults). */
export function borderBeam(el, { size = 120, duration = 6, colorFrom, colorTo, borderWidth = 2 } = {}) {
  if (!el || el.querySelector(":scope > .beam")) return;
  el.classList.add("beam-host");
  const beam = document.createElement("div");
  beam.className = "beam";
  beam.style.setProperty("--beam-width", `${borderWidth}px`);
  const light = document.createElement("i");
  light.style.width = `${size}px`;
  light.style.offsetPath = `rect(0 auto auto 0 round ${size}px)`;
  light.style.animationDuration = `${duration}s`;
  if (colorFrom) light.style.setProperty("--color-from", colorFrom);
  if (colorTo) light.style.setProperty("--color-to", colorTo);
  beam.appendChild(light);
  el.appendChild(beam);
}

/**
 * Number Ticker: animates 0 -> value with the same spring as Magic UI
 * (useSpring damping 60, stiffness 100, mass 1), starting when the element is in view.
 */
export function ticker(el) {
  const target = Number(el.dataset.ticker);
  const decimals = Number(el.dataset.decimals ?? 0);
  const prefix = el.dataset.prefix ?? "";
  const fmt = (v) => prefix + new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(v.toFixed(decimals)));
  if (!Number.isFinite(target) || matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = fmt(target || 0); return; }
  el.textContent = fmt(0);
  const run = () => {
    const k = 100, c = 60, m = 1;
    let x = 0, v = 0, last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.032, (now - last) / 1000); last = now;
      const a = (-k * (x - target) - c * v) / m;
      v += a * dt; x += v * dt;
      el.textContent = fmt(x);
      if (Math.abs(x - target) > Math.max(1e-4, target * 1e-4) || Math.abs(v) > 1e-3) requestAnimationFrame(step);
      else el.textContent = fmt(target);
    };
    requestAnimationFrame(step);
  };
  const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io.disconnect(); run(); } });
  io.observe(el);
}

export const tickAll = (root = document) => root.querySelectorAll("[data-ticker]").forEach(ticker);

let beamSeq = 0;
/**
 * Animated Beam (Magic UI): a quadratic curve between the centers of `from` and `to`
 * inside `container`, with a gradient that sweeps along it. Motion's linearGradient
 * animation is reproduced with SVG <animate> and the same ease (0.16, 1, 0.3, 1).
 */
export function animatedBeam(container, from, to, {
  curvature = 0, reverse = false, duration = 5, delay = 0, pathColor = "gray", pathWidth = 2, pathOpacity = 0.2,
  gradientStartColor = "#34d399", gradientStopColor = "#2453ff",
} = {}) {
  const id = `beam-grad-${++beamSeq}`;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("fill", "none");
  svg.setAttribute("class", "animated-beam");
  svg.innerHTML = `
    <path class="base" stroke="${pathColor}" stroke-width="${pathWidth}" stroke-opacity="${pathOpacity}" stroke-linecap="round"/>
    <path class="glow" stroke="url(#${id})" stroke-width="${pathWidth}" stroke-opacity="1" stroke-linecap="round"/>
    <defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse">
      <stop stop-color="${gradientStartColor}" stop-opacity="0"/>
      <stop stop-color="${gradientStartColor}"/>
      <stop offset="32.5%" stop-color="${gradientStopColor}"/>
      <stop offset="100%" stop-color="${gradientStopColor}" stop-opacity="0"/>
    </linearGradient></defs>`;
  const grad = svg.querySelector("linearGradient");
  const [x1, x2] = reverse ? [["90%", "-10%"], ["100%", "0%"]] : [["10%", "110%"], ["0%", "100%"]];
  for (const [attr, [a, b]] of [["x1", x1], ["x2", x2]]) {
    const anim = document.createElementNS(NS, "animate");
    for (const [k, v] of Object.entries({ attributeName: attr, values: `${a};${b}`, dur: `${duration}s`, begin: `${delay}s`,
      repeatCount: "indefinite", calcMode: "spline", keyTimes: "0;1", keySplines: "0.16 1 0.3 1" })) anim.setAttribute(k, v);
    grad.appendChild(anim);
  }
  container.appendChild(svg);
  const update = () => {
    const c = container.getBoundingClientRect(), a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    svg.setAttribute("width", c.width); svg.setAttribute("height", c.height); svg.setAttribute("viewBox", `0 0 ${c.width} ${c.height}`);
    const sx = a.left - c.left + a.width / 2, sy = a.top - c.top + a.height / 2;
    const ex = b.left - c.left + b.width / 2, ey = b.top - c.top + b.height / 2;
    const d = `M ${sx},${sy} Q ${(sx + ex) / 2},${sy - curvature} ${ex},${ey}`;
    svg.querySelectorAll("path").forEach((p) => p.setAttribute("d", d));
  };
  new ResizeObserver(update).observe(container);
  update();
  return svg;
}

/** Shimmer Button: adds Magic UI's spark, backdrop and highlight layers to a button. */
export function shimmer(btn) {
  if (!btn || btn.classList.contains("shimmer")) return;
  btn.classList.add("shimmer");
  btn.insertAdjacentHTML("afterbegin", '<span class="spark-wrap" aria-hidden="true"><span class="spark"></span></span>');
  btn.insertAdjacentHTML("beforeend", '<span class="highlight" aria-hidden="true"></span><span class="backdrop" aria-hidden="true"></span>');
}
export const shimmerAll = (root = document) => root.querySelectorAll("button.primary").forEach(shimmer);
