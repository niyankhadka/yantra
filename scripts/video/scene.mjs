// Writes scene-<format>.html: the whole teaser as one page whose window.render(t) is a pure function of time.
// Scenes follow the voice-over lines (plan.md); event times come from beats.mjs, shared with the soundtrack.
import fs from 'node:fs';
import path from 'node:path';
import { events } from './beats.mjs';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const hlDark = (line) => esc(line).replace(/("[^"]*")(\s*:)?/g, (m, s, colon) => (colon ? `<span class="k">${s}</span>${colon}` : `<span class="s">${s}</span>`));

// Per-format layout: the frame of each scene's main element, in px
const LAYOUT = {
  landscape: {
    canvas: [360, 300, 1200, 640], box: [210, 72],
    json: [80, 300, 960, 640], tb: [1100, 290, 740, 680],
    ed: [110, 330, 790, 340], term: [940, 330, 870, 340],
    browser: [280, 268, 0.85], walk: [1600, 900],
    file: [560, 270, 800, 560], chips: 880
  },
  vertical: {
    canvas: [60, 620, 960, 920], box: [230, 80],
    json: [60, 520, 960, 560], tb: [60, 1120, 960, 720],
    ed: [60, 600, 960, 300], term: [60, 940, 960, 430],
    browser: [80, 600, 0.958], walk: [960, 1240],
    file: [60, 560, 960, 720], chips: 1340
  }
};
const box = ([x, y, w, h]) => `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;

export function buildScene({ root, work, src, format, w, h, T, error, captures }) {
  const V = format === 'vertical';
  const Y = LAYOUT[format];
  const E = events(T);
  const svg = fs.readFileSync(path.join(work, 'checkout-tb.svg'), 'utf8');
  const [vw, vh] = [+svg.match(/width="([\d.]+)"/)[1], +svg.match(/height="([\d.]+)"/)[1]];
  const inner = svg.slice(svg.indexOf('<g transform="translate('));
  const diagram = inner.slice(0, inner.indexOf('\n  </g>') + 6);
  const defs = svg.slice(svg.indexOf('<defs>'), svg.indexOf('</defs>') + 7);
  const logo = fs.readFileSync(path.join(root, 'src/assets/logo-light.svg'), 'utf8').replace(/^<\?xml[^>]*>/, '').replace('<svg ', '<svg class="logo" ');
  const json = fs.readFileSync(path.join(src, 'checkout.json'), 'utf8').trimEnd().split('\n');
  const code = json.map((l) => `<div class="ln"><span class="clip" data-n="${l.length}">${hlDark(l)}</span></div>`).join('');
  const [, errCode, errMsg] = error.match(/error\s+(\S+)\s+(.*)$/);
  const walk = [2, 3, 4].map((s) => `walk-${format}-${s}`);
  const next = walk.map((n) => captures[n].next);
  const [bx, by, bs] = Y.browser;
  const [ww, wh] = Y.walk;

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--bg:#f6f6f3;--grid:#dddbd4;--surface:#fff;--border:#dcdad3;--ink:#1c1e23;--ink2:#4a4f59;--ink3:#6b707a;--accent:#2f5bd3;--red:#d64545;
--dbg:#0f1115;--dborder:#2b3039;--dink:#e7e9ed;--dink3:#7d8490;--daccent:#7ea3ff;
--sans:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;--mono:'Cascadia Code',ui-monospace,Consolas,monospace}
*{box-sizing:border-box;margin:0}
html,body{width:${w}px;height:${h}px;overflow:hidden;background:var(--bg);font-family:var(--sans);color:var(--ink)}
#grid{position:absolute;inset:-60px;background-image:radial-gradient(var(--grid) 1.6px,transparent 1.7px);background-size:28px 28px}
.abs{position:absolute;will-change:transform,opacity;opacity:0}
.capbox{left:0;right:0;top:${V ? 150 : 62}px;text-align:center;padding:0 ${V ? 70 : 40}px}
.cap{font-size:${V ? 80 : 66}px;font-weight:700;letter-spacing:-.025em;line-height:1.08;text-wrap:balance;${V ? '' : 'white-space:nowrap'}}
.cap b{color:var(--accent);font-weight:700}
.sub{font-size:${V ? 38 : 30}px;color:var(--ink2);margin-top:${V ? 26 : 14}px;font-weight:500;line-height:1.3;text-wrap:balance}
.w{opacity:0}
.dark{background:var(--dbg);border:1px solid var(--dborder);border-radius:22px;box-shadow:0 30px 80px rgba(28,30,35,.25);font-family:var(--mono);color:var(--dink);overflow:hidden}
.bar{display:flex;gap:9px;align-items:center;margin-bottom:18px;color:var(--dink3);font-size:17px;font-family:var(--mono)}
.bar i{width:13px;height:13px;border-radius:50%;background:#2b3039;display:inline-block}
.bar span{margin-left:14px}
.clip{display:inline-block;overflow:hidden;white-space:pre;vertical-align:top}
.k{color:var(--daccent)}.s{color:var(--dink)}.dim{color:var(--dink3)}.p{color:var(--daccent)}.err{color:#ff7b72}.ok{color:#7ee2a8}
/* 1-2 canvas */
#canvas{${box(Y.canvas)};background:#ecebe6;border:1px solid var(--border);border-radius:20px;box-shadow:0 24px 60px rgba(28,30,35,.12);overflow:hidden;opacity:1}
#canvas .tools{position:absolute;left:18px;top:18px;display:flex;flex-direction:column;gap:12px}
#canvas .tools i{width:26px;height:26px;border-radius:6px;border:2px solid #c8c4b9;display:block}
#canvas svg{position:absolute;inset:0;width:100%;height:100%}
.rb{position:absolute;left:0;top:0;width:${Y.box[0]}px;height:${Y.box[1]}px;background:#fff;border:2px solid #b9b5aa;border-radius:10px;font-size:${V ? 26 : 23}px;font-weight:600;color:#55595f;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.06)}
#clock{position:absolute;right:22px;top:20px;display:flex;align-items:center;gap:12px;background:#fff;border:1px solid var(--border);border-radius:999px;padding:8px 18px 8px 10px;font:600 ${V ? 26 : 22}px var(--mono);color:var(--ink2)}
#clock svg{position:static;width:${V ? 40 : 34}px;height:${V ? 40 : 34}px}
#aitag{position:absolute;right:22px;top:20px;background:#fff;border:1px solid var(--border);border-radius:999px;padding:8px 18px;font:600 ${V ? 24 : 20}px var(--mono);color:var(--ink3);opacity:0}
.mark{position:absolute;width:${V ? 110 : 96}px;height:${V ? 110 : 96}px;border-radius:50%;border:5px solid var(--red);opacity:0;box-shadow:0 0 0 6px rgba(214,69,69,.15)}
#cur{left:0;top:0;width:${V ? 52 : 44}px;height:${V ? 62 : 52}px;filter:drop-shadow(0 4px 6px rgba(0,0,0,.3));z-index:5}
/* 3 meet */
#meet{left:0;right:0;top:${V ? 700 : 330}px;display:flex;justify-content:center;align-items:center;gap:${V ? 30 : 36}px}
#meet .logo,#olock .logo{width:${V ? 150 : 170}px;height:${V ? 150 : 170}px}
.name{font-size:${V ? 150 : 170}px;font-weight:750;letter-spacing:-.04em}
#meetSub{left:0;right:0;top:${V ? 930 : 580}px;text-align:center;font-size:${V ? 62 : 56}px;font-weight:700;letter-spacing:-.02em;padding:0 60px}
#meetSub b{color:var(--accent)}
/* 4 describe */
#json{${box(Y.json)};padding:${V ? '26px 30px' : '30px 36px'};font-size:${V ? 13.4 : 14}px;line-height:${V ? 22 : 26}px;color:var(--dink3)}
#json .ln{height:${V ? 22 : 26}px;white-space:pre}#json .clip{height:${V ? 22 : 26}px}
#json .ask{font-size:${V ? 22 : 22}px;line-height:40px;color:var(--dink);margin-bottom:12px}
#json .ask .clip{height:40px}
#tb{${box(Y.tb)};opacity:1}
#tb svg{width:100%;height:100%;overflow:visible}
/* 5 checked */
#ed{${box(Y.ed)};background:#fff;border:1px solid var(--border);border-radius:20px;box-shadow:0 24px 60px rgba(28,30,35,.14);padding:26px 32px;font-family:var(--mono);font-size:${V ? 20 : 19}px;line-height:40px;color:var(--ink3)}
#ed .fn{font-family:var(--sans);font-size:19px;font-weight:600;margin-bottom:10px}
#ed .k2{color:var(--accent)}#ed .s2{color:var(--ink)}
#bad{position:relative}
#bad:after{content:'';position:absolute;left:0;right:0;bottom:-3px;height:3px;background:repeating-linear-gradient(90deg,var(--red) 0 6px,transparent 6px 10px);opacity:var(--sq,0)}
#term{${box(Y.term)};padding:28px 34px;font-size:${V ? 22 : 19}px;line-height:${V ? 46 : 42}px;white-space:pre}
.tl{height:${V ? 46 : 42}px;overflow:hidden;opacity:0}
.tl .clip{height:${V ? 46 : 42}px}
/* 6 story */
#browser{left:${bx}px;top:${by}px;width:${ww * bs}px;height:${wh * bs}px;border-radius:18px;overflow:hidden;background:#f6f6f3;box-shadow:0 30px 90px rgba(28,30,35,.22),0 0 0 1px var(--border)}
#browser img{position:absolute;left:0;top:0;width:100%;height:100%}
#ring{width:70px;height:70px;border-radius:50%;border:3px solid var(--accent);left:0;top:0}
/* 7 shapes, 8 uses */
.tile{position:absolute}
.tile img{display:block;width:100%;border-radius:14px;box-shadow:0 18px 44px rgba(28,30,35,.16),0 0 0 1px var(--border)}
.tile .tt{font-size:${V ? 44 : 40}px;font-weight:700;letter-spacing:-.02em;margin-top:${V ? 18 : 22}px;text-align:center}
/* 9 share */
#file{${box(Y.file)};background:#fff;border:1px solid var(--border);border-radius:22px;box-shadow:0 30px 80px rgba(28,30,35,.16);padding:24px 28px}
#file .hd{display:flex;align-items:center;gap:14px;font:600 ${V ? 28 : 24}px var(--mono);margin-bottom:20px}
#file .hd svg{width:${V ? 36 : 30}px;height:${V ? 36 : 30}px}
#file .badge{margin-left:auto;font:700 ${V ? 20 : 17}px var(--sans);color:#11827b;background:#e3f3f1;border-radius:999px;padding:6px 14px;letter-spacing:.04em;text-transform:uppercase}
#file .th{position:relative;border-radius:12px;overflow:hidden;box-shadow:0 0 0 1px var(--border)}
#file .th img{display:block;width:100%}
#file .th img+img{position:absolute;left:0;top:0}
#chips{left:0;right:0;top:${Y.chips}px;display:flex;justify-content:center;gap:${V ? 18 : 22}px;opacity:1}
.chip{font:700 ${V ? 30 : 28}px var(--mono);padding:12px 26px;border-radius:999px;background:var(--dbg);color:var(--dink);opacity:0}
/* 10 ending */
#olock{left:0;right:0;top:${V ? 400 : 150}px;display:flex;justify-content:center;align-items:center;gap:${V ? 30 : 36}px}
#olock .logo{width:${V ? 130 : 120}px;height:${V ? 130 : 120}px}
#olock .name{font-size:${V ? 130 : 120}px}
#tag{left:0;right:0;top:${V ? 660 : 350}px;text-align:center;font-size:${V ? 118 : 104}px;font-weight:750;letter-spacing:-.035em;line-height:1.05}
#tag span{opacity:0;display:${V ? 'block' : 'inline-block'}}#tag .t2{color:var(--accent)}
#cmd{left:50%;top:${V ? 1060 : 590}px;padding:22px 38px;border-radius:16px;font-size:${V ? 31 : 34}px;white-space:pre}
#cmd .clip{height:44px}
#tools{left:0;right:0;top:${V ? 1200 : 728}px;text-align:center;font-size:${V ? 30 : 27}px;color:var(--ink3);font-weight:500;padding:0 70px;line-height:1.45}
#url{left:0;right:0;top:${V ? 1360 : 800}px;text-align:center;font-size:${V ? 48 : 42}px;font-weight:700;color:var(--accent)}
</style></head><body class="${format}"><div id="grid"></div>

<div class="abs capbox" id="cap0"><div class="cap">Diagrams take hours to draw.</div><div class="sub w" id="stale">…and they're out of date by Friday.</div></div>
<div class="abs capbox" id="cap1"><div class="cap"><span class="w" id="w-ai">AI diagrams?</span> <span class="w" id="w-ov">Boxes overlap.</span> <b class="w" id="w-nw">Arrows point nowhere.</b></div></div>
<div class="abs" id="canvas"><div class="tools"><i></i><i></i><i></i><i></i></div>
  <svg id="wires"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 1 10 5 0 9z" fill="#8f8b80"/></marker></defs><path class="wire" d=""/><path class="wire" d=""/><path class="wire" d=""/></svg>
  <div class="rb" id="rb0">Web app</div><div class="rb" id="rb1">Orders API</div><div class="rb" id="rb2">Orders DB</div><div class="rb" id="rb3">Payments</div>
  <div id="clock"><svg viewBox="0 0 24 24" fill="none" stroke="#4a4f59" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path id="hh" d="M12 12 L12 7.5"/><path id="mh" d="M12 12 L12 4.5"/></svg><span id="clockT">9:00 AM</span></div>
  <div id="aitag">ai-diagram-final.png</div>
  <div class="mark" id="m0"></div><div class="mark" id="m1"></div>
</div>

<div class="abs" id="meet">${logo}<span class="name">Yantra</span></div>
<div class="abs" id="meetSub">Make your AI <b>show its work.</b></div>

<div class="abs capbox" id="cap3"><div class="cap">Describe it. <b>Yantra draws it.</b></div><div class="sub">No boxes to place. Ask your coding agent or any AI chat.</div></div>
<div class="abs dark" id="json"><div class="bar"><i></i><i></i><i></i><span>your coding agent</span></div><div class="ask"><span class="p">&gt; </span><span class="clip" id="ask">explain how our checkout works</span></div>${code}</div>
<div class="abs" id="tb"><svg viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, 'Segoe UI', sans-serif">${defs}${diagram}</svg></div>

<div class="abs capbox" id="cap4"><div class="cap">Checked <b>before anyone sees it.</b></div><div class="sub">Broken links, overlaps and crossed labels, caught automatically.</div></div>
<div class="abs" id="ed"><div class="fn">checkout.json</div><div>"edges": [</div><div>&nbsp;&nbsp;{ <span class="k2">"id"</span>: <span class="s2">"api-db"</span>, <span class="k2">"source"</span>: <span class="s2">"api"</span>,</div><div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="k2">"target"</span>: <span class="s2">"<span id="bad">db<span id="bx">x</span></span>"</span>, … }</div></div>
<div class="abs dark" id="term"><div class="tl" id="t0"><span class="p">$ </span><span class="clip" id="c0">yantra validate checkout.json</span></div><div class="tl" id="t1">  <span class="err">error</span>  <span class="dim">${esc(errCode)}</span></div><div class="tl" id="t2">  ${esc(errMsg)}</div><div class="tl" id="t3"><span class="p">●</span> Fixing the edge target</div><div class="tl" id="t4"><span class="p">$ </span><span class="clip" id="c1">yantra validate checkout.json</span></div><div class="tl" id="t5"><span class="ok">✓ checkout.json is valid</span></div></div>

<div class="abs capbox" id="cap5"><div class="cap">Step through it <b>like a story.</b></div><div class="sub">Each step lights up what matters.</div></div>
<div class="abs" id="browser">${walk.map((n, i) => `<img id="b${i}" src="${n}.png">`).join('')}</div>
<div class="abs" id="ring"></div>

<div class="abs capbox" id="cap6"><div class="cap"><span class="w" id="s0">Diagrams.</span> <span class="w" id="s1">Answer pages.</span> <b class="w" id="s2">Books.</b></div></div>
${['kind-cloud-architecture', 'kind-answer-page', 'kind-book'].map((f, i) => `<div class="abs tile" id="sh${i}"><img src="${f}.png"></div>`).join('')}

${[['use-platform', 'Onboard a team.'], ['use-incident', 'Review an incident.'], ['use-lesson', 'Teach a lesson.']].map(([f, l], i) => `<div class="abs tile" id="u${i}"><img src="${f}.png"><div class="tt">${l}</div></div>`).join('')}

<div class="abs capbox" id="cap8"><div class="cap">One file. <b>Opens anywhere, even offline.</b></div></div>
<div class="abs" id="file"><div class="hd"><svg viewBox="0 0 24 24" fill="none" stroke="#2f5bd3" stroke-width="2" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>cloud-architecture.html<span class="badge">works offline</span></div><div class="th"><img src="share-light.png"><img id="dk" src="share-dark.png"></div></div>
<div class="abs" id="chips">${['HTML', 'SVG', 'PNG', 'Markdown'].map((c, i) => `<span class="chip" id="ch${i}">${c}</span>`).join('')}</div>

<div class="abs" id="olock">${logo}<span class="name">Yantra</span></div>
<div class="abs" id="tag"><span class="t1">Don't draw it.</span> <span class="t2">Explain it.</span></div>
<div class="abs dark" id="cmd"><span class="p">$ </span><span class="clip" id="c2">npx @niyankhadka/yantra init</span></div>
<div class="abs" id="tools">Claude Code · Cursor · Codex · Antigravity · any AI chat</div>
<div class="abs" id="url">yantra.nbk.com.np</div>

<svg class="abs" id="cur" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7 16.5 L10.5 24 L14 22.5 L10.5 15 L17 15 Z" fill="#1c1e23" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
<script>
const E = ${JSON.stringify(E)};
const V = ${V}, W = ${w}, H = ${h};
const NEXT = ${JSON.stringify(next)}, BR = ${JSON.stringify([bx, by, bs])};
const $ = (id) => document.getElementById(id);
const cl = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => 1 - Math.pow(1 - cl(x), 3);
const inout = (x) => { x = cl(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const back = (x) => { x = cl(x); const c = 1.5; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const p = (t, a, b) => cl((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
function set(el, { x = 0, y = 0, s = 1, o = 1, r = 0, pre = '' }) { el.style.opacity = o; el.style.transform = pre + 'translate(' + x + 'px,' + y + 'px) scale(' + s + ') rotate(' + r + 'deg)'; }
const C = E.cuts;
// a scene element: in at a, out over the last 0.25s before b
function scene(el, t, a, b, { dy = 40, dx = 0, d = .4 } = {}) {
  const i = ease(p(t, a, a + d)), o = inout(p(t, b - .25, b));
  set(el, { x: (1 - i) * dx, y: (1 - i) * dy - o * 30, o: i * (1 - o) });
}
const show = (el, t, a, d = .2) => { const q = ease(p(t, a, a + d)); el.style.opacity = q; el.style.transform = 'translateY(' + (1 - q) * 12 + 'px)'; };
const type = (el, t, a, b) => { el.style.width = Math.floor(el.textContent.length * p(t, a, b)) + 'ch'; };

// canvas boxes (fractions of the canvas): hand-drawn layout, then the AI mess
const cv = $('canvas'), CW = cv.offsetWidth, CH = cv.offsetHeight, BW = ${Y.box[0]}, BH = ${Y.box[1]};
const P1 = V ? [[.08, .16], [.55, .16], [.55, .62], [.08, .62]] : [[.08, .2], [.4, .2], [.72, .2], [.4, .66]];
const P1s = V ? [[.08, .16], [.40, .86], [.55, .62], [.70, .40]] : [[.08, .2], [.62, .80], [.72, .2], [.10, .86]];
const P2 = V ? [[.18, .36], [.30, .41], [.44, .47], [.12, .74]] : [[.26, .36], [.35, .42], [.46, .47], [.18, .74]];
const R2 = [-5, 7, -3, 3];
const WIRES1 = [[0, 1], [1, 2], [1, 3]];
const DANGLE = V ? [.88, .14] : [.9, .16];
const boxes = [0, 1, 2, 3].map((i) => $('rb' + i));
const wires = [...document.querySelectorAll('.wire')];
wires.forEach((w) => { w.setAttribute('fill', 'none'); w.setAttribute('stroke', '#8f8b80'); w.setAttribute('stroke-width', '2.5'); w.setAttribute('marker-end', 'url(#ah)'); });
const center = (q) => [q[0] * CW + BW / 2, q[1] * CH + BH / 2];
function edgePt(from, to) { // where the line from a box centre to a point leaves the box
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const k = Math.min(Math.abs((BW / 2 + 6) / (dx || 1e-6)), Math.abs((BH / 2 + 6) / (dy || 1e-6)));
  return [from[0] + dx * k, from[1] + dy * k];
}

const tbg = document.querySelector('#tb svg > g');
{ const bb = tbg.getBBox(), m = tbg.transform.baseVal.consolidate(), ox = m ? m.matrix.e : 0, oy = m ? m.matrix.f : 0, pad = 24; tbg.ownerSVGElement.setAttribute('viewBox', (bb.x + ox - pad) + ' ' + (bb.y + oy - pad) + ' ' + (bb.width + pad * 2) + ' ' + (bb.height + pad * 2)); }
const kids = [...tbg.children];
const tEdges = kids.filter((k) => k.tagName === 'path');
const tCards = kids.filter((k) => k.tagName === 'g' && k.querySelector('rect[width="220"]'));
const tLabels = kids.filter((k) => k.tagName === 'g' && !k.querySelector('rect[width="220"]'));
const cardBase = tCards.map((c) => c.getAttribute('transform') || '');
tEdges.forEach((e) => { e.dataset.l = e.getTotalLength(); e.style.strokeDasharray = e.dataset.l; });
const jClips = [...document.querySelectorAll('#json .ln .clip')];
const offs = []; let acc = 0; for (const c of jClips) { offs.push(acc); acc += +c.dataset.n + 3; }

window.render = function (t) {
  $('grid').style.transform = 'translate(' + (-t * 6) + 'px,' + (-t * 3) + 'px)';
  let cursor = null; // [x, y, pressed, opacity]

  // ---- 1-2: the pain (canvas shared by both)
  scene($('cap0'), t, 0, C[1], { dy: 30 });
  show($('stale'), t, E.stale);
  scene($('cap1'), t, C[1], C[2], { dy: 0, d: .01 });
  show($('w-ai'), t, E.ai); show($('w-ov'), t, E.overlap); show($('w-nw'), t, E.nowhere);
  {
    const i = ease(p(t, 0, .45)), out = inout(p(t, C[2] - .3, C[2]));
    set(cv, { y: (1 - i) * 50, s: 1 - out * .08, o: i * (1 - out) });
    const mess = inout(p(t, C[1], C[1] + .5));
    const pos = P1.map((q, k) => {
      let a = q;
      if (k === 1) a = [lerp(P1s[1][0], q[0], inout(p(t, .6, E.drags[0] || 1.5))), lerp(P1s[1][1], q[1], inout(p(t, .6, E.drags[0] || 1.5)))];
      if (k === 3) a = [lerp(P1s[3][0], q[0], inout(p(t, 2.6, E.drags[1] || 3.5))), lerp(P1s[3][1], q[1], inout(p(t, 2.6, E.drags[1] || 3.5)))];
      return [lerp(a[0], P2[k][0], mess), lerp(a[1], P2[k][1], mess)];
    });
    boxes.forEach((b, k) => { b.style.transform = 'translate(' + pos[k][0] * CW + 'px,' + pos[k][1] * CH + 'px) rotate(' + R2[k] * mess + 'deg)'; });
    // wires: tidy edges while drawing; in the mess one edge dangles and one crosses
    const ends = mess < .5 ? WIRES1.map(([a, b]) => [center(pos[a]), center(pos[b])]) : [[center(pos[0]), center(pos[1])], [center(pos[1]), [DANGLE[0] * CW, DANGLE[1] * CH]], [center(pos[2]), center(pos[3])]];
    const wo = mess < .5 ? 1 - mess * 2 : (mess - .5) * 2;
    wires.forEach((wEl, k) => {
      const [a, b] = ends[k], s = edgePt(a, b), e2 = k === 1 && mess >= .5 ? b : edgePt(b, a);
      const mx = (s[0] + e2[0]) / 2 + (mess >= .5 ? 40 : 10), my = (s[1] + e2[1]) / 2 - (mess >= .5 ? 30 : 8);
      wEl.setAttribute('d', 'M' + s[0] + ' ' + s[1] + ' Q' + mx + ' ' + my + ' ' + e2[0] + ' ' + e2[1]);
      wEl.setAttribute('opacity', wo * (t > .3 ? 1 : 0));
    });
    // the clock runs while drawing by hand
    const mins = 9 * 60 + Math.floor(p(t, 0, C[1]) * 7.5 * 60 / 15) * 15;
    const hh = Math.floor(mins / 60), mm = mins % 60;
    $('clockT').textContent = (hh > 12 ? hh - 12 : hh) + ':' + String(mm).padStart(2, '0') + (hh >= 12 ? ' PM' : ' AM');
    $('hh').setAttribute('transform', 'rotate(' + (hh % 12 + mm / 60) * 30 + ' 12 12)');
    $('mh').setAttribute('transform', 'rotate(' + mm * 6 + ' 12 12)');
    $('clock').style.opacity = 1 - mess; $('aitag').style.opacity = mess;
    // red marks: the overlap, then the arrow to nowhere
    const ov = center(pos[1]), mk = [[ov[0] - 20, ov[1] - 10], [DANGLE[0] * CW, DANGLE[1] * CH]];
    [E.overlap, E.nowhere].forEach((a, k) => { const q = p(t, a, a + .3); set($('m' + k), { x: mk[k][0] - ${V ? 55 : 48}, y: mk[k][1] - ${V ? 55 : 48}, s: .5 + .5 * back(q), o: ease(q) }); });
    // the hand-drawing cursor
    const r = cv.getBoundingClientRect();
    if (t > .4 && t < C[1]) {
      const k = t < 2.3 ? 1 : 3, b = boxes[k].getBoundingClientRect();
      const press = (t > .6 && t < (E.drags[0] || 1.5)) || (t > 2.6 && t < (E.drags[1] || 3.5));
      cursor = [b.left + b.width * .55, b.top + b.height * .6, press ? 1 : 0, ease(p(t, .4, .6)) * (1 - p(t, C[1] - .3, C[1]))];
    }
  }

  // ---- 3: meet Yantra
  {
    const q = p(t, C[2], C[2] + .5), out = inout(p(t, C[3] - .25, C[3]));
    set($('meet'), { s: .8 + .2 * back(q), o: ease(q) * (1 - out), y: -out * 30 });
    const q2 = ease(p(t, E.meetSub, E.meetSub + .35));
    set($('meetSub'), { y: (1 - q2) * 24 - out * 30, o: q2 * (1 - out) });
  }

  // ---- 4: describe it, Yantra draws it
  scene($('cap3'), t, C[3], C[4], { dy: 30 });
  scene($('json'), t, C[3], C[4], { dx: V ? 0 : -60, dy: V ? 50 : 0 });
  type($('ask'), t, E.prompt[0], E.prompt[1]);
  { const typed = acc * p(t, E.json[0], E.json[1]); jClips.forEach((c, i) => { c.style.width = Math.max(0, Math.min(+c.dataset.n, Math.floor(typed - offs[i]))) + 'ch'; }); }
  {
    const out = inout(p(t, C[4] - .25, C[4]));
    set($('tb'), { y: -out * 30, o: (t >= C[3] ? 1 : 0) * (1 - out) });
    E.pops.forEach((a, k) => { if (!tCards[k]) return; const q = p(t, a, a + .38); tCards[k].setAttribute('transform', cardBase[k] + ' translate(110 50) scale(' + (.6 + .4 * back(q)) + ') translate(-110 -50)'); tCards[k].setAttribute('opacity', ease(q * 1.6)); });
    E.edges.forEach((a, k) => { if (!tEdges[k]) return; const q = inout(p(t, a, a + .35)); tEdges[k].style.strokeDashoffset = (1 - q) * tEdges[k].dataset.l; tEdges[k].setAttribute('opacity', q > 0 ? 1 : 0); if (tLabels[k]) tLabels[k].setAttribute('opacity', ease(p(t, a + .25, a + .5))); });
  }

  // ---- 5: checked
  scene($('cap4'), t, C[4], C[5], { dy: 30 });
  scene($('ed'), t, C[4], C[5], { dx: V ? 0 : -60 });
  scene($('term'), t, C[4] + .1, C[5], { dx: V ? 0 : 60 });
  show($('t0'), t, E.cmd[0], .1); type($('c0'), t, E.cmd[0], E.cmd[1]);
  show($('t1'), t, E.err); show($('t2'), t, E.err);
  const flagged = t >= E.err && t < E.fix;
  $('bad').style.setProperty('--sq', flagged ? 1 : 0); $('bad').style.color = flagged ? 'var(--red)' : '';
  $('bx').style.display = t >= E.fix ? 'none' : 'inline';
  show($('t3'), t, E.fix); show($('t4'), t, E.rerun[0], .1); type($('c1'), t, E.rerun[0], E.rerun[1]); show($('t5'), t, E.ok);

  // ---- 6: step through it
  scene($('cap5'), t, C[5], C[6], { dy: 30 });
  {
    const i = ease(p(t, C[5], C[5] + .45)), out = inout(p(t, C[6] - .28, C[6]));
    set($('browser'), { y: (1 - i) * 120 - out * 40, s: (1 + .02 * p(t, C[5], C[6])) * (.96 + .04 * i), o: i * (1 - out) });
    const [k1, k2] = E.clicks;
    $('b0').style.opacity = 1 - p(t, k1 + .02, k1 + .1);
    $('b1').style.opacity = t < k2 + .02 ? p(t, k1 + .1, k1 + .24) : 1 - p(t, k2 + .02, k2 + .1);
    $('b2').style.opacity = p(t, k2 + .1, k2 + .24);
    if (t > C[5] + .2 && t < C[6]) {
      const n = t < k1 + .3 ? NEXT[0] : NEXT[1];
      const tx = BR[0] + n.x * BR[2], ty = BR[1] + n.y * BR[2];
      const m = inout(p(t, C[5] + .3, k1 - .1));
      const press = Math.abs(t - k1) < .08 || Math.abs(t - k2) < .08;
      cursor = [lerp(W * .82, tx, m), lerp(H * .7, ty, m), press ? 1 : 0, p(t, C[5] + .2, C[5] + .35) * (1 - p(t, C[6] - .3, C[6]))];
    }
    const rq = Math.max(t >= k1 && t < k1 + .45 ? p(t, k1, k1 + .45) : 0, t >= k2 && t < k2 + .45 ? p(t, k2, k2 + .45) : 0);
    const n = t < k2 ? NEXT[0] : NEXT[1];
    set($('ring'), { x: BR[0] + n.x * BR[2] - 35, y: BR[1] + n.y * BR[2] - 35, s: .4 + rq * 1.1, o: rq > 0 ? (1 - rq) * .9 : 0 });
  }

  // ---- 7: every shape
  scene($('cap6'), t, C[6], C[7], { dy: 0, d: .01 });
  E.shapes.forEach((a, k) => { show($('s' + k), t, a); });
  ${V ? `const SH = [[240, 560], [240, 990], [240, 1420]], SW = 600;` : `const SH = [[75, 360], [680, 360], [1285, 360]], SW = 560;`}
  E.shapes.forEach((a, k) => { const el = $('sh' + k); el.style.left = SH[k][0] + 'px'; el.style.top = SH[k][1] + 'px'; el.style.width = SW + 'px'; const q = p(t, a, a + .4), out = inout(p(t, C[7] - .25, C[7])); set(el, { y: (1 - ease(q)) * 50 - out * 30, s: .9 + .1 * back(q), o: ease(q) * (1 - out) }); });

  // ---- 8: use cases
  ${V ? `const UP = [[220, 250], [220, 760], [220, 1270]], UW = 640;` : `const UP = [[105, 300], [690, 300], [1275, 300]], UW = 540;`}
  E.uses.forEach((a, k) => { const el = $('u' + k); el.style.left = UP[k][0] + 'px'; el.style.top = UP[k][1] + 'px'; el.style.width = UW + 'px'; const q = p(t, a - .05, a + .35), out = inout(p(t, C[8] - .25, C[8])); set(el, { y: (1 - ease(q)) * 50 - out * 30, s: .92 + .08 * back(q), o: ease(q) * (1 - out) }); });

  // ---- 9: share it anywhere
  scene($('cap8'), t, C[8], C[9], { dy: 30 });
  scene($('file'), t, E.file, C[9], { dy: 50 });
  $('dk').style.clipPath = 'inset(0 0 0 ' + (100 - 100 * inout(p(t, E.wipe[0], E.wipe[1]))) + '%)';
  E.chips.forEach((a, k) => { const q = p(t, a, a + .3), out = inout(p(t, C[9] - .25, C[9])); set($('ch' + k), { y: (1 - ease(q)) * 20, s: .8 + .2 * back(q), o: ease(q) * (1 - out) }); });

  // ---- 10: the ending
  {
    const q = p(t, E.lockup, E.lockup + .5);
    set($('olock'), { y: (1 - ease(q)) * 40, s: .85 + .15 * back(q), o: ease(q) });
    $('tag').style.opacity = 1;
    const spans = $('tag').children;
    E.tag.forEach((a, k) => { const q2 = p(t, a - .05, a + .3); set(spans[k], { y: (1 - ease(q2)) * 30, s: .94 + .06 * back(q2), o: ease(q2) }); });
    const b = ease(p(t, E.cta[0], E.cta[0] + .4));
    set($('cmd'), { y: (1 - b) * 30, o: b, pre: 'translateX(-50%) ' });
    type($('c2'), t, E.cta[0] + .1, E.cta[0] + .6);
    const c2 = ease(p(t, E.cta[1], E.cta[1] + .4));
    set($('tools'), { y: (1 - c2) * 20, o: c2 }); set($('url'), { y: (1 - c2) * 20, o: c2 });
  }

  if (cursor) set($('cur'), { x: cursor[0] - 6, y: cursor[1] - 4, s: 1 - cursor[2] * .15, o: cursor[3] }); else $('cur').style.opacity = 0;
};
window.ready = Promise.all([document.fonts.ready, ...[...document.images].map((im) => im.decode().catch(() => {}))]);
window.render(0);
</script></body></html>`;
  fs.writeFileSync(path.join(work, `scene-${format}.html`), html);
}
