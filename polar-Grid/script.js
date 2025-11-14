/* Swatch Browser — Polar/Grid + Filters + Nested axes + Preview (final) */
(() => {
  // -------- UI ELEMENTS --------
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
  const innerXSel= document.getElementById("innerX");
  const innerYSel= document.getElementById("innerY");
  const gridPanel= document.getElementById("gridPanel");

  const canvas = document.getElementById("wheel");
  const ctx    = canvas.getContext("2d", { willReadFrequently: true });
  const big    = document.getElementById("big");
  const bctx   = big.getContext("2d", { willReadFrequently: true });
  const meta   = document.getElementById("meta");

  // -------- CONFIG --------
  let IMG_BASE    = "images/";
  let IMG_BASE_HI = "images/";
  let LUT_URL     = "swatch_lookup.json";
  let DIAM        = 1000;

  const INNER_R = 70;
  const OUTER_R = () => Math.floor(DIAM * 0.47);
  const BASE_MIN_SIZE = 18, BASE_MAX_SIZE = 46;
  const MIN_ALPHA = 0.35, MAX_ALPHA = 1.0;

  const view = { scale: 1, offsetX: 0, offsetY: 0 };
  const dpr  = Math.max(1, window.devicePixelRatio || 1);

  // -------- STATE --------
  let entries = [];           // LUT rows with H,S,B + metadata (no images)
  let sprites = [];           // positioned drawables with images
  let uniq    = {};           // unique values by param
  let filters = {};           // current filter selections
  let mode    = "polar";      // "polar" | "grid"
  let sizeScale = 1;          // user size multiplier
  let hoverIdx  = -1;         // hovered sprite index
  const hiCache = new Map();  // fname -> hi-res Image | "loading" | "error"

  const PARAMS = ["dyestuff","pH","mordant","additive","time"];

  // -------- HELPERS --------
  const PH_ORDER = ["Acidic","Neutral","Alkaline"];
  const PH_ANN   = { Acidic:"Acidic (~pH 3)", Neutral:"Neutral (~pH 7)", Alkaline:"Alkaline (~pH 9)" };
  const displayVal = (param, val) => (param==="pH" ? (PH_ANN[val] || val) : val);

  // Convert time strings to minutes for numeric sorting (12h -> 720)
  const timeToMinutes = (t) => {
    if (typeof t !== "string") return 0;
    const m = t.trim().toLowerCase();
    if (m.endsWith("h")) return (parseInt(m, 10) || 0) * 60;
    if (m.endsWith("m")) return (parseInt(m, 10) || 0);
    const n = parseInt(m.replace(/\D+/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  };

  const toRad = (deg)=> (deg % 360) * Math.PI/180;
  const clamp = (v,lo,hi)=> Math.min(hi, Math.max(lo, v));
  const lerp  = (a,b,t)=> a + (b - a) * t;
  const map   = (v,in0,in1,out0,out1)=> out0 + (clamp((v-in0)/(in1-in0),0,1) * (out1-out0));
  const fmt2  = (n)=> Number(n).toFixed(2);

  function setCanvasSize(px) {
    DIAM = px|0;
    const css = DIAM, real = Math.round(css*dpr);
    canvas.style.width = css+"px"; canvas.style.height = css+"px";
    canvas.width = real; canvas.height = real;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    resetView();
  }
  function resetView() {
    view.scale = Number(zoomSlider.value) || 1;
    view.offsetX = 0; view.offsetY = 0;
    draw();
  }

  async function loadJSON(url){
    const r=await fetch(url,{cache:"no-store"});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  function loadImage(src){
    return new Promise((res,rej)=>{
      const i=new Image();
      i.onload=()=>res(i);
      i.onerror=()=>rej(new Error("Failed "+src));
      i.src=src;
    });
  }

  function buildUniques(list){
    uniq = {}; PARAMS.forEach(p=> uniq[p]=[]);
    const seen = {}; PARAMS.forEach(p=> seen[p]=new Set());
    for(const e of list){
      PARAMS.forEach(p => {
        if(!seen[p].has(e[p])){ seen[p].add(e[p]); uniq[p].push(e[p]); }
      });
    }
    uniq.dyestuff.sort();
    uniq.pH.sort((a,b)=> PH_ORDER.indexOf(a) - PH_ORDER.indexOf(b));
    uniq.mordant.sort();
    uniq.additive.sort();
    // important: time sort using minutes (so 12h comes last)
    uniq.time.sort((a,b)=> timeToMinutes(a) - timeToMinutes(b));
  }

  function renderFilters(){
    filters = {};
    for(const p of PARAMS){
      const root = filtRoots[p]; root.innerHTML="";
      const frag = document.createDocumentFragment();

      const allId = `all-${p}`;
      const allLbl = document.createElement("label");
      allLbl.innerHTML = `<input type="checkbox" id="${allId}" checked /> <b>All</b>`;
      frag.appendChild(allLbl);

      uniq[p].forEach((val,i)=>{
        const id = `f-${p}-${i}`;
        const lab = document.createElement("label");
        lab.style.whiteSpace="nowrap";
        lab.innerHTML = `<input type="checkbox" id="${id}" data-param="${p}" data-value="${val}"> ${displayVal(p,val)}`;
        frag.appendChild(lab);
      });

      root.appendChild(frag);

      const all = document.getElementById(allId);
      const boxes = [...root.querySelectorAll('input[type="checkbox"][id^="f-"]')];

      const sync = ()=>{
        if(all.checked){ filters[p]=null; boxes.forEach(b=> b.checked=false); }
        else{
          const sel = new Set(boxes.filter(b=>b.checked).map(b=>b.dataset.value));
          filters[p] = sel.size ? sel : new Set(); // empty = hide all
        }
        relayoutAndDraw();
      };
      all.addEventListener("change", sync);
      boxes.forEach(b=> b.addEventListener("change", ()=>{ all.checked=false; sync(); }));

      filters[p]=null;
    }
  }

  function renderAxisControls(){
    const opts = PARAMS.map(p=> `<option value="${p}">${p}</option>`).join("");
    xAxisSel.innerHTML = opts; yAxisSel.innerHTML = opts;
    innerXSel.innerHTML = `<option value="">(none)</option>` + opts;
    innerYSel.innerHTML = `<option value="">(none)</option>` + opts;
    xAxisSel.value="dyestuff"; yAxisSel.value="pH";
    innerXSel.value="mordant"; innerYSel.value="time";
    [xAxisSel,yAxisSel,innerXSel,innerYSel].forEach(el=> el.addEventListener("change", relayoutAndDraw));
  }

  function setGridPanelVisibility(){
    gridPanel.style.display = (mode === "grid") ? "block" : "none";
  }

  function passesFilters(e){
    for(const p of PARAMS){
      const sel = filters[p];
      if(sel===null) continue;
      if(sel.size===0) return false;
      if(!sel.has(e[p])) return false;
    }
    return true;
  }
  const filtered = (list)=> list.filter(passesFilters);
  const metaPack = (e)=> ({ filename:e.filename, dyestuff:e.dyestuff, pH:e.pH, mordant:e.mordant, additive:e.additive, time:e.time });

  // -------- LAYOUTS --------
  function layoutPolar(list){
    const outR = OUTER_R(); const arr=[];
    for(const e of filtered(list)){
      const h=((e.h%360)+360)%360, s=clamp(e.s,0,100), b=clamp(e.b,0,100);
      const th=toRad(h-90), r=Math.round(map(s,0,100,INNER_R,outR));
      const x=r*Math.cos(th), y=r*Math.sin(th);
      const size=map(b,0,100,BASE_MIN_SIZE,BASE_MAX_SIZE);
      arr.push({ img: e.img, h, s, b, x, y, baseSize: size, meta: metaPack(e) });
    }
    arr.sort((a,b)=> a.y-b.y);
    layoutPolar._axes=null;
    return arr;
  }

  // Grid with optional nested inner axes (X′, Y′)
  function layoutGrid(list){
    const data = filtered(list);
    const X = xAxisSel.value, Y=yAxisSel.value;
    const IX = innerXSel.value || null, IY = innerYSel.value || null;

    const xs = uniq[X].slice(), ys=uniq[Y].slice();
    const xi = new Map(xs.map((v,i)=>[v,i]));
    const yi = new Map(ys.map((v,i)=>[v,i]));

    const pad=70, W=DIAM-pad*2, H=DIAM-pad*2;
    const colW = xs.length ? W/xs.length : W;
    const rowH = ys.length ? H/ys.length : H;

    const innerMap = new Map();
    const key = (xv,yv)=> `${xv}||${yv}`;

    if (IX || IY){
      for(const e of data){
        const k = key(e[X], e[Y]);
        if(!innerMap.has(k)){
          innerMap.set(k, {
            ixVals: IX ? [] : null, iyVals: IY ? [] : null,
            ixSeen: IX ? new Set() : null, iySeen: IY ? new Set() : null
          });
        }
        const cell = innerMap.get(k);
        if (IX && !cell.ixSeen.has(e[IX])) { cell.ixSeen.add(e[IX]); cell.ixVals.push(e[IX]); }
        if (IY && !cell.iySeen.has(e[IY])) { cell.iySeen.add(e[IY]); cell.iyVals.push(e[IY]); }
      }
      innerMap.forEach(cell=>{
        if(cell.ixVals) cell.ixVals.sort();
        if(cell.iyVals) cell.iyVals.sort((a,b)=>{
          if (IY === "time") return timeToMinutes(a) - timeToMinutes(b);
          const A=parseInt(String(a).replace(/\D+/g,''))||0;
          const B=parseInt(String(b).replace(/\D+/g,''))||0;
          return A-B;
        });
        if(cell.ixVals) cell.ixIndex = new Map(cell.ixVals.map((v,i)=>[v,i]));
        if(cell.iyVals) cell.iyIndex = new Map(cell.iyVals.map((v,i)=>[v,i]));
      });
    }

    const arr=[];
    for(const e of data){
      const cx = xi.get(e[X]), cy = yi.get(e[Y]);
      if (cx==null || cy==null) continue;

      const cellX = pad + cx*colW, cellY = pad + cy*rowH;
      const centerX = cellX + colW/2, centerY = cellY + rowH/2;

      const size = map(e.b,0,100,BASE_MIN_SIZE,BASE_MAX_SIZE);

      let x=centerX, y=centerY;

      if (IX || IY){
        const cell = innerMap.get(key(e[X], e[Y]));
        const innerCols = cell?.ixVals?.length || 1;
        const innerRows = cell?.iyVals?.length || 1;

        const gridPad = Math.min(colW,rowH)*0.15; // margin inside cell
        const innerW = colW - gridPad*2;
        const innerH = rowH - gridPad*2;

        const ix = IX ? cell.ixIndex.get(e[IX]) : 0;
        const iy = IY ? cell.iyIndex.get(e[IY]) : 0;

        const colCW = innerW / innerCols;
        const rowRH = innerH / innerRows;

        x = cellX + gridPad + (ix + 0.5) * colCW;
        y = cellY + gridPad + (iy + 0.5) * rowRH;
      } else {
        // small nudge for duplicates without inner axes
        const seed = e.filename; let hash=0;
        for(let i=0;i<seed.length;i++) hash=(hash*131+seed.charCodeAt(i))|0;
        const ang=(hash>>>0)%360*Math.PI/180;
        const rad=Math.min(colW,rowH)*0.12*((hash>>>8)%100)/100;
        x = centerX + Math.cos(ang)*rad; y = centerY + Math.sin(ang)*rad;
      }

      arr.push({img:e.img, h:e.h, s:e.s, b:e.b, x, y, baseSize:size, meta:metaPack(e)});
    }

    layoutGrid._axes = { xs, ys, pad, colW, rowH, X, Y, IX, IY, innerMap };
    return arr;
  }

  // -------- DRAWING --------
  function applyView(){
    ctx.translate(DIAM/2 + view.offsetX, DIAM/2 + view.offsetY);
    ctx.scale(view.scale, view.scale);
    if (mode==="grid"){ ctx.translate(-DIAM/2, -DIAM/2); }
  }
  function clear(){
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,canvas.width/dpr, canvas.height/dpr);
  }

  function drawGuidesPolar(){
    if(!guidesEl.checked) return;
    const outR = OUTER_R();
    ctx.save(); applyView(); ctx.lineWidth = 1/view.scale;
    for(let S=0; S<=100; S+=20){
      const r = map(S,0,100, INNER_R, outR);
      ctx.strokeStyle = (S%50===0)?"rgba(0,0,0,0.28)":"rgba(0,0,0,0.13)";
      ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.stroke();
    }
    ctx.strokeStyle="rgba(0,0,0,0.35)";
    for(let H=0; H<360; H+=30){
      const t = toRad(H-90);
      ctx.beginPath();
      ctx.moveTo((INNER_R-14)*Math.cos(t),(INNER_R-14)*Math.sin(t));
      ctx.lineTo((OUTER_R()+14)*Math.cos(t),(OUTER_R()+14)*Math.sin(t));
      ctx.stroke();
    }
    ctx.restore();
  }

  // Grid lines + axis names + tick labels (with pH annotations)
  function drawGuidesGrid(){
    if(!guidesEl.checked) return;
    const ax = layoutGrid._axes; if(!ax) return;
    const { xs, ys, pad, colW, rowH, X, Y, IX, IY, innerMap } = ax;

    ctx.save(); applyView(); ctx.lineWidth = 1/view.scale; ctx.strokeStyle="rgba(0,0,0,0.18)";
    // outer grid
    for(let i=0;i<=xs.length;i++){
      const x=pad+i*colW;
      ctx.beginPath(); ctx.moveTo(x,pad); ctx.lineTo(x,pad+ys.length*rowH); ctx.stroke();
    }
    for(let j=0;j<=ys.length;j++){
      const y=pad+j*rowH;
      ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(pad+xs.length*colW, y); ctx.stroke();
    }

    // axis names
    ctx.fillStyle="#111"; ctx.font=(12/view.scale)+"px system-ui";
    ctx.textAlign="center"; ctx.textBaseline="bottom";
    ctx.fillText(X, pad+(xs.length*colW)/2, pad-20/view.scale);
    ctx.save();
    ctx.translate(pad-42/view.scale, pad+(ys.length*rowH)/2); // moved left to avoid overlap
    ctx.rotate(-Math.PI/2);
    ctx.fillText(Y, 0, 0);
    ctx.restore();

    // tick labels
    ctx.fillStyle="#111"; ctx.font=(11/view.scale)+"px system-ui";
    // X ticks (top)
    for(let ci=0; ci<xs.length; ci++){
      const xv = xs[ci];
      const x = pad + ci*colW + colW/2;
      ctx.textAlign="center"; ctx.textBaseline="bottom";
      ctx.fillText(displayVal(X, xv), x, pad-4/view.scale);
    }
    // Y ticks (left)
    for(let rj=0; rj<ys.length; rj++){
      const yv = ys[rj];
      const y = pad + rj*rowH + rowH/2;
      ctx.textAlign="right"; ctx.textBaseline="middle";
      ctx.fillText(displayVal(Y, yv), pad-8/view.scale, y);
    }

    // inner grid hints
    if (IX || IY){
      ctx.setLineDash([3/view.scale, 3/view.scale]); ctx.strokeStyle="rgba(0,0,0,0.12)";
      xs.forEach((xv,ci)=>{
        ys.forEach((yv,rj)=>{
          const cell = innerMap.get(`${xv}||${yv}`); if(!cell) return;
          const innerCols = cell.ixVals?.length || 1;
          const innerRows = cell.iyVals?.length || 1;
          const cellX = pad + ci*colW, cellY = pad + rj*rowH;
          const gridPad = Math.min(colW,rowH)*0.15;
          const innerW = colW-gridPad*2, innerH=rowH-gridPad*2;
          const colCW = innerW/innerCols, rowRH=innerH/innerRows;

          for(let k=1;k<innerCols;k++){
            const x = cellX+gridPad + k*colCW;
            ctx.beginPath(); ctx.moveTo(x, cellY+gridPad); ctx.lineTo(x, cellY+gridPad+innerH); ctx.stroke();
          }
          for(let k=1;k<innerRows;k++){
            const y = cellY+gridPad + k*rowRH;
            ctx.beginPath(); ctx.moveTo(cellX+gridPad, y); ctx.lineTo(cellX+gridPad+innerW, y); ctx.stroke();
          }
        });
      });
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function fillRoundRect(x,y,w,h,r,color,alpha=1){
    const rr = Math.max(0, Math.min(r, Math.min(w,h)/2));
    ctx.save(); ctx.globalAlpha=alpha; ctx.fillStyle=color;
    ctx.beginPath();
    ctx.moveTo(x+rr,y); ctx.lineTo(x+w-rr,y); ctx.quadraticCurveTo(x+w,y,x+w,y+rr);
    ctx.lineTo(x+w,y+h-rr); ctx.quadraticCurveTo(x+w,y+h,x+w-rr,y+h);
    ctx.lineTo(x+rr,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-rr);
    ctx.lineTo(x,y+rr); ctx.quadraticCurveTo(x,y,x+rr,y);
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  function drawSprites(){
    ctx.save(); applyView();
    for(let i=0;i<sprites.length;i++){
      const s=sprites[i];
      const size = s.baseSize * sizeScale;
      const a = lerp(MIN_ALPHA, MAX_ALPHA, s.b/100);

      // hover-only shadow square
      if (i===hoverIdx){
        const rx=s.x-(size/2)+2, ry=s.y-(size/2)+2;
        fillRoundRect(rx, ry, size+4, size+4, Math.max(3,size*0.08), "black", 0.18);
      }

      // draw square-cropped image
      const w=s.img.width, h=s.img.height;
      const side=Math.min(w,h), sx=(w-side)/2, sy=(h-side)/2;
      ctx.save(); ctx.globalAlpha=a;
      ctx.drawImage(s.img, sx, sy, side, side, s.x-size/2, s.y-size/2, size, size);
      ctx.restore();

      if (i===hoverIdx){
        ctx.save(); ctx.lineWidth=Math.max(1, 2/view.scale); ctx.strokeStyle="rgba(0,0,0,0.65)";
        ctx.strokeRect(s.x-size/2, s.y-size/2, size, size); ctx.restore();
      }
    }
    ctx.restore();
  }

  function draw(){
    clear();
    if (mode==="polar") drawGuidesPolar(); else drawGuidesGrid();
    drawSprites();
  }

  // -------- INTERACTION --------
  function screenToWorld(mx,my){
    const r = canvas.getBoundingClientRect();
    let x = (mx - r.left - DIAM/2 - view.offsetX) / view.scale;
    let y = (my - r.top  - DIAM/2 - view.offsetY) / view.scale;
    if (mode==="grid"){ x += DIAM/2; y += DIAM/2; }
    return {x,y};
  }
  function findHover(mx,my){
    if(!sprites.length) return -1;
    const {x,y} = screenToWorld(mx,my);
    let best=-1, bestD=Infinity;
    for(let i=0;i<sprites.length;i++){
      const s=sprites[i];
      const size=s.baseSize*sizeScale;
      const dx=Math.abs(x-s.x), dy=Math.abs(y-s.y);
      const hit=size*0.55;
      if(dx<=hit && dy<=hit){
        const d=Math.hypot(dx,dy);
        if(d<bestD){ best=i; bestD=d; }
      }
    }
    return best;
  }

  function drawPreview(idx){
    bctx.clearRect(0,0,big.width,big.height);
    if(idx<0){ meta.textContent="Hover a swatch…"; return; }
    const s=sprites[idx];
    const pad=8, box=Math.min(big.width,big.height)-pad*2;

    let img=s.img; const fname=s.meta.filename;
    const cached=hiCache.get(fname);
    if(cached===undefined && IMG_BASE_HI){
      hiCache.set(fname,"loading");
      loadImage(IMG_BASE_HI+fname).then(im=>{ hiCache.set(fname,im); if(idx===hoverIdx) drawPreview(idx); })
                                  .catch(()=> hiCache.set(fname,"error"));
    } else if (cached instanceof HTMLImageElement){ img=cached; }

    const w=img.width, h=img.height, side=Math.min(w,h), sx=(w-side)/2, sy=(h-side)/2;
    bctx.save(); bctx.imageSmoothingEnabled=true;
    bctx.drawImage(img, sx,sy,side,side, pad,pad, box,box); bctx.restore();

    if(hiCache.get(fname)==="loading"){
      bctx.save(); bctx.fillStyle="rgba(0,0,0,0.55)"; bctx.fillRect(pad,pad,box,box);
      bctx.fillStyle="#fff"; bctx.font="bold 14px system-ui"; bctx.textAlign="center"; bctx.textBaseline="middle";
      bctx.fillText("Loading hi-res…", pad+box/2, pad+box/2); bctx.restore();
    }

    meta.innerHTML =
      `<div><b>File</b>: ${s.meta.filename}</div>
       <div><b>Dye</b>: ${s.meta.dyestuff}  <b>pH</b>: ${displayVal("pH", s.meta.pH)}</div>
       <div><b>Mordant</b>: ${s.meta.mordant}</div>
       <div><b>Additive</b>: ${s.meta.additive}  <b>Time</b>: ${s.meta.time}</div>
       <div class="sep" style="margin:8px 0;"></div>
       <div><b>H</b>: ${fmt2(s.h)}  <b>S</b>: ${fmt2(s.s)}  <b>B</b>: ${fmt2(s.b)}</div>`;
  }

  // mouse hover
  canvas.addEventListener("mousemove",(e)=>{ const i=findHover(e.clientX,e.clientY); if(i!==hoverIdx){ hoverIdx=i; draw(); drawPreview(hoverIdx);} });
  canvas.addEventListener("mouseleave",()=>{ hoverIdx=-1; draw(); drawPreview(-1); });

  // drag to pan
  let dragging=false,lastX=0,lastY=0;
  canvas.addEventListener("mousedown",(e)=>{ dragging=true; lastX=e.clientX; lastY=e.clientY; });
  window.addEventListener("mouseup", ()=> dragging=false);
  window.addEventListener("mousemove",(e)=>{ if(!dragging) return; const dx=e.clientX-lastX, dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY; view.offsetX+=dx; view.offsetY+=dy; draw(); });

  // wheel to zoom (cursor-centered)
  canvas.addEventListener("wheel",(e)=>{ e.preventDefault(); const f=(e.deltaY<0)?1.1:1/1.1; zoomAt(e.clientX,e.clientY,f); }, {passive:false});
  function zoomAt(mx,my,factor){
    const newScale = clamp(view.scale*factor, 0.5, 4);
    factor = newScale / view.scale;
    const r = canvas.getBoundingClientRect();
    const cx = mx - r.left - DIAM/2 - view.offsetX;
    const cy = my - r.top  - DIAM/2 - view.offsetY;
    view.offsetX -= cx*(factor-1); view.offsetY -= cy*(factor-1);
    view.scale = newScale; zoomSlider.value = view.scale.toFixed(2); zoomVal.textContent = `${view.scale.toFixed(2)}×`; draw();
  }

  // right-side controls
  zoomSlider.addEventListener("input",()=>{ const target=Number(zoomSlider.value); const r=canvas.getBoundingClientRect(); zoomAt(r.left+DIAM/2, r.top+DIAM/2, target/view.scale); });
  sizeSlider.addEventListener("input",()=>{ sizeScale=Number(sizeSlider.value); sizeVal.textContent=`${sizeScale.toFixed(2)}×`; draw(); });
  resetBtn.addEventListener("click",()=>{ zoomSlider.value="1.00"; zoomVal.textContent="1.00×"; sizeSlider.value="1.00"; sizeVal.textContent="1.00×"; sizeScale=1; resetView(); });

  // mode change
  modeEls.forEach(r=> r.addEventListener("change",()=>{
    mode = modeEls.find(e=>e.checked)?.value || "polar";
    setGridPanelVisibility();
    relayoutAndDraw();
  }));

  // -------- LIFECYCLE --------
  function relayoutAndDraw(){
    if(!entries.length) return;
    // keep already loaded images
    const imgBy = new Map(sprites.map(s=> [s.meta.filename, s.img]));
    const withImg = entries.map(e=> ({...e, img: imgBy.get(e.filename) || null}));
    const need = filtered(withImg).filter(e=> !e.img);
    Promise.all(need.map(e=> loadImage(IMG_BASE+e.filename).then(img=>{e.img=img;}).catch(()=>{})))
      .then(()=> {
        sprites = (mode==="polar") ? layoutPolar(withImg) : layoutGrid(withImg);
        draw(); drawPreview(hoverIdx);
      });
  }

  loadBtn.addEventListener("click", ()=>{ hiCache.clear(); loadAll().catch(err=> alert("Load failed: "+err.message)); });

  async function loadAll(){
    IMG_BASE    = imgBaseEl.value.trim();
    IMG_BASE_HI = imgBaseHiEl.value.trim();
    LUT_URL     = lutUrlEl.value.trim();
    setCanvasSize(parseInt(diamEl.value,10) || 1000);

    let lut = await loadJSON(LUT_URL);
    if(!Array.isArray(lut)) lut = Object.values(lut);

    // normalize entries
    entries = lut.map(r=> ({
      filename:r.filename,
      h:Number(r.h), s:Number(r.s), b:Number(r.b),
      dyestuff:r.dyestuff, pH:r.pH, mordant:r.mordant, additive:r.additive, time:r.time
    })).filter(r=> Number.isFinite(r.h) && Number.isFinite(r.s) && Number.isFinite(r.b));

    buildUniques(entries);
    renderFilters();
    renderAxisControls();
    setGridPanelVisibility();

    const loads = entries.map(e=> loadImage(IMG_BASE+e.filename).then(img=> ({...e,img})).catch(()=>null));
    const loaded = (await Promise.all(loads)).filter(Boolean);

    sprites = layoutPolar(loaded);
    draw(); drawPreview(-1);
  }

  // init
  (function init(){
    sizeVal.textContent="1.00×"; zoomVal.textContent="1.00×";
    setCanvasSize(parseInt(diamEl.value,10) || 1000);
    draw();
    loadAll().catch(console.error);
  })();
})();
