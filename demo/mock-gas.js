// ============================================================
// LOKÁLNE DEMO – simuluje Apps Script server (google.script.run)
// pre skutočné stránky aplikácie (paywall.html, webapp.html).
// Všetko sa ukladá len do localStorage tohto prehliadača.
// Rovnaké funkcie a správanie ako Access.gs + Web.gs v testovacom režime.
// ============================================================
(function () {
  var KEY = 'gscfetch_local_demo_v1';
  var APP_URL = 'app.html';
  var SWITCH_URL = 'login.html?mode=login&logout=1';
  var SUPPORT = 'analytics@ui42.com';
  // Rovnaké ako PLANS v gsc-web-app/Access.gs.
  var PLANS = {
    starter: { name: 'Starter', priceMonthly: 9.99, priceYearly: 99, desc: 'Na občasné exporty a menšie weby',
      maxTargets: 3, maxRows: 25000, auto: false,
      features: ['Až 3 tabuľky', 'Pozície, queries aj queries + URL', 'Fetch ručne, kedykoľvek', 'Do 25 000 riadkov na fetch', 'Filter jazykových verzií'] },
    pro: { name: 'Pro', priceMonthly: 19.99, priceYearly: 199, desc: 'Pre pravidelný mesačný reporting',
      maxTargets: null, maxRows: 50000, auto: true, featured: true,
      features: ['Všetko zo Starter', 'Mesačný monitoring – auto-fetch 1. deň v mesiaci', 'Neobmedzené tabuľky', 'Až 50 000 riadkov na fetch', 'Prioritná podpora'] }
  };
  // Rovnaké ako LIFETIME_OFFER v Access.gs.
  var LIFETIME = { enabled: true, plan: 'pro', price: 499, endsAt: '2026-11-30T23:59:59+01:00', maxSeats: 100 };
  var LIFETIME_UNTIL = Date.UTC(2100, 0, 1);
  function lifetimeOffer() {
    var endsAt = new Date(LIFETIME.endsAt).getTime();
    var remaining = Math.max(0, LIFETIME.maxSeats - (db().lifetimeSold || 0));
    return { active: LIFETIME.enabled && Date.now() < endsAt && remaining > 0, plan: LIFETIME.plan, planName: PLANS[LIFETIME.plan].name,
      price: LIFETIME.price, endsAt: endsAt, maxSeats: LIFETIME.maxSeats, remaining: remaining, link: '' };
  }
  function planPrices(k) {
    return { key: k, name: PLANS[k].name, desc: PLANS[k].desc, priceMonthly: PLANS[k].priceMonthly, priceYearly: PLANS[k].priceYearly };
  }
  var LANG_MODES = ['all', 'clean', 'exclude', 'include'];
  var SITES = ['sc-domain:kellysbike.com', 'https://www.poniveni.sk/', 'sc-domain:ducplant.sk'];

  var memory = null;
  function db() {
    if (memory) return memory;
    try { memory = JSON.parse(localStorage.getItem(KEY)); } catch (e) { memory = null; }
    if (!memory || !memory.users) memory = { session: null, users: {} };
    return memory;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch (e) {} }
  function user() {
    var d = db();
    if (!d.session || !d.users[d.session]) throw new Error('Nie si prihlásený. Vráť sa na landing page a prihlás sa.');
    var u = d.users[d.session];
    u.targets = u.targets || []; u.billing = u.billing || {}; u.defaults = u.defaults || {}; u.payments = u.payments || [];
    return u;
  }
  function activeSub(u) { return u.sub && u.sub.until > Date.now() && PLANS[u.sub.plan] ? u.sub : null; }
  function requireAccess() {
    var u = user();
    var sub = activeSub(u);
    if (!sub) throw new Error('Nemáš aktívne predplatné. Obnov stránku a vyber si plán.');
    return { user: u, plan: PLANS[sub.plan], sub: sub };
  }
  function priceFor(plan, period) {
    if (period === 'lifetime') return LIFETIME.price;
    return period === 'yearly' ? PLANS[plan].priceYearly : PLANS[plan].priceMonthly;
  }
  function requireChangeable(a) {
    if (a.sub.period === 'lifetime') throw new Error('Máš lifetime licenciu – platí navždy, netreba ju meniť ani rušiť.');
    return a;
  }
  function nextUntil(period) {
    var until = new Date();
    until.setMonth(until.getMonth() + (period === 'yearly' ? 12 : 1));
    return until.getTime();
  }
  function addPayment(u, plan, period, note) {
    u.payments.push({ date: Date.now(), plan: plan, planName: PLANS[plan].name, period: period,
      amount: Math.round(priceFor(plan, period) * 100) / 100, note: note || '' });
  }
  function cleanBilling(b) {
    var clean = {};
    ['name', 'company', 'vat', 'country', 'address'].forEach(function (f) { clean[f] = String((b && b[f]) || '').trim().slice(0, 120); });
    return clean;
  }
  function defaults(u) {
    var d = u.defaults;
    return { daysBack: d.daysBack || 30, rowLimit: d.rowLimit || 25000,
      langMode: LANG_MODES.indexOf(d.langMode) >= 0 ? d.langMode : 'all', langCodes: d.langCodes || [] };
  }
  function parseDays(v) {
    var n = parseInt(v, 10);
    if (isNaN(n) || n < 1 || n > 480) throw new Error('Počet dní musí byť číslo od 1 do 480.');
    return n;
  }
  function parseRows(v, plan) {
    var n = parseInt(String(v).replace(/\s/g, ''), 10);
    if (isNaN(n) || n < 1) throw new Error('Max riadkov musí byť kladné číslo.');
    if (n > plan.maxRows) {
      throw new Error('Tvoj plán ' + plan.name + ' umožňuje najviac ' + plan.maxRows + ' riadkov na fetch.' +
        (plan.maxRows < PLANS.pro.maxRows ? ' Pre viac prejdi na Pro.' : ''));
    }
    return n;
  }
  function parseCodes(v) {
    return String(v || '').toLowerCase().split(/[\s,;\/]+/)
      .filter(function (c, i, all) { return /^[a-z0-9-]{1,10}$/.test(c) && all.indexOf(c) === i; });
  }
  function state(u) {
    var sub = activeSub(u);
    var plan = PLANS[sub.plan];
    return {
      targets: u.targets,
      account: { email: u.email, name: u.name || '', plan: sub.plan, planName: plan.name, maxTargets: plan.maxTargets, maxRows: plan.maxRows, auto: plan.auto,
        source: 'demo', period: sub.period, until: sub.until, cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd, appUrl: APP_URL, switchAccountUrl: SWITCH_URL }
    };
  }
  function accountDetails() {
    var u = user();
    var sub = activeSub(u);
    return {
      email: u.email, name: u.name || u.billing.name || '', billing: u.billing, defaults: defaults(u),
      payments: u.payments.slice().reverse(),
      subscription: sub ? { plan: sub.plan, planName: PLANS[sub.plan].name, source: 'demo', period: sub.period, until: sub.until,
        cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd, price: priceFor(sub.plan, sub.period) } : null,
      demoPayments: true, portalUrl: '', switchAccountUrl: SWITCH_URL, appUrl: APP_URL, supportEmail: SUPPORT,
      plans: Object.keys(PLANS).map(planPrices)
    };
  }
  function filterLabel(t) {
    var codes = (t.langCodes || []).map(function (c) { return '/' + c + '/'; }).join(', ');
    if (t.langMode === 'clean') return ' | filter URL: iba bez jazykového prefixu';
    if (t.langMode === 'exclude' && codes) return ' | filter URL: bez ' + codes;
    if (t.langMode === 'include' && codes) return ' | filter URL: iba ' + codes;
    return '';
  }

  var handlers = {
    // ---- Access.gs: paywall ----
    getPaywallInfo: function () {
      var u = user();
      return {
        email: u.email, demoPayments: true, appUrl: APP_URL, switchAccountUrl: SWITCH_URL, supportEmail: SUPPORT,
        landingUrl: '../index.html', billing: u.billing, lifetime: lifetimeOffer(),
        plans: Object.keys(PLANS).map(function (key) {
          var p = PLANS[key];
          return { key: key, name: p.name, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly, desc: p.desc,
            featured: !!p.featured, features: p.features, links: { monthly: '', yearly: '' } };
        })
      };
    },
    simulatePayment: function (plan, period, billing) {
      if (!PLANS[plan]) throw new Error('Neznámy plán.');
      var u = user();
      var until;
      if (period === 'lifetime') {
        if (!lifetimeOffer().active) throw new Error('Zakladateľská lifetime ponuka už skončila alebo je vypredaná.');
        plan = LIFETIME.plan;
        until = LIFETIME_UNTIL;
        db().lifetimeSold = (db().lifetimeSold || 0) + 1;
      } else {
        period = period === 'yearly' ? 'yearly' : 'monthly';
        until = nextUntil(period);
      }
      u.sub = { plan: plan, period: period, until: until, paidAt: Date.now(), cancelAtPeriodEnd: false };
      u.billing = cleanBilling(billing);
      u.name = u.name || u.billing.name;
      addPayment(u, plan, period);
      save();
      return { planName: PLANS[plan].name, period: period, amount: priceFor(plan, period),
        until: period === 'lifetime' ? null : u.sub.until, appUrl: APP_URL };
    },
    recheckAccess: function () { return !!activeSub(user()); },

    // ---- Access.gs: účet ----
    getAccountDetails: function () { return accountDetails(); },
    updateProfile: function (name, billing) {
      var u = requireAccess().user;
      u.name = String(name || '').trim().slice(0, 100);
      u.billing = cleanBilling(billing);
      save();
      return accountDetails();
    },
    updateDefaults: function (d) {
      var a = requireAccess();
      var u = a.user;
      u.defaults = { daysBack: parseDays(d.daysBack), rowLimit: parseRows(d.rowLimit, a.plan),
        langMode: LANG_MODES.indexOf(d.langMode) >= 0 ? d.langMode : 'all', langCodes: parseCodes(d.langCodes) };
      save();
      return accountDetails();
    },
    changePlan: function (plan, period) {
      var a = requireChangeable(requireAccess());
      if (!PLANS[plan]) throw new Error('Neznámy plán.');
      period = period === 'yearly' ? 'yearly' : 'monthly';
      if (plan === a.sub.plan && period === a.sub.period) throw new Error('Tento plán už máš.');
      a.user.sub = { plan: plan, period: period, until: nextUntil(period), paidAt: Date.now(), cancelAtPeriodEnd: false };
      addPayment(a.user, plan, period, 'Zmena plánu');
      save();
      return accountDetails();
    },
    cancelSubscription: function () { var a = requireChangeable(requireAccess()); a.user.sub.cancelAtPeriodEnd = true; save(); return accountDetails(); },
    resumeSubscription: function () { var a = requireChangeable(requireAccess()); a.user.sub.cancelAtPeriodEnd = false; save(); return accountDetails(); },
    deleteAccount: function () {
      var d = db();
      delete d.users[d.session];
      d.session = null;
      save();
      return SWITCH_URL;
    },

    // ---- Web.gs ----
    getWebState: function () { return state(requireAccess().user); },
    listGscSites: function () { requireAccess(); return SITES.slice(); },
    addWebTarget: function (sheetUrl, siteUrl, daysBack) {
      var a = requireAccess();
      if (a.plan.maxTargets !== null && a.user.targets.length >= a.plan.maxTargets) {
        throw new Error('Plán ' + a.plan.name + ' má limit ' + a.plan.maxTargets + ' tabuľky. Pre viac tabuliek prejdi na Pro.');
      }
      sheetUrl = String(sheetUrl || '').trim();
      siteUrl = String(siteUrl || '').trim();
      if (!sheetUrl || !siteUrl) throw new Error('Vyplň URL tabuľky aj web.');
      if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(sheetUrl)) {
        throw new Error('Toto nevyzerá ako odkaz na Google tabuľku (https://docs.google.com/spreadsheets/d/...).');
      }
      var def = defaults(a.user);
      var site = siteUrl.replace(/^sc-domain:|^https?:\/\/(www\.)?|\/$/g, '');
      a.user.targets.push({ sheetUrl: sheetUrl, siteUrl: siteUrl, name: 'Tabuľka ' + (a.user.targets.length + 1) + ' – ' + site,
        daysBack: parseDays(daysBack), rowLimit: Math.min(def.rowLimit, a.plan.maxRows), langMode: def.langMode, langCodes: def.langCodes, auto: false });
      save();
      return state(a.user);
    },
    setWebTargetSettings: function (index, settings) {
      var a = requireAccess();
      var t = a.user.targets[index];
      if (!t) throw new Error('Tabuľka sa nenašla, obnov stránku.');
      t.daysBack = parseDays(settings.daysBack);
      t.rowLimit = parseRows(settings.rowLimit, a.plan);
      t.langMode = LANG_MODES.indexOf(settings.langMode) >= 0 ? settings.langMode : 'all';
      t.langCodes = parseCodes(settings.langCodes);
      save();
      return state(a.user);
    },
    removeWebTarget: function (index) {
      var a = requireAccess();
      a.user.targets.splice(index, 1);
      save();
      return state(a.user);
    },
    setWebTargetAuto: function (index, enabled) {
      var a = requireAccess();
      if (enabled && !a.plan.auto) throw new Error('Auto-fetch je dostupný od plánu Pro.');
      a.user.targets[index].auto = !!enabled;
      save();
      return state(a.user);
    },
    runWebTarget: function (index, action) {
      var a = requireAccess();
      var t = a.user.targets[index];
      if (!t) throw new Error('Tabuľka sa nenašla, obnov stránku.');
      if (action === 'positions') {
        return '✅ Fetch hotový – stĺpce D, E, F a G | KW: 84 | porovnanie: nie (prvé meranie)' + filterLabel(t) + '\n(lokálne demo – vymyslené dáta)';
      }
      var n = Math.min(t.rowLimit, a.plan.maxRows, action === 'allQueries' ? 18342 : 46210);
      var sheet = action === 'allQueries' ? 'GSC_queries' : 'GSC_queries_url';
      return '✅ Hotovo! Zapísaných ' + n.toLocaleString('sk-SK') + ' riadkov do sheetu ' + sheet +
        ' | posledných ' + t.daysBack + ' dní' + filterLabel(t) + '\n(lokálne demo – vymyslené dáta)';
    }
  };

  var SLOW = { simulatePayment: 1500, runWebTarget: 1300, changePlan: 700 };
  function runner() {
    var onOk = null, onFail = null;
    var r = {
      withSuccessHandler: function (fn) { onOk = fn; return r; },
      withFailureHandler: function (fn) { onFail = fn; return r; }
    };
    Object.keys(handlers).forEach(function (name) {
      r[name] = function () {
        var args = arguments;
        setTimeout(function () {
          var result;
          try { result = handlers[name].apply(null, args); }
          catch (e) { if (onFail) onFail(e); return; }
          if (onOk) onOk(result);
        }, SLOW[name] || 200);
      };
    });
    return r;
  }
  window.google = { script: {} };
  Object.defineProperty(window.google.script, 'run', { get: runner });

  // Pomocné pre login.html a app.html
  window.GSC_DEMO = {
    login: function (name, email) {
      var d = db();
      email = String(email).trim().toLowerCase();
      if (!d.users[email]) d.users[email] = { name: name, email: email, targets: [], billing: { name: name }, defaults: {}, payments: [] };
      d.session = email;
      save();
    },
    logout: function () { db().session = null; save(); },
    reset: function () { memory = { session: null, users: {} }; save(); },
    status: function () {
      var d = db();
      var u = d.session ? d.users[d.session] : null;
      return { loggedIn: !!u, active: !!(u && activeSub(u)), email: u ? u.email : '' };
    }
  };
})();
