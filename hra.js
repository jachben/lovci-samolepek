'use strict';
// =============================================================
//  Lovci samolepek – hlavní logika hry
//  Mapa (MapLibre + OpenFreeMap), GPS, objevování samolepek,
//  Lepárny, chytání a album. Postup se ukládá v telefonu.
// =============================================================

const VERZE = '0.1 (23. 11. 2026)';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const DRUHY = window.SAMOLEPKY;
const MESTA = window.MESTA;

// vaha = jak často se objevuje (ze 100), sance = šance chycení jedním hodem,
// utek = šance, že po nepovedeném chycení uteče. zaklad = útok/obrana/výdrž,
// když je samolepka nemá vlastní (podobně jako základní hodnoty pokémonů).
const VZACNOST = {
  bezna:      { jm: 'Běžná',      vaha: 60,  sance: 0.50, utek: 0.08, xp: 100,  barva: '#34c759', poh: '',          zaklad: [120, 110, 130] },
  neobvykla:  { jm: 'Neobvyklá',  vaha: 26,  sance: 0.30, utek: 0.10, xp: 250,  barva: '#e0b400', poh: 'poskakuje', zaklad: [160, 140, 160] },
  vzacna:     { jm: 'Vzácná',     vaha: 10,  sance: 0.16, utek: 0.12, xp: 600,  barva: '#ff9f0a', poh: 'uhyba',     zaklad: [200, 170, 190] },
  epicka:     { jm: 'Epická',     vaha: 3.3, sance: 0.09, utek: 0.15, xp: 1200, barva: '#bf5af2', poh: 'uhyba',     zaklad: [240, 200, 220] },
  legendarni: { jm: 'Legendární', vaha: 0.7, sance: 0.04, utek: 0.20, xp: 2500, barva: '#ff375f', poh: 'uhyba',     zaklad: [280, 240, 260] },
};

// Hodnoty konkrétního kusu (jako CP/HP u pokémonů). Stejné pro všechny hráče –
// spočítají se z místa a času objevení.
function hodnotyKusu(druh, id) {
  const r = rng(hash(...id.split('_').map(Number), 31337));
  const vz = VZACNOST[druh.vzacnost];
  const [A, D, S] = [druh.utok || vz.zaklad[0], druh.obrana || vz.zaklad[1], druh.vydrz || vz.zaklad[2]];
  const iv = [0, 0, 0].map(() => Math.floor(r() * 16));
  const maxL = Math.min(30, uroven(stav.xp) + 2);
  const lvl = 1 + Math.floor(r() * maxL);
  const cpm = 0.094 + (lvl - 1) * (0.79 - 0.094) / 39;
  const sila = Math.max(10, Math.floor((A + iv[0]) * Math.sqrt(D + iv[1]) * Math.sqrt(S + iv[2]) * cpm * cpm / 10));
  const zivoty = Math.max(10, Math.floor((S + iv[2]) * cpm));
  return { sila, zivoty, iv, lvl, hodnoceni: Math.round((iv[0] + iv[1] + iv[2]) / 45 * 100) };
}

const NAST = {
  dosahChytani: 55,      // m – jak blízko musíš být k samolepce
  dosahZastavky: 55,     // m – jak blízko k Lepárně
  viditelnost: 320,      // m – do jaké vzdálenosti vidíš samolepky
  viditZastavky: 700,
  slotMs: 10 * 60e3,     // samolepka vydrží 10 minut
  bunkaLat: 0.0011, bunkaLon: 0.0017,  // mřížka cca 120 × 120 m
  hustota: 0.5,         // šance na samolepku v buňce (×2 překrývající se vlny)
  pauzaZastavky: 5 * 60e3,
  rychlostTest: 9,       // m/s při zkušební procházce
  startLapky: 30,
};

// ---------- Uložený postup ----------
const KLIC = 'lovci-samolepek-v1';
const vychozi = () => ({
  jmeno: 'Lovec', xp: 0, lapky: NAST.startLapky, lepidlo: 3,
  chyceno: {}, utekli: {}, sbirka: {}, zastavky: {},
  test: false, testPoz: [MESTA.litomysl.lon, MESTA.litomysl.lat], zvuk: true,
});
let stav;
try { stav = Object.assign(vychozi(), JSON.parse(localStorage.getItem(KLIC) || '{}')); } catch { stav = vychozi(); }
function uloz() { try { localStorage.setItem(KLIC, JSON.stringify(stav)); } catch {} }
// Staré záznamy o chycených kouscích už nejsou potřeba
(function uklid() {
  const ted = Math.floor(Date.now() / NAST.slotMs);
  for (const t of ['chyceno', 'utekli']) for (const id in stav[t]) { const slot = +id.split('_')[2]; if (!(slot >= ted - 2)) delete stav[t][id]; }
  for (const id in stav.zastavky) if (Date.now() - stav.zastavky[id] > NAST.pauzaZastavky) delete stav.zastavky[id];
  uloz();
})();

// ---------- Pomocné ----------
function hash(...n) { let h = 2166136261; for (const x of n) { h ^= (x | 0); h = Math.imul(h, 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); } return h >>> 0; }
function rng(seed) { let a = seed; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function vzdal(a, b) { // [lon, lat] → metry
  const R = 6371000, r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function smer(a, b) { const r = Math.PI / 180; const y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r); const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r); return Math.atan2(y, x) / r; }
function posun(p, m, uhel) { const r = Math.PI / 180; return [p[0] + m * Math.sin(uhel * r) / (111320 * Math.cos(p[1] * r)), p[1] + m * Math.cos(uhel * r) / 110540]; }
function kruh(c, m, n = 64) { const k = []; for (let i = 0; i <= n; i++) k.push(posun(c, m, i * 360 / n)); return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [k] } }; }
const spi = ms => new Promise(r => setTimeout(r, ms));
const ukaz = id => $(id).classList.remove('skryto');
const skryj = id => $(id).classList.add('skryto');
function mestoU(p) { for (const k in MESTA) if (vzdal(p, [MESTA[k].lon, MESTA[k].lat]) < MESTA[k].polomer) return k; return null; }
function obrazekHTML(d) { return d.obrazek ? `<img src="${d.obrazek}" alt="" class="${d.vyplnit ? 'vyplnit' : ''}" style="${d.vyplnit ? `object-position:${d.stred || '50% 20%'};transform-origin:${d.stred || '50% 20%'};transform:scale(${d.zoom || 1})` : ''}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${d.emoji || '❔'}'}))">` : `<span>${d.emoji}</span>`; }
function samolepkaEl(d, tridy = '') { const e = document.createElement('div'); e.className = 'samolepka ' + tridy; e.style.setProperty('--b', d.barva || '#fff'); e.innerHTML = obrazekHTML(d); return e; }
function postavaHTML(d) { return `<img class="postava-img" src="${d.vystrizek}" alt="">`; }
function uroven(xp) { return Math.floor(Math.sqrt(xp / 400)) + 1; }
function xpNaUroven(l) { return 400 * (l - 1) ** 2; }

let toastCas;
function toast(t, ms = 2200) { const e = $('#toast'); e.textContent = t; e.classList.add('vid'); clearTimeout(toastCas); toastCas = setTimeout(() => e.classList.remove('vid'), ms); }

// ---------- Zvuky (generované, žádné soubory) ----------
let ac;
function zvuk(typ) {
  if (!stav.zvuk) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const tony = { hod: [[520, .06], [380, .08]], zasah: [[880, .07]], treseni: [[300, .05]], chyceno: [[660, .1], [880, .1], [1320, .22]], utek: [[400, .1], [260, .25]], zastavka: [[700, .06], [940, .06], [1180, .12]], blizko: [[990, .05], [1320, .07]] }[typ] || [];
    let t = ac.currentTime;
    for (const [f, d] of tony) { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(.18, t); g.gain.exponentialRampToValueAtTime(.001, t + d); o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d + .02); t += d * .9; }
  } catch {}
}
const vibruj = v => { try { navigator.vibrate && navigator.vibrate(v); } catch {} };

// =============================================================
//  Objevování samolepek a Lepáren (stejné pro všechny hráče –
//  spočítá se z místa a času, není potřeba server)
// =============================================================
// Vybírá se jen ze vzácností, které v seznamu opravdu jsou. Dokud je samolepek málo
// (třeba jen vzácné), objevují se řidčeji, ať mapa není plná jedné samolepky.
function kandidati(mesto) { return DRUHY.filter(d => d.mesto === 'vsude' || d.mesto === mesto); }
function podilVah(mesto) { const vz = new Set(kandidati(mesto).map(d => d.vzacnost)); let s = 0; for (const k of vz) s += VZACNOST[k] ? VZACNOST[k].vaha : 0; return s / 100; }
function vyberDruh(r, mesto) {
  const kand = kandidati(mesto); if (!kand.length) return null;
  const vz = [...new Set(kand.map(d => d.vzacnost))].filter(k => VZACNOST[k]);
  const celkem = vz.reduce((a, k) => a + VZACNOST[k].vaha, 0);
  let x = r() * celkem, vyb = vz[0];
  for (const k of vz) { x -= VZACNOST[k].vaha; if (x < 0) { vyb = k; break; } }
  const pool = kand.filter(d => d.vzacnost === vyb);
  return pool[Math.floor(r() * pool.length)];
}

// Náhodná setkání: za každých ~40 m chůze se může kousek před tebou objevit samolepka
let bonusy = [], posledniBodCesty = null, usloCesta = 0, bonusCislo = 0;
function cestou(p) {
  if (!posledniBodCesty) { posledniBodCesty = p.slice(); return; }
  const d = vzdal(posledniBodCesty, p);
  if (d < 2) return;
  const smerChuze = smer(posledniBodCesty, p);
  posledniBodCesty = p.slice(); usloCesta += Math.min(d, 50);
  if (usloCesta < 40) return;
  usloCesta = 0;
  bonusy = bonusy.filter(b => b.konec > Date.now() && !stav.chyceno[b.id] && !stav.utekli[b.id]);
  if (Math.random() > 0.65 || bonusy.length >= 4) return;
  const druh = vyberDruh(Math.random, mestoU(p)); if (!druh) return;
  const poz = posun(p, 18 + Math.random() * 22, smerChuze + (Math.random() * 120 - 60));
  const slot = Math.floor(Date.now() / NAST.slotMs);
  bonusy.push({ id: `b${++bonusCislo}${Date.now() % 100000}_0_${slot}_9`, druh, poz, konec: Date.now() + 4 * 60e3 });
  vibruj([40, 60, 40]); zvuk('blizko');
  toast(`Něco se objevilo poblíž!`, 1800);
  obnovZnacky();
}

function samolepkyKolem(p) {
  const ted = Date.now(), out = [];
  for (const b of bonusy) {
    if (b.konec < ted || stav.chyceno[b.id] || stav.utekli[b.id]) continue;
    const d = vzdal(p, b.poz); if (d <= NAST.viditelnost) out.push({ ...b, d });
  }
  const { bunkaLat: BL, bunkaLon: BO } = NAST;
  const cy0 = Math.floor(p[1] / BL), cx0 = Math.floor(p[0] / BO);
  const R = Math.ceil(NAST.viditelnost / 120) + 1;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const cy = cy0 + dy, cx = cx0 + dx;
    const stred = [(cx + .5) * BO, (cy + .5) * BL];
    if (vzdal(p, stred) > NAST.viditelnost + 120) continue;
    const mesto = mestoU(stred);
    for (const k of [0, 1]) {
      const slot = Math.floor((ted + k * NAST.slotMs / 2) / NAST.slotMs);
      const r = rng(hash(cx, cy, slot, k, 991));
      if (r() >= NAST.hustota * (mesto ? 1.2 : 0.9) * Math.max(0.6, Math.min(1, podilVah(mesto)))) continue;
      const poz = [(cx + r()) * BO, (cy + r()) * BL];
      const d = vzdal(p, poz);
      if (d > NAST.viditelnost) continue;
      const id = `${cx}_${cy}_${slot}_${k}`;
      if (stav.chyceno[id] || stav.utekli[id]) continue;
      const druh = vyberDruh(r, mesto);
      if (!druh) continue;
      out.push({ id, druh, poz, d, konec: (slot + 1) * NAST.slotMs - k * NAST.slotMs / 2 });
    }
  }
  return out;
}

const NAZVY_ZAST = ['u Lípy', 'u Lavičky', 'na Rohu', 'u Kašny', 'u Školy', 'u Mostu', 'u Parku', 'u Stromu', 'u Zídky', 'na Plácku', 'u Cesty', 'u Hřiště', 'u Zastávky', 'u Pekárny', 'na Kopečku', 'u Brány', 'u Lampy', 'u Schodů', 'u Potoka', 'u Kapličky'];
function lepárnyKolem(p) {
  const out = [];
  const site = [{ g: 1, bl: 0.0016, bo: 0.0024, vMeste: true }, { g: 2, bl: 0.0035, bo: 0.0052, vMeste: false }];
  for (const s of site) {
    const cy0 = Math.floor(p[1] / s.bl), cx0 = Math.floor(p[0] / s.bo);
    const R = Math.ceil(NAST.viditZastavky / (s.bl * 110540)) + 1;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const cy = cy0 + dy, cx = cx0 + dx;
      const r = rng(hash(cx, cy, s.g, 4242));
      if (r() > 0.62) continue;
      const poz = [(cx + .15 + r() * .7) * s.bo, (cy + .15 + r() * .7) * s.bl];
      if (!!mestoU(poz) !== s.vMeste) continue;
      const d = vzdal(p, poz);
      if (d > NAST.viditZastavky) continue;
      out.push({ id: `z${s.g}_${cx}_${cy}`, poz, d, jmeno: 'Lepárna ' + NAZVY_ZAST[Math.floor(r() * NAZVY_ZAST.length)] });
    }
  }
  (window.ZASTAVKY_VLASTNI || []).forEach((z, i) => {
    const poz = [z.lon, z.lat], d = vzdal(p, poz);
    if (d <= NAST.viditZastavky) out.push({ id: 'v' + i, poz, d, jmeno: z.jmeno || 'Lepárna' });
  });
  return out;
}

// =============================================================
//  Mapa
// =============================================================
let mapa, hracMarker, hracEl;
let poloha = null;        // skutečná (GPS / zkušební) poloha [lon, lat]
let zobrazena = null;     // plynule dojíždějící poloha panáčka
let cilChuze = null;      // zkušební procházka: kam jde
let presnost = null;
const znacky = new Map(); // id → { marker, el, data, typ }
let mapaPripravena = false;

const TRAVA_SVG = `<svg class="trava" viewBox="0 0 60 22"><g fill="#3fae4a"><path d="M8 22 q2-14 -4-20 q9 6 8 20z"/><path d="M16 22 q0-12 6-18 q-3 9 -2 18z" fill="#56c45a"/><path d="M40 22 q1-13 -5-19 q9 7 9 19z" fill="#56c45a"/><path d="M50 22 q2-10 8-15 q-5 7 -4 15z"/><path d="M27 22 q1-9 -3-13 q7 5 6 13z" fill="#2f9a3e"/></g></svg>`;
const PANACEK_SVG = `
<svg viewBox="0 0 64 100">
 <defs>
  <linearGradient id="gMikina" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b7bff"/><stop offset="1" stop-color="#5442d6"/></linearGradient>
  <linearGradient id="gKalhoty" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#34407a"/><stop offset="1" stop-color="#232b57"/></linearGradient>
  <radialGradient id="gKuze" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#ffe1c7"/><stop offset="1" stop-color="#f2b98f"/></radialGradient>
  <linearGradient id="gCepice" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fe3c8"/><stop offset="1" stop-color="#11a58f"/></linearGradient>
 </defs>
 <ellipse cx="32" cy="95" rx="17" ry="4.5" fill="rgba(0,0,0,.3)"/>
 <g class="otoc"><g class="telo" stroke="#1d1b3a" stroke-width="1.6" stroke-linejoin="round">
  <g class="noha-l"><rect x="22" y="62" width="9" height="24" rx="4.5" fill="url(#gKalhoty)"/><path d="M19.5 84 h12 a3 3 0 0 1 3 3 v2 h-15 z" fill="#fff"/><path d="M19.5 89 h15" stroke="#ff5a5f" stroke-width="2"/></g>
  <g class="noha-p"><rect x="33" y="62" width="9" height="24" rx="4.5" fill="url(#gKalhoty)"/><path d="M32.5 84 h12 a3 3 0 0 1 3 3 v2 h-15 z" fill="#fff"/><path d="M32.5 89 h15" stroke="#ff5a5f" stroke-width="2"/></g>
  <rect x="40" y="40" width="12" height="20" rx="4" fill="#ffb238"/>
  <g class="ruka-l"><rect x="10" y="41" width="8" height="21" rx="4" fill="url(#gMikina)"/><circle cx="14" cy="63" r="3.6" fill="url(#gKuze)"/></g>
  <path d="M17 44 q0 -7 8 -7 h14 q8 0 8 7 v18 q0 5 -5 5 h-20 q-5 0 -5 -5 z" fill="url(#gMikina)"/>
  <path d="M25 37 q7 6 14 0" fill="none" stroke="#fff" stroke-width="2"/>
  <circle cx="32" cy="52" r="5.5" fill="#ffd84d" stroke="#fff" stroke-width="2"/>
  <path d="M32 48.6 l1 2.2 2.4.2 -1.8 1.6 .6 2.4 -2.2 -1.3 -2.2 1.3 .6 -2.4 -1.8 -1.6 2.4 -.2z" fill="#fff" stroke="none"/>
  <g class="ruka-p"><rect x="46" y="41" width="8" height="21" rx="4" fill="url(#gMikina)"/><circle cx="50" cy="63" r="3.6" fill="url(#gKuze)"/></g>
  <circle cx="32" cy="22" r="15" fill="url(#gKuze)"/>
  <path d="M17 24 q-1 -5 2 -8 q3 8 11 6 q8 -1 13 -6 q3 3 2 8" fill="#5a3a2a" stroke="none"/>
  <path d="M16.2 19 a15.8 13.5 0 0 1 31.6 0 z" fill="url(#gCepice)"/>
  <path d="M34 15.5 h17 a2.6 2.6 0 0 1 0 5.2 h-17 z" fill="#0e8c79"/>
  <circle cx="27" cy="10.5" r="3" fill="#ffd84d" stroke-width="1.2"/>
  <ellipse cx="26.5" cy="25" rx="1.9" ry="2.4" fill="#1d1b3a" stroke="none"/><ellipse cx="37" cy="25" rx="1.9" ry="2.4" fill="#1d1b3a" stroke="none"/>
  <circle cx="27.2" cy="24.2" r=".7" fill="#fff" stroke="none"/><circle cx="37.7" cy="24.2" r=".7" fill="#fff" stroke="none"/>
  <ellipse cx="22.5" cy="29" rx="2.4" ry="1.4" fill="#ff9aa2" stroke="none" opacity=".7"/><ellipse cx="41.5" cy="29" rx="2.4" ry="1.4" fill="#ff9aa2" stroke="none" opacity=".7"/>
  <path d="M28 30.5 q4 3.2 8 0" fill="none" stroke-width="1.6" stroke-linecap="round"/>
 </g></g>
</svg>`;

function vytvorMapu(start) {
  mapa = new maplibregl.Map({
    container: 'mapa',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: start, zoom: 16.9, pitch: 60, bearing: 0,
    minZoom: 15.2, maxZoom: 19.3, maxPitch: 65,
    dragPan: false, dragRotate: false, doubleClickZoom: false, keyboard: false, boxZoom: false, touchPitch: false,
    attributionControl: { compact: true },
    fadeDuration: 0,
  });
  mapa.touchZoomRotate.enable({ around: 'center' });
  mapa.touchZoomRotate.disableRotation();
  mapa.scrollZoom.enable({ around: 'center' });

  hracEl = document.createElement('div');
  hracEl.className = 'hrac';
  hracEl.innerHTML = '<div class="kuzel"></div>' + PANACEK_SVG;
  hracMarker = new maplibregl.Marker({ element: hracEl, anchor: 'bottom', pitchAlignment: 'viewport', rotationAlignment: 'viewport', offset: [0, 4] }).setLngLat(start).addTo(mapa);

  ukaz('#nacitani');
  mapa.on('style.load', upravVzhled);
  mapa.once('load', () => skryj('#nacitani'));
  setTimeout(() => skryj('#nacitani'), 25000);
  mapa.on('load', () => {
    mapa.addSource('dosah', { type: 'geojson', data: kruh(start, NAST.dosahChytani) });
    mapa.addLayer({ id: 'dosah-vypln', type: 'fill', source: 'dosah', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.18 } });
    mapa.addSource('pulz', { type: 'geojson', data: kruh(start, 5) });
    mapa.addLayer({ id: 'pulz', type: 'line', source: 'pulz', paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-opacity': 0.6 } });
    mapa.addLayer({ id: 'dosah-okraj', type: 'line', source: 'dosah', paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-opacity': 0.95, 'line-blur': 0.5 } });
    mapaPripravena = true;
    obnovZnacky(true);
  });
  mapa.on('error', e => { if (/tiles|style|Failed to fetch/i.test(String(e && e.error && e.error.message))) toast('Mapa se nenačetla – zkontroluj internet'); });
  mapa.on('rotate', () => { $('#kompas span').style.transform = `rotate(${-mapa.getBearing()}deg)`; });
  ovladaniMapy();
}

// Herní vzhled mapy: sytě zelená krajina, světlé cesty, měkké pastelové domy, skoro žádné popisky
function upravVzhled() {
  const B = {
    zem: '#86d873', mesto: '#8edb7b', les: '#55b956', trava: '#76d064', park: '#6fcb5f', voda: '#58c4f5',
    cesta: '#f3f7e6', okrajCesty: '#5fae5a', hlavni: '#fff1b8', okrajHlavni: '#4f9c4c', chodnik: '#e9f7d9',
  };
  const paint = (id, k, v) => { try { if (mapa.getLayer(id)) mapa.setPaintProperty(id, k, v); } catch {} };
  const layout = (id, k, v) => { try { if (mapa.getLayer(id)) mapa.setLayoutProperty(id, k, v); } catch {} };
  const sirka = n => ['interpolate', ['exponential', 1.6], ['zoom'], 14, n * 0.3, 17, n, 20, n * 5];
  paint('background', 'background-color', B.zem);
  layout('natural_earth', 'visibility', 'none');
  for (const l of mapa.getStyle().layers) {
    const id = l.id;
    if (l.type === 'fill') {
      if (id === 'water') paint(id, 'fill-color', B.voda);
      else if (/wood|forest/.test(id)) paint(id, 'fill-color', B.les);
      else if (/grass|wetland|pitch|track/.test(id)) paint(id, 'fill-color', B.trava);
      else if (id === 'park') { paint(id, 'fill-color', B.park); paint(id, 'fill-opacity', 1); }
      else if (/residential|landuse_|aeroway|sand|ice/.test(id)) { paint(id, 'fill-color', B.mesto); paint(id, 'fill-opacity', 1); }
      else if (id === 'building') { paint(id, 'fill-color', '#b9a9f5'); paint(id, 'fill-outline-color', '#9c87ee'); }
      else if (id === 'road_area_pattern') layout(id, 'visibility', 'none');
    } else if (l.type === 'line') {
      if (/waterway/.test(id)) paint(id, 'line-color', B.voda);
      else if (/rail|boundary|aeroway|park_outline|hatching/.test(id)) layout(id, 'visibility', 'none');
      else if (/path_pedestrian/.test(id)) { paint(id, 'line-color', B.chodnik); paint(id, 'line-width', sirka(2.2)); try { mapa.setPaintProperty(id, 'line-dasharray', null); } catch {} }
      else if (/casing/.test(id)) { const hl = /trunk|primary|motorway|secondary/.test(id); paint(id, 'line-color', hl ? B.okrajHlavni : B.okrajCesty); paint(id, 'line-opacity', 1); paint(id, 'line-width', sirka(hl ? 13 : 9)); }
      else if (/^(road|bridge|tunnel)_/.test(id)) { const hl = /trunk|primary|motorway|secondary/.test(id); paint(id, 'line-color', hl ? B.hlavni : B.cesta); paint(id, 'line-opacity', 1); paint(id, 'line-width', sirka(hl ? 10 : 6.5)); }
    } else if (l.type === 'fill-extrusion') {
      paint(id, 'fill-extrusion-color', ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#c9bcff', 15, '#b3a2f7', 40, '#9c87ee']);
      paint(id, 'fill-extrusion-height', ['*', 0.55, ['coalesce', ['get', 'render_height'], 6]]);
      paint(id, 'fill-extrusion-base', ['*', 0.55, ['coalesce', ['get', 'render_min_height'], 0]]);
      paint(id, 'fill-extrusion-opacity', 0.9);
      paint(id, 'fill-extrusion-vertical-gradient', true);
    } else if (l.type === 'symbol') {
      if (/highway-name-(minor|major)|label_town|label_village|label_city/.test(id)) {
        paint(id, 'text-color', '#3d5a3a'); paint(id, 'text-halo-color', 'rgba(255,255,255,.85)'); paint(id, 'text-halo-width', 1.6);
      } else layout(id, 'visibility', 'none');
    }
  }
  try { mapa.setLight({ anchor: 'viewport', color: '#fff', intensity: 0.22, position: [1.3, 200, 35] }); } catch {}
}

// Jedním prstem otáčení mapy (jako ve hrách), ťuknutí = jít tam (zkušební procházka)
function ovladaniMapy() {
  const c = mapa.getCanvasContainer();
  const prsty = new Map();
  let start = null;
  c.addEventListener('pointerdown', e => {
    if (e.target.closest('.znacka')) return;
    prsty.set(e.pointerId, [e.clientX, e.clientY]);
    start = prsty.size === 1 ? { x: e.clientX, y: e.clientY, t: Date.now(), b: mapa.getBearing(), pohyb: 0 } : null;
  });
  window.addEventListener('pointermove', e => {
    if (!prsty.has(e.pointerId)) return;
    const [px, py] = prsty.get(e.pointerId);
    prsty.set(e.pointerId, [e.clientX, e.clientY]);
    if (!start || prsty.size !== 1) return;
    start.pohyb += Math.abs(e.clientX - px) + Math.abs(e.clientY - py);
    if (start.pohyb > 8) {
      // otáčení kolem panáčka: vodorovný tah, ve spodní půlce obráceně
      const dolni = start.y > innerHeight * 0.55 ? -1 : 1;
      mapa.setBearing(start.b - (e.clientX - start.x) * 0.4 * dolni);
    }
  });
  const konec = e => {
    if (!prsty.has(e.pointerId)) return;
    prsty.delete(e.pointerId);
    if (start && start.pohyb <= 8 && Date.now() - start.t < 450 && e.type === 'pointerup' && poloha) {
      if (!stav.test) { stav.testPoz = poloha.slice(); prepniTest(true, true); toast('Chodíš ťukáním na mapu. Chůzi podle GPS zapneš v Nastavení.', 3500); }
      const r = c.getBoundingClientRect();
      const ll = mapa.unproject([e.clientX - r.left, e.clientY - r.top]);
      cilChuze = [ll.lng, ll.lat];
    }
    start = null;
  };
  window.addEventListener('pointerup', konec);
  window.addEventListener('pointercancel', konec);
}

// ---------- Plynulý pohyb panáčka a kamery ----------
let posledniPulz = 0, posledniSnimek = performance.now(), posledniDosah = null, posledniObnova = 0, posledniObnovaPoz = null;
function smycka(t) {
  const dtSkut = Math.min(1, (t - posledniSnimek) / 1000);
  const dt = Math.min(0.1, dtSkut); posledniSnimek = t;
  if (stav.test && cilChuze && poloha) {
    const d = vzdal(poloha, cilChuze), krok = NAST.rychlostTest * dtSkut;
    if (d <= krok) { poloha = cilChuze; cilChuze = null; } else poloha = posun(poloha, krok, smer(poloha, cilChuze));
    stav.testPoz = poloha;
  }
  if (poloha) cestou(poloha);
  if (poloha && mapa) {
    if (!zobrazena || vzdal(zobrazena, poloha) > 300) zobrazena = poloha.slice();
    const pred = zobrazena.slice();
    const k = 1 - Math.pow(0.02, dt);   // dojezd
    zobrazena = [zobrazena[0] + (poloha[0] - zobrazena[0]) * k, zobrazena[1] + (poloha[1] - zobrazena[1]) * k];
    const rychlost = vzdal(pred, zobrazena) / Math.max(dt, 0.001);
    hracEl.classList.toggle('jde', rychlost > 0.4);
    if (rychlost > 0.4) {
      const s = ((smer(pred, zobrazena) - mapa.getBearing()) % 360 + 360) % 360;
      if (s > 200 && s < 340) hracEl.classList.add('vlevo'); else if (s > 20 && s < 160) hracEl.classList.remove('vlevo');
    }
    hracMarker.setLngLat(zobrazena);
    const kuzel = hracEl.querySelector('.kuzel');
    if (natoceni !== null && !stav.test) { kuzel.style.opacity = 1; kuzel.style.transform = `translateX(-50%) scaleY(.45) rotate(${natoceni - mapa.getBearing()}deg)`; } else kuzel.style.opacity = 0;
    mapa.setCenter(zobrazena);
    if (mapaPripravena && (!posledniDosah || vzdal(posledniDosah, zobrazena) > 1)) {
      posledniDosah = zobrazena.slice();
      mapa.getSource('dosah').setData(kruh(zobrazena, NAST.dosahChytani));
    }
    if (mapaPripravena && t - posledniPulz > 50) {
      posledniPulz = t;
      const f = (t % 2400) / 2400;
      mapa.getSource('pulz').setData(kruh(zobrazena, 6 + f * (NAST.dosahChytani - 6), 40));
      mapa.setPaintProperty('pulz', 'line-opacity', 0.75 * (1 - f));
    }
    if (t - posledniObnova > 1500 || (posledniObnovaPoz && vzdal(posledniObnovaPoz, poloha) > 15)) obnovZnacky();
  }
  requestAnimationFrame(smycka);
}

// ---------- Značky samolepek a Lepáren ----------
let videnoBlizko = new Set();
function obnovZnacky(hned) {
  if (!mapaPripravena || !poloha) return;
  posledniObnova = performance.now(); posledniObnovaPoz = poloha.slice();
  const tvory = samolepkyKolem(poloha), zast = lepárnyKolem(poloha);
  const zustava = new Set();

  for (const s of tvory) {
    zustava.add(s.id);
    let z = znacky.get(s.id);
    if (!z) {
      const el = document.createElement('div');
      el.className = 'znacka tvor-mapa objevi vz-' + s.druh.vzacnost;
      if (s.druh.vystrizek) {
        el.classList.add('postava-mapa');
        el.insertAdjacentHTML('beforeend', `<div class="postava">${postavaHTML(s.druh)}</div>`);
      } else {
        const lep = samolepkaEl(s.druh); lep.insertAdjacentHTML('beforeend', '<i class="lesk"></i>');
        el.appendChild(lep);
      }
      el.insertAdjacentHTML('beforeend', (s.druh.vystrizek ? '' : TRAVA_SVG) + '<div class="stin"></div>' + (['vzacna', 'epicka', 'legendarni'].includes(s.druh.vzacnost) ? '<i class="trpyt t1">✦</i><i class="trpyt t2">✧</i><i class="trpyt t3">✦</i>' : ''));
      setTimeout(() => el.classList.remove('objevi'), 700);
      el.querySelector('.samolepka, .postava').style.animationDelay = (-Math.random() * 2) + 's';
      naTuk(el, () => klikNaTvora(s.id));
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat(s.poz).addTo(mapa);
      z = { marker, el, typ: 'tvor' }; znacky.set(s.id, z);
    }
    z.data = s;
    const blizko = s.d <= NAST.dosahChytani;
    z.el.classList.toggle('blizko', blizko);
    if (blizko && !videnoBlizko.has(s.id)) { videnoBlizko.add(s.id); if (!hned) { zvuk('blizko'); vibruj(60); } }
  }
  for (const s of zast) {
    zustava.add(s.id);
    let z = znacky.get(s.id);
    if (!z) {
      const el = document.createElement('div');
      el.className = 'znacka zast-mapa';
      el.innerHTML = '<div class="zare"></div><div class="disk-mapa"><div class="disk-lic"><span>★</span></div><div class="disk-hrana"></div></div><div class="noha"></div><div class="podstavec"></div>';
      naTuk(el, () => klikNaZastavku(s.id));
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat(s.poz).addTo(mapa);
      z = { marker, el, typ: 'zast' }; znacky.set(s.id, z);
    }
    z.data = s;
    z.el.classList.toggle('pouzita', !!stav.zastavky[s.id] && Date.now() - stav.zastavky[s.id] < NAST.pauzaZastavky);
    z.el.classList.toggle('blizko', s.d <= NAST.dosahZastavky);
  }
  for (const [id, z] of znacky) if (!zustava.has(id)) { z.marker.remove(); znacky.delete(id); }
  obnovOkoli(tvory);
}

// Spolehlivé ťuknutí na značku i v mobilu (mapa jinak ťuknutí „sní“)
function naTuk(el, fn) {
  let st = null;
  const stop = e => e.stopPropagation();
  el.addEventListener('touchstart', stop, { passive: true });
  el.addEventListener('mousedown', stop);
  el.addEventListener('pointerdown', e => { e.stopPropagation(); st = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  el.addEventListener('pointerup', e => {
    e.stopPropagation();
    if (st && Math.abs(e.clientX - st.x) + Math.abs(e.clientY - st.y) < 14 && Date.now() - st.t < 700) fn();
    st = null;
  });
  el.addEventListener('click', e => e.stopPropagation());
}

function obnovOkoli(tvory) {
  const sez = $('#okoliSeznam');
  const nej = tvory.slice().sort((a, b) => a.d - b.d).slice(0, 6);
  sez.innerHTML = nej.length ? '' : '<div class="nic">Nic tu není… projdi se</div>';
  for (const s of nej) {
    const e = document.createElement('span');
    e.innerHTML = obrazekHTML(s.druh);
    e.style.setProperty('--b', s.druh.barva || '#fff');
    if (s.d <= NAST.dosahChytani) e.classList.add('blizko');
    e.title = `${s.druh.jmeno} – ${Math.round(s.d)} m`;
    const tecky = s.d <= NAST.dosahChytani ? 0 : s.d < 120 ? 1 : s.d < 220 ? 2 : 3;
    const obal = document.createElement('div'); obal.className = 'okoli-kus';
    obal.appendChild(e);
    obal.insertAdjacentHTML('beforeend', `<div class="vzd">${tecky ? '•'.repeat(tecky) : 'tady!'}</div>`);
    sez.appendChild(obal);
  }
}

// Dojdi k cíli, zastav se kousek před ním (už na dosah)
function jdiK(cil, d, dosah) {
  if (!stav.test) { stav.testPoz = poloha.slice(); prepniTest(true, true); }
  const zastav = Math.max(0, d - dosah * 0.6);
  cilChuze = posun(poloha, zastav, smer(poloha, cil));
}

function klikNaTvora(id) {
  const z = znacky.get(id); if (!z) return;
  const s = z.data, d = vzdal(poloha, s.poz);
  if (d > NAST.dosahChytani) { jdiK(s.poz, d, NAST.dosahChytani); toast(`Jdu k: ${s.druh.jmeno} (${Math.round(d)} m)`, 1600); return; }
  if (Date.now() > s.konec) { toast('Samolepka už odletěla'); obnovZnacky(); return; }
  if (stav.lapky <= 0) { toast('Došly ti lapky – zastav se na Lepárně'); return; }
  zacniLov(s);
}

// =============================================================
//  Lepárna
// =============================================================
let aktZast = null;
function klikNaZastavku(id) {
  const z = znacky.get(id); if (!z) return;
  aktZast = z.data;
  const d = vzdal(poloha, aktZast.poz);
  if (d > NAST.dosahZastavky) { jdiK(aktZast.poz, d, NAST.dosahZastavky); toast(`Jdu k: ${aktZast.jmeno} (${Math.round(d)} m)`, 1600); return; }
  const pouzita = stav.zastavky[id] && Date.now() - stav.zastavky[id] < NAST.pauzaZastavky;
  $('#zastJmeno').textContent = aktZast.jmeno;
  $('#zastDisk').classList.toggle('pouzity', !!pouzita);
  $('#zastDisk').style.transform = '';
  if (d > NAST.dosahZastavky) $('#zastText').textContent = `Jsi ${Math.round(d)} m daleko. Dojdi blíž a roztoč disk.`;
  else if (pouzita) $('#zastText').textContent = `Už jsi tu byl. Znovu za ${Math.ceil((NAST.pauzaZastavky - (Date.now() - stav.zastavky[id])) / 60000)} min.`;
  else $('#zastText').textContent = 'Roztoč disk prstem!';
  ukaz('#lepar');
}
(function disk() {
  const el = $('#zastDisk'); let st = null, uhel = 0;
  const uhelBodu = e => { const r = el.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI; };
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); st = { a: uhelBodu(e), soucet: 0 }; });
  el.addEventListener('pointermove', e => {
    if (!st) return; const a = uhelBodu(e); let d = a - st.a; if (d > 180) d -= 360; if (d < -180) d += 360;
    st.a = a; st.soucet += Math.abs(d); uhel += d; el.style.transform = `rotate(${uhel}deg)`;
    if (st.soucet > 200) { st = null; roztoc(); }
  });
  el.addEventListener('pointerup', () => { if (st && st.soucet < 30) roztoc(); st = null; });
})();
function roztoc() {
  if (!aktZast) return;
  const id = aktZast.id, d = vzdal(poloha, aktZast.poz);
  if (d > NAST.dosahZastavky || (stav.zastavky[id] && Date.now() - stav.zastavky[id] < NAST.pauzaZastavky)) return;
  const el = $('#zastDisk');
  el.style.transition = 'transform 1s cubic-bezier(.2,.8,.3,1)';
  el.style.transform = `rotate(${720 + Math.random() * 360}deg)`;
  setTimeout(() => { el.style.transition = ''; }, 1000);
  const r = rng(hash(Date.now() & 0xffffffff, 7));
  const lapky = 3 + Math.floor(r() * 4), lep = r() < 0.35 ? 1 : 0;
  stav.lapky += lapky; stav.lepidlo += lep; stav.zastavky[id] = Date.now();
  pridejXP(50);
  uloz(); zvuk('zastavka'); vibruj([30, 40, 30]);
  el.classList.add('pouzity');
  $('#zastText').innerHTML = `<b>+${lapky} lapek</b>${lep ? ' a <b>+1 lepidlo</b>' : ''} · +50 XP`;
  obnovHUD(); obnovZnacky();
}

// =============================================================
//  Chytání
// =============================================================
let lov = null;
function zacniLov(s) {
  const vz = VZACNOST[s.druh.vzacnost];
  lov = { s, vz, lepidlo: false, pokusy: 0, hotovo: false, letí: false, h: hodnotyKusu(s.druh, s.id) };
  $('#lovSila').textContent = 'SÍLA ' + lov.h.sila;
  const tvor = $('#lovTvor');
  tvor.className = s.druh.vystrizek ? 'postava-lov' : 'samolepka';
  $('#lov').classList.toggle('je-postava', !!s.druh.vystrizek);
  $('#lovTvorObal').className = vz.poh;
  tvor.style.setProperty('--b', s.druh.barva || '#fff');
  tvor.style.transform = ''; tvor.innerHTML = s.druh.vystrizek ? postavaHTML(s.druh) : obrazekHTML(s.druh);
  $('#lovJmeno').textContent = s.druh.jmeno;
  $('#lovVz').textContent = vz.jm; $('#lovVz').style.background = vz.barva;
  $('#lovKruh i').style.setProperty('--k', vz.barva);
  $('#lovKruh').style.display = '';
  skryj('#lovVysledek');
  ukaz('#lov');
  obnovLovInfo(); novyMic();
  requestAnimationFrame(kruhSmycka);
}
function obnovLovInfo() {
  $('#lovLapky').textContent = `Lapky: ${stav.lapky}`;
  $('#lovLepPocet').textContent = stav.lepidlo;
  $('#lovLepidlo').classList.toggle('aktivni', !!(lov && lov.lepidlo));
}
function kruhSmycka(t) {
  if (!lov || $('#lov').classList.contains('skryto')) return;
  lov.kruh = 1 - 0.68 * ((t % 1800) / 1800);
  $('#lovKruh i').style.transform = `translate(-50%,-50%) scale(${lov.kruh})`;
  requestAnimationFrame(kruhSmycka);
}
function micDomu() { return { x: innerWidth / 2, y: innerHeight - 120 - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sb')) || 0) }; }
function nastavMic(x, y, sc = 1, rot = 0) { const m = $('#lovMic'); m.style.left = x + 'px'; m.style.top = y + 'px'; m.style.transform = `translate(-50%,-50%) scale(${sc}) rotate(${rot}deg)`; }
function novyMic() {
  const m = $('#lovMic'); m.className = 'lapka velka'; m.style.opacity = stav.lapky > 0 ? 1 : 0.3;
  const d = micDomu(); nastavMic(d.x, d.y);
}
function hlaska(t, ms = 900) { const e = $('#lovHlaska'); e.textContent = t; e.classList.add('vid'); setTimeout(() => e.classList.remove('vid'), ms); }

(function hazeni() {
  const m = $('#lovMic'); let tah = null;
  m.addEventListener('pointerdown', e => {
    if (!lov || lov.letí || lov.hotovo) return;
    if (stav.lapky <= 0) { hlaska('Došly lapky'); return; }
    m.setPointerCapture(e.pointerId);
    tah = { body: [[e.clientX, e.clientY, performance.now()]] };
  });
  m.addEventListener('pointermove', e => {
    if (!tah) return;
    tah.body.push([e.clientX, e.clientY, performance.now()]); if (tah.body.length > 6) tah.body.shift();
    nastavMic(e.clientX, e.clientY);
  });
  const pust = e => {
    if (!tah) return;
    const b = tah.body; tah = null;
    const a = b[0], z = b[b.length - 1], dt = Math.max(16, z[2] - a[2]);
    const vx = (z[0] - a[0]) / dt, vy = (z[1] - a[1]) / dt;
    if (vy > -0.35) { const d = micDomu(); nastavMic(d.x, d.y); return; }  // jen posunul, nehodil
    hod(z[0], z[1], vx, vy);
  };
  m.addEventListener('pointerup', pust);
  m.addEventListener('pointercancel', pust);
})();

function hod(sx, sy, vx, vy) {
  lov.letí = true;
  stav.lapky--; uloz(); obnovLovInfo(); obnovHUD();
  zvuk('hod');
  const kruhPriHodu = lov.kruh;
  const obal = $('#lovTvorObal').getBoundingClientRect();
  const cy = obal.top + obal.height / 2;
  const sila = Math.min(1.7, -vy / 1.55);
  const tx = sx + vx * 300;
  const ty = sy - (sy - cy) * sila;
  const T = 620, t0 = performance.now(), oblouk = 130 * Math.min(sila, 1.2);
  const krok = t => {
    const u = Math.min(1, (t - t0) / T);
    const x = sx + (tx - sx) * u, y = sy + (ty - sy) * u - oblouk * Math.sin(Math.PI * u);
    nastavMic(x, y, 1 - 0.5 * u * Math.min(sila, 1), u * 720);
    if (Math.random() < 0.6) { const st = document.createElement('i'); st.className = 'stopa'; st.style.left = x + 'px'; st.style.top = y + 'px'; st.style.transform = `translate(-50%,-50%) scale(${1 - 0.5 * u})`; $('#lov').appendChild(st); setTimeout(() => st.remove(), 450); }
    if (u < 1) return requestAnimationFrame(krok);
    // dopad – trefil?
    const r = $('#lovTvor').getBoundingClientRect();
    const sxT = r.left + r.width / 2, syT = r.top + r.height / 2;
    const vzd = Math.hypot(tx - sxT, ty - syT);
    if (vzd < r.width * 0.62) zasah(tx, ty, vzd < r.width * 0.5 * kruhPriHodu * 1.2 ? kruhPriHodu : 1);
    else vedle();
  };
  requestAnimationFrame(krok);
}

async function vedle() {
  hlaska('Vedle!', 700);
  const m = $('#lovMic'); m.style.transition = 'opacity .4s'; m.style.opacity = 0;
  await spi(450); m.style.transition = '';
  lov.letí = false; novyMic();
  if (stav.lapky <= 0) hlaska('Došly lapky', 1500);
}

async function zasah(x, y, kruhK) {
  zvuk('zasah'); vibruj(40);
  // bonus za malý kroužek
  let bonus = 1;
  if (kruhK < 1) { bonus = 1 + (1 - kruhK) * 1.3; hlaska(kruhK < 0.48 ? 'Výborně!' : kruhK < 0.72 ? 'Skvěle!' : 'Pěkně!'); }
  const tvor = $('#lovTvor'); tvor.classList.add('dovnitr');
  $('#lovKruh').style.display = 'none';
  const zab = document.createElement('div'); zab.className = 'zablesk'; $('#lov').appendChild(zab); setTimeout(() => zab.remove(), 400);
  const m = $('#lovMic'); m.classList.add('otevreny');
  const vb = document.createElement('i'); vb.className = 'vybuch'; vb.style.left = x + 'px'; vb.style.top = y + 'px'; $('#lov').appendChild(vb); setTimeout(() => vb.remove(), 600);
  await spi(350);
  m.classList.remove('otevreny');
  // spadne na zem
  const zem = $('#lovTvorObal').getBoundingClientRect().bottom + 6;
  m.style.transition = 'top .35s cubic-bezier(.5,0,.8,1.6)'; nastavMic(x, zem, 0.75);
  await spi(450); m.style.transition = '';

  const lep = lov.lepidlo ? 1.6 : 1;
  if (lov.lepidlo) { lov.lepidlo = false; stav.lepidlo = Math.max(0, stav.lepidlo - 1); uloz(); obnovLovInfo(); }
  const zakl = lov.s.druh.sance || lov.vz.sance;
  const sance = Math.min(0.97, zakl * bonus * lep * (1 + (uroven(stav.xp) - 1) * 0.015) * (1 + lov.pokusy * 0.04));
  const naTreseni = Math.pow(sance, 1 / 3);
  for (let i = 0; i < 3; i++) {
    await spi(500);
    m.classList.remove('trese'); void m.offsetWidth; m.classList.add('trese'); zvuk('treseni');
    await spi(650);
    if (Math.random() > naTreseni) return vyskocil(x, zem);
  }
  chyceno(x, zem);
}

async function vyskocil(x, zem) {
  lov.pokusy++;
  const m = $('#lovMic'); m.classList.add('otevreny');
  const tvor = $('#lovTvor'); tvor.classList.remove('dovnitr');
  $('#lovKruh').style.display = '';
  hlaska('Ach ne!', 800);
  await spi(300);
  m.style.opacity = 0; m.classList.remove('otevreny');
  if (Math.random() < (lov.s.druh.utek || lov.vz.utek)) {
    await spi(500);
    tvor.classList.add('utika'); zvuk('utek'); hlaska('Utekla!', 1200);
    stav.utekli[lov.s.id] = 1; uloz();
    lov.hotovo = true;
    await spi(1400); konecLovu();
    toast(`${lov.s.druh.jmeno} utekla`);
    return;
  }
  await spi(300);
  lov.letí = false; novyMic();
}

async function chyceno(x, y) {
  lov.hotovo = true;
  zvuk('chyceno'); vibruj([60, 50, 120]);
  for (let i = 0; i < 9; i++) {
    const h = document.createElement('div'); h.className = 'hvezdy'; h.textContent = ['★', '✦', '✧'][i % 3];
    h.style.left = x + 'px'; h.style.top = y + 'px'; h.style.color = ['#ffd84d', '#fff', '#1fc8b0'][i % 3];
    const a = i / 9 * Math.PI * 2; h.style.setProperty('--dx', Math.cos(a) * 90 + 'px'); h.style.setProperty('--dy', Math.sin(a) * 90 - 30 + 'px');
    $('#lov').appendChild(h); setTimeout(() => h.remove(), 1000);
  }
  const d = lov.s.druh;
  stav.chyceno[lov.s.id] = 1;
  const zaznam = stav.sbirka[d.id] || { pocet: 0 };
  const novy = !zaznam.pocet;
  zaznam.pocet++;
  zaznam.kusy = (zaznam.kusy || []).concat([{ ...lov.h, cas: Date.now() }]).sort((a, b) => b.sila - a.sila).slice(0, 30);
  if (novy) zaznam.prvni = { cas: Date.now(), mesto: mestoU(poloha) };
  stav.sbirka[d.id] = zaznam;
  const xp = lov.vz.xp + (novy ? 500 : 0);
  const predL = uroven(stav.xp);
  pridejXP(xp);
  uloz();
  await spi(900);
  const obr = $('#vysObr'); obr.className = d.vystrizek ? 'postava-karta' : 'samolepka velka'; obr.style.setProperty('--b', d.barva || '#fff'); obr.innerHTML = d.vystrizek ? postavaHTML(d) : obrazekHTML(d);
  $('#vysNadpis').textContent = novy ? 'Nová samolepka!' : 'Chyceno!';
  $('#vysText').innerHTML = `<b>${d.jmeno}</b> · ${lov.vz.jm}<br><span class="hodnoty"><b>Síla ${lov.h.sila}</b> · Životy ${lov.h.zivoty} · Hodnocení ${lov.h.hodnoceni} %</span><br>+${xp} XP${novy ? ' (nová do alba)' : ''}${uroven(stav.xp) > predL ? `<br>🎉 <b>Úroveň ${uroven(stav.xp)}!</b>` : ''}<br><span class="sede">V albu máš ${zaznam.pocet}×</span>`;
  $('#lovVysledek .karta').style.setProperty('--vz', lov.vz.barva);
  $('#vysStuha').textContent = lov.vz.jm;
  ukaz('#lovVysledek');
  konfety();
}
function konfety() {
  const k = $('#lovVysledek');
  for (let i = 0; i < 40; i++) {
    const c = document.createElement('i'); c.className = 'konfeta';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = ['#ffd84d', '#1fc8b0', '#6c5ce7', '#ff6b9a', '#5ac8fa'][i % 5];
    c.style.animationDelay = Math.random() * 0.4 + 's';
    c.style.setProperty('--x', (Math.random() * 120 - 60) + 'px');
    c.style.setProperty('--r', (Math.random() * 720) + 'deg');
    k.appendChild(c); setTimeout(() => c.remove(), 2600);
  }
}
$('#vysOk').addEventListener('click', konecLovu);
$('#lovUtec').addEventListener('click', () => { if (lov && lov.letí && !lov.hotovo) return; konecLovu(); });
$('#lovLepidlo').addEventListener('click', () => {
  if (!lov || lov.hotovo) return;
  if (!lov.lepidlo && stav.lepidlo <= 0) { hlaska('Nemáš lepidlo', 900); return; }
  lov.lepidlo = !lov.lepidlo; obnovLovInfo();
  if (lov.lepidlo) hlaska('Lepidlo připraveno', 800);
});
function konecLovu() { skryj('#lov'); skryj('#lovVysledek'); lov = null; obnovHUD(); obnovZnacky(); }

// =============================================================
//  HUD, album, menu, nastavení
// =============================================================
function pridejXP(n) { stav.xp += n; }
function obnovHUD() {
  const l = uroven(stav.xp), od = xpNaUroven(l), do_ = xpNaUroven(l + 1);
  $('#lvl').textContent = l;
  $('#jmenoHrace').textContent = stav.jmeno || 'Lovec';
  $('#xpFill').style.width = Math.round((stav.xp - od) / (do_ - od) * 100) + '%';
  $('#xpText').textContent = `${stav.xp - od} / ${do_ - od} XP`;
  $('#lapkyPocet').textContent = stav.lapky;
  $('#batohLapky').textContent = stav.lapky;
  $('#batohLepidlo').textContent = stav.lepidlo;
}

function otevriAlbum() {
  const m = $('#albumMrizka'); m.innerHTML = '';
  let mam = 0;
  for (const d of DRUHY) {
    const z = stav.sbirka[d.id];
    if (z) mam++;
    const k = document.createElement('button');
    k.className = 'album-karta' + (z ? '' : ' nechyceno');
    k.appendChild(samolepkaEl(d));
    k.insertAdjacentHTML('beforeend', `<div class="jm">${z ? d.jmeno : '???'}</div><div class="pc">${z ? z.pocet + '×' : VZACNOST[d.vzacnost].jm}</div>`);
    k.addEventListener('click', () => z ? ukazDetail(d) : toast('Tuhle ještě nemáš' + (d.mesto !== 'vsude' ? ` – hledej v ${d.mesto === 'usti' ? 'Ústí' : 'Litomyšli'}` : '')));
    m.appendChild(k);
  }
  $('#albumPocet').textContent = `${mam}/${DRUHY.length}`;
}
function ukazDetail(d) {
  const z = stav.sbirka[d.id], vz = VZACNOST[d.vzacnost];
  const o = $('#detailObr'); o.className = d.vystrizek ? 'postava-karta' : 'samolepka velka'; o.style.setProperty('--b', d.barva || '#fff'); o.innerHTML = d.vystrizek ? postavaHTML(d) : obrazekHTML(d);
  $('#detailJmeno').textContent = d.jmeno;
  $('#detailVz').textContent = vz.jm; $('#detailVz').style.background = vz.barva;
  $('#detailPopis').textContent = d.popis || '';
  const kde = z.prvni && z.prvni.mesto ? MESTA[z.prvni.mesto].jmeno : 'mimo města';
  const nej = (z.kusy || [])[0];
  $('#detailHodnoty').innerHTML = nej ? `<div><b>${nej.sila}</b><small>Síla</small></div><div><b>${nej.zivoty}</b><small>Životy</small></div><div><b>${nej.iv.join('/')}</b><small>Útok/Obrana/Výdrž</small></div><div><b>${nej.hodnoceni} %</b><small>Hodnocení</small></div>` : '';
  $('#detailInfo').textContent = `Nejsilnější kus nahoře · chyceno ${z.pocet}× · poprvé ${z.prvni ? new Date(z.prvni.cas).toLocaleDateString('cs-CZ') : ''} (${kde})`;
  ukaz('#detail');
}

$('#menuBtn').addEventListener('click', () => ukaz('#menu'));
$('#profil').addEventListener('click', () => { otevriAlbum(); ukaz('#album'); });
$('#okoli').addEventListener('click', () => {
  const t = [...znacky.values()].filter(z => z.typ === 'tvor').map(z => z.data).sort((a, b) => a.d - b.d)[0];
  toast(t ? `Nejblíž: ${t.druh.jmeno}, ${Math.round(t.d)} m` : 'V okolí nic není');
});
$('#kompas').addEventListener('click', () => mapa && mapa.easeTo({ bearing: 0, duration: 400 }));
$$('[data-otevri]').forEach(b => b.addEventListener('click', () => {
  const kam = b.dataset.otevri; skryj('#menu');
  if (kam === 'album') otevriAlbum();
  if (kam === 'nastaveni') nactiNastaveni();
  obnovHUD(); ukaz('#' + kam);
}));
$$('[data-zavri]').forEach(b => b.addEventListener('click', () => b.closest('.vrstva, .obrazovka').classList.add('skryto')));
$$('.vrstva').forEach(v => v.addEventListener('click', e => { if (e.target === v && v.id !== 'lovVysledek') v.classList.add('skryto'); }));

function nactiNastaveni() {
  $('#inJmeno').value = stav.jmeno; $('#inTest').checked = stav.test; $('#inZvuk').checked = stav.zvuk;
  $('#testMesta').classList.toggle('skryto', !stav.test);
  $('#verze').textContent = 'Verze ' + VERZE;
}
$('#inJmeno').addEventListener('input', e => { stav.jmeno = e.target.value.trim() || 'Lovec'; uloz(); obnovHUD(); });
$('#inZvuk').addEventListener('change', e => { stav.zvuk = e.target.checked; uloz(); });
$('#inTest').addEventListener('change', e => { prepniTest(e.target.checked); $('#testMesta').classList.toggle('skryto', !stav.test); });
$$('[data-mesto]').forEach(b => b.addEventListener('click', () => {
  const m = MESTA[b.dataset.mesto]; poloha = [m.lon, m.lat]; zobrazena = null; cilChuze = null; stav.testPoz = poloha; uloz();
  skryj('#nastaveni'); toast('Jsi v ' + (b.dataset.mesto === 'usti' ? 'Ústí nad Orlicí' : 'Litomyšli') + ' – ťukni na mapu a jdi');
}));
$('#btnReset').addEventListener('click', () => {
  if (!confirm('Opravdu smazat celý postup? Album, lapky i úroveň budou pryč.')) return;
  const test = stav.test, poz = stav.testPoz; stav = vychozi(); stav.test = test; stav.testPoz = poz; uloz();
  obnovHUD(); for (const [, z] of znacky) z.marker.remove(); znacky.clear(); obnovZnacky(true); skryj('#nastaveni'); toast('Postup smazán');
});

// =============================================================
//  GPS / zkušební procházka
// =============================================================
let napovedaChuze = false;
let gpsWatch = null, gpsPrvni = true;
function nastavGpsStav(t) { const e = $('#gpsStav'); if (!t) e.classList.add('skryto'); else { e.textContent = t; e.classList.remove('skryto'); } }

function spustGPS() {
  if (!('geolocation' in navigator)) { nastavGpsStav('Telefon nepodporuje polohu'); return; }
  if (gpsWatch !== null) return;
  gpsPrvni = true;
  nastavGpsStav('Hledám tvou polohu…');
  gpsWatch = navigator.geolocation.watchPosition(p => {
    if (stav.test) return;
    presnost = p.coords.accuracy;
    const prvni = !poloha || gpsPrvni;
    gpsPrvni = false;
    poloha = [p.coords.longitude, p.coords.latitude];
    if (prvni) zobrazena = null;
    if (!mapa) vytvorMapu(poloha);
    nastavGpsStav(presnost > 60 ? `Slabé GPS (±${Math.round(presnost)} m)` : '');
  }, err => {
    if (stav.test) return;
    if (err.code === 1) nastavGpsStav('Poloha zakázaná – povol ji v Nastavení, nebo zapni Zkušební procházku');
    else nastavGpsStav('GPS nejde – jdi ven, nebo zapni Zkušební procházku');
    // GPS nikdy nenašlo polohu → přepnout na zkušební procházku, ať jde chodit ťukáním
    if (!poloha || !mapa) { prepniTest(true); toast(err.code === 1 ? 'Poloha je zakázaná – chodíš ťukáním na mapu (zkušební procházka)' : 'Nevidím GPS – chodíš ťukáním na mapu (zkušební procházka)', 4500); }
  }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
}
function zastavGPS() { if (gpsWatch !== null) { navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; } }

function prepniTest(zap, ticho) {
  stav.test = zap; uloz();
  if (zap) {
    zastavGPS(); nastavGpsStav('');
    poloha = (stav.testPoz || [MESTA.litomysl.lon, MESTA.litomysl.lat]).slice();
    if (!ticho) zobrazena = null;
    if (!mapa) vytvorMapu(poloha);
    if (!ticho) toast('Ťukni na mapu a panáček tam dojde', 3200);
  } else { cilChuze = null; spustGPS(); }
}

// Kompas telefonu: kužel před panáčkem ukazuje, kam se díváš
let natoceni = null;
function spustKompas() {
  const zapni = () => window.addEventListener(('ondeviceorientationabsolute' in window) ? 'deviceorientationabsolute' : 'deviceorientation', e => {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute !== false && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;
    if (h !== null) natoceni = h;
  });
  try {
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function')
      DeviceOrientationEvent.requestPermission().then(s => { if (s === 'granted') zapni(); }).catch(() => {});
    else zapni();
  } catch {}
}

// Displej nezhasne, když hraješ
let wakeLock = null;
async function drzDisplej() { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('#uvod')) drzDisplej(); if (document.visibilityState === 'visible') obnovZnacky(); });

// =============================================================
//  Start
// =============================================================
function start(test) {
  $('#uvod').remove();
  drzDisplej();
  try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch {}
  obnovHUD();
  spustKompas();
  if (test) prepniTest(true);
  else { stav.test = false; uloz(); spustGPS(); }
  requestAnimationFrame(smycka);
}
$('#btnHrat').addEventListener('click', () => start(false));
$('#btnTest').addEventListener('click', () => start(true));

// Nápověda k instalaci na úvodní obrazovce
(function () {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (!standalone) $('#uvodInstal').textContent = ios ? 'Tip: v Safari dej Sdílet → Přidat na plochu a hraj jako aplikaci.' : 'Tip: v menu prohlížeče dej Přidat na plochu / Nainstalovat.';
})();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

// Pro zkoušení z konzole
window.__hra = { stav: () => stav, poloha: () => poloha, znacky, NAST, zacniLov, samolepkyKolem };
