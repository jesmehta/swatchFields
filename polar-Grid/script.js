/* Swatch Colour Wheel (vanilla JS)
   - Reads swatch_lookup.json (from Script 1)
   - Preloads all swatch images
   - Places each by HSB (Hue→angle, Sat→radius, Bright→size/alpha)
   - Hover to see details
*/
(() => {
  // ---------- UI elements ----------
  const imgBaseEl = document.getElementById("imgBase");
  const lutUrlEl  = document.getElementById("lutUrl");
  const diamEl    = document.getElementById("diam");
  const guidesEl  = document.getElementById("guides");
  const loadBtn   = document.getElementById("loadBtn");
  const canvas    = document.getElementById("wheel");
  const tooltip   = document.getElementById("tooltip");
  const ctx       = canvas.getContext("2d", { willReadFrequently: true });

  // ---------- Config (mapped from UI) ----------
  let IMG_BASE = "imagesLRC/";
  let LUT_URL  = "swatch_lookup.json";
  let DIAM     = 1000;

  // Visual mapping
  const INNER_R   = 70;    // radius at S=0
  const OUTER_R   = () => Math.floor(DIAM * 0.47); // at S=100 (adaptive)
  const MIN_SIZE  = 18;    // at B=0
  const MAX_SIZE  = 46;    // at B=100
  const MIN_ALPHA = 0.35;  // alpha multiplier at B=0
  const MAX_ALPHA = 1.00;  // alpha multiplier at B=100

  // ---------- State ----------
  let entries = [];  // parsed LUT entries with HSB + meta
  let sprites = [];  // {img, h,s,b, x,y, r, theta, size, meta}
  let dpr      = Math.max(1, window.devicePixelRatio || 1);
  let hoverIdx = -1;

  // ---------- Helpers ----------
  const toRad = (deg) => (deg % 360) * Math.PI / 180;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp  = (a,b,t) => a + (b - a) * t;
  const map   = (v, in0, in1, out0, out1) => out0 + (clamp((v - in0)/(in1 - in0),0,1) * (out1 - out0));
  const fmt2  = (n) => Number(n).toFixed(2);

  function setCanvasSize(px) {
    DIAM = px|0;
    const css = DIAM;              // CSS pixels
    const real = Math.round(css * dpr); // backing store
    canvas.style.width = css + "px";
    canvas.style.height = css + "px";
    canvas.width = real;
    canvas.height = real;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
  }

  function readUI() {
    IMG_BASE = imgBaseEl.value.trim();
    LUT_URL  = lutUrlEl.value.trim();
    setCanvasSize(parseInt(diamEl.value, 10) || 1000);
  }

  // ---------- Loading ----------
  async function loadJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      // If assets are same-origin (Live Server), this is fine. If cross-origin, uncomment:
      // img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error(`Failed to load ${src}`));
      img.src = src;
    });
  }

  async function loadAll() {
    readUI();

    // 1) get LUT
    let lut = await loadJSON(LUT_URL);
    if (!Array.isArray(lut)) lut = Object.values(lut);

    // 2) normalize & filter valid HSB
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

    // 3) preload images
    const loads = entries.map(e => loadImage(IMG_BASE + e.filename).then(img => ({...e, img})).catch(() => null));
    const loaded = (await Promise.all(loads)).filter(Boolean);

    // 4) layout
    sprites = layout(loaded);

    // 5) draw
    draw();
  }

  // ---------- Layout & Draw ----------
  function layout(list) {
    const cx = DIAM/2, cy = DIAM/2;
    const outR = OUTER_R();
    const arr = [];

    for (const e of list) {
      const h = ((e.h % 360) + 360) % 360;
      const s = clamp(e.s, 0, 100);
      const b = clamp(e.b, 0, 100);

      const theta = toRad(h - 90); // rotate so 0° is at top
      const r     = Math.round(map(s, 0, 100, INNER_R, outR));
      const x     = cx + r * Math.cos(theta);
      const y     = cy + r * Math.sin(theta);

      const size  = map(b, 0, 100, MIN_SIZE, MAX_SIZE);
      arr.push({
        img: e.img, h, s, b, theta, r, x, y, size,
        meta: {
          filename: e.filename, dyestuff: e.dyestuff, pH: e.pH,
          mordant: e.mordant, additive: e.additive, time: e.time
        }
      });
    }

    // draw inner → outer so farther ones don’t occlude inner
    arr.sort((a,b) => a.r - b.r);
    return arr;
  }

  function clear() {
    ctx.save();
    ctx.setTransform(dpr,0,0,dpr,0,0); // ensure CSS pixel coords
    ctx.clearRect(0,0,canvas.width/dpr, canvas.height/dpr);
    ctx.restore();
  }

  function drawGuides() {
    if (!guidesEl.checked) return;
    const cx = DIAM/2, cy = DIAM/2, outR = OUTER_R();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineWidth = 1;
    // saturation rings
    for (let S=0; S<=100; S+=20) {
      const r = map(S, 0,100, INNER_R, outR);
      ctx.strokeStyle = (S%50===0) ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.12)";
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
    // title
    ctx.fillStyle = "#111";
    ctx.font = "14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("HSB Colour Wheel", 0, outR + 34);
    ctx.restore();
  }

  function drawSprites() {
    for (const s of sprites) {
      const a = lerp(MIN_ALPHA, MAX_ALPHA, s.b/100);
      // shadow
      // ctx.save();
      // ctx.globalAlpha = 0.20;
      // ctx.beginPath();
      // ctx.arc(s.x+2, s.y+2, (s.size+6)/2, 0, Math.PI*2);
      // ctx.fillStyle = "black";
      // ctx.fill();
      // ctx.restore();
      if (s === sprites[hoverIdx]) {
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.beginPath();
        ctx.arc(s.x+2, s.y+2, (s.size+6)/2, 0, Math.PI*2);
        ctx.fillStyle = "black";
        ctx.fill();
        ctx.restore();
      }


      // sprite (cover into square)
      const w = s.img.width, h = s.img.height;
      const side = Math.min(w,h);
      const sx = (w - side)/2, sy = (h - side)/2;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.drawImage(s.img, sx, sy, side, side, s.x - s.size/2, s.y - s.size/2, s.size, s.size);
      ctx.restore();
    }
  }

  function draw() {
    clear();
    drawGuides();
    drawSprites();
  }

  // ---------- Hover tooltip ----------
  canvas.addEventListener("mousemove", (ev) => {
    if (!sprites.length) return;
    const rect = canvas.getBoundingClientRect();
    // account for CSS pixel coords (we drew using CSS coords)
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;

    let best = -1, bestDist = Infinity;
    for (let i=0;i<sprites.length;i++){
      const s = sprites[i];
      const d = Math.hypot(x - s.x, y - s.y);
      if (d < s.size * 0.6 && d < bestDist) { best = i; bestDist = d; }
    }
    hoverIdx = best;
    if (best === -1) {
      tooltip.style.opacity = 0;
      return;
    }

    const s = sprites[best];
    tooltip.innerHTML =
      `<span class="k">file</span>: <span class="v">${s.meta.filename}</span><br/>
       <span class="k">dye</span>: <span class="v">${s.meta.dyestuff}</span>
       <span class="k">pH</span>: <span class="v">${s.meta.pH}</span>
       <span class="k">mordant</span>: <span class="v">${s.meta.mordant}</span><br/>
       <span class="k">additive</span>: <span class="v">${s.meta.additive}</span>
       <span class="k">time</span>: <span class="v">${s.meta.time}</span><br/>
       <span class="k">H</span>: <span class="v">${fmt2(s.h)}</span>
       <span class="k">S</span>: <span class="v">${fmt2(s.s)}</span>
       <span class="k">B</span>: <span class="v">${fmt2(s.b)}</span>`;
    tooltip.style.left = `${s.x}px`;
    tooltip.style.top  = `${s.y}px`;
    tooltip.style.opacity = 1;
  });

  canvas.addEventListener("mouseleave", () => { tooltip.style.opacity = 0; });

  // ---------- Controls ----------
  loadBtn.addEventListener("click", () => {
    tooltip.style.opacity = 0;
    loadAll().catch(err => {
      tooltip.style.opacity = 0;
      console.error(err);
      alert(`Failed to load: ${err.message}`);
    });
  });

  // Initial draw (empty guides) & auto-load once
  setCanvasSize(parseInt(diamEl.value,10) || 1000);
  // Draw just the guides until data is loaded
  draw();
  // Kick off initial load
  loadAll().catch(err => {
    console.error(err);
    // leave guides visible to show UI is alive
  });

  // Redraw on resize if size input changes
  diamEl.addEventListener("change", () => { readUI(); draw(); });

})();
