(() => {
  // HARD-CODED PATHS (as per your workflow)
  const SWATCH_FOLDER  = "../imagesSuperCrop/";   // main display images
  const PREVIEW_FOLDER = "../imagesBordered/";  // high-res hover swatch
  const LUT_URL        = "../swatch_lookup.json";

  // --- DOM refs ---
  const canvas    = document.getElementById("view");
  const ctx       = canvas.getContext("2d");
  const thumb     = document.getElementById("thumb");
  const tctx      = thumb.getContext("2d");
  const hoverC    = document.getElementById("hoverSwatch");
  const hctx      = hoverC.getContext("2d");

  const loadBtn   = document.getElementById("loadBtn");
  const statusEl  = document.getElementById("status");
  const infoEl    = document.getElementById("info");

  const zoomSl    = document.getElementById("zoom");
  const zoomVal   = document.getElementById("zoomVal");
  const sizeSl    = document.getElementById("swatchSize");
  const sizeVal   = document.getElementById("swatchSizeVal");
  const showGuidesEl = document.getElementById("showGuides");

  const gridSettings = document.getElementById("gridSettings");
  const gridOuterXEl = document.getElementById("gridOuterX");
  const gridOuterYEl = document.getElementById("gridOuterY");
  const gridInnerXEl = document.getElementById("gridInnerX");
  const gridInnerYEl = document.getElementById("gridInnerY");

  const filterDyestuffEl = document.getElementById("filterDyestuff");
  const filterPHEl       = document.getElementById("filterPH");
  const filterMordantEl  = document.getElementById("filterMordant");
  const filterAddEl      = document.getElementById("filterAdditive");
  const filterTimeEl     = document.getElementById("filterTime");

  const selectAllBtn = document.getElementById("selectAll");
  const clearAllBtn  = document.getElementById("clearAll");

  const countTotalEl    = document.getElementById("countTotal");
  const countFilteredEl = document.getElementById("countFiltered");

  const hoverMetaEl = document.getElementById("hoverMeta");
  const hoverFields = {
    filename: hoverMetaEl.querySelector('[data-field="filename"]'),
    dyestuff: hoverMetaEl.querySelector('[data-field="dyestuff"]'),
    pH:       hoverMetaEl.querySelector('[data-field="pH"]'),
    mordant:  hoverMetaEl.querySelector('[data-field="mordant"]'),
    additive: hoverMetaEl.querySelector('[data-field="additive"]'),
    time:     hoverMetaEl.querySelector('[data-field="time"]'),
    H:        hoverMetaEl.querySelector('[data-field="H"]'),
    S:        hoverMetaEl.querySelector('[data-field="S"]'),
    B:        hoverMetaEl.querySelector('[data-field="B"]')
  };

  // --- state ---
  let swatches = [];       // full dataset
  let filtered = [];       // after filter
  let layout   = [];       // drawn swatches for hover (x,y,size,swatch)
  let mode     = "polar";  // "polar" | "grid"

  const PARAMS = ["dyestuff","pH","mordant","additive","time"];

  // --- helpers ---
  function setStatus(msg) { statusEl.textContent = msg; }

  function loadJSON(url) {
    return fetch(url, { cache:"no-store" }).then(r=>{
      if(!r.ok) throw new Error(r.status);
      return r.json();
    });
  }

  function loadImage(src) {
    return new Promise((resolve,reject)=>{
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load "+src));
      img.src = src;
    });
  }

  function rgbToHex(r,g,b) {
    const toHex = v => v.toString(16).padStart(2,"0");
    return "#" + toHex(r) + toHex(g) + toHex(b);
  }

  // sort helpers
  function sortPH(values) {
    const order = ["Acidic","Neutral","Alkaline"];
    return [...values].sort((a,b)=> order.indexOf(a)-order.indexOf(b));
  }
  function timeToMinutes(t) {
    if (t === "12h") return 720;
    const m = /(\d+)\s*m/.exec(t);
    if (m) return parseInt(m[1],10);
    return 0;
  }
  function sortTime(values) {
    return [...values].sort((a,b)=> timeToMinutes(a)-timeToMinutes(b));
  }

  function buildChips(container, paramName, values) {
    container.innerHTML = "";
    values.forEach(val=>{
      const chip = document.createElement("label");
      chip.className = "chip";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.dataset.param = paramName;
      cb.dataset.value = val;
      cb.addEventListener("change", onFilterChange);
      chip.appendChild(cb);
      chip.append(" "+val);
      container.appendChild(chip);
    });
  }

  function buildFilters() {
    const uniq = (arr) => [...new Set(arr)];

    const dyes  = uniq(swatches.map(s=>s.dyestuff)).sort((a,b)=>a.localeCompare(b));
    const ph    = sortPH(uniq(swatches.map(s=>s.pH)));
    const mord  = uniq(swatches.map(s=>s.mordant)).sort((a,b)=>a.localeCompare(b));
    const add   = uniq(swatches.map(s=>s.additive)).sort((a,b)=>a.localeCompare(b));
    const time  = sortTime(uniq(swatches.map(s=>s.time)));

    buildChips(filterDyestuffEl, "dyestuff", dyes);
    buildChips(filterPHEl,       "pH",       ph.map(v=>labelPH(v)));
    buildChips(filterMordantEl,  "mordant",  mord);
    buildChips(filterAddEl,      "additive", add);
    buildChips(filterTimeEl,     "time",     time.map(v=>labelTime(v)));
  }

  function labelPH(v) {
    // display annotated, but underlying value remains raw
    if (v === "Acidic")  return "Acidic (~pH3)";
    if (v === "Neutral") return "Neutral (~pH7)";
    if (v === "Alkaline")return "Alkaline (~pH9)";
    return v;
  }
  function unlabelPH(label) {
    if (label.startsWith("Acidic")) return "Acidic";
    if (label.startsWith("Neutral")) return "Neutral";
    if (label.startsWith("Alkaline")) return "Alkaline";
    return label;
  }

  function labelTime(v) {
    if (v === "12h") return "12h (~720m)";
    return v;
  }
  function unlabelTime(label) {
    if (label.startsWith("12h")) return "12h";
    return label;
  }

  function getFilterSelections() {
    const allCbs = document.querySelectorAll(".filter-chips input[type=checkbox]");
    const selected = { dyestuff:new Set(), pH:new Set(), mordant:new Set(), additive:new Set(), time:new Set() };

    allCbs.forEach(cb=>{
      if (!cb.checked) return;
      const param = cb.dataset.param;
      let val = cb.dataset.value;
      if (param === "pH")   val = unlabelPH(val);
      if (param === "time") val = unlabelTime(val);
      selected[param].add(val);
    });

    return selected;
  }

  function applyFilters() {
    const sel = getFilterSelections();

    filtered = swatches.filter(s => (
      (sel.dyestuff.size===0 || sel.dyestuff.has(s.dyestuff)) &&
      (sel.pH.size===0       || sel.pH.has(s.pH)) &&
      (sel.mordant.size===0  || sel.mordant.has(s.mordant)) &&
      (sel.additive.size===0 || sel.additive.has(s.additive)) &&
      (sel.time.size===0     || sel.time.has(s.time))
    ));

    countTotalEl.textContent    = "Total: " + swatches.length;
    countFilteredEl.textContent = "Shown: " + filtered.length;
  }

  function onFilterChange() {
    applyFilters();
    redraw();
  }

  function setAllFilters(checked) {
    const allCbs = document.querySelectorAll(".filter-chips input[type=checkbox]");
    allCbs.forEach(cb => cb.checked = checked);
    applyFilters();
    redraw();
  }

  selectAllBtn.addEventListener("click", ()=> setAllFilters(true));
  clearAllBtn.addEventListener("click", ()=> setAllFilters(false));

  // mode switching
  Array.from(document.querySelectorAll('input[name="mode"]')).forEach(r=>{
    r.addEventListener("change", ()=>{
      mode = r.value;
      gridSettings.style.display = (mode === "grid") ? "block" : "none";
      redraw();
    });
  });

  // zoom / size
  function syncZoom() {
    zoomVal.textContent = zoomSl.value + "×";
    redraw();
  }
  function syncSize() {
    sizeVal.textContent = sizeSl.value + "px";
    redraw();
  }
  zoomSl.addEventListener("input", syncZoom);
  sizeSl.addEventListener("input", syncSize);

  function showGuidesChanged() { redraw(); }
  showGuidesEl.addEventListener("change", showGuidesChanged);

  // grid axis selectors
  function buildAxisSelectors() {
    const opts = [
      { value:"dyestuff", label:"Dyestuff" },
      { value:"pH",       label:"pH" },
      { value:"mordant",  label:"Mordant" },
      { value:"additive", label:"Additive" },
      { value:"time",     label:"Time" }
    ];
    [gridOuterXEl,gridOuterYEl,gridInnerXEl,gridInnerYEl].forEach(sel=>{
      sel.innerHTML = "";
      opts.forEach(o=>{
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        sel.appendChild(opt);
      });
    });
    gridOuterXEl.value = "dyestuff";
    gridOuterYEl.value = "pH";
    gridInnerXEl.value = "mordant";
    gridInnerYEl.value = "time";
  }
  [gridOuterXEl,gridOuterYEl,gridInnerXEl,gridInnerYEl].forEach(sel=>{
    sel.addEventListener("change", ()=> redraw());
  });

  // --- LOADING SWATCHES ---
  loadBtn.addEventListener("click", async ()=>{
    try {
      setStatus("loading…");
      infoEl.textContent = "Loading lookup and images…";

      let lut = await loadJSON(LUT_URL);
      if (!Array.isArray(lut)) lut = Object.values(lut);

      // pre-shape
      const raw = lut.map(r => ({
        filename: r.filename,
        dyestuff: r.dyestuff,
        pH:       r.pH,
        mordant:  r.mordant,
        additive: r.additive,
        time:     r.time,
        h:        Number(r.h),
        s:        Number(r.s),
        b:        Number(r.b)
      }));

      // load bordered & preview images
      const promises = raw.map(async meta => {
        const mainPath    = SWATCH_FOLDER  + meta.filename;
        const previewPath = PREVIEW_FOLDER + meta.filename;
        try {
          const [imgMain, imgPreview] = await Promise.all([
            loadImage(mainPath),
            loadImage(previewPath).catch(()=>loadImage(mainPath)) // fallback
          ]);
          return { ...meta, imgMain, imgPreview };
        } catch (e) {
          console.warn("Failed swatch", meta.filename, e);
          return null;
        }
      });

      const loaded = (await Promise.all(promises)).filter(Boolean);
      swatches = loaded;
      buildFilters();
      buildAxisSelectors();
      applyFilters();
      setStatus("ready");
      infoEl.textContent = `Loaded ${swatches.length} swatches. Use filters and toggles to explore.`;
      redraw();
    } catch (err) {
      console.error(err);
      setStatus("error");
      infoEl.textContent = "Failed to load swatches.";
      alert("Error loading swatches: "+err.message);
    }
  });

  // --- DRAWING ---
  function clearCanvas() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
  }

  function redraw() {
    if (!swatches.length) {
      clearCanvas();
      layout = [];
      drawThumb();
      return;
    }

    clearCanvas();
    layout = [];

    if (mode === "polar") drawPolar();
    else drawGrid();

    drawThumb();
  }

  function drawThumb() {
    const w = canvas.width;
    const h = canvas.height;
    const scale = 0.35;
    const tw = w * scale;
    const th = h * scale;
    thumb.width  = tw;
    thumb.height = th;
    tctx.clearRect(0,0,tw,th);
    tctx.drawImage(canvas, 0, 0, w, h, 0, 0, tw, th);
    thumb.style.display = "block";
  }

  function drawPolar() {
    const w = canvas.width;
    const h = canvas.height;
    const cx = w/2;
    const cy = h/2;

    const zoom = parseFloat(zoomSl.value);
    const size = parseInt(sizeSl.value,10);

    const maxR = (Math.min(w,h)/2 - size*2) * zoom;
    const minR = size * 1.5;

    // guides
    if (showGuidesEl.checked) {
      ctx.save();
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 1;
      // circles at B=20,40,60,80,100
      [20,40,60,80,100].forEach(br=>{
        const r = minR + (br/100) * (maxR-minR);
        ctx.beginPath();
        ctx.arc(cx,cy,r,0,Math.PI*2);
        ctx.stroke();
      });
      // axes at main hues
      [0,60,120,180,240,300].forEach(hue=>{
        const a = hue * Math.PI/180;
        const r = maxR;
        ctx.beginPath();
        ctx.moveTo(cx,cy);
        ctx.lineTo(cx+Math.cos(a)*r, cy+Math.sin(a)*r);
        ctx.stroke();
      });
      ctx.restore();
    }

    // draw swatches
    filtered.forEach(s=>{
      const angle = (s.h-90) * Math.PI/180; // rotate so 0° at top
      const r = minR + (s.b/100) * (maxR-minR);

      const x = cx + Math.cos(angle)*r;
      const y = cy + Math.sin(angle)*r;

      const half = size/2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x-half, y-half, size, size);
      ctx.clip();
      const img = s.imgMain;
      const side = Math.min(img.width, img.height);
      const sx = (img.width-side)/2;
      const sy = (img.height-side)/2;
      ctx.drawImage(img, sx, sy, side, side, x-half, y-half, size, size);
      ctx.restore();

      layout.push({ x, y, size, swatch:s });
    });
  }

  function getParamValues(param, list) {
    const uniq = (arr) => [...new Set(arr)];
    if (param === "pH") {
      return sortPH(uniq(list.map(s=>s.pH)));
    } else if (param === "time") {
      return sortTime(uniq(list.map(s=>s.time)));
    } else if (param === "dyestuff") {
      return uniq(list.map(s=>s.dyestuff)).sort((a,b)=>a.localeCompare(b));
    } else if (param === "mordant") {
      return uniq(list.map(s=>s.mordant)).sort((a,b)=>a.localeCompare(b));
    } else if (param === "additive") {
      return uniq(list.map(s=>s.additive)).sort((a,b)=>a.localeCompare(b));
    }
    return [];
  }

  function drawGrid() {
    const w = canvas.width;
    const h = canvas.height;

    const zoom   = parseFloat(zoomSl.value);
    const size   = parseInt(sizeSl.value,10);
    const margin = 40;

    const outerX = gridOuterXEl.value;
    const outerY = gridOuterYEl.value;
    const innerX = gridInnerXEl.value;
    const innerY = gridInnerYEl.value;

    const outerXVals = getParamValues(outerX, filtered);
    const outerYVals = getParamValues(outerY, filtered);

    const cols = Math.max(outerXVals.length, 1);
    const rows = Math.max(outerYVals.length, 1);

    const gridW = (w - margin*2) * zoom;
    const gridH = (h - margin*2) * zoom;

    const cellW = gridW / Math.max(cols,1);
    const cellH = gridH / Math.max(rows,1);

    const originX = margin + (w - margin*2 - gridW)/2;
    const originY = margin + (h - margin*2 - gridH)/2;

    // precompute inner value sets per param
    const innerXVals = getParamValues(innerX, filtered);
    const innerYVals = getParamValues(innerY, filtered);

    const pad = size * 0.6;
    const innerW = Math.max(cellW - pad*2, size);
    const innerH = Math.max(cellH - pad*2, size);

    // guides & labels
    if (showGuidesEl.checked) {
      ctx.save();
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 1;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#6b7280";
      ctx.font = "11px system-ui, sans-serif";

      // vertical grid lines + X labels
      for (let i=0;i<=cols;i++) {
        const x = originX + cellW * i;
        ctx.beginPath();
        ctx.moveTo(x, originY);
        ctx.lineTo(x, originY + gridH);
        ctx.stroke();
      }
      for (let i=0;i<cols;i++) {
        const cx = originX + cellW * (i+0.5);
        const label = formatAxisLabel(outerX, outerXVals[i]);
        ctx.fillText(label, cx, originY - 18);
      }
      // outer X param name
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.fillText("X: "+ axisTitle(outerX), originX + gridW/2, originY - 32);

      // horizontal grid lines + Y labels
      ctx.font = "11px system-ui, sans-serif";
      for (let j=0;j<=rows;j++) {
        const y = originY + cellH * j;
        ctx.beginPath();
        ctx.moveTo(originX, y);
        ctx.lineTo(originX + gridW, y);
        ctx.stroke();
      }
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let j=0;j<rows;j++) {
        const cy = originY + cellH * (j+0.5);
        const label = formatAxisLabel(outerY, outerYVals[j]);
        ctx.fillText(label, originX - 6, cy);
      }
      // outer Y param name
      ctx.save();
      ctx.translate(originX - 34, originY + gridH/2);
      ctx.rotate(-Math.PI/2);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.fillText("Y: "+ axisTitle(outerY), 0, 0);
      ctx.restore();

      ctx.restore();
    }

    // group swatches by outer cells
    const cellMap = new Map(); // key "xVal|yVal" -> array of swatches
    function keyXY(xVal,yVal){ return xVal+"|"+yVal; }
    filtered.forEach(s=>{
      const xVal = s[outerX];
      const yVal = s[outerY];
      const key = keyXY(xVal,yVal);
      if (!cellMap.has(key)) cellMap.set(key, []);
      cellMap.get(key).push(s);
    });

    // draw swatches cell by cell
    cellMap.forEach((list, key)=>{
      const [xVal,yVal] = key.split("|");
      const i = outerXVals.indexOf(xVal);
      const j = outerYVals.indexOf(yVal);
      if (i<0 || j<0) return;

      const cellX = originX + cellW * i;
      const cellY = originY + cellH * j;

      // layout inside cell
      list.forEach(s=>{
        const ix = Math.max(innerXVals.indexOf(s[innerX]), 0);
        const iy = Math.max(innerYVals.indexOf(s[innerY]), 0);
        const maxIX = Math.max(innerXVals.length-1, 1);
        const maxIY = Math.max(innerYVals.length-1, 1);

        const nx = maxIX===0 ? 0.5 : ix / maxIX;
        const ny = maxIY===0 ? 0.5 : iy / maxIY;

        const cx = cellX + pad + nx * innerW;
        const cy = cellY + pad + ny * innerH;

        const drawSize = size;
        const half = drawSize/2;

        ctx.save();
        ctx.beginPath();
        ctx.rect(cx-half, cy-half, drawSize, drawSize);
        ctx.clip();
        const img = s.imgMain;
        const side = Math.min(img.width, img.height);
        const sx = (img.width-side)/2;
        const sy = (img.height-side)/2;
        ctx.drawImage(img, sx, sy, side, side, cx-half, cy-half, drawSize, drawSize);
        ctx.restore();

        layout.push({ x:cx, y:cy, size:drawSize, swatch:s });
      });
    });
  }

  function formatAxisLabel(param, value) {
    if (param === "pH")   return labelPH(value);
    if (param === "time") return labelTime(value);
    return value;
  }

  function axisTitle(param) {
    if (param === "dyestuff") return "Dyestuff";
    if (param === "pH")       return "pH";
    if (param === "mordant")  return "Mordant";
    if (param === "additive") return "Additive";
    if (param === "time")     return "Time";
    return param;
  }

  // --- HOVER ---
  function distance2(x1,y1,x2,y2) {
    const dx = x1-x2, dy=y1-y2;
    return dx*dx+dy*dy;
  }

  canvas.addEventListener("mousemove", (e)=>{
    if (!layout.length) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let best = null;
    let bestDist = Infinity;
    layout.forEach(entry=>{
      const r = entry.size/1.5;
      const d2 = distance2(mx,my, entry.x, entry.y);
      if (d2 < r*r && d2 < bestDist) {
        best = entry;
        bestDist = d2;
      }
    });

    if (best) showHover(best.swatch);
    else clearHover();
  });

  canvas.addEventListener("mouseleave", clearHover);

  function clearHover() {
    hctx.clearRect(0,0,hoverC.width,hoverC.height);
    for (const k in hoverFields) {
      hoverFields[k].textContent = "—";
    }
  }

  function showHover(s) {
    // draw preview image
    hctx.clearRect(0,0,hoverC.width,hoverC.height);
    const img = s.imgPreview || s.imgMain;
    const side = Math.min(img.width, img.height);
    const sx = (img.width-side)/2;
    const sy = (img.height-side)/2;
    hctx.imageSmoothingEnabled = true;
    hctx.drawImage(img, sx, sy, side, side, 0, 0, hoverC.width, hoverC.height);

    hoverFields.filename.textContent = s.filename;
    hoverFields.dyestuff.textContent = s.dyestuff;
    hoverFields.pH.textContent       = labelPH(s.pH);
    hoverFields.mordant.textContent  = s.mordant;
    hoverFields.additive.textContent = s.additive;
    hoverFields.time.textContent     = labelTime(s.time);
    hoverFields.H.textContent        = s.h.toFixed(1);
    hoverFields.S.textContent        = s.s.toFixed(1);
    hoverFields.B.textContent        = s.b.toFixed(1);
  }

  // --- initial ---
  function init() {
    gridSettings.style.display = "none";
    zoomVal.textContent = zoomSl.value + "×";
    sizeVal.textContent = sizeSl.value + "px";
    clearHover();
  }

  init();
})();
