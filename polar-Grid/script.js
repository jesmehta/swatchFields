/* Swatch Browser — Filters + Polar/Grid + Preview (vanilla JS) */
(() => {
  // ---- UI grabs ----
  const imgBaseEl   = document.getElementById("imgBase");
  const imgBaseHiEl = document.getElementById("imgBaseHi");
  const lutUrlEl    = document.getElementById("lutUrl");
  const diamEl      = document.getElementById("diam");
  const guidesEl    = document.getElementById("guides");
  const loadBtn     = document.getElementById("loadBtn");

  const modeEls     = [...document.querySelectorAll('input[name="mode"]')];
  const zoomSlider  = document.getElementById("zoom");
  const zoomVal     = document.getElementById("zoomVal");
  const sizeSlider  = document.getElementById("sizeScale");
  const sizeVal     = document.getElementById("sizeVal");
  const resetBtn    = document.getElementById("resetView");

  const filtRoots = {
    dyestuff: document.getElementById("f-dyestuff"),
    pH:       document.getElementById("f-pH"),
    mordant:  document.getElementById("f-mordant"),
    additive: document.getElementById("f-additive"),
    time:     document.getElementById("f-time"),
  };

  const xAxisSel = document.getElementById("xAxis");
  const yAxisSel = document.getElementById("yAxis");
  const gBySel   = document.getElementById("gBy");

  const canvas = document.getElementById("wheel");
  const ctx    = canvas.getContext("2d", { willReadFrequently: true });
  const big    = document.getElementById("big");
  const bctx   = big.getContext("2d", { willReadFrequently: true });
  const meta   = document.getElementById("meta");

  // ---- Config ----
  let IMG_BASE    = "images/";
  let IMG_BASE_HI = "images/";
  let LUT_URL     = "swatch_lookup.json";
  let DIAM        = 1000;

  // Polar mapping
  const INNER_R = 70;
  const OUTER_R = () => Math.floor(DIAM * 0.47);
  const BASE_MIN_SIZE = 18;
  const BASE_MAX_SIZE = 46;
  const MIN_ALPHA = 0.35, MAX_ALPHA = 1.0;

  // View (pan/zoom)
  const view = { scale: 1, offsetX: 0, offsetY: 0 };
  const dpr  = Math.max(1, window.devicePixelRatio || 1);

  // State
  let entries   = [];   // raw LUT (filtered for finite H,S,B)
  let sprites   = [];   // laid-out
  let uniq      = {};   // { param -> [values] }
  let filters   = {};   // { param -> Set(selectedValues) | null (all) }
  let mode      = "polar";
  let sizeScale = 1;
  let hoverIdx  = -1;
  const hiCache = new Map(); // filename -> Image | "loading" | "error"

  // Axis params usable in grid
  const PARAMS = ["dyestuff","pH","mordant","additive","time"];
  // Friendly labels (optional)
  const LABEL = { pH: "pH" };

  // ---- Helpers ----
  const toRad = (deg) => (deg % 360) * Math.PI / 180;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp  = (a,b,t) => a + (b - a) * t;
  const map   = (v, in0, in1, out0, out1) => out0 + (clamp((v - in0)/(in1 - in0),0,1) * (out1 - out0));
  const fmt2  = (n) => Number(n).toFixed(2);

  function setCanvasSize(px) {
    DIAM = px|0;
    const css = DIAM, real = Math.round(css * dpr);
    canvas.style.width = css + "px"; canvas.style.height = css + "px";
    canvas.width = real; canvas.height = real;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    resetView();
  }

  function resetView() {
    view.scale   = Number(zoomSlider.value) || 1;
    view.offsetX = 0;
    view.offsetY = 0;
    draw();
  }

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

  function byKey(key) {
    return (a,b) => String(a[key]).localeCompare(String(b[key]), undefined, {numeric:true, sensitivity:"base"});
  }

  // Build unique value lists per parameter
  function buildUniques(list) {
    uniq = {};
    for (const p of PARAMS) uniq[p] = [];
    const seen = {}; PARAMS.forEach(p => seen[p] = new Set());
    for (const e of list) {
      for (const p of PARAMS) {
        const v = e[p];
        if (!seen[p].has(v)) { seen[p].add(v); uniq[p].push(v); }
      }
    }
    // stable ordering so UI's predictable
    // keep “time” in natural order if it ends with m (30m, 60m, 90m)
    uniq.dyestuff.sort(byKey("valueOf")); // default alpha
    uniq.pH.sort();                       // Acidic, Alkaline, Neutral (alpha; tweak if you want custom order)
    uniq.mordant.sort();
    uniq.additive.sort();
    uniq.time.sort((a,b) => {
      const A = parseInt(String(a).replace(/\D+/g,''))|0;
      const B = parseInt(String(b).replace(/\D+/g,''))|0;
      return A - B;
    });
  }

  // Render checkboxes
  function renderFilters() {
    filters = {};
    for (const p of PARAMS) {
      const root = filtRoots[p];
      root.innerHTML = "";
      const frag = document.createDocumentFragment();

      // “All” toggle
      const allId = `all-${p}`;
      const allWrap = document.createElement("label");
      allWrap.innerHTML = `<input type="checkbox" id="${allId}" checked /> <b>All</b>`;
      frag.appendChild(allWrap);

      frag.appendChild(document.createElement("div"));

      // Each value
      uniq[p].forEach((val, i) => {
        const id = `f-${p}-${i}`;
        const lab = document.createElement("label");
        lab.style.whiteSpace = "nowrap";
        lab.innerHTML = `<input type="checkbox" id="${id}" data-param="${p}" data-value="${val}"/> ${val}`;
        frag.appendChild(lab);
      });

      root.appendChild(frag);

      // Behavior: if “All” is checked → others unchecked & disabled state ignored
      const all = document.getElementById(allId);
      const valueBoxes = [...root.querySelectorAll('input[type="checkbox"][id^="f-"]')];

      const sync = () => {
        if (all.checked) {
          // no filter
          filters[p] = null;
          valueBoxes.forEach(b => { b.checked = false; });
        } else {
          const sel = new Set(valueBoxes.filter(b => b.checked).map(b => b.dataset.value));
          filters[p] = sel.size ? sel : new Set(); // empty set => hides all
        }
        updateLayoutAndDraw();
      };

      all.addEventListener("change", sync);
      valueBoxes.forEach(b => b.addEventListener("change", () => {
        all.checked = false; // selecting any value turns off “All”
        sync();
      }));

      // initial state
      filters[p] = null;
    }
  }

  // Grid controls (axes + group-by)
  function renderGridControls() {
    const options = PARAMS.map(p => `<option value="${p}">${LABEL[p]||p}</option>`).join("");
    xAxisSel.innerHTML = options;
    yAxisSel.innerHTML = options;
    gBySel.innerHTML   = `<option value="">(none)</option>` + options;

    xAxisSel.value = "dyestuff";
    yAxisSel.value = "pH";
    gBySel.value   = "mordant";

    [xAxisSel, yAxisSel, gBySel].forEach(el => el.addEventListener("change", updateLayoutAndDraw));
  }

  // Load everything
  async function loadAll() {
    IMG_BASE    = imgBaseEl.value.trim();
    IMG_BASE_HI = imgBaseHiEl.value.trim();
    LUT_URL     = lutUrlEl.value.trim();
    setCanvasSize(parseInt(diamEl.value, 10) || 1000);

    let lut = await loadJSON(LUT_URL);
    if (!Array.isArray(lut)) lut = Object.values(lut);

    entries = lut.map(r => ({
      filename: r.filename,
      h: Number(r.h), s: Number(r.s), b: Number(r.b),
      dyestuff: r.dyestuff, pH: r.pH, mordant: r.mordant, additive: r.additive, time: r.time
    })).filter(r => Number.isFinite(r.h) && Number.isFinite(r.s) && Number.isFinite(r.b));

    buildUniques(entries);
    renderFilters();
    renderGridControls();

    const loads = entries.map(e => loadImage(IMG_BASE + e.filename).then(img => ({...e, img})).catch(()=>null));
    const loaded = (await Promise.all(loads)).filter(Boolean);

    sprites = layoutPolar(loaded); // default
    draw();
    drawPreview(-1);
  }

  // Filtering
  function passesFilters(e) {
    for (const p of PARAMS) {
      const sel = filters[p];
      if (sel === null) continue;       // no filter on this param
      if (sel.size === 0) return false; // explicit “hide all”
      if (!sel.has(e[p])) return false; // not selected
    }
    return true;
  }

  function filteredList(list) {
    return list.filter(passesFilters);
  }

  // Layouts
  function layoutPolar(list) {
    const outR = OUTER_R();
    const arr = [];
    for (const e of filteredList(list)) {
      const h = ((e.h % 360) + 360) % 360;
      const s = clamp(e.s, 0, 100);
      const b = clamp(e.b, 0, 100);
      const theta = toRad(h - 90);
      const r     = Math.round(map(s, 0, 100, INNER_R, outR));
      const x     = r * Math.cos(theta);
      const y     = r * Math.sin(theta);
      const size  = map(b, 0, 100, BASE_MIN_SIZE, BASE_MAX_SIZE);
      arr.push({img:e.img, h,s,b, x,y, baseSize:size, meta: metaPack(e)});
    }
    arr.sort((a,b) => a.y - b.y); // slight stable sort to look pleasant
    return arr;
  }

  function metaPack(e) {
    return {
      filename:e.filename, dyestuff:e.dyestuff, pH:e.pH,
      mordant:e.mordant, additive:e.additive, time:e.time
    };
  }

  // Grid layout: categorical axes with cells; group-by controls in-cell nudge
  function layoutGrid(list) {
    const data = filteredList(list);
    const xParam = xAxisSel.value;
    const yParam = yAxisSel.value;
    const gParam = gBySel.value || null;

    const xs = uniq[xParam].slice();
    const ys = uniq[yParam].slice();

    // cell sizes in world coords
    const pad = 60; // outer padding
    const W = DIAM - pad*2;
    const H = DIAM - pad*2;
    const colW = xs.length ? W / xs.length : W;
    const rowH = ys.length ? H / ys.length : H;

    // make index maps
    const xi = new Map(xs.map((v,i)=>[v,i]));
    const yi = new Map(ys.map((v,i)=>[v,i]));

    // group color (just a small outline hue by hash)
    function colorForGroup(val) {
      if (!gParam || !val) return null;
      let hash = 0;
      for (let i=0;i<String(val).length;i++) hash = (hash*31 + String(val).charCodeAt(i))|0;
      const hue = (hash >>> 0) % 360;
      return `hsla(${hue},72%,38%,0.85)`;
    }

    const arr = [];
    for (const e of data) {
      const cx = xi.get(e[xParam]), cy = yi.get(e[yParam]);
      if (cx == null || cy == null) continue;

      // base position: cell center
      const x0 = pad + (cx + 0.5) * colW;
      const y0 = pad + (cy + 0.5) * rowH;

      // size by brightness (keeps visual feel)
      const size = map(e.b, 0, 100, BASE_MIN_SIZE, BASE_MAX_SIZE);

      // nudge to separate overlaps (spiral by a stable hash of filename and group value)
      let seedStr = e.filename + "|" + (gParam ? e[gParam] : "");
      let hash = 0; for (let i=0;i<seedStr.length;i++) hash = (hash*131 + seedStr.charCodeAt(i))|0;
      const angle = (hash >>> 0) % 360 * Math.PI / 180;
      const radius = Math.min(colW, rowH) * 0.18 * ((hash>>>8)%100)/100; // up to 18% of cell
      const x = x0 + Math.cos(angle) * radius;
      const y = y0 + Math.sin(angle) * radius;

      arr.push({
        img:e.img, h:e.h, s:e.s, b:e.b,
        x,y, baseSize:size, meta: metaPack(e),
        outline: colorForGroup(gParam ? e[gParam] : null)
      });
    }

    // store grid guides info for drawing axes
    layoutGrid._axes = { xs, ys, pad, colW, rowH, xParam, yParam };
    return arr;
  }

  function applyView() {
    ctx.translate(DIAM/2 + view.offsetX, DIAM/2 + view.offsetY);
    ctx.scale(view.scale, view.scale);
    if (mode === "grid") {
      // In grid, anchor at top-left world origin so pan feels natural:
      ctx.translate(-DIAM/2, -DIAM/2);
    }
  }

  function clear() {
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,canvas.width/dpr, canvas.height/dpr);
  }

  // Guides
  function drawGuidesPolar() {
    if (!guidesEl.checked) return;
    const outR = OUTER_R();
    ctx.save(); applyView();
    ctx.lineWidth = 1 / view.scale;
    for (let S=0; S<=100; S+=20) {
      const r = map(S, 0,100, INNER_R, outR);
      ctx.strokeStyle = (S%50===0) ? "rgba(0,0,0,0.28)" : "rgba(0,0,0,0.13)";
      ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    for (let H=0; H<360; H+=30) {
      const t = toRad(H-90);
      const x1 = (INNER_R-14)*Math.cos(t), y1 = (INNER_R-14)*Math.sin(t);
      const x2 = (OUTER_R()+14)*Math.cos(t), y2 = (OUTER_R()+14)*Math.sin(t);
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawGuidesGrid() {
    if (!guidesEl.checked) return;
    const ax = layoutGrid._axes; if (!ax) return;
    const { xs, ys, pad, colW, rowH, xParam, yParam } = ax;

    ctx.save(); applyView();
    ctx.lineWidth = 1 / view.scale;
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    // grid lines
    for (let i=0;i<=xs.length;i++){
      const x = pad + i*colW;
      ctx.beginPath(); ctx.moveTo(x, pad); ctx.lineTo(x, pad + ys.length*rowH); ctx.stroke();
    }
    for (let j=0;j<=ys.length;j++){
      const y = pad + j*rowH;
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(pad + xs.length*colW, y); ctx.stroke();
    }

    // labels
    ctx.fillStyle = "#111";
    ctx.font = (12 / view.scale) + "px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let i=0;i<xs.length;i++){
      const x = pad + (i+0.5)*colW;
      ctx.fillText(String(xs[i]), x, pad - 18 / view.scale);
    }
    ctx.save();
    ctx.translate(pad - 10 / view.scale, pad + (ys.length*rowH)/2);
    ctx.rotate(-Math.PI/2);
    ctx.fillText(LABEL[yParam]||yParam, 0, -30 / view.scale);
    ctx.restore();

    // axis titles
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(LABEL[xParam]||xParam, pad + (xs.length*colW)/2, pad + ys.length*rowH + 26 / view.scale);

    ctx.restore();
  }

  // Hover-only soft square shadow
  function fillRoundRect(x, y, w, h, r, color, alpha=1) {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.lineTo(x+w-rr, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+rr);
    ctx.lineTo(x+w, y+h-rr);
    ctx.quadraticCurveTo(x+w, y+h, x+w-rr, y+h);
    ctx.lineTo(x+rr, y+h);
    ctx.quadraticCurveTo(x, y+h, x, y+h-rr);
    ctx.lineTo(x, y+rr);
    ctx.quadraticCurveTo(x, y, x+rr, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawSprites() {
    ctx.save(); applyView();
    for (let i=0;i<sprites.length;i++){
      const s = sprites[i];
      const size = s.baseSize * sizeScale;
      const a = lerp(MIN_ALPHA, MAX_ALPHA, s.b/100);

      // hover square shadow only
      if (i === hoverIdx) {
        const shadowPad = 4;
        const rx = s.x - (size/2) + 2;
        const ry = s.y - (size/2) + 2;
        fillRoundRect(rx, ry, size + shadowPad, size + shadowPad, Math.max(3, size*0.08), "black", 0.18);
      }

      // image
      const w = s.img.width, h = s.img.height;
      const side = Math.min(w,h), sx=(w-side)/2, sy=(h-side)/2;
      ctx.save(); ctx.globalAlpha = a;
      ctx.drawImage(s.img, sx, sy, side, side, s.x - size/2, s.y - size/2, size, size);
      ctx.restore();

      // optional group outline (grid)
      if (mode === "grid" && s.outline) {
        ctx.save();
        ctx.lineWidth = Math.max(1, 2 / view.scale);
        ctx.strokeStyle = s.outline;
        ctx.strokeRect(s.x - size/2, s.y - size/2, size, size);
        ctx.restore();
      }

      if (i === hoverIdx) {
        ctx.save();
        ctx.lineWidth = Math.max(1, 2 / view.scale);
        ctx.strokeStyle = "rgba(0,0,0,0.65)";
        ctx.strokeRect(s.x - size/2, s.y - size/2, size, size);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function draw() {
    clear();
    if (mode === "polar") drawGuidesPolar();
    else drawGuidesGrid();
    drawSprites();
  }

  // Hit-testing
  function screenToWorld(mx, my) {
    const rect = canvas.getBoundingClientRect();
    const x = mx - rect.left, y = my - rect.top;
    let wx = (x - DIAM/2 - view.offsetX) / view.scale;
    let wy = (y - DIAM/2 - view.offsetY) / view.scale;
    if (mode === "grid") { wx += DIAM/2; wy += DIAM/2; }
    return {x: wx, y: wy};
  }
  function findHover(mx,my) {
    if (!sprites.length) return -1;
    const {x,y} = screenToWorld(mx,my);
    let best=-1, bestD=Infinity;
    for (let i=0;i<sprites.length;i++){
      const s = sprites[i];
      const size = s.baseSize * sizeScale;
      const dX = Math.abs(x - s.x), dY = Math.abs(y - s.y);
      const hitHalf = size * 0.55;
      if (dX <= hitHalf && dY <= hitHalf) {
        const d = Math.hypot(dX,dY);
        if (d < bestD) { best=i; bestD=d; }
      }
    }
    return best;
  }

  // Preview with hi-res fallback
  function drawPreview(idx) {
    bctx.clearRect(0,0,big.width,big.height);
    if (idx < 0) { meta.textContent = "Hover a swatch…"; return; }
    const s = sprites[idx];
    const pad = 8, box = Math.min(big.width, big.height) - pad*2;

    let previewImg = s.img;
    const fname = s.meta.filename;

    if (IMG_BASE_HI) {
      const cached = hiCache.get(fname);
      if (cached === undefined) {
        hiCache.set(fname, "loading");
        loadImage(IMG_BASE_HI + fname)
          .then(img => { hiCache.set(fname, img); if (idx===hoverIdx) drawPreview(idx); })
          .catch(()=> hiCache.set(fname, "error"));
      } else if (cached instanceof HTMLImageElement) {
        previewImg = cached;
      }
    }

    const w = previewImg.width, h = previewImg.height;
    const side = Math.min(w,h), sx=(w-side)/2, sy=(h-side)/2;

    bctx.save();
    bctx.imageSmoothingEnabled = true;
    bctx.drawImage(previewImg, sx, sy, side, side, pad, pad, box, box);
    bctx.restore();

    if (hiCache.get(fname) === "loading") {
      bctx.save();
      bctx.fillStyle="rgba(0,0,0,0.55)";
      bctx.fillRect(pad,pad,box,box);
      bctx.fillStyle="#fff"; bctx.font="bold 14px system-ui";
      bctx.textAlign="center"; bctx.textBaseline="middle";
      bctx.fillText("Loading hi-res…", pad+box/2, pad+box/2);
      bctx.restore();
    }

    meta.innerHTML =
      `<div><b>File</b>: ${s.meta.filename}</div>
       <div><b>Dye</b>: ${s.meta.dyestuff}  <b>pH</b>: ${s.meta.pH}</div>
       <div><b>Mordant</b>: ${s.meta.mordant}</div>
       <div><b>Additive</b>: ${s.meta.additive}  <b>Time</b>: ${s.meta.time}</div>
       <div class="sep" style="margin:8px 0;"></div>
       <div><b>H</b>: ${fmt2(s.h)}  <b>S</b>: ${fmt2(s.s)}  <b>B</b>: ${fmt2(s.b)}</div>`;
  }

  // Events
  canvas.addEventListener("mousemove", (ev) => {
    const i = findHover(ev.clientX, ev.clientY);
    if (i !== hoverIdx) { hoverIdx = i; draw(); drawPreview(hoverIdx); }
  });
  canvas.addEventListener("mouseleave", () => { hoverIdx=-1; draw(); drawPreview(-1); });

  // Pan
  let dragging=false, lastX=0, lastY=0;
  canvas.addEventListener("mousedown", (e)=>{ dragging=true; lastX=e.clientX; lastY=e.clientY; });
  window.addEventListener("mouseup", ()=> dragging=false);
  window.addEventListener("mousemove", (e)=>{
    if (!dragging) return;
    const dx=e.clientX-lastX, dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY;
    view.offsetX += dx; view.offsetY += dy; draw();
  });

  // Zoom
  canvas.addEventListener("wheel", (e)=>{
    e.preventDefault();
    const f = (e.deltaY<0)?1.1:1/1.1;
    zoomAt(e.clientX, e.clientY, f);
  }, {passive:false});

  function zoomAt(mx,my,factor) {
    const newScale = clamp(view.scale*factor, 0.5, 4);
    factor = newScale / view.scale;
    const rect = canvas.getBoundingClientRect();
    const cx = mx - rect.left - DIAM/2 - view.offsetX;
    const cy = my - rect.top  - DIAM/2 - view.offsetY;
    view.offsetX -= cx * (factor - 1);
    view.offsetY -= cy * (factor - 1);
    view.scale = newScale;
    zoomSlider.value = view.scale.toFixed(2);
    zoomVal.textContent = `${view.scale.toFixed(2)}×`;
    draw();
  }

  zoomSlider.addEventListener("input", ()=>{
    const target = Number(zoomSlider.value);
    const rect = canvas.getBoundingClientRect();
    zoomAt(rect.left + DIAM/2, rect.top + DIAM/2, target / view.scale);
  });
  sizeSlider.addEventListener("input", ()=>{
    sizeScale = Number(sizeSlider.value);
    sizeVal.textContent = `${sizeScale.toFixed(2)}×`;
    draw();
  });
  resetBtn.addEventListener("click", ()=>{
    zoomSlider.value = "1.00"; zoomVal.textContent = "1.00×";
    sizeSlider.value = "1.00"; sizeVal.textContent = "1.00×";
    sizeScale = 1; resetView();
  });

  // Mode toggle
  modeEls.forEach(r => r.addEventListener("change", ()=>{
    mode = modeEls.find(e=>e.checked)?.value || "polar";
    updateLayoutAndDraw();
  }));

  // Apply filters / relayout
  function updateLayoutAndDraw() {
    if (!entries.length) return;
    const base = entries.map(e => ({...e, img: null})); // placeholder
    // Use already-loaded images by filename lookup from sprites or cache previous images
    const imgByName = new Map();
    sprites.forEach(s => imgByName.set(s.meta.filename, s.img));
    const withImg = base.map(e => ({...e, img: imgByName.get(e.filename) || null}));
    // we still need images for any new items (e.g., filters turned on reveal ones unseen)
    const need = withImg.filter(e => !e.img);
    Promise.all(need.map(e => loadImage(IMG_BASE + e.filename).then(img=>{e.img=img;}).catch(()=>{})))
      .then(()=>{
        if (mode === "polar") sprites = layoutPolar(withImg);
        else sprites = layoutGrid(withImg);
        draw();
        drawPreview(hoverIdx);
      });
  }

  // Initial
  loadBtn.addEventListener("click", ()=>{ hiCache.clear(); loadAll().catch(err=>alert("Load failed: "+err.message)); });

  (function init(){
    sizeVal.textContent = "1.00×";
    zoomVal.textContent = "1.00×";
    setCanvasSize(parseInt(diamEl.value,10) || 1000);
    draw();
    loadAll().catch(console.error);
  })();
})();
