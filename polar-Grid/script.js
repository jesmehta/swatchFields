/* Swatch Colour Wheel — Zoom + Preview (vanilla JS)
   - HSB → polar placement
   - Mouse wheel / slider zoom, drag-to-pan
   - Large preview on hover (right panel)
*/
(() => {
  // ---------- UI ----------
  const imgBaseEl = document.getElementById("imgBase");
  const lutUrlEl  = document.getElementById("lutUrl");
  const diamEl    = document.getElementById("diam");
  const guidesEl  = document.getElementById("guides");
  const loadBtn   = document.getElementById("loadBtn");

  const zoomSlider = document.getElementById("zoom");
  const zoomVal    = document.getElementById("zoomVal");
  const sizeSlider = document.getElementById("sizeScale");
  const sizeVal    = document.getElementById("sizeVal");
  const resetBtn   = document.getElementById("resetView");

  const canvas  = document.getElementById("wheel");
  const ctx     = canvas.getContext("2d", { willReadFrequently: true });

  const big     = document.getElementById("big");
  const bctx    = big.getContext("2d", { willReadFrequently: true });
  const meta    = document.getElementById("meta");

  // ---------- Config ----------
  let IMG_BASE = "images/";
  let LUT_URL  = "swatch_lookup.json";
  let DIAM     = 1000;

  // Base visual mapping (before size scale)
  const INNER_R   = 70;
  const OUTER_R   = () => Math.floor(DIAM * 0.47);
  const BASE_MIN_SIZE = 18;
  const BASE_MAX_SIZE = 46;
  const MIN_ALPHA = 0.35;
  const MAX_ALPHA = 1.0;

  // ---------- View transform (pan/zoom) ----------
  const view = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  // ---------- State ----------
  let entries = [];  // normalized LUT
  let sprites = [];  // laid out at world coords (wheel-centered)
  let sizeScale = 1; // multiplies sprite size
  let hoverIdx = -1;

  // ---------- Helpers ----------
  const toRad = (deg) => (deg % 360) * Math.PI / 180;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp  = (a,b,t) => a + (b - a) * t;
  const map   = (v, in0, in1, out0, out1) => out0 + (clamp((v - in0)/(in1 - in0),0,1) * (out1 - out0));
  const fmt2  = (n) => Number(n).toFixed(2);

  function setCanvasSize(px) {
    DIAM = px|0;
    const css = DIAM, real = Math.round(css * dpr);
    canvas.style.width = css + "px";
    canvas.style.height = css + "px";
    canvas.width = real; canvas.height = real;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    resetView(); // keep center on resize
  }

  function resetView() {
    view.scale = Number(zoomSlider.value) || 1;
    view.offsetX = 0;
    view.offsetY = 0;
    draw();
  }

  // ---------- Loaders ----------
  async function loadJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  function loadImage(src) {
    return new Promise((resolve,reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed " + src));
      img.src = src;
    });
  }

  // ---------- App ----------
  async function loadAll() {
    IMG_BASE = imgBaseEl.value.trim();
    LUT_URL  = lutUrlEl.value.trim();
    setCanvasSize(parseInt(diamEl.value, 10) || 1000);

    // 1) LUT
    let lut = await loadJSON(LUT_URL);
    if (!Array.isArray(lut)) lut = Object.values(lut);

    entries = lut.map(r => ({
      filename: r.filename,
      h: Number(r.h),
      s: Number(r.s),
      b: Number(r.b),
      dyestuff: r.dyestuff,
      pH: r.pH,
      mordant: r.mordant,
      additive: r.additive,
      time: r.time
    })).filter(r => Number.isFinite(r.h) && Number.isFinite(r.s) && Number.isFinite(r.b));

    // 2) Preload images
    const loads = entries.map(e => loadImage(IMG_BASE + e.filename).then(img => ({...e, img})).catch(()=>null));
    const loaded = (await Promise.all(loads)).filter(Boolean);

    // 3) Layout at world coords (center 0,0)
    sprites = layout(loaded);

    // 4) Draw
    draw();
  }

  function layout(list) {
    const outR = OUTER_R();
    const arr = [];
    for (const e of list) {
      const h = ((e.h % 360) + 360) % 360;
      const s = clamp(e.s, 0, 100);
      const b = clamp(e.b, 0, 100);

      const theta = toRad(h - 90);
      const r     = Math.round(map(s, 0, 100, INNER_R, outR));
      const x     = r * Math.cos(theta);
      const y     = r * Math.sin(theta);

      const size  = map(b, 0, 100, BASE_MIN_SIZE, BASE_MAX_SIZE);
      arr.push({
        img: e.img, h, s, b, theta, r, x, y, baseSize: size,
        meta: {
          filename: e.filename, dyestuff: e.dyestuff, pH: e.pH,
          mordant: e.mordant, additive: e.additive, time: e.time
        }
      });
    }
    // inner → outer
    arr.sort((a,b) => a.r - b.r);
    return arr;
  }

  // ---------- Drawing ----------
  function applyView() {
    ctx.translate(DIAM/2 + view.offsetX, DIAM/2 + view.offsetY);
    ctx.scale(view.scale, view.scale);
  }

  function clear() {
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,canvas.width/dpr, canvas.height/dpr);
  }

  function drawGuides() {
    if (!guidesEl.checked) return;
    const outR = OUTER_R();

    ctx.save();
    applyView();

    // rings
    ctx.lineWidth = 1 / view.scale;
    for (let S=0; S<=100; S+=20) {
      const r = map(S, 0,100, INNER_R, outR);
      ctx.strokeStyle = (S%50===0) ? "rgba(0,0,0,0.28)" : "rgba(0,0,0,0.13)";
      ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.stroke();
    }
    // hue ticks
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    for (let H=0; H<360; H+=30) {
      const t = toRad(H-90);
      const x1 = (INNER_R-14)*Math.cos(t), y1 = (INNER_R-14)*Math.sin(t);
      const x2 = (outR+14)*Math.cos(t), y2 = (outR+14)*Math.sin(t);
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    }

    ctx.restore();
  }

  function drawSprites() {
    ctx.save();
    applyView();

    for (let i=0;i<sprites.length;i++) {
      const s = sprites[i];
      const size = s.baseSize * sizeScale;
      const a = lerp(MIN_ALPHA, MAX_ALPHA, s.b/100);

      // hover glow
      if (i === hoverIdx) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.arc(s.x, s.y, (size+8)/2, 0, Math.PI*2);
        ctx.fillStyle = "#000";
        ctx.fill();
        ctx.restore();
      }

      // draw image cropped square, scaled to size
      const w = s.img.width, h = s.img.height;
      const side = Math.min(w,h), sx = (w-side)/2, sy=(h-side)/2;

      ctx.save();
      ctx.globalAlpha = a;
      ctx.drawImage(s.img, sx, sy, side, side, s.x - size/2, s.y - size/2, size, size);
      ctx.restore();
    }

    ctx.restore();
  }

  function draw() {
    clear();
    drawGuides();
    drawSprites();
  }

  // ---------- Hit test in world coords ----------
  function screenToWorld(mx, my) {
    // CSS px → world coords centered at (0,0)
    const rect = canvas.getBoundingClientRect();
    const x = mx - rect.left;
    const y = my - rect.top;
    const wx = (x - DIAM/2 - view.offsetX) / view.scale;
    const wy = (y - DIAM/2 - view.offsetY) / view.scale;
    return {x: wx, y: wy};
  }

  function findHover(mx, my) {
    if (!sprites.length) return -1;
    const {x,y} = screenToWorld(mx,my);
    let best = -1, bestDist = Infinity;
    for (let i=0;i<sprites.length;i++){
      const s = sprites[i];
      const size = s.baseSize * sizeScale;
      const d = Math.hypot(x - s.x, y - s.y);
      if (d < size * 0.6 && d < bestDist) { best = i; bestDist = d; }
    }
    return best;
  }

  // ---------- Preview panel ----------
  function drawPreview(idx) {
    bctx.clearRect(0,0,big.width,big.height);
    if (idx < 0) {
      meta.textContent = "Hover a swatch…";
      return;
    }
    const s = sprites[idx];
    const pad = 8;
    const box = Math.min(big.width, big.height) - pad*2;

    // crop square
    const w = s.img.width, h = s.img.height;
    const side = Math.min(w,h), sx=(w-side)/2, sy=(h-side)/2;

    // draw image
    bctx.save();
    bctx.imageSmoothingEnabled = true;
    bctx.drawImage(s.img, sx, sy, side, side, pad, pad, box, box);
    bctx.restore();

    // meta
    meta.innerHTML =
      `<div><b>File</b>: ${s.meta.filename}</div>
       <div><b>Dye</b>: ${s.meta.dyestuff}  <b>pH</b>: ${s.meta.pH}</div>
       <div><b>Mordant</b>: ${s.meta.mordant}</div>
       <div><b>Additive</b>: ${s.meta.additive}  <b>Time</b>: ${s.meta.time}</div>
       <div class="sep" style="margin:8px 0;"></div>
       <div><b>H</b>: ${fmt2(s.h)}  <b>S</b>: ${fmt2(s.s)}  <b>B</b>: ${fmt2(s.b)}</div>`;
  }

  // ---------- Events ----------
  canvas.addEventListener("mousemove", (ev) => {
    const idx = findHover(ev.clientX, ev.clientY);
    if (idx !== hoverIdx) {
      hoverIdx = idx;
      draw();
      drawPreview(hoverIdx);
    }
  });
  canvas.addEventListener("mouseleave", () => {
    hoverIdx = -1; draw(); drawPreview(-1);
  });

  // Drag to pan
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener("mousedown", (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener("mouseup", ()=> dragging=false);
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    view.offsetX += dx;
    view.offsetY += dy;
    draw();
  });

  // Wheel zoom (cursor-centered)
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = (e.deltaY < 0) ? 1.1 : 1/1.1;
    zoomAt(e.clientX, e.clientY, factor);
  }, { passive:false });

  function zoomAt(mx, my, factor) {
    // clamp scale
    const newScale = clamp(view.scale * factor, 0.5, 4);
    factor = newScale / view.scale;
    // anchor at cursor: adjust offsets so world point under cursor stays under cursor
    const rect = canvas.getBoundingClientRect();
    const cx = mx - rect.left - DIAM/2 - view.offsetX;
    const cy = my - rect.top  - DIAM/2 - view.offsetY;
    view.offsetX -= cx * (factor - 1);
    view.offsetY -= cy * (factor - 1);
    view.scale = newScale;

    // sync slider
    zoomSlider.value = view.scale.toFixed(2);
    zoomVal.textContent = `${view.scale.toFixed(2)}×`;
    draw();
  }

  // Sliders / controls
  zoomSlider.addEventListener("input", () => {
    const target = Number(zoomSlider.value);
    // zoom at center
    const center = canvas.getBoundingClientRect();
    zoomAt(center.left + DIAM/2, center.top + DIAM/2, target / view.scale);
  });
  sizeSlider.addEventListener("input", () => {
    sizeScale = Number(sizeSlider.value);
    sizeVal.textContent = `${sizeScale.toFixed(2)}×`;
    draw();
  });
  resetBtn.addEventListener("click", () => {
    zoomSlider.value = "1.00";
    zoomVal.textContent = "1.00×";
    sizeSlider.value = "1.00";
    sizeVal.textContent = "1.00×";
    sizeScale = 1;
    resetView();
  });

  loadBtn.addEventListener("click", () => {
    loadAll().catch(err => {
      console.error(err);
      alert("Load failed: " + err.message);
    });
  });

  // Initial
  (function init(){
    sizeVal.textContent = "1.00×";
    zoomVal.textContent = "1.00×";
    setCanvasSize(parseInt(diamEl.value,10) || 1000);
    // draw empty guides
    draw();
    loadAll().catch(console.error);
  })();
})();
