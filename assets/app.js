/* 臺南市雨水下水道缺失圖台 — GitHub Pages / PWA 版 */
'use strict';

const GRADES = [
  {k:'A', nm:'A　嚴重', c:'#B94E3C', note:'需優先處理'},
  {k:'B', nm:'B　中等', c:'#DDA03B', note:'應追蹤改善'},
  {k:'C', nm:'C　輕微', c:'#8DA88B', note:'定期觀察'},
  {k:'未分級', nm:'未分級', c:'#AC9A85', note:'無法縱走，未評級'}
];
const GC = Object.fromEntries(GRADES.map(g => [g.k, g.c]));
const TYPES = ['管線破損','淤積','管線橫越','纜線附掛','無法縱走'];
const FIXES = [{k:1, nm:'已改善'}, {k:0, nm:'未改善'}];
const CONTRACTS = [
  {k:'C1', c:'#C0673C', nm:'115年度永華行政區老舊雨水箱涵修繕工程', short:'第一年度施工', st:'施工中',
   info:'開口契約，115年7月28日決標，施工中（第一年度啟動段，全為重建）'},
  {k:'C2', c:'#6C8FA6', nm:'臺南市永華行政區老舊雨水箱涵改善工程', short:'中央提報改善', st:'設計中',
   info:'中央提報案，經費已核定，設計中'},
  {k:'C3', c:'#C2A03D', nm:'規劃第二年度修繕', short:'第二年度規劃', st:'待編列',
   info:'已納入第二年度規劃，尚未發包（含原第一年度移列的 30 處）'},
  {k:'C4', c:'#6E9A6A', nm:'另案已完成', short:'另案已完成', st:'已完工',
   info:'115年底前盤點已完成，不列入後續發包'},
  {k:'C5', c:'#A78B6E', nm:'其他工程案辦理', short:'其他工程案', st:'他案辦理',
   info:'由其他工程案處理，非本規劃範圍'},
  {k:'C6', c:'#9E9384', nm:'其它（未納入現行計畫）', short:'其它', st:'未納入',
   info:'經評估未納入第一、二年度及中央提報案'},
  {k:'C0', c:'#CBBFAE', nm:'尚未分配', short:'尚未分配', st:'待評估',
   info:'尚未納入任何修繕計畫（含淤積、管線橫越、纜線附掛、無法縱走及仁德區破損）'}
];
const CN = Object.fromEntries(CONTRACTS.map(c => [c.k, c]));
const LABEL_ZOOM = 16, LABEL_MAX = 160, LIST_MAX = 120;

let RECORDS = [], TAINAN = null, PHOTO_IDX = {}, TOWNS = [], NETWORK = null;
const state = {
  town:new Set(), type:new Set(), grade:new Set(), fixed:new Set(), contract:new Set(),
  q:'', color:'grade', me:null, radius:500, useRadius:false
};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pkey = r => r.town + '|' + r.type + '|' + r.pic;
const photoSrc = r => PHOTO_IDX[pkey(r)] ? './photos/' + PHOTO_IDX[pkey(r)] : '';
const fillOf = r => state.color === 'contract' ? CN[r.contract].c : GC[r.grade];
const LL = r => [r.dlat ?? r.lat, r.dlng ?? r.lng];
const isPhone = () => window.matchMedia('(max-width:880px)').matches;

function toast(msg, ms = 2600){
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

/* 兩點距離（公尺） */
function dist(a, b, c, d){
  const R = 6371000, p = Math.PI / 180;
  const dLat = (c - a) * p, dLng = (d - b) * p;
  const s = Math.sin(dLat/2)**2 + Math.cos(a*p) * Math.cos(c*p) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const fmtDist = m => m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' km';

/* ============================ 啟動 ============================ */
let map, markerLayer, townLayer, pipeLayer, mhLayer, markers = new Map(), current = [];
let meMarker = null, meCircle = null, watchId = null;

(async function init(){
  try{
    const [rec, tw, idx, net] = await Promise.all([
      fetch('./data/records.json').then(r => r.json()),
      fetch('./data/tainan.json').then(r => r.json()),
      fetch('./data/photo_index.json').then(r => r.json()).catch(() => ({})),
      fetch('./data/network.json').then(r => r.json()).catch(() => null)
    ]);
    RECORDS = rec; TAINAN = tw; PHOTO_IDX = idx; NETWORK = net;
  }catch(e){
    $('#bootMsg').textContent = '資料載入失敗，請重新整理。';
    return;
  }
  TOWNS = [...new Set(RECORDS.map(r => r.town))]
    .sort((a, b) => RECORDS.filter(r => r.town === b).length - RECORDS.filter(r => r.town === a).length);

  $('#app').hidden = false;
  buildMap();
  buildNetwork();
  bindUI();
  render();
  $('#boot').classList.add('gone');
  setTimeout(() => $('#boot').remove(), 400);

  if('serviceWorker' in navigator){
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();

/* ============================ 地圖 ============================ */
function buildMap(){
  map = L.map('map', {zoomControl:false, preferCanvas:true, minZoom:9, maxZoom:19, tap:true})
        .setView([23.05, 120.28], 11);
  L.control.zoom({position:'bottomright'}).addTo(map);
  map.attributionControl.setPrefix('');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    subdomains:'abc', attribution:'© OpenStreetMap contributors · 行政區界 g0v/twgeojson',
    maxZoom:19, opacity:.95
  }).addTo(map);

  /* 臺南市以外：白色霧面遮罩 */
  const world = [[-180,-89],[180,-89],[180,89],[-180,89],[-180,-89]];
  L.geoJSON({type:'Feature', geometry:{type:'Polygon', coordinates:[world, ...TAINAN.outline.coordinates]}},
    {style:{fillColor:'#FFFFFF', fillOpacity:.88, color:'#FFFFFF', weight:0, interactive:false}}).addTo(map);

  townLayer = L.geoJSON(
    {type:'FeatureCollection', features:TAINAN.districts.map(d => ({type:'Feature', properties:{name:d.name}, geometry:d.geometry}))},
    {style:districtStyle, interactive:false}).addTo(map);

  L.geoJSON({type:'Feature', geometry:TAINAN.outline},
    {style:{color:'#B87F3E', weight:1.4, fill:false, opacity:.75}, interactive:false}).addTo(map);

  window.CITY = L.geoJSON({type:'Feature', geometry:TAINAN.outline}).getBounds();
  map.setMaxBounds(CITY.pad(.45));
  map.fitBounds(CITY, isPhone()
    ? {paddingTopLeft:[12, 58], paddingBottomRight:[12, 130]}
    : {padding:[16, 16]});

  markerLayer = L.layerGroup().addTo(map);
  map.on('zoomend', () => {const rad = radius(); markers.forEach(m => m.setRadius(rad));});
  map.on('zoomend moveend', updateLabels);

  const legend = L.control({position:'topright'});
  legend.onAdd = () => {const d = L.DomUtil.create('div', 'legend'); d.id = 'legendbox'; return d;};
  legend.addTo(map);

  const note = L.control({position:'topleft'});
  note.onAdd = () => {
    const d = L.DomUtil.create('div', 'mapnote'); d.id = 'zoomnote';
    d.innerHTML = '僅顯示臺南市範圍　·　放大至 <b>街廓層級</b> 自動顯示缺失標籤';
    return d;
  };
  if(!isPhone()) note.addTo(map);

  const loc = L.control({position:'bottomright'});
  loc.onAdd = () => {
    const b = L.DomUtil.create('button', 'mapbtn'); b.id = 'mapLocate';
    b.title = '定位我的位置';
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke-linecap="round"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/></svg>';
    L.DomEvent.disableClickPropagation(b);
    b.onclick = toggleGeo;
    return b;
  };
  if(!isPhone()) loc.addTo(map);
}

/* ============================ 管線 / 人孔圖層 ============================ */
function buildNetwork(){
  pipeLayer = L.layerGroup();
  mhLayer = L.layerGroup();

  if(NETWORK){
    NETWORK.pipes.forEach(p => {
      L.polyline(p.coords.map(c => [c[1], c[0]]), {
        color: GC[p.grade] || '#8B7A63', weight:3, opacity:.7, lineCap:'round'
      }).bindPopup(() => pipePopup(p), {maxWidth:280, minWidth:230}).addTo(pipeLayer);
    });
    NETWORK.manholes.forEach(m => {
      L.circleMarker([m.lat, m.lng], {
        radius:3.2, color:'#fff', weight:1, fillColor:'#8B7A63', fillOpacity:.9
      }).bindPopup(() => mhPopup(m), {maxWidth:260, minWidth:210}).addTo(mhLayer);
    });
  }

  pipeLayer.addTo(map);
  const has = !!(NETWORK && NETWORK.pipes.length);
  $('#pipeCnt').textContent = NETWORK ? NETWORK.pipes.length.toLocaleString() : '0';
  $('#mhCnt').textContent = NETWORK ? NETWORK.manholes.length.toLocaleString() : '0';
  if(!has){
    $('#layerPipes').disabled = true;
    $('#layerManholes').disabled = true;
    $('#layerPipes').setAttribute('aria-pressed', 'false');
  }
}

function pipePopup(p){
  return `<div class="pop">
    <div class="ph"><span class="badge" style="background:${GC[p.grade] || '#AC9A85'}">${p.grade === '未分級' ? '—' : (p.grade || '—')}</span>
      <span class="ty">管線段　${esc(p.town)}</span></div>
    <h3>${esc(p.road || (p.a + ' – ' + p.b))}</h3>
    <table>
      <tr><td>起訖人孔</td><td>${esc(p.a)} – ${esc(p.b)}</td></tr>
      <tr><td>缺失類別</td><td>${p.types.map(esc).join('、') || '—'}</td></tr>
      <tr><td>缺失筆數</td><td>${p.n} 筆（已改善 ${p.fixed} 筆）</td></tr>
    </table>
  </div>`;
}

function mhPopup(m){
  return `<div class="pop">
    <div class="ph"><span class="ty">人孔　${esc(m.town)}</span></div>
    <h3>${esc(m.code)}</h3>
    <table>
      ${m.road ? `<tr><td>路段</td><td>${esc(m.road)}</td></tr>` : ''}
      ${m.depth ? `<tr><td>人孔深度</td><td>${esc(m.depth)}</td></tr>` : ''}
      ${m.typ ? `<tr><td>人孔類型</td><td>${esc(m.typ)}</td></tr>` : ''}
      ${m.rim ? `<tr><td>蓋頂高程</td><td>${esc(m.rim)}</td></tr>` : ''}
      ${m.consDate ? `<tr><td>建造日期</td><td>${esc(m.consDate)}</td></tr>` : ''}
    </table>
  </div>`;
}

function districtStyle(f){
  const n = f.properties.name, has = TOWNS.includes(n);
  const sel = state.town.size ? state.town.has(n) : null;
  return {
    color: sel === true ? '#B87F3E' : '#D8C4A8',
    weight: sel === true ? 1.6 : .8,
    fillColor: sel === true ? '#D9A05B' : (has ? '#E8D5BC' : '#F3EADD'),
    fillOpacity: sel === true ? .16 : (sel === false ? .06 : (has ? .13 : .05))
  };
}

const radius = () => {const z = map.getZoom(); return z <= 11 ? 4 : z <= 13 ? 5 : z <= 15 ? 6.5 : 8;};

function draw(rows){
  markerLayer.clearLayers(); markers = new Map();
  const order = {'C':0, '未分級':1, 'B':2, 'A':3};
  [...rows].sort((a, b) => order[a.grade] - order[b.grade]).forEach(r => {
    const m = L.circleMarker(LL(r), {
      radius: radius(),
      color: r.fixed ? '#5E8A5B' : '#fff',
      weight: r.fixed ? 2.4 : 1.2,
      dashArray: r.approx ? '2,2' : null,
      opacity:.95, fillColor: fillOf(r), fillOpacity: r.fixed ? .55 : (r.approx ? .7 : .92)
    }).bindPopup(() => popup(r), {
      maxWidth:300, minWidth:280, closeButton:true,
      autoPanPaddingTopLeft: isPhone() ? [16, 72] : [24, 24],
      autoPanPaddingBottomRight: isPhone() ? [16, 145] : [24, 24]
    });
    m._rec = r;
    m.on('popupopen', () => highlight(r.id));
    m.addTo(markerLayer); markers.set(r.id, m);
  });
  updateLabels();
}

/* 標籤顯示設定（記在瀏覽器，下次開啟沿用） */
const LABEL = {on:true, grade:true, type:true, no:true, mh:true, contract:true};
try{ Object.assign(LABEL, JSON.parse(localStorage.getItem('labelPrefs') || '{}')); }catch(e){}
const saveLabel = () => { try{ localStorage.setItem('labelPrefs', JSON.stringify(LABEL)); }catch(e){} };

function labelHtml(r){
  const c = CN[r.contract];
  const parts = [];
  if(LABEL.grade) parts.push(`<span class="lg" style="background:${GC[r.grade]}">${r.grade === '未分級' ? '—' : r.grade}</span>`);
  if(LABEL.type) parts.push(`<b>${esc(r.type)}</b>`);
  if(LABEL.no) parts.push(`<span class="ls">${esc(r.repairNo || r.pno)}</span>`);
  if(LABEL.mh && r.dis !== '') parts.push(`<span class="ls">${esc(r.mh)}+${esc(r.dis)}m</span>`);
  if(LABEL.contract && r.contract !== 'C0') parts.push(`<span class="ct" style="background:${c.c}">${esc(c.short)}</span>`);
  return parts.join(' ');
}

function refreshLabels(){
  markers.forEach(m => { if(m.getTooltip()) m.unbindTooltip(); });
  updateLabels();
}

function updateLabels(){
  const any = LABEL.on && (LABEL.grade || LABEL.type || LABEL.no || LABEL.mh || LABEL.contract);
  const on = any && map.getZoom() >= LABEL_ZOOM;
  const b = map.getBounds();
  let n = 0;
  markers.forEach(m => {
    const want = on && n < LABEL_MAX && b.contains(m.getLatLng());
    if(want){
      if(!m.getTooltip()) m.bindTooltip(labelHtml(m._rec), {permanent:true, direction:'right', offset:[9, 0], className:'lbl', opacity:1});
      n++;
    }else if(m.getTooltip()) m.unbindTooltip();
  });
  const note = document.getElementById('zoomnote');
  if(note) note.innerHTML = !any ? '缺失標籤已關閉　·　點選圓點看明細'
    : on ? `已顯示 <b>${n}</b> 筆缺失標籤　·　點選圓點看明細`
    : '僅顯示臺南市範圍　·　放大至 <b>街廓層級</b> 自動顯示缺失標籤';
}

function popup(r){
  const subs = Object.entries(r.subs || {}).map(([k, v]) => `<span>${esc(k)} <b style="color:${GC[v]}">${v}</b></span>`).join('');
  const ext = Object.entries(r.ext || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
  const src = photoSrc(r);
  const c = CN[r.contract];
  const d = state.me ? dist(state.me.lat, state.me.lng, r.lat, r.lng) : null;
  const img = src ? `<a href="${src}" target="_blank" rel="noopener">
      <img src="${src}" alt="${esc(r.pic)} 現況照片" loading="lazy">
      <div class="cap">現況照片 ${esc(r.pic)}　點擊放大</div></a>` : '';
  const eng = `<div class="eng"><div class="eh">工程契約</div>
    <span class="tag"><span class="sq" style="background:${c.c}"></span>${esc(c.short)}　${esc(c.st)}</span>
    <table style="margin-top:6px">
      <tr><td>案名</td><td>${esc(c.nm)}</td></tr>
      ${c.info ? `<tr><td>狀態</td><td>${esc(c.info)}</td></tr>` : ''}
      ${r.repairNo ? `<tr><td>修補編號</td><td>${esc(r.repairNo)}</td></tr>` : ''}
      ${r.mode ? `<tr><td>處理方式</td><td>${esc(r.mode)}${r.method ? `（工法 ${esc(r.method)}）` : ''}</td></tr>` : ''}
      ${r.area != null ? `<tr><td>初估面積</td><td>${r.area} m²／m³</td></tr>` : ''}
      ${r.budget != null ? `<tr><td>總預算</td><td>${Number(r.budget).toLocaleString()} 元</td></tr>` : ''}
      ${r.zone ? `<tr><td>路段分區</td><td>${esc(r.zone)}</td></tr>` : ''}
      ${r.score != null ? `<tr><td>評分</td><td>${r.score} / 5</td></tr>` : ''}
      ${r.boxH != null ? `<tr><td>箱涵尺寸</td><td>H ${r.boxH} × W ${r.boxW} m${r.cover != null ? `，覆土 ${Number(r.cover).toFixed(2)} m` : ''}</td></tr>` : ''}
      ${r.engMemo ? `<tr><td>施工備註</td><td>${esc(r.engMemo)}</td></tr>` : ''}
    </table></div>`;
  return `<div class="pop">
    <div class="ph"><span class="badge" style="background:${GC[r.grade]}">${esc(r.grade)}</span>
      <span class="ty">${esc(r.type)}</span>${d != null ? `<span class="ty" style="margin-left:auto;color:var(--geo)">距我 ${fmtDist(d)}</span>` : ''}</div>
    <h3>${esc(r.pno || r.repairNo || '—')}</h3>
    <div class="loc">${esc(r.town)}　${esc(r.road || '')}${r.addr && r.addr !== r.road ? `<br>${esc(r.addr)}` : ''}</div>
    ${r.desc ? `<div class="desc">${esc(r.desc)}</div>` : ''}
    <table>
      ${r.mh ? `<tr><td>起算人孔</td><td>${esc(r.mh)}${r.dis !== '' ? `（${esc(r.dis)} m）` : ''}</td></tr>` : ''}
      ${ext}
      ${r.date ? `<tr><td>調查日期</td><td>${esc(r.date)}</td></tr>` : ''}
      ${r.org ? `<tr><td>調查單位</td><td>${esc(r.org)}</td></tr>` : ''}
      ${r.pic ? `<tr><td>照片編號</td><td>${esc(r.pic)}</td></tr>` : ''}
      <tr><td>TWD97</td><td>${r.x} , ${r.y}</td></tr>
    </table>
    ${subs ? `<div class="subs">${subs}</div>` : ''}
    ${eng}
    ${r.fixed ? `<div class="fix">✓ ${esc(r.note || '已改善')}</div>` : ''}
    ${r.approx ? '<div class="warn">此點為概略位置：計畫表沿用同一管段座標，圖上已微幅散開以利辨識，匯出檔仍保留原始 X／Y。</div>' : ''}
    <div class="nav">
      <a href="https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}" target="_blank" rel="noopener">Google 導航</a>
      <a href="geo:${r.lat},${r.lng}?q=${r.lat},${r.lng}">開啟地圖 App</a>
    </div>
    ${img}
  </div>`;
}

/* ============================ 定位 ============================ */
function setGeoUI(on){
  ['#locate', '#mLocate', '#mapLocate'].forEach(s => {
    const el = $(s); if(el) el.classList.toggle('on', on);
  });
  $('#clrGeo').hidden = !on;
  $('#radiusWrap').hidden = !on;
}

function toggleGeo(){
  if(state.me){ stopGeo(); return; }
  if(!navigator.geolocation){ toast('此瀏覽器不支援定位功能'); return; }
  if(!window.isSecureContext){ toast('定位需在 HTTPS 網站下使用'); return; }
  $('#geoMsg').textContent = '定位中…';
  toast('定位中…', 1600);
  watchId = navigator.geolocation.watchPosition(onGeo, onGeoErr, {
    enableHighAccuracy:true, timeout:12000, maximumAge:5000
  });
}

function stopGeo(){
  if(watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null; state.me = null; state.useRadius = false;
  const ro = $('#radiusOn'); if(ro) ro.setAttribute('aria-pressed', 'false');
  if(meMarker){ map.removeLayer(meMarker); meMarker = null; }
  if(meCircle){ map.removeLayer(meCircle); meCircle = null; }
  setGeoUI(false);
  $('#geoMsg').textContent = '需允許瀏覽器使用定位。定位後清單會依距離排序，並可設定搜尋半徑。';
  render();
}

function onGeo(pos){
  const {latitude:lat, longitude:lng, accuracy:acc} = pos.coords;
  const first = !state.me;
  state.me = {lat, lng, acc};

  if(!meMarker){
    meMarker = L.marker([lat, lng], {
      icon: L.divIcon({className:'', html:'<div class="me-dot"></div>', iconSize:[16, 16], iconAnchor:[8, 8]}),
      interactive:false, zIndexOffset:1000
    }).addTo(map);
    meCircle = L.circle([lat, lng], {radius:acc, color:'#3E7FBF', weight:1, fillColor:'#3E7FBF', fillOpacity:.10, interactive:false}).addTo(map);
  }else{
    meMarker.setLatLng([lat, lng]);
    meCircle.setLatLng([lat, lng]).setRadius(acc);
  }

  setGeoUI(true);
  const inCity = CITY.contains([lat, lng]);
  $('#geoMsg').textContent = inCity
    ? `已定位，精度約 ${Math.round(acc)} 公尺。清單依距離排序。`
    : `目前位置不在臺南市範圍內（精度約 ${Math.round(acc)} 公尺），仍會列出最近的缺失。`;

  if(first){
    map.flyTo([lat, lng], inCity ? 17 : 12, {duration:.8});
    toast(inCity ? '已定位，清單改為依距離排序' : '目前不在臺南市範圍內');
    if(isPhone()) setTimeout(() => setSheet('half'), 900);
  }
  render();
}

function onGeoErr(err){
  const msg = err.code === 1 ? '定位權限遭拒，請於瀏覽器設定中允許存取位置。'
            : err.code === 2 ? '無法取得位置訊號，請移至戶外再試。'
            : '定位逾時，請再試一次。';
  $('#geoMsg').textContent = msg;
  toast(msg, 3600);
  stopGeo();
}

/* ============================ 篩選與繪製 ============================ */
function match(r){
  if(state.town.size && !state.town.has(r.town)) return false;
  if(state.type.size && !state.type.has(r.type)) return false;
  if(state.grade.size && !state.grade.has(r.grade)) return false;
  if(state.fixed.size && !state.fixed.has(r.fixed)) return false;
  if(state.contract.size && !state.contract.has(r.contract)) return false;
  if(state.me && state.useRadius && dist(state.me.lat, state.me.lng, r.lat, r.lng) > state.radius) return false;
  if(state.q){
    const q = state.q.toLowerCase();
    const hay = (r.pno + ' ' + r.road + ' ' + (r.addr || '') + ' ' + r.desc + ' ' + r.mh + ' ' + r.pic + ' ' + (r.repairNo || '') + ' ' + r.plan).toLowerCase();
    if(!hay.includes(q)) return false;
  }
  return true;
}

function chip(label, n, on, fn, cls){
  const b = document.createElement('button');
  b.className = 'chip' + (cls ? ' ' + cls : '');
  b.setAttribute('aria-pressed', on);
  b.innerHTML = `${label}<span class="n">${n}</span>`;
  b.onclick = fn;
  return b;
}

function render(){
  const rows = RECORDS.filter(match);
  current = rows;
  draw(rows);

  $('#cnt').textContent = rows.length.toLocaleString();
  $('#mCount').textContent = rows.length.toLocaleString() + ' 筆';

  const by = Object.fromEntries(GRADES.map(g => [g.k, rows.filter(r => r.grade === g.k).length]));
  $('#bar').innerHTML = GRADES.filter(g => by[g.k]).map(g =>
    `<i style="background:${g.c};flex:${by[g.k]}" title="${g.nm}：${by[g.k]}" data-g="${g.k}"></i>`).join('')
    || '<i style="background:var(--line);flex:1"></i>';
  $('#bar').querySelectorAll('i[data-g]').forEach(el => el.onclick = () => toggle('grade', el.dataset.g));

  $('#grades').innerHTML = '';
  GRADES.forEach(g => {
    const d = document.createElement('button');
    d.className = 'g'; d.setAttribute('aria-pressed', state.grade.has(g.k)); d.dataset.on = by[g.k] ? 1 : 0;
    d.innerHTML = `<span class="dot" style="background:${g.c}"></span>
      <span class="nm">${g.nm}<span style="color:var(--ink-3);font-size:11px"> · ${g.note}</span></span>
      <span class="ct">${by[g.k].toLocaleString()}</span>`;
    d.onclick = () => toggle('grade', g.k);
    $('#grades').appendChild(d);
  });

  $('#scope').textContent = (state.town.size ? [...state.town].join('、') : '已納入 ' + TOWNS.length + ' 個行政區')
    + '　·　' + rows.length.toLocaleString() + ' / ' + RECORDS.length.toLocaleString() + ' 筆';

  const byC = Object.fromEntries(CONTRACTS.map(c => [c.k, rows.filter(r => r.contract === c.k).length]));
  const cons = $('#cons'); cons.innerHTML = '';
  CONTRACTS.forEach(c => {
    const b = document.createElement('button');
    b.className = 'con'; b.setAttribute('aria-pressed', state.contract.has(c.k)); b.dataset.on = byC[c.k] ? 1 : 0;
    b.innerHTML = `<span class="sq" style="background:${c.c}"></span>
      <span class="cn"><span class="c1l">${c.short}<span class="st">${c.st}</span></span>
      <span class="c2l">${c.k === 'C0' ? c.info : c.nm}</span></span>
      <span class="ct">${byC[c.k].toLocaleString()}</span>`;
    b.onclick = () => toggle('contract', c.k);
    cons.appendChild(b);
  });

  renderList(rows);
  townLayer.setStyle(districtStyle);
  buildChips();
  drawLegend();
}

function renderList(rows){
  const list = $('#list'); list.innerHTML = '';
  const rank = {'A':0, 'B':1, 'C':2, '未分級':3};
  let show;
  if(state.me){
    show = rows.map(r => ({r, d: dist(state.me.lat, state.me.lng, r.lat, r.lng)}))
               .sort((a, b) => a.d - b.d);
    $('#listTitle').textContent = '附近缺失（依距離）';
  }else{
    show = rows.slice().sort((a, b) => rank[a.grade] - rank[b.grade] || a.town.localeCompare(b.town, 'zh-Hant'))
               .map(r => ({r, d:null}));
    $('#listTitle').textContent = '缺失清單';
  }
  $('#listcnt').textContent = rows.length ? `顯示前 ${Math.min(LIST_MAX, show.length)} 筆` : '';
  if(!show.length){
    list.innerHTML = '<div class="empty">' +
      (state.me && state.useRadius ? '此半徑內沒有缺失，試著拉大搜尋半徑。' : '沒有符合條件的缺失，請放寬篩選。') +
      '</div>';
    return;
  }
  show.slice(0, LIST_MAX).forEach(({r, d}) => {
    const b = document.createElement('button');
    b.className = 'item'; b.dataset.id = r.id;
    b.innerHTML = `<div class="t"><span class="dot" style="background:${GC[r.grade]}"></span>
      ${esc(r.repairNo || r.pno)}${r.fixed ? ' <span style="color:var(--ok);font-size:10.5px">已改善</span>' : ''}
      <em>${d != null ? `<span class="km">${fmtDist(d)}</span>　` : ''}${esc(r.town)}</em></div>
      <div class="d"><span class="tg" style="background:${CN[r.contract].c}"></span> ${esc(r.type)}　${esc(r.addr || r.desc || r.road || '')}</div>`;
    b.onclick = () => {
      map.flyTo(LL(r), 17, {duration:.6});
      const m = markers.get(r.id);
      if(m) setTimeout(() => m.openPopup(), 620);
      highlight(r.id);
      if(isPhone()) setSheet('peek');
    };
    list.appendChild(b);
  });
  if(show.length > LIST_MAX){
    list.insertAdjacentHTML('beforeend', `<div class="more">另有 ${show.length - LIST_MAX} 筆，請於地圖上點選或縮小篩選範圍</div>`);
  }
}

const highlight = id => document.querySelectorAll('.item').forEach(el => el.classList.toggle('on', +el.dataset.id === id));

function toggle(key, val){
  const s = state[key];
  s.has(val) ? s.delete(val) : s.add(val);
  render();
}

function buildChips(){
  const others = skip => r =>
    (skip === 'town' || !state.town.size || state.town.has(r.town)) &&
    (skip === 'type' || !state.type.size || state.type.has(r.type)) &&
    (skip === 'grade' || !state.grade.size || state.grade.has(r.grade)) &&
    (skip === 'fixed' || !state.fixed.size || state.fixed.has(r.fixed)) &&
    (skip === 'contract' || !state.contract.size || state.contract.has(r.contract));

  const t = $('#towns'); t.innerHTML = '';
  TOWNS.forEach(n => {
    const c = RECORDS.filter(r => r.town === n && others('town')(r)).length;
    t.appendChild(chip(n, c, state.town.has(n), () => {toggle('town', n); zoomToSelection();}));
  });

  const ty = $('#types'); ty.innerHTML = '';
  TYPES.forEach(n => {
    const c = RECORDS.filter(r => r.type === n && others('type')(r)).length;
    ty.appendChild(chip(n, c, state.type.has(n), () => toggle('type', n)));
  });

  const fx = $('#fixed'); fx.innerHTML = '';
  FIXES.forEach(o => {
    const c = RECORDS.filter(r => r.fixed === o.k && others('fixed')(r)).length;
    fx.appendChild(chip(o.nm, c, state.fixed.has(o.k), () => toggle('fixed', o.k), o.k ? 'ok' : ''));
  });
}

function drawLegend(){
  const d = document.getElementById('legendbox');
  if(!d) return;
  d.innerHTML = state.color === 'grade'
    ? '<div class="lh">缺失等級</div>' + GRADES.map(g =>
        `<div class="row"><span style="width:9px;height:9px;border-radius:9px;background:${g.c};display:inline-block;flex:none"></span><b>${g.k}</b>${g.note}</div>`).join('')
    : '<div class="lh">工程契約</div>' + CONTRACTS.map(c =>
        `<div class="row"><span style="width:9px;height:9px;border-radius:3px;background:${c.c};display:inline-block;flex:none"></span><b>${c.short}</b>${c.st}</div>`).join('');
  d.innerHTML += '<div class="fx"><div class="row"><span class="ring"></span>綠圈＝已改善</div>'
    + '<div class="row" style="margin-top:3px"><span style="width:11px;height:11px;border-radius:11px;border:1.5px dashed var(--ink-3);display:inline-block;flex:none"></span>虛線＝概略位置</div></div>';
}

function zoomToSelection(){
  if(!state.town.size){ map.flyToBounds(CITY, {padding:[16, 16], duration:.7}); return; }
  const f = TAINAN.districts.filter(d => state.town.has(d.name));
  if(!f.length) return;
  const bb = L.geoJSON({type:'FeatureCollection', features:f.map(d => ({type:'Feature', geometry:d.geometry, properties:{}}))}).getBounds();
  map.flyToBounds(bb, {padding:[26, 26], duration:.7});
}

/* ============================ 匯出 ============================ */
function download(name, mime, text){
  const url = URL.createObjectURL(new Blob([text], {type:mime}));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
const props = r => ({
  編號:r.id, 行政區:r.town, 缺失類別:r.type, 綜合等級:r.grade,
  分項等級:Object.entries(r.subs || {}).map(([k, v]) => k + ':' + v).join('；'),
  管線編號:r.pno, 起算人孔:r.mh, 距離m:r.dis, 現況說明:r.desc,
  量測值:Object.entries(r.ext || {}).map(([k, v]) => k + ':' + v).join('；'),
  鄰近路段:r.road, 詳細位置:r.addr || '', 調查日期:r.date, 調查單位:r.org,
  照片編號:r.pic, 照片檔名:PHOTO_IDX[pkey(r)] || '', 影像檔:r.vid,
  改善狀態:r.fixed ? '已改善' : '未改善', 改善備註:r.note,
  計畫分配:r.plan, 契約代碼:r.contract, 契約名稱:CN[r.contract].nm, 契約狀態:CN[r.contract].st,
  破損修補編號:r.repairNo || '', 處理方式:r.mode || '', 修繕工法:r.method || '',
  初估改善量:r.area ?? '', 總預算:r.budget ?? '', 路段分區:r.zone || '', 評分:r.score ?? '',
  箱涵H:r.boxH ?? '', 箱涵W:r.boxW ?? '', 覆土深:r.cover != null ? Number(r.cover).toFixed(2) : '',
  工程備註:r.engMemo || '', 座標概略:r.approx ? '是' : '否',
  TWD97_X:r.x, TWD97_Y:r.y
});

/* ============================ UI 綁定 ============================ */
function bindUI(){
  document.querySelectorAll('[data-reset]').forEach(btn => {
    btn.onclick = () => {
      state[btn.dataset.reset].clear();
      if(btn.dataset.reset === 'town') zoomToSelection();
      render();
    };
  });

  let qt;
  $('#q').oninput = e => {
    clearTimeout(qt);
    qt = setTimeout(() => {state.q = e.target.value.trim(); render();}, 200);
  };

  document.querySelectorAll('#colorby button').forEach(b => {
    b.onclick = () => {
      state.color = b.dataset.mode;
      document.querySelectorAll('#colorby button').forEach(x => x.setAttribute('aria-pressed', x === b));
      markers.forEach(m => m.setStyle({fillColor: fillOf(m._rec)}));
      drawLegend();
    };
  });

  const lblOn = $('#lblOn'), lblBox = $('#lblFields');
  lblOn.checked = LABEL.on;
  lblBox.classList.toggle('off', !LABEL.on);
  lblBox.querySelectorAll('input[data-f]').forEach(cb => {
    cb.checked = LABEL[cb.dataset.f];
    cb.onchange = () => {LABEL[cb.dataset.f] = cb.checked; saveLabel(); refreshLabels();};
  });
  lblOn.onchange = () => {
    LABEL.on = lblOn.checked; saveLabel();
    lblBox.classList.toggle('off', !LABEL.on);
    refreshLabels();
  };

  $('#layerPipes').onclick = e => {
    if(e.currentTarget.disabled) return;
    const on = !map.hasLayer(pipeLayer);
    on ? pipeLayer.addTo(map) : map.removeLayer(pipeLayer);
    e.currentTarget.setAttribute('aria-pressed', on);
  };
  $('#layerManholes').onclick = e => {
    if(e.currentTarget.disabled) return;
    const on = !map.hasLayer(mhLayer);
    on ? mhLayer.addTo(map) : map.removeLayer(mhLayer);
    e.currentTarget.setAttribute('aria-pressed', on);
  };

  $('#locate').onclick = toggleGeo;
  $('#mLocate').onclick = toggleGeo;
  $('#clrGeo').onclick = stopGeo;
  $('#radius').oninput = e => {
    state.radius = +e.target.value;
    $('#radiusVal').textContent = state.radius >= 1000 ? (state.radius / 1000) + ' km' : state.radius + ' m';
    if(state.useRadius) render();
  };
  $('#radiusOn').onclick = e => {
    state.useRadius = !state.useRadius;
    e.currentTarget.setAttribute('aria-pressed', state.useRadius);
    render();
  };

  $('#exGeo').onclick = () => {
    const fc = {
      type:'FeatureCollection', name:'臺南市下水道缺失點位',
      crs:{type:'name', properties:{name:'urn:ogc:def:crs:OGC:1.3:CRS84'}},
      features: current.map(r => ({type:'Feature', geometry:{type:'Point', coordinates:[r.lng, r.lat]}, properties:props(r)}))
    };
    download(`臺南市下水道缺失_${current.length}筆_${stamp()}.geojson`, 'application/geo+json', JSON.stringify(fc, null, 1));
  };
  $('#exCsv').onclick = () => {
    if(!current.length) return;
    const cols = [...Object.keys(props(current[0])), '經度', '緯度'];
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.join(',')].concat(current.map(r => {
      const p = props(r);
      return cols.map(c => q(c === '經度' ? r.lng : c === '緯度' ? r.lat : p[c])).join(',');
    }));
    download(`臺南市下水道缺失_${current.length}筆_${stamp()}.csv`, 'text/csv;charset=utf-8', '\ufeff' + lines.join('\r\n'));
  };

  /* 底部面板：三段式抽屜 */
  $('#mFilter').onclick = () => setSheet($('#panel').classList.contains('open') ? 'peek' : 'open');
  $('#grab').onclick = () => {
    const p = $('#panel');
    setSheet(p.classList.contains('open') ? 'peek' : p.classList.contains('half') ? 'open' : 'half');
  };
  dragSheet();
}

function setSheet(mode){
  const p = $('#panel');
  p.classList.remove('open', 'half');
  if(mode === 'open') p.classList.add('open');
  if(mode === 'half') p.classList.add('half');
}

function dragSheet(){
  const p = $('#panel'), grab = $('#grab');
  let y0 = 0, base = 0, dragging = false;
  const cur = () => {
    const h = p.getBoundingClientRect().height;
    return p.classList.contains('open') ? 0
         : p.classList.contains('half') ? window.innerHeight * .42
         : h - parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--peek'));
  };
  grab.addEventListener('pointerdown', e => {
    if(!isPhone()) return;
    dragging = true; y0 = e.clientY; base = cur();
    p.classList.add('dragging');
    grab.setPointerCapture(e.pointerId);
  });
  grab.addEventListener('pointermove', e => {
    if(!dragging) return;
    const dy = Math.max(0, base + (e.clientY - y0));
    p.style.transform = `translateY(${dy}px)`;
  });
  grab.addEventListener('pointerup', e => {
    if(!dragging) return;
    dragging = false;
    p.classList.remove('dragging');
    p.style.transform = '';
    const dy = e.clientY - y0;
    const h = window.innerHeight;
    if(dy < -h * .12) setSheet(base > h * .3 ? 'half' : 'open');
    else if(dy > h * .12) setSheet(base < h * .1 ? 'half' : 'peek');
  });
}
