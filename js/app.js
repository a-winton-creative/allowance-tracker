/* Kids Allowance Tracker: the page.
 *
 * How it fits together:
 *   - loadState() asks the back end for everything, then render() draws one
 *     half per kid. The last good answer is saved in this browser so the page
 *     can still show numbers when there's no signal.
 *   - Buttons open "sheets" (pop-ups) inside that kid's half. Anything that
 *     changes money asks for the parent PIN first (needPin).
 *   - Every change goes through save(), which sends it, redraws with the fresh
 *     numbers, and shows "Saved".
 */
(function () {
  'use strict';

  var CACHE_KEY = 'allowance.state.v1';
  var ACCOUNTS = ['Main', 'Charity', 'Savings'];
  var THEMES = ['Fire Dragon', 'Storm Dragon', 'Sea Dragon', 'Block World', 'Bird Field Guide', 'Kitty Café', 'Moon & Crows', 'Quest'];
  var THEME_ALIASES = { 'Dragons': 'Fire Dragon' }; // the original dragon theme's old name
  // little colour chips for the theme picker (from the approved designs)
  var THEME_CHIPS = {
    'Fire Dragon': ['#1a0508', '#ff6a2b', '#fff1e6'],
    'Storm Dragon': ['#121119', '#a174ff', '#f1ecff'],
    'Sea Dragon': ['#05191f', '#2fd1b0', '#e8fbf8'],
    'Block World': ['#123d4a', '#9be15d', '#ffffff'],
    'Bird Field Guide': ['#f4ecd8', '#3f5f31', '#2b3a22'],
    'Kitty Café': ['#ffd6e8', '#7a4cc2', '#3e1f66'],
    'Moon & Crows': ['#0b0d1c', '#e8e6d8', '#e6e9f7'],
    'Quest': ['#17224d', '#d4ab4f', '#f4e7c4']
  };

  var S = {
    data: null,        // latest state from the back end
    savedAt: null,     // when it arrived (ms)
    offline: false,
    sheets: {},        // kidId -> true while a pop-up is open in that half
    redrawLater: false
  };

  var app = document.getElementById('app');
  var statusEl = document.getElementById('status');

  // ===================================================================== helpers

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    n = Math.round(Number(n || 0) * 100) / 100;
    var s = '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < 0 ? '–' + s : s;
  }
  function parseMoney(v) {
    var n = Number(String(v || '').replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }
  function ymdToDate(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function niceDate(s) {
    if (!s) return '';
    return ymdToDate(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function shortDate(s) { return ymdToDate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  function monthLabel(s) { return ymdToDate(s).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function themeName(t) { t = THEME_ALIASES[t] || t; return window.THEME_ART[t] ? t : THEMES[0]; }
  function themeArt(t) { return window.THEME_ART[themeName(t)]; }
  function kidById(id) { return S.data.kids.filter(function (k) { return k.kidId === id; })[0]; }
  function halfEl(kidId) { return app.querySelector('.half[data-kid="' + kidId + '"]'); }
  function today() { return (S.data && S.data.today) || new Date().toISOString().slice(0, 10); }

  var ICONS = {
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
    cap: '<path d="M2 9l10-5 10 5-10 5-10-5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>',
    bag: '<path d="M6 7h12l1 14H5L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    slide: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13 7l4 4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="M21 5H9l-6 7 6 7h12V5z"/><path d="M17 9l-5 6M12 9l5 6"/>'
  };
  function icon(name, size, label) {
    var a = label ? 'role="img" aria-label="' + esc(label) + '"' : 'aria-hidden="true"';
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" ' + a + '>' + ICONS[name] + '</svg>';
  }
  var LOCK = function (s) { return icon('lock', s || 14, 'PIN required'); };

  /** Shrink text until it fits on one line (used for balances and names). */
  function fitText(el) {
    el.style.fontSize = '';
    var size = parseFloat(getComputedStyle(el).fontSize);
    var min = Math.max(14, size * 0.35);
    var guard = 60;
    while (el.scrollWidth > el.clientWidth + 1 && size > min && guard--) {
      size -= Math.max(1, size * 0.05);
      el.style.fontSize = size + 'px';
    }
  }
  function fitAll() { app.querySelectorAll('[data-fit]').forEach(fitText); }

  var statusTimer = null;
  function showStatus(text, ok, sticky) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (ok ? ' is-ok' : '');
    statusEl.hidden = false;
    clearTimeout(statusTimer);
    if (!sticky) statusTimer = setTimeout(function () { statusEl.hidden = true; renderOfflineNote(); }, 2200);
  }
  function renderOfflineNote() {
    document.body.classList.toggle('is-offline', S.offline);
    if (S.offline && S.savedAt) {
      var t = new Date(S.savedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      showStatus('Offline · last updated ' + t, false, true);
    } else if (!S.offline && statusEl.textContent.indexOf('Offline') === 0) {
      statusEl.hidden = true;
    }
  }

  // ===================================================================== loading + caching

  function loadCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && c.data && c.data.kids) { S.data = c.data; S.savedAt = c.savedAt; return true; }
    } catch (e) { /* no cache */ }
    return false;
  }
  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: S.data, savedAt: S.savedAt })); } catch (e) { /* ignore */ }
  }
  function setData(d) {
    S.data = d; S.savedAt = Date.now(); S.offline = false; saveCache();
  }

  var loading = false;
  function loadState() {
    if (loading) return;
    loading = true;
    Api.getState().then(function (d) {
      setData(d);
      render();
      renderOfflineNote();
    }).catch(function (err) {
      if (S.data) { S.offline = true; renderOfflineNote(); }
      else renderFatal(err);
    }).then(function () { loading = false; });
  }

  function renderFatal(err) {
    app.innerHTML = '<div class="fatal"><h1>Can’t connect right now</h1>' +
      '<p>' + esc(err && err.code === 'OFFLINE' ? 'This device can’t reach Google. Check the Wi-Fi or cell signal and try again.' : (err && err.message) || 'Something went wrong.') + '</p>' +
      '<button type="button" id="retry">Try again</button></div>';
    document.getElementById('retry').onclick = function () { app.innerHTML = loadingHtml(); loadState(); };
  }
  function loadingHtml() {
    return '<section class="half half--loading"><div class="shimmer"></div></section>' +
           '<section class="half half--loading"><div class="shimmer"></div></section>';
  }

  // ===================================================================== main screen

  function orderedKids() {
    return S.data.kids.slice().sort(function (a, b) {
      return (a.side === 'Right') - (b.side === 'Right');
    });
  }

  function render() {
    if (!S.data) return;
    if (Object.keys(S.sheets).some(function (k) { return S.sheets[k]; })) { S.redrawLater = true; return; }
    S.redrawLater = false;
    app.innerHTML = orderedKids().map(halfHtml).join('');
    Images.hydrate(app);
    var used = [];
    S.data.kids.forEach(function (k) { if (k.avatarFileId) used.push(k.avatarFileId); if (k.backgroundFileId) used.push(k.backgroundFileId); });
    Images.prune(used);
    fitAll();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
  }

  function halfHtml(k) {
    var art = themeArt(k.theme);
    var b = k.balances || { Main: 0, Charity: 0, Savings: 0 };
    var neg = b.Main < 0;
    var chores = (k.chores || []).length
      ? '<ul class="chores">' + k.chores.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>'
      : '<p class="chores-empty">No chores listed yet.</p>';
    var initial = esc((k.name || '?').charAt(0).toUpperCase());
    var back = k.backgroundFileId
      ? '<div class="art-back bg-photo" aria-hidden="true" data-bg-id="' + esc(k.backgroundFileId) + '"></div><div class="bg-tint" aria-hidden="true"></div>'
      : '<div class="art-back" aria-hidden="true"><svg viewBox="0 0 720 900" preserveAspectRatio="xMaxYMin slice">' + art.back + '</svg></div>';

    return '' +
    '<section class="half theme-' + art.slug + '" data-kid="' + esc(k.kidId) + '" aria-label="' + esc(k.name) + '">' +
      back +
      '<div class="content">' +
        '<header class="kid-head">' +
          '<div class="avatar" role="img" aria-label="' + esc(k.name) + '">' + initial + avatarImg(k) + '</div>' +
          '<h1 class="kid-name" data-fit>' + esc(k.name) + '</h1>' +
        '</header>' +
        '<div class="glass bal-card">' +
          '<div class="bal-top"><div class="lbl">Balance</div>' + (neg ? '<div class="below-zero">Below zero</div>' : '') + '</div>' +
          '<div class="num bal-num' + (neg ? ' is-neg' : '') + '" data-fit>' + money(b.Main) + '</div>' +
        '</div>' +
        '<div class="row2 row-main">' +
          '<div class="glass next-card">' +
            '<div class="lbl">Next allowance</div>' +
            '<div class="num next-amt" data-fit>' + money(k.perPay.Main) + '</div>' +
            '<div class="split"><div>+ ' + money(k.perPay.Charity) + ' Charity</div><div>+ ' + money(k.perPay.Savings) + ' Savings</div></div>' +
            '<div class="payday">' + icon('cal', 18) + ' ' + esc(niceDate(k.nextPayday)) + '</div>' +
          '</div>' +
          '<div class="glass chores-card"><div class="lbl">Chores</div>' + chores + '</div>' +
        '</div>' +
        '<div class="row2">' +
          miniCard('Charity', 'heart', b.Charity) +
          miniCard('Savings', 'cap', b.Savings) +
        '</div>' +
        '<div class="actions">' +
          '<button type="button" class="btn-primary" data-act="purchase" data-needs-net>' + icon('bag', 28) + ' Purchase ' + LOCK(18) + '</button>' +
          '<div class="btn-row">' +
            '<button type="button" class="glass btn-glass" data-act="allowance" data-needs-net>' + icon('slide', 20) +
              '<span class="long">Edit Allowance ' + LOCK() + '</span><span class="short">Allowance ' + LOCK(11) + '</span></button>' +
            '<button type="button" class="glass btn-glass" data-act="kid" data-needs-net>' + icon('pen', 20) +
              '<span class="long">Edit Kid ' + LOCK() + '</span><span class="short">Edit Kid ' + LOCK(11) + '</span></button>' +
            '<button type="button" class="glass btn-glass" data-act="history" data-needs-net>' + icon('clock', 20) +
              '<span class="long">History</span><span class="short">History</span></button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="hero" aria-hidden="true"><svg viewBox="440 -20 280 380">' + art.front + '</svg></div>' +
      '<div class="sheet-host"></div>' +
    '</section>';
  }

  function avatarImg(k) {
    if (!k.avatarFileId) return '';
    var src = Images.peek(k.avatarFileId);
    return '<img alt="" data-img-id="' + esc(k.avatarFileId) + '"' + (src ? ' src="' + src + '"' : '') + '>';
  }

  function miniCard(name, ic, amt) {
    return '<div class="glass mini-card"><div class="lbl">' + icon(ic, 20) + ' ' + name + '</div>' +
      '<div class="num mini-amt' + (amt < 0 ? ' is-neg' : '') + '" data-fit>' + money(amt) + '</div></div>';
  }

  // ===================================================================== sheets (pop-ups)

  function openSheet(kidId, html, onMount) {
    var half = halfEl(kidId);
    if (!half) return;
    S.sheets[kidId] = true;
    var host = half.querySelector('.sheet-host');
    host.innerHTML = '<div class="sheet-backdrop"><div class="sheet" role="dialog" aria-modal="true"><div class="sheet-inner">' + html + '</div></div></div>';
    var sheet = host.querySelector('.sheet');
    Images.hydrate(sheet);
    host.querySelector('.sheet-backdrop').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) closeSheet(kidId);
    });
    sheet.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = function () { closeSheet(kidId); }; });
    if (onMount) onMount(sheet);
    var first = sheet.querySelector('[autofocus]') || sheet.querySelector('button, input, select');
    if (first && !matchMedia('(hover: none)').matches) first.focus();
    return sheet;
  }
  function closeSheet(kidId) {
    var half = halfEl(kidId);
    if (half) half.querySelector('.sheet-host').innerHTML = '';
    delete S.sheets[kidId];
    var btn = half && half.querySelector('[data-act]');
    if (S.redrawLater) render();
    else if (btn) btn.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') Object.keys(S.sheets).forEach(closeSheet);
  });

  function sheetHead(k, title, closeLabel) {
    return '<div class="sheet-head"><button type="button" class="link-btn" data-close>' + (closeLabel || 'Cancel') + '</button>' +
      '<h2>' + esc(title) + '</h2>' +
      '<div class="mini-avatar" role="img" aria-label="' + esc(k.name) + '">' + esc(k.name.charAt(0).toUpperCase()) + avatarImg(k) + '</div></div>';
  }

  // ---- PIN

  /** Run `then` once a parent has unlocked this device (asks for the PIN if needed). */
  function needPin(kidId, then, why) {
    if (Api.isUnlocked()) return then();
    openPin(kidId, then, why);
  }

  function openPin(kidId, then, why) {
    var k = kidById(kidId);
    var digits = '';
    var busy = false;
    var keys = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) {
      return '<button type="button" class="glass" data-key="' + n + '">' + n + '</button>';
    }).join('') + '<div></div><button type="button" class="glass" data-key="0">0</button>' +
      '<button type="button" class="key-plain" data-key="del" aria-label="Delete last digit">' + icon('back', 30) + '</button>';

    var html = '<div class="sheet-head"><button type="button" class="link-btn" data-close>Cancel</button><span></span><span></span></div>' +
      '<div class="pin-wrap">' + icon('lock', 52) +
        '<h2>Parent PIN</h2>' +
        '<p class="pin-sub">' + esc(why || ('to make changes for ' + k.name)) + '</p>' +
        '<div class="pin-dots" aria-hidden="true">' + '<i></i><i></i><i></i><i></i><i></i><i></i>' + '</div>' +
        '<p class="pin-sub" data-msg aria-live="assertive">Stays unlocked for 10 minutes</p>' +
        '<div class="keypad">' + keys + '</div>' +
        '<input class="sr-only" data-pininput inputmode="numeric" autocomplete="off" aria-label="Parent PIN">' +
      '</div>';

    openSheet(kidId, html, function (sheet) {
      var dots = sheet.querySelectorAll('.pin-dots i');
      var msg = sheet.querySelector('[data-msg]');
      function paint() { dots.forEach(function (d, i) { d.classList.toggle('on', i < digits.length); }); }
      function press(key) {
        if (busy) return;
        if (key === 'del') digits = digits.slice(0, -1);
        else if (digits.length < 6) digits += key;
        paint();
        if (digits.length === 6) submit();
      }
      function submit() {
        busy = true;
        msg.textContent = 'Checking…';
        Api.unlock(digits).then(function () {
          closeSheet(kidId);
          then();
        }).catch(function (err) {
          busy = false;
          digits = '';
          paint();
          var box = sheet.querySelector('.pin-dots');
          box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
          msg.textContent = err.code === 'OFFLINE' ? 'Can’t reach Google. Try again.' : err.message;
        });
      }
      sheet.querySelectorAll('[data-key]').forEach(function (b) {
        b.onclick = function () { press(b.getAttribute('data-key')); };
      });
      sheet.addEventListener('keydown', function (e) {
        if (/^[0-9]$/.test(e.key)) { press(e.key); e.preventDefault(); }
        else if (e.key === 'Backspace') { press('del'); e.preventDefault(); }
      });
      sheet.tabIndex = -1;
      sheet.focus({ preventScroll: true });
    });
  }

  /** Send a change. Redraws with fresh numbers and says "Saved". */
  function save(kidId, sheet, action, payload, onDone, button) {
    var btn = button || sheet.querySelector('[data-submit]');
    var errs = sheet.querySelectorAll('.form-error');
    var err = errs.length ? errs[errs.length - 1] : null;
    if (button && sheet.querySelector('[data-imgerr]')) err = sheet.querySelector('[data-imgerr]');
    var label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = action === 'uploadImage' ? 'Uploading…' : 'Saving…'; }
    if (err) err.textContent = '';
    Api.write(action, payload).then(function (result) {
      if (onDone) return onDone(result);
      setData(result);
      closeSheet(kidId);
      render();
      showStatus('Saved', true);
    }).catch(function (e) {
      if (btn) { btn.disabled = false; btn.innerHTML = label; }
      if (e.code === 'LOCKED') {
        // the 10 minutes ran out: ask again, then retry the same change
        closeSheet(kidId);
        openPin(kidId, function () { reopenAfterPin(kidId, action, payload, onDone); }, 'The unlock ran out. Enter the PIN to finish saving.');
        return;
      }
      if (err) err.textContent = e.code === 'OFFLINE' ? 'Can’t reach Google. Nothing was saved. Try again.' : e.message;
    });
  }
  function reopenAfterPin(kidId, action, payload, onDone) {
    Api.write(action, payload).then(function (result) {
      if (onDone) { onDone(result); return; }
      setData(result); render(); showStatus('Saved', true);
    }).catch(function (e) { showStatus(e.message || 'Not saved'); });
  }

  // ---- Purchase / Add money

  function openMoney(kidId, mode, account) {
    var k = kidById(kidId);
    var isBuy = mode === 'purchase';
    var acct = account || 'Main';
    var html = sheetHead(k, isBuy ? 'Purchase' : 'Add money') +
      '<div><span class="field-lbl">' + (isBuy ? 'Take it from' : 'Put it in') + '</span><div class="acct-pick">' +
        ACCOUNTS.map(function (a) {
          return '<button type="button" data-acct="' + a + '" aria-pressed="' + (a === acct) + '"><b>' + a + '</b><span class="num">' + money(k.balances[a]) + '</span></button>';
        }).join('') + '</div></div>' +
      '<div><label class="field-lbl" for="m-amt">Amount</label>' +
        '<div class="amount-box"><span>$</span><input id="m-amt" inputmode="decimal" autocomplete="off" placeholder="0.00" autofocus></div></div>' +
      '<div><label class="field-lbl" for="m-note" data-notelbl></label><input id="m-note" class="field" maxlength="200" autocomplete="off"></div>' +
      '<div><label class="field-lbl" for="m-date">Date</label><input id="m-date" class="field" type="date" value="' + today() + '" max="' + today() + '"></div>' +
      '<div class="preview"><span data-prevlbl></span><span class="num" data-prev></span></div>' +
      '<p class="form-error" role="alert"></p>' +
      '<button type="button" class="btn-primary" data-submit disabled></button>';

    openSheet(kidId, html, function (sheet) {
      var amt = sheet.querySelector('#m-amt'), note = sheet.querySelector('#m-note'), date = sheet.querySelector('#m-date');
      var submit = sheet.querySelector('[data-submit]');
      function refresh() {
        sheet.querySelectorAll('[data-acct]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-acct') === acct); });
        sheet.querySelector('[data-notelbl]').textContent = isBuy
          ? (acct === 'Charity' ? 'Who did you give to?' : 'What did you buy?')
          : 'Where did it come from?';
        note.placeholder = isBuy ? (acct === 'Charity' ? 'e.g. Animal shelter' : 'e.g. Book fair') : 'e.g. Birthday money from Grandma';
        var n = parseMoney(amt.value);
        var ok = n > 0;
        var before = k.balances[acct];
        var after = Math.round((before + (isBuy ? -1 : 1) * (ok ? n : 0)) * 100) / 100;
        sheet.querySelector('[data-prevlbl]').textContent = acct + ' after this';
        sheet.querySelector('[data-prev]').textContent = money(before) + ' → ' + money(after);
        submit.textContent = ok ? (isBuy ? 'Take out ' : 'Add ') + money(n) : (isBuy ? 'Enter an amount' : 'Enter an amount');
        submit.disabled = !(ok && note.value.trim() && date.value);
      }
      sheet.querySelectorAll('[data-acct]').forEach(function (b) {
        b.onclick = function () { acct = b.getAttribute('data-acct'); refresh(); };
      });
      [amt, note, date].forEach(function (el) { el.addEventListener('input', refresh); });
      refresh();
      submit.onclick = function () {
        save(kidId, sheet, isBuy ? 'purchase' : 'deposit', {
          kid: kidId, account: acct, amount: parseMoney(amt.value), note: note.value.trim(), date: date.value
        });
      };
    });
  }

  // ---- Edit Allowance

  function openAllowance(kidId) {
    var k = kidById(kidId);
    var days = '';
    for (var d = 1; d <= 31; d++) days += '<option value="' + d + '"' + (d === k.payDay ? ' selected' : '') + '>' + ordinal(d) + '</option>';
    var rows = ACCOUNTS.map(function (a) {
      return '<b>' + a + '</b>' +
        '<input class="field num" inputmode="decimal" data-per="' + a + '" aria-label="' + a + ' each payday" value="' + k.perPay[a].toFixed(2) + '">' +
        '<input class="field num" inputmode="decimal" data-bal="' + a + '" aria-label="' + a + ' balance now" value="' + k.balances[a].toFixed(2) + '">';
    }).join('');

    var html = sheetHead(k, 'Edit Allowance') +
      '<div class="section"><label class="field-lbl" for="a-day" style="margin:0">Payday</label>' +
        '<div class="payday-row"><span>Day</span><select id="a-day" class="field">' + days + '</select><span>of every month</span></div>' +
        '<p class="hint">Next payday: ' + esc(niceDate(k.nextPayday)) + '. In short months it pays on the last day.</p></div>' +
      '<div class="section"><span class="field-lbl" style="margin:0">Accounts</span>' +
        '<div class="acct-table"><span></span><span class="sub">Each payday</span><span class="sub">Balance now</span>' + rows + '</div>' +
        '<p class="hint">Changing a balance here records an “Adjustment” in History, so there’s always a paper trail.</p></div>' +
      '<button type="button" class="dashed-btn" data-addmoney>' + icon('plus', 22) + ' Add money (gift, bonus, refund)</button>' +
      '<div class="section"><span class="field-lbl" style="margin:0">Chores</span><div data-chores></div>' +
        '<button type="button" class="add-btn" data-addchore>' + icon('plus', 18) + ' Add chore</button></div>' +
      '<p class="form-error" role="alert"></p>' +
      '<button type="button" class="btn-primary" data-submit>Save changes</button>';

    openSheet(kidId, html, function (sheet) {
      var list = sheet.querySelector('[data-chores]');
      function choreRow(text) {
        var row = document.createElement('div');
        row.className = 'chore-row';
        row.innerHTML = '<input class="field" maxlength="120" aria-label="Chore" value="' + esc(text) + '">' +
          '<button type="button" class="icon-btn" aria-label="Remove chore">' + icon('x', 18) + '</button>';
        row.querySelector('button').onclick = function () { row.remove(); };
        list.appendChild(row);
        return row;
      }
      (k.chores || []).forEach(choreRow);
      sheet.querySelector('[data-addchore]').onclick = function () { choreRow('').querySelector('input').focus(); };
      sheet.querySelector('[data-addmoney]').onclick = function () { closeSheet(kidId); openMoney(kidId, 'deposit'); };
      sheet.querySelectorAll('[data-bal]').forEach(function (inp) {
        inp.addEventListener('input', function () { inp.setAttribute('data-touched', '1'); });
      });

      sheet.querySelector('[data-submit]').onclick = function () {
        var err = sheet.querySelector('.form-error');
        var perPay = {}, balances = {}, bad = false;
        sheet.querySelectorAll('[data-per]').forEach(function (i) {
          var n = parseMoney(i.value); if (!(n >= 0)) bad = true; perPay[i.getAttribute('data-per')] = n;
        });
        // only send balances a parent actually changed, so we never undo a change made on another device
        sheet.querySelectorAll('[data-bal][data-touched]').forEach(function (i) {
          var n = parseMoney(i.value); if (isNaN(n)) bad = true; balances[i.getAttribute('data-bal')] = n;
        });
        if (bad) { err.textContent = 'Please check the amounts. Each one needs to be a number.'; return; }
        var chores = Array.prototype.map.call(list.querySelectorAll('input'), function (i) { return i.value.trim(); }).filter(Boolean);
        save(kidId, sheet, 'saveAllowance', {
          kid: kidId, payDay: +sheet.querySelector('#a-day').value, perPay: perPay, balances: balances, chores: chores
        });
      };
    });
  }

  // ---- Edit Kid (name, theme, photo, background)

  function openKid(kidId) {
    var k = kidById(kidId);
    var chosen = themeName(k.theme);
    var html = sheetHead(k, 'Edit Kid') +
      // photo
      '<div class="section" data-photo>' +
        '<span class="field-lbl" style="margin:0">Photo</span>' +
        '<div class="photo-row">' +
          '<div class="avatar photo-prev" aria-hidden="true">' + esc(k.name.charAt(0).toUpperCase()) + avatarImg(k) + '</div>' +
          '<div class="photo-btns">' +
            '<button type="button" class="small-btn" data-pick="avatar">Choose photo</button>' +
            (k.avatarFileId ? '<button type="button" class="small-btn ghost" data-remove="avatar">Remove photo</button>' : '') +
          '</div>' +
        '</div>' +
        '<p class="hint">JPG, PNG, iPhone photos or GIF. GIFs up to 5 MB keep their animation.</p>' +
      '</div>' +
      // background
      '<div class="section" data-bgsec>' +
        '<span class="field-lbl" style="margin:0">Background</span>' +
        '<div class="bg-prev' + (k.backgroundFileId ? '' : ' is-theme') + '"' + (k.backgroundFileId ? ' data-bg-id="' + esc(k.backgroundFileId) + '"' : '') + '>' +
          (k.backgroundFileId ? '' : '<span>Theme artwork</span>') + '</div>' +
        '<div class="photo-btns row">' +
          '<button type="button" class="small-btn" data-pick="background">Choose background</button>' +
          (k.backgroundFileId ? '<button type="button" class="small-btn ghost" data-remove="background">Use theme artwork</button>' : '') +
        '</div>' +
        '<p class="hint">Replaces the theme’s background art. The theme’s colors, cards and front artwork stay.</p>' +
      '</div>' +
      '<input type="file" accept="image/*" class="sr-only" data-file tabindex="-1" aria-hidden="true">' +
      '<p class="form-error" data-imgerr role="alert"></p>' +
      // name + theme
      '<div><label class="field-lbl" for="k-name">First name</label><input id="k-name" class="field" maxlength="30" value="' + esc(k.name) + '" autocomplete="off"></div>' +
      '<div><span class="field-lbl">Theme</span><div class="theme-grid">' +
        THEMES.map(function (t) {
          var c = THEME_CHIPS[t];
          return '<button type="button" class="theme-tile" data-theme="' + esc(t) + '" aria-pressed="' + (t === chosen) + '" ' +
            'style="background:' + c[0] + ';color:' + c[2] + '"><i style="background:' + c[1] + '"></i>' + esc(t) + '</button>';
        }).join('') + '</div></div>' +
      '<p class="form-error" role="alert"></p>' +
      '<button type="button" class="btn-primary" data-submit>Save name &amp; theme</button>';

    openSheet(kidId, html, function (sheet) {
      var fileInput = sheet.querySelector('[data-file]');
      var imgErr = sheet.querySelector('[data-imgerr]');
      var pickingKind = null;

      // after any photo change: keep the fresh numbers and redraw this sheet
      function afterImage(kind, previewUrl) {
        return function (state) {
          setData(state);
          S.redrawLater = true;   // redraw the main screen when this pop-up closes
          var fresh = kidById(kidId);
          var id = kind === 'avatar' ? fresh.avatarFileId : fresh.backgroundFileId;
          if (id && previewUrl) Images.remember(id, previewUrl);
          showStatus(kind === 'avatar' ? (id ? 'Photo saved' : 'Photo removed') : (id ? 'Background saved' : 'Theme artwork is back'), true);
          if (sheet.isConnected) { closeSheet(kidId); openKid(kidId); }
          else render();
        };
      }

      sheet.querySelectorAll('[data-pick]').forEach(function (b) {
        b.onclick = function () { pickingKind = b.getAttribute('data-pick'); imgErr.textContent = ''; fileInput.value = ''; fileInput.click(); };
      });
      sheet.querySelectorAll('[data-remove]').forEach(function (b) {
        b.onclick = function () {
          var kind = b.getAttribute('data-remove');
          save(kidId, sheet, 'removeImage', { kid: kidId, kind: kind }, afterImage(kind, null), b);
        };
      });

      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        var kind = pickingKind;
        var btn = sheet.querySelector('[data-pick="' + kind + '"]');
        function upload(prep) {
          save(kidId, sheet, 'uploadImage', { kid: kidId, kind: kind, mime: prep.mime, data: prep.data }, afterImage(kind, prep.previewUrl), btn);
        }
        function fail(e) { imgErr.textContent = e.message; }

        if (kind === 'background') {
          if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
          Images.prepareBackground(file).then(upload, function (e) { if (btn) { btn.disabled = false; btn.textContent = 'Choose background'; } fail(e); });
          return;
        }
        if (Images.isGif(file)) { Images.prepareGif(file).then(upload, fail); return; }

        // still photo: let the parent drag and zoom it inside the circle first
        Images.decode(file).then(function (img) {
          var sec = sheet.querySelector('[data-photo]');
          sec.innerHTML = '<span class="field-lbl" style="margin:0">Drag to move · slide to zoom</span>' +
            '<div class="crop" data-crop></div>' +
            '<label class="zoom-row"><span aria-hidden="true">−</span><input type="range" min="1" max="3" step="0.01" value="1" aria-label="Zoom" data-zoom><span aria-hidden="true">+</span></label>' +
            '<div class="photo-btns row"><button type="button" class="small-btn" data-usecrop>Use this photo</button>' +
            '<button type="button" class="small-btn ghost" data-cancelcrop>Cancel</button></div>';
          var cropper = Images.makeCropper(sec.querySelector('[data-crop]'), img, sec.querySelector('[data-zoom]'));
          sec.querySelector('[data-cancelcrop]').onclick = function () { closeSheet(kidId); openKid(kidId); };
          var use = sec.querySelector('[data-usecrop]');
          use.onclick = function () {
            use.disabled = true; use.textContent = 'Preparing…';
            cropper.done().then(function (prep) {
              save(kidId, sheet, 'uploadImage', { kid: kidId, kind: 'avatar', mime: prep.mime, data: prep.data }, afterImage('avatar', prep.previewUrl), use);
            }, function (e) { use.disabled = false; use.textContent = 'Use this photo'; fail(e); });
          };
        }, fail);
      });

      sheet.querySelectorAll('[data-theme]').forEach(function (b) {
        b.onclick = function () {
          chosen = b.getAttribute('data-theme');
          sheet.querySelectorAll('[data-theme]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        };
      });
      sheet.querySelector('[data-submit]').onclick = function () {
        var name = sheet.querySelector('#k-name').value.trim();
        var errs = sheet.querySelectorAll('.form-error');
        if (!name) { errs[errs.length - 1].textContent = 'Please enter a first name.'; return; }
        save(kidId, sheet, 'saveKid', { kid: kidId, name: name, theme: chosen });
      };
    });
  }

  // ---- History

  function openHistory(kidId) {
    var k = kidById(kidId);
    var html = sheetHead(k, 'History', 'Done') + '<div data-hist><p class="hint">Loading…</p></div>';
    openSheet(kidId, html, function (sheet) {
      Api.getHistory(kidId).then(function (h) { drawHistory(kidId, sheet, h); })
        .catch(function (e) {
          sheet.querySelector('[data-hist]').innerHTML = '<p class="form-error">' +
            esc(e.code === 'OFFLINE' ? 'Can’t reach Google, so History can’t load right now.' : e.message) + '</p>';
        });
    });
  }

  function drawHistory(kidId, sheet, h) {
    var k = kidById(kidId);
    var box = sheet.querySelector('[data-hist]');
    if (!box) return;
    // current balances = the newest "balance after" for each account in this history
    var now = {};
    h.entries.forEach(function (t) { if (!(t.account in now)) now[t.account] = t.balanceAfter; });
    var sum = '<div class="hist-sum">' + ACCOUNTS.map(function (a) {
      var v = now[a] || 0;
      return '<div><span class="tag tag-' + a + '">' + a + '</span><span class="num' + (v < 0 ? ' amt neg' : '') + '">' + money(v) + '</span></div>';
    }).join('') + '</div>';
    var out = [sum], lastMonth = '';
    if (!h.entries.length) out.push('<p class="hint">Nothing here yet.</p>');
    h.entries.forEach(function (t) {
      var m = monthLabel(t.date);
      if (m !== lastMonth) { out.push('<h3 class="month">' + esc(m) + '</h3>'); lastMonth = m; }
      out.push('<div class="hrow"><div style="flex:1;min-width:0">' +
        '<div class="meta"><span class="tag tag-' + esc(t.account) + '">' + esc(t.account) + '</span>' + esc(shortDate(t.date)) + ' · ' + esc(t.type) + (t.edited ? ' · edited' : '') + '</div>' +
        '<div class="note">' + esc(t.note) + '</div></div>' +
        '<div><div class="amt num ' + (t.amount < 0 ? 'neg' : 'pos') + '">' + (t.amount > 0 ? '+' : '') + money(t.amount) + '</div>' +
        '<div class="after">Bal ' + money(t.balanceAfter) + '</div></div>' +
        '<button type="button" class="icon-btn" data-edit="' + esc(t.txnId) + '" aria-label="Edit entry (PIN required)">' + icon('pen', 18) + '</button></div>');
    });
    box.innerHTML = out.join('');
    box.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () {
        var t = h.entries.filter(function (x) { return x.txnId === b.getAttribute('data-edit'); })[0];
        closeSheet(kidId);
        needPin(kidId, function () { openEditEntry(kidId, t); }, 'to edit an entry in ' + k.name + '’s history');
      };
    });
  }

  function openEditEntry(kidId, t) {
    var k = kidById(kidId);
    var sign = t.amount < 0 ? -1 : 1;
    var html = sheetHead(k, 'Edit entry') +
      '<p class="hint">' + esc(t.type) + ' · ' + esc(niceDate(t.date)) + (sign < 0 ? ' · money out' : ' · money in') + '</p>' +
      '<div><span class="field-lbl">Account</span><div class="acct-pick">' + ACCOUNTS.map(function (a) {
        return '<button type="button" data-acct="' + a + '" aria-pressed="' + (a === t.account) + '"><b>' + a + '</b></button>';
      }).join('') + '</div></div>' +
      '<div><label class="field-lbl" for="e-amt">Amount ' + (sign < 0 ? '(taken out)' : '(added)') + '</label>' +
        '<div class="amount-box"><span>$</span><input id="e-amt" inputmode="decimal" value="' + Math.abs(t.amount).toFixed(2) + '"></div></div>' +
      '<div><label class="field-lbl" for="e-note">Note</label><input id="e-note" class="field" maxlength="200" value="' + esc(t.note) + '"></div>' +
      '<div><label class="field-lbl" for="e-date">Date</label><input id="e-date" class="field" type="date" value="' + esc(t.date) + '" max="' + today() + '"></div>' +
      '<p class="form-error" role="alert"></p>' +
      '<button type="button" class="btn-primary" data-submit>Save entry</button>' +
      '<div data-delzone><button type="button" class="danger-btn" data-del style="width:100%">Delete entry</button></div>';

    openSheet(kidId, html, function (sheet) {
      var acct = t.account;
      sheet.querySelectorAll('[data-acct]').forEach(function (b) {
        b.onclick = function () {
          acct = b.getAttribute('data-acct');
          sheet.querySelectorAll('[data-acct]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        };
      });
      function backToHistory(h) {
        closeSheet(kidId);
        showStatus('Saved', true);
        loadState(); // refresh the balances on the main screen
        openSheet(kidId, sheetHead(k, 'History', 'Done') + '<div data-hist></div>', function (s2) { drawHistory(kidId, s2, h); });
      }
      sheet.querySelector('[data-submit]').onclick = function () {
        var n = parseMoney(sheet.querySelector('#e-amt').value);
        if (!(n >= 0)) { sheet.querySelector('.form-error').textContent = 'Please enter an amount.'; return; }
        save(kidId, sheet, 'editTxn', {
          txnId: t.txnId, amount: sign * n, note: sheet.querySelector('#e-note').value.trim(),
          date: sheet.querySelector('#e-date').value, account: acct
        }, backToHistory);
      };
      sheet.querySelector('[data-del]').onclick = function () {
        var zone = sheet.querySelector('[data-delzone]');
        zone.innerHTML = '<div class="confirm"><p class="hint">Delete this entry? It disappears from the app and the balance, but stays in the Google Sheet marked “Deleted”.</p>' +
          '<div class="btns"><button type="button" data-no>Keep it</button><button type="button" class="yes" data-yes>Delete</button></div></div>';
        zone.querySelector('[data-no]').onclick = function () { closeSheet(kidId); openEditEntry(kidId, t); };
        zone.querySelector('[data-yes]').onclick = function () {
          zone.querySelector('[data-yes]').textContent = 'Deleting…';
          save(kidId, sheet, 'deleteTxn', { txnId: t.txnId }, backToHistory);
        };
      };
    });
  }

  // ===================================================================== wiring

  app.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn || !S.data) return;
    if (S.offline && btn.hasAttribute('data-needs-net')) { showStatus('Offline: try again when there’s a signal'); return; }
    var kidId = btn.closest('.half').getAttribute('data-kid');
    var k = kidById(kidId);
    switch (btn.getAttribute('data-act')) {
      case 'purchase': needPin(kidId, function () { openMoney(kidId, 'purchase'); }, 'to log a purchase for ' + k.name); break;
      case 'allowance': needPin(kidId, function () { openAllowance(kidId); }, 'to edit ' + k.name + '’s allowance'); break;
      case 'kid': needPin(kidId, function () { openKid(kidId); }, 'to edit ' + k.name + '’s name and theme'); break;
      case 'history': openHistory(kidId); break;
    }
  });

  var resizeTimer;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(fitAll, 150); });

  // keep the numbers fresh: when the page comes back into view, and every few minutes
  document.addEventListener('visibilitychange', function () { if (!document.hidden) loadState(); });
  setInterval(function () { if (!document.hidden) loadState(); }, (APP_CONFIG.refreshMinutes || 5) * 60 * 1000);
  window.addEventListener('online', loadState);

  // start: show the last saved numbers straight away (if any), then fetch fresh ones
  if (loadCache()) render();
  loadState();
})();
