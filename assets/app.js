/* Saveforex — shared interactions */
(function () {
  var d = document, root = d.documentElement;

  function revealAll() {
    d.querySelectorAll('.rv').forEach(function (e) { e.classList.add('in'); });
  }

  // Reveal-on-scroll. Switch on the hidden initial state only once we KNOW JS is
  // running; if anything below throws, fall back to showing everything.
  try {
    root.classList.add('js-anim');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    d.querySelectorAll('.rv').forEach(function (el) { io.observe(el); });

    window.addEventListener('load', function () {
      d.querySelectorAll('.hero .rv, .subhero .rv').forEach(function (el) { el.classList.add('in'); });
      setTimeout(function () { if (!d.querySelector('.rv.in')) revealAll(); }, 1200);
    });
  } catch (err) {
    root.classList.remove('js-anim');
    revealAll();
  }

  // header scroll state
  var header = d.getElementById('header');
  if (header) {
    window.addEventListener('scroll', function () {
      header.classList.toggle('scrolled', window.scrollY > 30);
    });
  }

  // mobile menu
  var mb = d.getElementById('menuBtn');
  var nl = d.getElementById('navlinks');
  if (mb && nl) {
    mb.addEventListener('click', function () { nl.classList.toggle('open'); });
    nl.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { nl.classList.remove('open'); });
    });
  }

  // (ticker ora è gestito dal widget TradingView live)

  // contact form -> Cloudflare Pages Function (/api/contact)
  var form = d.getElementById('contactForm');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = d.getElementById('formMsg');
      var btn = d.getElementById('sendBtn');
      var data = Object.fromEntries(new FormData(form).entries());
      if (data.website) { return; } // honeypot
      msg.className = 'form-msg';
      msg.textContent = 'Invio in corso…';
      if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(function (r) {
        if (r.ok) {
          form.reset();
          msg.className = 'form-msg ok';
          msg.textContent = '✓ Richiesta inviata. Ti risponderemo al più presto.';
        } else { throw new Error('bad status'); }
      }).catch(function () {
        msg.className = 'form-msg err';
        msg.innerHTML = 'Invio non riuscito. Scrivici a <a href="mailto:berlinzani@saveforex.it" style="color:var(--gold-bright)">berlinzani@saveforex.it</a>.';
      }).finally(function () {
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
      });
    });
  }
})();

/* ============================================================
   Cookie consent banner (Garante 2021 compliant)
   - Senza consenso: solo cookie e strumenti tecnici
   - Accetta / Rifiuta con pari evidenza; "X" = rifiuta
   - Scelta memorizzata 6 mesi; riapribile da "Preferenze cookie"
   - Contenuti di terze parti: si caricano SOLO con consenso esplicito.
     Oggi: le quotazioni TradingView (window.sfConsent.tradingview === true).
     Il consenso si dà dal banner ("Accetta") o dal segnaposto ("Carica quotazioni live").
     Rifiutare dopo aver accettato ricarica la pagina: nessuna terza parte resta attiva.
   - Predisposto per categorie non tecniche (analytics/marketing) future:
     leggere window.sfConsent.analytics === true prima di attivarle
   ============================================================ */
(function () {
  var KEY = 'sf_cookie_consent';
  var MAXAGE_DAYS = 180; // 6 mesi

  function readConsent() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.ts) return null;
      var ageDays = (Date.now() - o.ts) / 86400000;
      if (ageDays > MAXAGE_DAYS) return null; // scaduto: richiedi di nuovo
      return o;
    } catch (e) { return null; }
  }

  function saveConsent(obj, keepTs) {
    obj.ts = keepTs || Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (e) {}
    window.sfConsent = obj;
    // Punto di aggancio per script non tecnici futuri:
    if (obj.analytics === true && typeof window.sfEnableAnalytics === 'function') {
      try { window.sfEnableAnalytics(); } catch (e) {}
    }
    applyTradingView();
  }

  /* ---------- Quotazioni TradingView (terza parte) ---------- */
  var TV_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js';
  var tvState = 'idle'; // idle | loading | ready | failed
  var tvTimer;

  function tvSetState(s) {
    tvState = s;
    var box = document.getElementById('tvTicker');
    if (!box) return;
    box.classList.remove('is-loading', 'is-ready', 'is-failed');
    if (s !== 'idle') box.classList.add('is-' + s);
    var btn = document.getElementById('tvLoad');
    if (btn) {
      btn.disabled = (s === 'loading');
      btn.textContent = s === 'loading' ? 'Caricamento…' : (s === 'failed' ? 'Riprova' : 'Carica quotazioni live');
    }
    var st = document.getElementById('tvStatus');
    if (st) st.textContent = s === 'failed' ? 'Quotazioni non raggiungibili al momento.' : '';
  }

  function loadTradingView() {
    if (tvState === 'loading' || tvState === 'ready') return;
    var box = document.getElementById('tvTicker');
    var host = box && box.querySelector('.tradingview-widget-container');
    var cfgEl = document.getElementById('tvConfig');
    var cfg = null;
    try { cfg = cfgEl && JSON.parse(cfgEl.textContent); } catch (e) {}
    if (!host || !cfg) return; // manca qualcosa: resta il segnaposto

    // eventuale tentativo precedente (dopo "Riprova")
    var old = host.querySelector('script');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var w = host.querySelector('.tradingview-widget-container__widget');
    if (w) w.innerHTML = '';
    tvSetState('loading');

    var finished = false, mo = null;
    function end(state) {
      if (finished) return;
      finished = true;
      clearTimeout(tvTimer);
      if (mo) mo.disconnect();
      tvSetState(state);
    }
    // il widget è pronto quando il suo iframe ha finito di caricare
    try {
      mo = new MutationObserver(function () {
        var f = host.querySelector('iframe');
        if (f) {
          mo.disconnect();
          f.addEventListener('load', function () { end('ready'); });
          setTimeout(function () { end('ready'); }, 3000);
        }
      });
      mo.observe(host, { childList: true, subtree: true });
    } catch (e) {}

    var s = document.createElement('script');
    s.type = 'text/javascript';
    s.src = TV_SRC;
    s.async = true;
    s.text = JSON.stringify(cfg); // il loader legge la configurazione dal testo dello script
    s.onerror = function () { end('failed'); };
    tvTimer = setTimeout(function () { end('failed'); }, 12000);
    host.appendChild(s);
  }

  function applyTradingView() {
    var c = window.sfConsent || {};
    if (c.tradingview === true) {
      loadTradingView();
    } else if (tvState === 'loading' || tvState === 'ready') {
      location.reload(); // consenso revocato: la pagina riparte senza terze parti
    }
  }

  // consenso dato dal solo segnaposto (senza passare da "Accetta")
  function grantTradingView() {
    var c = readConsent();
    var next = c || { technical: true, analytics: false, marketing: false };
    next.tradingview = true;
    next.choice = 'custom';
    saveConsent(next, c && c.ts); // non allunga la scadenza di una scelta già registrata
    closeBanner();                // la scelta è registrata: il banner ha assolto il suo scopo
  }

  /* ---------- Banner ---------- */
  var banner, overlay;

  function closeBanner() {
    var b = banner, o = overlay;
    banner = overlay = null;
    if (b) b.classList.remove('show');
    if (o) o.classList.remove('show');
    setTimeout(function () {
      if (b && b.parentNode) b.parentNode.removeChild(b);
      if (o && o.parentNode) o.parentNode.removeChild(o);
    }, 300);
  }

  function buildBanner() {
    overlay = document.createElement('div');
    overlay.className = 'cc-overlay';

    banner = document.createElement('div');
    banner.className = 'cc-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Informativa cookie');
    banner.innerHTML =
      '<button class="cc-x" aria-label="Rifiuta e chiudi" title="Rifiuta">×</button>' +
      '<div class="cc-body">' +
        '<h4>Rispettiamo la tua privacy</h4>' +
        '<p>Questo sito usa <b>cookie tecnici</b>, necessari al suo funzionamento e alla sicurezza. ' +
        'Con il tuo consenso mostra anche le <b>quotazioni in tempo reale di TradingView</b>, un servizio ' +
        'di terze parti che riceve il tuo indirizzo IP e l’indirizzo della pagina. ' +
        'Non usiamo cookie di profilazione. Puoi rifiutare: il sito funziona comunque. ' +
        'Maggiori informazioni nella <a href="cookie-policy.html">Cookie Policy</a> e nella ' +
        '<a href="privacy-policy.html">Privacy Policy</a>.</p>' +
      '</div>' +
      '<div class="cc-actions">' +
        '<button class="btn btn-solid cc-reject">Rifiuta</button>' +
        '<button class="btn btn-solid cc-accept">Accetta</button>' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.appendChild(banner);

    banner.querySelector('.cc-accept').addEventListener('click', function () {
      saveConsent({ technical: true, analytics: true, marketing: true, tradingview: true, choice: 'accept' });
      closeBanner();
    });
    // "Rifiuta" e "X" hanno lo stesso effetto: nessun consenso non-tecnico, nessuna terza parte
    function reject() {
      saveConsent({ technical: true, analytics: false, marketing: false, tradingview: false, choice: 'reject' });
      closeBanner();
    }
    banner.querySelector('.cc-reject').addEventListener('click', reject);
    banner.querySelector('.cc-x').addEventListener('click', reject);

    var b = banner, o = overlay;
    requestAnimationFrame(function () {
      b.classList.add('show');
      o.classList.add('show');
    });
  }

  // Espone un metodo per riaprire il banner dal footer ("Preferenze cookie")
  window.sfOpenCookiePrefs = function () {
    if (banner) return; // un banner è già aperto (uno in dissolvenza non conta)
    buildBanner();
  };

  document.addEventListener('DOMContentLoaded', function () {
    // link "Preferenze cookie" nel footer
    document.querySelectorAll('[data-cookie-prefs]').forEach(function (el) {
      el.addEventListener('click', function (e) { e.preventDefault(); window.sfOpenCookiePrefs(); });
    });

    // segnaposto delle quotazioni: il pulsante diventa visibile solo con JavaScript attivo
    var tvBtn = document.getElementById('tvLoad');
    if (tvBtn) {
      tvBtn.classList.add('is-on');
      tvBtn.addEventListener('click', function () {
        if (window.sfConsent && window.sfConsent.tradingview === true) loadTradingView(); // "Riprova"
        else grantTradingView();
      });
    }

    var c = readConsent();
    window.sfConsent = c || { technical: true, analytics: false, marketing: false };
    if (!c) {
      // Mostra il banner al primo accesso (o se scaduto)
      buildBanner();
    } else if (c.analytics === true && typeof window.sfEnableAnalytics === 'function') {
      try { window.sfEnableAnalytics(); } catch (e) {}
    }
    applyTradingView();
  });
})();
