/**
 * Optional website analytics: one Google Tag Manager container (GA4 and Microsoft Clarity
 * are tags inside it), set at build time by YANTRA_SITE_GTM_ID (a repository variable in
 * pages.yml). Unset: nothing is written. Never part of built diagram files or the viewer.
 *
 * Consent Mode v2: every storage type starts denied; a banner asks once and the choice is
 * kept in localStorage ('yantra:consent'). Accepting pushes the 'yantra_consent' event, so
 * tags that require analytics_storage can fire on the same page view.
 */

const CONSENT_KEY = 'yantra:consent';

/** The container id when it is well formed, otherwise null. */
export function gtmId() {
  const id = process.env.YANTRA_SITE_GTM_ID?.trim().toUpperCase();
  return id && /^GTM-[A-Z0-9]{4,12}$/.test(id) ? id : null;
}

// Consent defaults and the banner, before GTM loads. Rejecting later also clears the GA4 and Clarity cookies.
const CONSENT_SCRIPT = `(function(){var w=window,d=document,K='${CONSENT_KEY}';w.dataLayer=w.dataLayer||[];function g(){w.dataLayer.push(arguments)}w.gtag=w.gtag||g;
w.clarity=w.clarity||function(){(w.clarity.q=w.clarity.q||[]).push(arguments)};
var c=null;try{c=localStorage.getItem(K)}catch(e){}
g('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'granted',security_storage:'granted',wait_for_update:500});
function apply(v,ev){var on=v==='granted';g('consent','update',{analytics_storage:on?'granted':'denied'});w.clarity('consentv2',{ad_Storage:'denied',analytics_Storage:on?'granted':'denied'});
if(!on){w.clarity('consent',false);d.cookie.split(';').forEach(function(k){var n=k.split('=')[0].trim();if(/^(_ga|_gid|_clck|_clsk)/.test(n)){var h=location.hostname.split('.');for(var i=0;i<h.length-1;i++)d.cookie=n+'=;Max-Age=0;path=/;domain=.'+h.slice(i).join('.');d.cookie=n+'=;Max-Age=0;path=/'}})}
if(ev)w.dataLayer.push({event:'yantra_consent',analytics_consent:v})}
if(c==='granted'||c==='denied')apply(c,false);
function ask(){var o=d.getElementById('consent');if(o){o.hidden=false;return}var b=d.createElement('div');b.id='consent';b.className='consent';b.setAttribute('role','region');b.setAttribute('aria-label','Cookie choice');
b.innerHTML='<p>May we use analytics cookies (Google Analytics and Microsoft Clarity) to see how the site is used? Diagrams you build or paste are never sent.</p><div class="consent-btns"><button type="button" data-v="denied">Reject</button><button type="button" data-v="granted">Accept</button></div>';
var s=d.createElement('style');s.textContent='.consent{position:fixed;z-index:1000;left:16px;right:16px;bottom:16px;max-width:560px;margin:0 auto;padding:14px 16px;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;font:14px/1.45 var(--y-font-sans,system-ui,sans-serif);color:var(--y-ink,#1c1e23);background:var(--y-surface,#fff);border:1px solid var(--y-border-strong,#c4c1b8);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18)}.consent p{margin:0;flex:1 1 260px}.consent-btns{display:flex;gap:8px}.consent button{font:inherit;padding:7px 14px;border-radius:7px;cursor:pointer;border:1px solid var(--y-border-strong,#c4c1b8);background:var(--y-surface-2,#f1f0ec);color:inherit}.consent button[data-v=granted]{background:var(--y-accent,#2f5bd3);border-color:var(--y-accent,#2f5bd3);color:var(--y-accent-ink,#fff)}.consent button:focus-visible{outline:2px solid var(--y-accent,#2f5bd3);outline-offset:2px}';
b.appendChild(s);b.addEventListener('click',function(e){var v=e.target.getAttribute&&e.target.getAttribute('data-v');if(!v)return;try{localStorage.setItem(K,v)}catch(x){}apply(v,true);b.hidden=true});d.body.appendChild(b)}
w.yantraConsent=ask;
if(c!=='granted'&&c!=='denied'){if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',ask);else ask()}
d.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-consent-open]');if(t){e.preventDefault();ask()}})})()`;

/** Head tags: consent defaults and the banner, then the GTM loader. Empty when off. */
export function analyticsHead() {
  const id = gtmId();
  if (!id) return '';
  return `<script>${CONSENT_SCRIPT}</script>
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f)})(window,document,'script','dataLayer','${id}')</script>
`;
}

/** The "Cookie settings" control for the footer. Empty when off. */
export function consentLink() {
  return gtmId() ? '<button class="footer-consent" type="button" data-consent-open>Cookie settings</button>' : '';
}
