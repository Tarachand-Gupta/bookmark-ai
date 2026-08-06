import type { NewTabTemplateConfig, PresetThumbnailName } from "@bookmark-ai/types";

/**
 * The six built-in starter templates (docs/features/newtab-canvas.md §4.6).
 * Hand-written, trustworthy, and deliberately the REFERENCE shape the agent's
 * HTML should copy: every data read is `call("<type>", {...})` over the fixed
 * postMessage vocabulary — never fetch, never chrome.*, never storage.
 *
 * They live server-side (not as extension asset files) because seeding is
 * server-side: the tenant DB is the single source of truth, so the seeding
 * route needs the HTML here. The extension never reads these constants; it
 * renders whatever rows the templates API returns.
 *
 * Bridge protocol the templates assume (enforced by the parent's bridge.ts):
 *   request  : parent.postMessage({ id, type, ...params }, "*")
 *   response : { id, ok: true, data } | { id, ok: false, error }   (openUrl: { id, ok: true })
 * Template JS avoids `${"``"}`-template literals and `</script>` in string
 * literals so the strings survive being embedded verbatim into this file.
 */

export interface NewTabPreset {
  id: string;
  name: string;
  html: string;
  config: NewTabTemplateConfig;
}

const BASE_CSS = [
  "html,body{margin:0;height:100%;font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;",
  "background:transparent;color:#e8e8ea}",
  "body{display:flex;flex-direction:column}",
  ".bar{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid #2a2a30}",
  ".bar h1{font-size:15px;margin:0;font-weight:600}",
  ".bar input{flex:1;max-width:360px;background:#18181c;border:1px solid #2e2e35;border-radius:8px;",
  "padding:7px 10px;color:#e8e8ea;font-size:13px;outline:none}",
  ".bar input:focus{border-color:#565660}",
  "main{flex:1;overflow:auto;padding:16px 20px}",
  ".muted{color:#8a8a92;font-size:13px}",
  "button.card{cursor:pointer;text-align:left;background:#17171b;border:1px solid #26262c;",
  "border-radius:10px;padding:10px;color:inherit;font:inherit}",
  "button.card:hover{border-color:#3d3d47;background:#1c1c21}",
].join("\n");

const BRIDGE_JS = [
  "(function(){",
  "window.__esc=function(s){return String(s==null?'':s).replace(/[&<>\"']/g,function(c){",
  "  return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c];});};",
  "var pend={};",
  "window.call=function(type,params){return new Promise(function(resolve){",
  "  var id='r'+Math.random().toString(36).slice(2)+Date.now().toString(36);",
  "  pend[id]=resolve;parent.postMessage(Object.assign({id:id,type:type},params||{}),'*');});};",
  "window.addEventListener('message',function(e){var d=e.data;",
  "  if(!d||typeof d!=='object'||typeof d.id!=='string')return;",
  "  var r=pend[d.id];if(r){delete pend[d.id];r(d);}});",
  "window.open_=function(url){window.call('openUrl',{url:url});};",
  "})();",
].join("\n");

function page(title: string, head: string, bodyHtml: string, script: string): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${title}</title><style>`,
    BASE_CSS,
    head,
    `</style></head><body>`,
    bodyHtml,
    `<script>`,
    BRIDGE_JS,
    script,
    `</` + "script></body></html>",
  ].join("\n");
}

/* ── 1. Favorites ────────────────────────────────────────────────────────── */
// The canonical worked example the agent's system prompt cites (§4.3.2): ready
// handshake → getFavorites → render cards → openUrl on click → search box that
// calls the `search` bridge type.
const FAVORITES_HTML = page(
  "Favorites",
  [
    ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}",
    ".avatar{display:flex;align-items:center;justify-content:center;width:36px;height:36px;",
    "border-radius:9px;background:#26262e;color:#c9c9d4;font-weight:700;margin-bottom:8px}",
    ".t{font-size:13px;font-weight:600;display:block;overflow:hidden;text-overflow:ellipsis;",
    "white-space:nowrap}",
    ".d{font-size:11px;color:#8a8a92}",
  ].join("\n"),
  [
    '<header class="bar"><h1>Favorites</h1>',
    '<input id="q" placeholder="Search your bookmarks…"></header>',
    '<main><div id="out" class="grid"><p class="muted">Loading…</p></div></main>',
  ].join("\n"),
  [
    "var out=document.getElementById('out'),q=document.getElementById('q');",
    "function tile(b){return '<button class=\"card\"><span class=\"avatar\">'+",
    "  window.__esc((b.domain||'?').slice(0,1).toUpperCase())+'</span>'+",
    "  '<span class=\"t\">'+window.__esc(b.title||b.url)+'</span>'+",
    "  '<span class=\"d\">'+window.__esc(b.domain||'')+'</span></button>';}",
    "function bind(list){out.innerHTML=list.length?list.map(tile).join(''):",
    "  '<p class=\"muted\">Nothing here yet.</p>';",
    "  Array.prototype.forEach.call(out.querySelectorAll('button'),function(el,i){",
    "    el.addEventListener('click',function(){window.open_(list[i].url);});});}",
    "var timer=null;",
    "q.addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(async function(){",
    "  var v=q.value.trim();if(!v){init();return;}",
    "  var res=await window.call('search',{q:v,mode:'hybrid',limit:24});",
    "  var hits=res.ok?(res.data.results||[]).map(function(r){return r.bookmark;}):[];",
    "  bind(hits);},250);});",
    "async function init(){await window.call('ready');",
    "  var res=await window.call('getFavorites');bind(res.ok?res.data||[]:[]);}",
    "init();",
  ].join("\n"),
);

/* ── 2. Recent ───────────────────────────────────────────────────────────── */
const RECENT_HTML = page(
  "Most recent",
  [
    ".row{display:flex;flex-direction:column;gap:8px;max-width:760px}",
    ".cat{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#8a8a92}",
  ].join("\n"),
  [
    '<header class="bar"><h1>Most recent saves</h1></header>',
    '<main><div id="out" class="row"><p class="muted">Loading…</p></div></main>',
  ].join("\n"),
  [
    "var out=document.getElementById('out');",
    "function row(b){return '<button class=\"card\"><span class=\"cat\">'+",
    "  window.__esc((b.tags||[]).concat(b.category).filter(Boolean).slice(0,3).join(' · '))+",
    "  '</span><b class=\"t\">'+window.__esc(b.title||b.url)+'</b>'+",
    "  '<span class=\"d\">'+window.__esc(b.domain)+' — '+",
    "  window.__esc(String(b.savedAt||'').slice(0,10))+'</span></button>';}",
    "async function init(){await window.call('ready');",
    "  var res=await window.call('listBookmarks',{limit:24});",
    "  var list=res.ok?(res.data.bookmarks||[]):[];",
    "  out.innerHTML=list.length?list.map(row).join(''):'<p class=\"muted\">No bookmarks yet.</p>';",
    "  Array.prototype.forEach.call(out.querySelectorAll('button'),function(el,i){",
    "    el.addEventListener('click',function(){window.open_(list[i].url);});});}",
    "init();",
  ].join("\n"),
);

/* ── 3. Continue where you left off ──────────────────────────────────────── */
const CONTINUE_HTML = page(
  "Continue",
  [".list{display:flex;flex-direction:column;gap:8px;max-width:680px}"].join("\n"),
  [
    '<header class="bar"><h1>Continue where you left off</h1></header>',
    '<main><div id="out" class="list"><p class="muted">Loading…</p></div></main>',
  ].join("\n"),
  [
    "var out=document.getElementById('out');",
    "function row(t){return '<button class=\"card\"><b class=\"t\">'+",
    "  window.__esc(t.title||t.url)+'</b><span class=\"d\">'+window.__esc(t.url)+'</span></button>';}",
    "async function init(){await window.call('ready');",
    "  var res=await window.call('continueWhereYouLeft');",
    "  if(!res.ok||!res.data||!res.data.enabled){out.innerHTML=",
    "    '<p class=\"muted\">Live tab sharing is off — turn it on in the extension popup, and your tabs-in-progress will appear here.</p>';return;}",
    "  var dev=res.data.device;",
    "  if(!dev){out.innerHTML='<p class=\"muted\">No recent devices seen.</p>';return;}",
    "  var tabs=(dev.tabs||[]).slice(0,15);",
    "  out.innerHTML='<p class=\"muted\">On '+window.__esc(dev.label||dev.browser)+':</p>'+",
    "    (tabs.length?tabs.map(row).join(''):'<p class=\"muted\">No tabs captured.</p>');",
    "  Array.prototype.forEach.call(out.querySelectorAll('button'),function(el,i){",
    "    el.addEventListener('click',function(){window.open_(tabs[i].url);});});}",
    "init();",
  ].join("\n"),
);

/* ── 4. Working on ───────────────────────────────────────────────────────── */
const WORKING_HTML = page(
  "Working on",
  [".cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}",
   ".col h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#8a8a92;margin:0 0 8px}",
   ".stack{display:flex;flex-direction:column;gap:8px}"].join("\n"),
  [
    '<header class="bar"><h1>What am I working on</h1></header>',
    '<main><div id="out" class="cols"><p class="muted">Loading…</p></div></main>',
  ].join("\n"),
  [
    "var out=document.getElementById('out');",
    "function row(t){return '<button class=\"card\"><b class=\"t\">'+",
    "  window.__esc(t.title||t.url)+'</b></button>';}",
    "async function init(){await window.call('ready');",
    "  var res=await window.call('listLiveTabs');",
    "  if(!res.ok||!res.data||!res.data.enabled){out.innerHTML=",
    "    '<p class=\"muted\">Live tab sharing is off — enable it in the extension popup.</p>';return;}",
    "  var devs=(res.data.devices||[]).slice(0,4);",
    "  if(!devs.length){out.innerHTML='<p class=\"muted\">No devices reporting right now.</p>';return;}",
    "  out.innerHTML=devs.map(function(d){return '<div class=\"col\"><h2>'+",
    "    window.__esc(d.label||d.browser)+'</h2><div class=\"stack\">'+",
    "    (d.tabs||[]).slice(0,8).map(row).join('')+'</div></div>';}).join('');",
    "  var btns=out.querySelectorAll('.stack');",
    "  Array.prototype.forEach.call(btns,function(stack,di){",
    "    var tabs=(devs[di].tabs||[]).slice(0,8);",
    "    Array.prototype.forEach.call(stack.querySelectorAll('button'),function(el,i){",
    "      el.addEventListener('click',function(){window.open_(tabs[i].url);});});});}",
    "init();",
  ].join("\n"),
);

/* ── 5. Most used ────────────────────────────────────────────────────────── */
const MOST_USED_HTML = page(
  "Most used",
  [
    ".list{display:flex;flex-direction:column;gap:10px;max-width:560px}",
    ".rank{display:flex;align-items:baseline;gap:10px}",
    ".rank .n{width:24px;text-align:right;color:#8a8a92;font-size:12px}",
    ".rank b{font-size:14px;flex:1}",
    ".bartrack{height:5px;background:#26262c;border-radius:3px;overflow:hidden;margin-top:5px}",
    ".barfill{height:100%;background:#7c8cff;border-radius:3px}",
  ].join("\n"),
  [
    '<header class="bar"><h1>Mostly used websites</h1><span class="muted">by saved count</span></header>',
    '<main><div id="out" class="list"><p class="muted">Loading…</p></div></main>',
  ].join("\n"),
  [
    "var out=document.getElementById('out');",
    "async function init(){await window.call('ready');",
    "  var res=await window.call('getMostUsed');",
    "  var list=res.ok?res.data||[]:[];",
    "  if(!list.length){out.innerHTML='<p class=\"muted\">Save some bookmarks first.</p>';return;}",
    "  var max=list[0].count||1;",
    "  out.innerHTML=list.map(function(d,i){return '<div class=\"rank\"><span class=\"n\">'+(i+1)+",
    "    '</span><b>'+window.__esc(d.domain)+'</b><span class=\"d\">'+d.count+' saves</span></div>'+",
    "    '<div class=\"bartrack\"><div class=\"barfill\" style=\"width:'+",
    "    Math.round(100*d.count/max)+'%\"></div></div>';}).join('');}",
    "init();",
  ].join("\n"),
);

/* ── 6. Time spent ───────────────────────────────────────────────────────── */
// Honest empty state (§4.5.1): we do NOT track time-on-page. The preset says so
// instead of inventing a number; the agent's prompt is told the same rule.
const TIME_SPENT_HTML = page(
  "Time spent",
  [".empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:60px 20px;",
   "text-align:center;color:#8a8a92}"].join("\n"),
  [
    '<header class="bar"><h1>Time you spend</h1></header>',
    '<main><div id="out" class="empty"><p class="muted">Loading…</p></div></main>',
  ].join("\n"),
  [
    "var out=document.getElementById('out');",
    "async function init(){await window.call('ready');",
    "  var res=await window.call('getTimeSpent');",
    "  if(res.ok&&res.data&&res.data.available===false){out.innerHTML=",
    "    '<b>Not tracked — on purpose.</b><p>Bookmark AI doesn\\u2019t watch how long you spend",
    "    on pages, so there\\u2019s nothing to show here. Your saves, sessions, and live tabs",
    "    power the other templates instead.</p>';return;}",
    "  out.innerHTML='<p>Time-tracking isn\\u2019t available.</p>';}",
    "init();",
  ].join("\n"),
);

function presetConfig(thumbnail: PresetThumbnailName): NewTabTemplateConfig {
  return { launcherPosition: "bottom-right", thumbnail };
}

/** The served-as-seeded preset set, in sidebar order. First entry becomes the
 *  default active template on first seed (§4.6). */
export const NEWTAB_PRESETS: NewTabPreset[] = [
  { id: "preset:favorites", name: "Favorites", html: FAVORITES_HTML, config: presetConfig("favorites") },
  { id: "preset:recent", name: "Most recent", html: RECENT_HTML, config: presetConfig("recent") },
  { id: "preset:continue", name: "Continue where you left off", html: CONTINUE_HTML, config: presetConfig("continue") },
  { id: "preset:working-on", name: "What am I working on", html: WORKING_HTML, config: presetConfig("working-on") },
  { id: "preset:most-used", name: "Mostly used websites", html: MOST_USED_HTML, config: presetConfig("most-used") },
  { id: "preset:time-spent", name: "Time you spend", html: TIME_SPENT_HTML, config: presetConfig("time-spent") },
];
