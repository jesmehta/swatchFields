(() => {
  const imgBaseEl   = document.getElementById("imgBase");
  const lutUrlEl    = document.getElementById("lutUrl");
  const loadBtn     = document.getElementById("loadSwatches");
  const statusEl    = document.getElementById("status");

  const showThumbEl = document.getElementById("showThumb");
  const thumb       = document.getElementById("thumb");
  const tctx        = thumb.getContext("2d");

  const sampleFile  = document.getElementById("sampleFile");
  const sampleUrlEl = document.getElementById("sampleUrl");
  const loadSampleUrlBtn = document.getElementById("loadSampleUrl");

  const tileEl = document.getElementById("tile");
  const wHsl = document.getElementById("wH"), wHval = document.getElementById("wHval");
  const wBsl = document.getElementById("wB"), wBval = document.getElementById("wBval");
  const wSsl = document.getElementById("wS"), wSval = document.getElementById("wSval");

  const renderBtn = document.getElementById("render");
  const savePNG   = document.getElementById("downloadPNG");
  const saveCSV   = document.getElementById("downloadCSV");

  const out = document.getElementById("out");
  const octx = out.getContext("2d", { willReadFrequently: true });
  const info = document.getElementById("info");

  // hovered swatch panel
  const hoverCanvas = document.getElementById("hoverSwatch");
  const hctx        = hoverCanvas.getContext("2d");
  const hoverMeta   = document.getElementById("hoverMeta");

  let IMG_BASE = "images/";
  let LUT_URL  = "swatch_lookup.json";

  let swatches = [];      // { filename, img, h,s,b, dyestuff, pH, mordant, additive, time }
  let sampleImg = null;   // HTMLImageElement
  let sampleData = null;  // ImageData

  // mosaic state for hover lookup
  let mosaicRows = [];            // array of tile rows (for CSV + hover)
  let mosaicGrid = [];            // 2D array [ty][tx] -> row
  let lastTileSize = 20;
  let tilesX = 0, tilesY = 0;

  // ---------- helpers ----------
  function setStatus(s){ statusEl.textContent = s; }
  function loadJSON(url){
    return fetch(url, {cache:"no-store"}).then(r=>{ if(!r.ok) throw new Error(r.status); return r.json(); });
  }
  function loadImage(src, useCORS=true){
    return new Promise((res,rej)=>{
      const i = new Image();
      if (useCORS) i.crossOrigin = "anonymous";
      i.onload = ()=> res(i);
      i.onerror = ()=> rej(new Error("load "+src));
      i.src = src;
    });
  }
  function fetchAsBlobURL(url){
    return fetch(url, { mode: "cors", cache: "no-store" })
      .then(r => { if(!r.ok) throw new Error("HTTP "+r.status); return r.blob(); })
      .then(blob => URL.createObjectURL(blob));
  }
  function rgb2hsb(r,g,b){
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    let h,s,v=max, d=max-min; s = max===0?0:d/max;
    if(max===min){ h=0; }
    else{
      switch(max){
        case r: h=(g-b)/d + (g<b?6:0); break;
        case g: h=(b-r)/d + 2; break;
        case b: h=(r-g)/d + 4; break;
      }
      h/=6;
    }
    return { h:h*360, s:s*100, b:v*100 };
  }
  function avgHSB(imgData, x, y, w, h){
    const {data, width, height} = imgData;
    let sumR=0, sumG=0, sumB=0, count=0;
    const x0=Math.max(0,x), y0=Math.max(0,y);
    const x1=Math.min(width, x+w), y1=Math.min(height, y+h);
    for(let j=y0;j<y1;j++){
      let idx=(j*width + x0)*4;
      for(let i=x0;i<x1;i++){
        const r=data[idx], g=data[idx+1], b=data[idx+2], a=data[idx+3];
        if(a>0){ sumR+=r; sumG+=g; sumB+=b; count++; }
        idx+=4;
      }
    }
    if(!count) return {h:0,s:0,b:0};
    const r=Math.round(sumR/count), g=Math.round(sumG/count), b=Math.round(sumB/count);
    return rgb2hsb(r,g,b);
  }
  function hueDelta(a,b){ const d=Math.abs(a-b)%360; return d>180?360-d:d; }
  function scoreHSB(h1,s1,b1, h2,s2,b2, wH,wB,wS){
    const dh=hueDelta(h1,h2);
    return wH*dh + wB*Math.abs(b1-b2) + wS*Math.abs(s1-s2);
  }
  function toCSV(rows){
    const head = ["tx","ty","x","y","w","h","tileH","tileS","tileB","filename","swatchH","swatchS","swatchB","dyestuff","pH","mordant","additive","time","score"].join(",");
    const lines = rows.map(r => [
      r.tx,r.ty,r.x,r.y,r.w,r.h,
      r.tileH.toFixed(2),r.tileS.toFixed(2),r.tileB.toFixed(2),
      r.filename,
      r.swatchH.toFixed(2),r.swatchS.toFixed(2),r.swatchB.toFixed(2),
      r.dyestuff,r.pH,r.mordant,r.additive,r.time,
      r.score.toFixed(3)
    ].join(","));
    return head + "\n" + lines.join("\n");
  }
  function downloadBlob(filename, mime, text){
    const blob = new Blob([text], {type:mime});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(()=> URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- original thumbnail ----------
  function updateThumbVisibility(){
    if(!sampleImg){ thumb.style.display = "none"; return; }
    if(showThumbEl.checked){
      // fit width of panel (thumb canvas width set by CSS; use device pixels to draw crisp)
      const maxW = thumb.clientWidth || 220;
      const ratio = sampleImg.naturalWidth / sampleImg.naturalHeight;
      const w = Math.max(100, Math.floor(maxW));
      const h = Math.floor(w / ratio);
      thumb.width = w;
      thumb.height = h;
      tctx.clearRect(0,0,w,h);
      tctx.drawImage(sampleImg, 0,0, w,h);
      thumb.style.display = "block";
    }else{
      thumb.style.display = "none";
    }
  }
  showThumbEl.addEventListener("change", updateThumbVisibility);

  // ---------- load swatches ----------
  loadBtn.addEventListener("click", async ()=>{
    try{
      setStatus("loading…");
      IMG_BASE = imgBaseEl.value.trim() || "images/";
      LUT_URL  = lutUrlEl.value.trim() || "swatch_lookup.json";

      let lut = await loadJSON(LUT_URL);
      if(!Array.isArray(lut)) lut = Object.values(lut);

      const base = IMG_BASE.endsWith("/")? IMG_BASE : IMG_BASE+"/";
      const meta = lut.map(r => ({
        filename: r.filename,
        h: Number(r.h), s: Number(r.s), b: Number(r.b),
        dyestuff: r.dyestuff, pH: r.pH, mordant: r.mordant, additive: r.additive, time: r.time
      })).filter(r => Number.isFinite(r.h) && Number.isFinite(r.s) && Number.isFinite(r.b));

      const imgs = await Promise.all(meta.map(m =>
        loadImage(base + m.filename, /*useCORS*/ false).then(img => ({...m, img})).catch(()=>null)
      ));
      swatches = imgs.filter(Boolean);
      setStatus(`ready (${swatches.length} swatches)`);
      info.textContent = "Swatches loaded. Pick a sample image and Render.";
    }catch(err){
      setStatus("error");
      alert("Failed loading swatches: "+err.message);
    }
  });

  // ---------- load sample image ----------
  sampleFile.addEventListener("change", ()=>{
    const f = sampleFile.files?.[0]; if(!f) return;
    const url = URL.createObjectURL(f);
    loadSampleFromURL(url, { revoke:true, assumeSafe:true });
  });

  loadSampleUrlBtn.addEventListener("click", ()=>{
    const url = sampleUrlEl.value.trim(); if(!url) return;
    loadSampleFromURL(url, { revoke:false, assumeSafe:false });
  });

  async function loadSampleFromURL(url, { revoke=false, assumeSafe=false } = {}){
    try{
      let img = await loadImage(url, /*useCORS*/ true).catch(()=>null);
      let blobURL;
      if(!img || !assumeSafe){
        try{
          blobURL = await fetchAsBlobURL(url);
          img = await loadImage(blobURL, /*useCORS*/ false);
        }catch(e){ /* ignore */ }
      }
      if(!img) throw new Error("Could not load image (CORS or network).");

      sampleImg = img;
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      out.width = w; out.height = h;
      octx.clearRect(0,0,w,h);
      octx.drawImage(img, 0,0);

      try{
        sampleData = octx.getImageData(0,0,w,h);
        info.textContent = `Sample loaded: ${w}×${h}px (pixels readable)`;
      }catch(se){
        sampleData = null;
        info.textContent =
          "Sample loaded, but pixels are not readable due to CORS. " +
          "Use the file picker or a CORS-enabled URL.";
      }

      updateThumbVisibility();

      if (blobURL) setTimeout(()=> URL.revokeObjectURL(blobURL), 1500);
      if (revoke)  setTimeout(()=> URL.revokeObjectURL(url), 1500);
    }catch(e){
      info.textContent = "Could not load sample image (check URL/CORS or use file picker).";
      updateThumbVisibility();
    }
  }

  // ---------- sliders ----------
  [wHsl,wBsl,wSsl].forEach(sl => sl.addEventListener("input", syncWeights));
  function syncWeights(){
    wHval.textContent = Number(wHsl.value).toFixed(2);
    wBval.textContent = Number(wBsl.value).toFixed(2);
    wSval.textContent = Number(wSsl.value).toFixed(2);
  }
  syncWeights();

  // ---------- render mosaic ----------
  renderBtn.addEventListener("click", ()=>{
    if(!swatches.length){ alert("Load swatches first."); return; }
    if(!sampleImg){ alert("Load a sample image first."); return; }
    if(!sampleData){
      alert("This image blocks pixel access (CORS). Use file picker or a CORS-enabled URL.");
      return;
    }

    const wH = Number(wHsl.value), wB = Number(wBsl.value), wS = Number(wSsl.value);
    const tile = Math.max(4, Math.min(200, parseInt(tileEl.value,10) || 20));
    lastTileSize = tile;

    const W = sampleData.width, H = sampleData.height;

    octx.clearRect(0,0,out.width,out.height);
    const rows = [];

    for(let y=0, ty=0; y<H; y+=tile, ty++){
      for(let x=0, tx=0; x<W; x+=tile, tx++){
        const {h:th, s:ts, b:tb} = avgHSB(sampleData, x, y, tile, tile);

        // find best swatch (one tile = one swatch)
        let best = null, bestScore = Infinity;
        for(const s of swatches){
          const sc = scoreHSB(th,ts,tb, s.h,s.s,s.b, wH,wB,wS);
          if(sc < bestScore){ best = s; bestScore = sc; }
        }

        if(best){
          const img = best.img;
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side)/2, sy = (img.height - side)/2;
          octx.drawImage(img, sx, sy, side, side, x, y, tile, tile);

          rows.push({
            tx, ty, x, y, w:tile, h:tile,
            tileH:th, tileS:ts, tileB:tb,
            filename: best.filename,
            swatchH: best.h, swatchS: best.s, swatchB: best.b,
            dyestuff: best.dyestuff, pH: best.pH, mordant: best.mordant, additive: best.additive, time: best.time,
            score: bestScore,
            img: best.img // keep for hover rendering
          });
        }
      }
    }

    // build hover lookup grid
    tilesX = Math.ceil(W / tile);
    tilesY = Math.ceil(H / tile);
    mosaicRows = rows;
    mosaicGrid = Array.from({length: tilesY}, ()=> Array(tilesX).fill(null));
    for(const r of rows){
      if (r.ty < tilesY && r.tx < tilesX){
        mosaicGrid[r.ty][r.tx] = r;
      }
    }

    info.textContent = `Rendered mosaic: ${tilesX}×${tilesY} tiles (${rows.length} tiles)`;
    savePNG.disabled = false;
    saveCSV.disabled = false;

    savePNG.onclick = ()=>{
      const url = out.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url; a.download = "mosaic.png"; a.click();
    };
    saveCSV.onclick = ()=>{
      const csv = toCSV(rows);
      downloadBlob("mosaic_tile_to_swatch.csv", "text/csv", csv);
    };
  });

  // ---------- hover logic (tile -> swatch panel) ----------
  out.addEventListener("mousemove", (e)=>{
    if(!mosaicGrid.length) return;
    const rect = out.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const tx = Math.floor(mx / lastTileSize);
    const ty = Math.floor(my / lastTileSize);
    if (tx < 0 || ty < 0 || tx >= tilesX || ty >= tilesY) { clearHover(); return; }
    const row = mosaicGrid[ty]?.[tx];
    if (!row) { clearHover(); return; }
    renderHover(row);
  });
  out.addEventListener("mouseleave", clearHover);

  function clearHover(){
    hctx.clearRect(0,0,hoverCanvas.width,hoverCanvas.height);
    hoverMeta.innerHTML =
      `<div class="datarow"><b>File:</b> —</div>
       <div class="datarow"><b>Dye:</b> —</div>
       <div class="datarow"><b>pH:</b> —</div>
       <div class="datarow"><b>Mordant:</b> —</div>
       <div class="datarow"><b>Additive:</b> —</div>
       <div class="datarow"><b>Time:</b> —</div>
       <div class="sep"></div>
       <div class="datarow"><b>H:</b> — <b>S:</b> — <b>B:</b> —</div>
       <div class="datarow"><b>Score:</b> —</div>
       <small class="subtle">Move cursor over mosaic.</small>`;
  }

  function renderHover(row){
    // draw the swatch square-cropped into the hover canvas
    hctx.clearRect(0,0,hoverCanvas.width,hoverCanvas.height);
    const img = row.img;
    const side = Math.min(img.width, img.height);
    const sx = (img.width - side)/2, sy = (img.height - side)/2;
    hctx.imageSmoothingEnabled = true;
    hctx.drawImage(img, sx, sy, side, side, 0, 0, hoverCanvas.width, hoverCanvas.height);

    hoverMeta.innerHTML =
      `<div class="datarow"><b>File:</b> ${row.filename}</div>
       <div class="datarow"><b>Dye:</b> ${row.dyestuff}</div>
       <div class="datarow"><b>pH:</b> ${row.pH}</div>
       <div class="datarow"><b>Mordant:</b> ${row.mordant}</div>
       <div class="datarow"><b>Additive:</b> ${row.additive}</div>
       <div class="datarow"><b>Time:</b> ${row.time}</div>
       <div class="sep"></div>
       <div class="datarow"><b>H:</b> ${row.swatchH.toFixed(2)}  <b>S:</b> ${row.swatchS.toFixed(2)}  <b>B:</b> ${row.swatchB.toFixed(2)}</div>
       <div class="datarow"><b>Score:</b> ${row.score.toFixed(3)}</div>`;
  }

  // ---------- init ----------
  function updateThumbOnResize(){ if(showThumbEl.checked) updateThumbVisibility(); }
  window.addEventListener("resize", updateThumbOnResize);
})();
