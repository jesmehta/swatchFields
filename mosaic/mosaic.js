(() => {
  // HARD-CODED PATHS (adjust as needed for your repo structure)
  const TILE_FOLDER    = "../imagesSuperCrop/";   // tight square tiles for mosaic
  const PREVIEW_FOLDER = "../imagesBordered/";    // bordered swatches for hover preview
  const LUT_URL        = "../swatch_lookup.json";

  // --- DOM ---
  const loadBtn     = document.getElementById("loadSwatches");
  const statusEl    = document.getElementById("status");
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

  const showThumbEl = document.getElementById("showThumb");
  const thumb = document.getElementById("thumb");
  const tctx  = thumb.getContext("2d");

  const hoverCanvas = document.getElementById("hoverSwatch");
  const hctx        = hoverCanvas.getContext("2d");
  const hoverMeta   = document.getElementById("hoverMeta");

  let swatches = [];      // { filename, h,s,b, dyestuff, pH, mordant, additive, time, imgTile, imgPreview }
  let sampleImg = null;
  let sampleData = null;
  let mosaicRows = [];
  let mosaicGrid = [];
  let lastTileSize = 20;
  let tilesX = 0, tilesY = 0;

  // --- helpers ---
  function setStatus(s){ statusEl.textContent = s; }
  function loadJSON(url){ return fetch(url, {cache:"no-store"}).then(r=>{ if(!r.ok) throw new Error(r.status); return r.json(); }); }
  function loadImage(src, useCORS=true){ return new Promise((res,rej)=>{ const i=new Image(); if(useCORS) i.crossOrigin="anonymous"; i.onload=()=>res(i); i.onerror=()=>rej(new Error("load "+src)); i.src=src; }); }
  function fetchAsBlobURL(url){ return fetch(url, {mode:"cors",cache:"no-store"}).then(r=>{ if(!r.ok) throw new Error("HTTP "+r.status); return r.blob(); }).then(b=>URL.createObjectURL(b)); }
  function rgb2hsb(r,g,b){ r/=255; g/=255; b/=255; const max=Math.max(r,g,b), min=Math.min(r,g,b); let h,s,v=max, d=max-min; s=max===0?0:d/max; if(max===min){h=0;} else { switch(max){case r:h=(g-b)/d + (g<b?6:0);break; case g:h=(b-r)/d + 2;break; case b:h=(r-g)/d + 4;break;} h/=6;} return {h:h*360,s:s*100,b:v*100}; }
  function avgHSB(imgData,x,y,w,h){ const {data,width,height}=imgData; let sumR=0,sumG=0,sumB=0,count=0; const x0=Math.max(0,x), y0=Math.max(0,y); const x1=Math.min(width,x+w), y1=Math.min(height,y+h); for(let j=y0;j<y1;j++){ let idx=(j*width+x0)*4; for(let i=x0;i<x1;i++){ const r=data[idx],g=data[idx+1],b=data[idx+2],a=data[idx+3]; if(a>0){ sumR+=r; sumG+=g; sumB+=b; count++; } idx+=4; } } if(!count) return {h:0,s:0,b:0}; const r=Math.round(sumR/count), g=Math.round(sumG/count), b=Math.round(sumB/count); return rgb2hsb(r,g,b); }
  function hueDelta(a,b){ const d=Math.abs(a-b)%360; return d>180?360-d:d; }
  function scoreHSB(h1,s1,b1,h2,s2,b2,wH,wB,wS){ const dh=hueDelta(h1,h2); return wH*dh + wB*Math.abs(b1-b2) + wS*Math.abs(s1-s2); }
  function toCSV(rows){ const head=["tx","ty","x","y","w","h","tileH","tileS","tileB","filename","swatchH","swatchS","swatchB","dyestuff","pH","mordant","additive","time","score"].join(","); const lines=rows.map(r=>[r.tx,r.ty,r.x,r.y,r.w,r.h,r.tileH.toFixed(2),r.tileS.toFixed(2),r.tileB.toFixed(2),r.filename,r.swatchH.toFixed(2),r.swatchS.toFixed(2),r.swatchB.toFixed(2),r.dyestuff,r.pH,r.mordant,r.additive,r.time,r.score.toFixed(3)].join(",")); return head+"\n"+lines.join("\n"); }
  function downloadBlob(filename,mime,text){ const blob=new Blob([text],{type:mime}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); }

  function updateThumbVisibility(){
    if(!sampleImg){ thumb.style.display="none"; return; }
    if(showThumbEl.checked){
      const maxW = thumb.clientWidth || 280;
      const ratio = (sampleImg.naturalWidth||sampleImg.width)/(sampleImg.naturalHeight||sampleImg.height);
      const w = Math.max(120, Math.floor(maxW));
      const h = Math.floor(w/ratio);
      thumb.width=w; thumb.height=h;
      tctx.clearRect(0,0,w,h);
      tctx.drawImage(sampleImg,0,0,w,h);
      thumb.style.display="block";
    } else {
      thumb.style.display="none";
    }
  }
  window.addEventListener("resize", ()=> showThumbEl.checked && updateThumbVisibility());

  // --- SWATCH LOAD (tiles & preview) ---
  loadBtn.addEventListener("click", async ()=>{
    try{
      setStatus("loading…");
      let lut = await loadJSON(LUT_URL);
      if(!Array.isArray(lut)) lut = Object.values(lut);
      const meta = lut.map(r=>({
        filename:r.filename,
        h:+r.h,
        s:+r.s,
        b:+r.b,
        dyestuff:r.dyestuff,
        pH:r.pH,
        mordant:r.mordant,
        additive:r.additive,
        time:r.time
      })).filter(r=>Number.isFinite(r.h)&&Number.isFinite(r.s)&&Number.isFinite(r.b));

      const imgs = await Promise.all(meta.map(m=>
        Promise.all([
          loadImage(TILE_FOLDER    + m.filename, false),
          loadImage(PREVIEW_FOLDER + m.filename, false).catch(()=>loadImage(TILE_FOLDER + m.filename, false))
        ]).then(([imgTile,imgPreview])=>({ ...m, imgTile, imgPreview })).catch(()=>null)
      ));
      swatches = imgs.filter(Boolean);
      setStatus(`ready (${swatches.length} swatches)`);
      info.textContent = "Swatches loaded. Pick a sample image and Render.";
    }catch(err){
      setStatus("error"); alert("Failed loading swatches: "+err.message);
    }
  });

  // --- SAMPLE LOAD (with CORS fallback) ---
  sampleFile.addEventListener("change", ()=>{
    const f=sampleFile.files?.[0]; if(!f) return;
    const url=URL.createObjectURL(f);
    loadSample(url,{revoke:true,assumeSafe:true});
  });
  loadSampleUrlBtn.addEventListener("click", ()=>{
    const url=sampleUrlEl.value.trim(); if(!url) return;
    loadSample(url,{revoke:false,assumeSafe:false});
  });

  async function loadSample(url,{revoke=false,assumeSafe=false}={}){
    try{
      let img = await loadImage(url,true).catch(()=>null);
      let blobURL;
      if(!img || !assumeSafe){
        try{ blobURL = await fetchAsBlobURL(url); img = await loadImage(blobURL,false); }catch(e){}
      }
      if(!img) throw new Error("Could not load image (CORS or network).");
      sampleImg = img;
      const w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;
      out.width=w; out.height=h; octx.clearRect(0,0,w,h); octx.drawImage(img,0,0);
      try{ sampleData = octx.getImageData(0,0,w,h); info.textContent = `Sample loaded: ${w}×${h}px (pixels readable)`; }
      catch(se){ sampleData=null; info.textContent = "Sample loaded, but pixels are not readable due to CORS. Use the file picker or a CORS-enabled URL."; }
      updateThumbVisibility();
      if(blobURL) setTimeout(()=>URL.revokeObjectURL(blobURL),1500);
      if(revoke)  setTimeout(()=>URL.revokeObjectURL(url),1500);
    }catch(e){
      info.textContent = "Could not load sample image (check URL/CORS or use file picker).";
      updateThumbVisibility();
    }
  }

  // --- sliders display ---
  [wHsl,wBsl,wSsl].forEach(sl=>sl.addEventListener("input",()=>{
    wHval.textContent=Number(wHsl.value).toFixed(2);
    wBval.textContent=Number(wBsl.value).toFixed(2);
    wSval.textContent=Number(wSsl.value).toFixed(2);
  }));
  wHval.textContent="1.00"; wBval.textContent="0.60"; wSval.textContent="0.20";

  // --- render mosaic ---
  renderBtn.addEventListener("click", ()=>{
    if(!swatches.length){ alert("Load swatches first."); return; }
    if(!sampleImg){ alert("Load a sample image first."); return; }
    if(!sampleData){ alert("This image blocks pixel access (CORS). Use file picker or a CORS-enabled URL."); return; }

    const wH=+wHsl.value, wB=+wBsl.value, wS=+wSsl.value;
    const tile=Math.max(4, Math.min(200, parseInt(tileEl.value,10)||20));
    lastTileSize = tile;
    const W=sampleData.width, H=sampleData.height;

    octx.clearRect(0,0,out.width,out.height);
    const rows=[];
    for(let y=0,ty=0;y<H;y+=tile,ty++){
      for(let x=0,tx=0;x<W;x+=tile,tx++){
        const {h:th,s:ts,b:tb}=avgHSB(sampleData,x,y,tile,tile);
        let best=null,bestScore=Infinity;
        for(const s of swatches){
          const sc = scoreHSB(th,ts,tb, s.h,s.s,s.b, wH,wB,wS);
          if(sc<bestScore){best=s;bestScore=sc;}
        }
        if(best){
          const img = best.imgTile; // tile image = SuperCrop
          const side=Math.min(img.width,img.height);
          const sx=(img.width-side)/2;
          const sy=(img.height-side)/2;
          octx.drawImage(img,sx,sy,side,side,x,y,tile,tile);
          rows.push({
            tx,ty,x,y,w:tile,h:tile,
            tileH:th,tileS:ts,tileB:tb,
            filename:best.filename,
            swatchH:best.h,swatchS:best.s,swatchB:best.b,
            dyestuff:best.dyestuff,pH:best.pH,mordant:best.mordant,additive:best.additive,time:best.time,
            score:bestScore,
            swatch:best
          });
        }
      }
    }
    tilesX=Math.ceil(W/tile); tilesY=Math.ceil(H/tile);
    mosaicRows=rows; mosaicGrid=Array.from({length:tilesY},()=>Array(tilesX).fill(null));
    for(const r of rows){ if(r.ty<tilesY && r.tx<tilesX) mosaicGrid[r.ty][r.tx]=r; }

    info.textContent = `Rendered mosaic: ${tilesX}×${tilesY} tiles (${rows.length} tiles)`;
    savePNG.disabled=false; saveCSV.disabled=false;
    savePNG.onclick=()=>{ const url=out.toDataURL("image/png"); const a=document.createElement("a"); a.href=url; a.download="mosaic.png"; a.click(); };
    saveCSV.onclick=()=>{ const csv=toCSV(rows); downloadBlob("mosaic_tile_to_swatch.csv","text/csv",csv); };
  });

  // --- hover over mosaic -> swatch panel (uses Bordered preview) ---
  out.addEventListener("mousemove",(e)=>{
    if(!mosaicGrid.length) return;

    const rect = out.getBoundingClientRect();
    const scaleX = out.width  / rect.width;
    const scaleY = out.height / rect.height;

    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top)  * scaleY;

    const tx=Math.floor(mx/lastTileSize);
    const ty=Math.floor(my/lastTileSize);
    if(tx<0||ty<0||tx>=tilesX||ty>=tilesY){ clearHover(); return; }
    const row=mosaicGrid[ty]?.[tx]; if(!row){ clearHover(); return; }
    renderHover(row.swatch);
  });

  out.addEventListener("mouseleave", clearHover);

  function clearHover(){
    hctx.clearRect(0,0,hoverCanvas.width,hoverCanvas.height);
    hoverMeta.innerHTML = `
      <div><b>File:</b> —</div>
      <div><b>Dye:</b> —</div>
      <div><b>pH:</b> —</div>
      <div><b>Mordant:</b> —</div>
      <div><b>Additive:</b> —</div>
      <div><b>Time:</b> —</div>
      <div class="sep"></div>
      <div><b>H:</b> — <b>S:</b> — <b>B:</b> —</div>
      <small class="subtle">Move cursor over mosaic.</small>
    `;
  }

  function renderHover(s){
    hctx.clearRect(0,0,hoverCanvas.width,hoverCanvas.height);
    const img = s.imgPreview || s.imgTile;
    const side=Math.min(img.width,img.height);
    const sx=(img.width-side)/2;
    const sy=(img.height-side)/2;
    hctx.imageSmoothingEnabled=true;
    hctx.drawImage(img,sx,sy,side,side,0,0,hoverCanvas.width,hoverCanvas.height);
    hoverMeta.innerHTML = `
      <div><b>File:</b> ${s.filename}</div>
      <div><b>Dye:</b> ${s.dyestuff}</div>
      <div><b>pH:</b> ${s.pH}</div>
      <div><b>Mordant:</b> ${s.mordant}</div>
      <div><b>Additive:</b> ${s.additive}</div>
      <div><b>Time:</b> ${s.time}</div>
      <div class="sep"></div>
      <div><b>H:</b> ${s.h.toFixed(2)} <b>S:</b> ${s.s.toFixed(2)} <b>B:</b> ${s.b.toFixed(2)}</div>
    `;
  }

})();
