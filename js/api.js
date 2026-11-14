/* Talking to the back end (Google Apps Script).
 *
 * Reads are plain GET requests. Changes are POSTs whose body is JSON sent as
 * "text/plain": that keeps the browser from sending a "preflight" check first,
 * which Apps Script can't answer.
 *
 * Unlocking: the PIN is checked by the back end, which hands back a token that
 * works for 10 minutes. We keep the token (never the PIN) in this browser.
 *
 * Testing: add ?mock=1 to the address to use fake data instead of the real sheet.
 */
(function () {
  var MOCK = /[?&]mock=1\b/.test(location.search);
  var TOKEN_KEY = 'allowance.unlock';
  var TIMEOUT_MS = 20000;
  var mockReady = !MOCK ? Promise.resolve() : new Promise(function (resolve) {
    var s = document.createElement('script');
    s.src = 'js/mock.js';
    s.onload = resolve;
    document.head.appendChild(s);
  });

  function withTimeout(promise) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(netError('The request took too long.')); }, TIMEOUT_MS);
      })
    ]);
  }
  function netError(msg) { var e = new Error(msg || 'Can’t reach Google right now.'); e.code = 'OFFLINE'; return e; }

  function unwrap(res) {
    if (!res.ok) throw netError();
    return res.json().then(function (body) {
      if (!body.ok) { var e = new Error(body.error || 'Something went wrong.'); e.code = body.code; throw e; }
      return body.data;
    });
  }

  function get(params) {
    if (MOCK) return mockReady.then(function () { return window.MockApi.get(params); });
    var q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return withTimeout(fetch(APP_CONFIG.apiUrl + '?' + q, { method: 'GET', cache: 'no-store' })
      .catch(function () { throw netError(); })).then(unwrap);
  }

  function post(body) {
    if (MOCK) return mockReady.then(function () { return window.MockApi.post(body); });
    return withTimeout(fetch(APP_CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).catch(function () { throw netError(); })).then(unwrap);
  }

  // ---- unlock token (kept for 10 minutes on this device)
  function readToken() {
    try {
      var t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
      if (t && t.exp > Date.now()) return t.token;
    } catch (e) { /* storage unavailable */ }
    return null;
  }
  function saveToken(token, seconds) {
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: token, exp: Date.now() + seconds * 1000 - 5000 })); }
    catch (e) { /* storage unavailable: unlock lasts until the page closes */ }
    memToken = { token: token, exp: Date.now() + seconds * 1000 - 5000 };
  }
  function clearToken() {
    memToken = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  }
  var memToken = null;
  function currentToken() {
    return readToken() || (memToken && memToken.exp > Date.now() ? memToken.token : null);
  }

  window.Api = {
    isMock: MOCK,
    getState: function () { return get({ action: 'state' }); },
    getHistory: function (kid) { return get({ action: 'history', kid: kid }); },
    isUnlocked: function () { return !!currentToken(); },
    unlock: function (pin) {
      return post({ action: 'unlock', pin: pin }).then(function (d) {
        saveToken(d.token, d.expiresInSeconds);
        return true;
      });
    },
    lock: clearToken,
    /** A change that needs the PIN. Rejects with code 'LOCKED' if the unlock has expired. */
    write: function (action, payload) {
      var token = currentToken();
      if (!token) { var e = new Error('Locked'); e.code = 'LOCKED'; return Promise.reject(e); }
      var body = Object.assign({ action: action, token: token }, payload);
      return post(body).catch(function (err) {
        if (err.code === 'LOCKED') clearToken();
        throw err;
      });
    }
  };


})();
