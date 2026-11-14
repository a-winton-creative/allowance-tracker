/* Fake back end for testing the page without touching the real sheet.
 * Only loaded when the address ends in ?mock=1. Test PIN: 123456.
 * Extra test switches: &theme1=Quest&theme2=Kitty%20Caf%C3%A9  &offline=1  &long=1
 */
(function () {
  var qs = new URLSearchParams(location.search);
  var today = '2026-11-13';
  var kids = [
    { kidId: 'nora', name: 'Nora', side: 'Left', theme: qs.get('theme1') || 'Fire Dragon', payDay: 1,
      perPay: { Main: 20, Charity: 5, Savings: 5 },
      chores: ['Make bed every morning', 'Feed the cat', 'Unload the dishwasher', 'Homework before screens'] },
    { kidId: 'graham', name: 'Graham', side: 'Right', theme: qs.get('theme2') || 'Block World', payDay: 15,
      perPay: { Main: 10, Charity: 2.5, Savings: 2.5 },
      chores: ['Tidy room on Saturdays', 'Set the table for dinner', 'Bring in the recycling bins'] }
  ];
  var n = 0;
  var txns = [];
  function add(date, kid, acct, type, amt, note) {
    txns.push({ txnId: 'm' + (++n), date: date, kidId: kid, account: acct, type: type, amount: amt, note: note, status: 'Active', edited: false });
  }
  ['nora', 'graham'].forEach(function (k) {
    ['Main', 'Charity', 'Savings'].forEach(function (a) { add('2026-10-01', k, a, 'Starting balance', 50, 'Starting balance'); });
  });
  add('2026-10-15', 'graham', 'Main', 'Allowance', 10, 'Payday');
  add('2026-10-15', 'graham', 'Charity', 'Allowance', 2.5, 'Payday');
  add('2026-10-15', 'graham', 'Savings', 'Allowance', 2.5, 'Payday');
  add('2026-11-02', 'graham', 'Savings', 'Deposit', 20, 'Birthday money from Grandma');
  add('2026-11-10', 'graham', 'Main', 'Purchase', -64.5, 'Trading cards');
  add('2026-11-01', 'nora', 'Main', 'Allowance', 20, 'Payday');
  add('2026-11-08', 'nora', 'Charity', 'Purchase', -5, 'Animal shelter donation');
  if (qs.get('long')) add('2026-11-12', 'nora', 'Main', 'Deposit', 1187.25, 'Big test deposit');

  function bal(kid) {
    var b = { Main: 0, Charity: 0, Savings: 0 };
    txns.forEach(function (t) { if (t.kidId === kid && t.status === 'Active') b[t.account] = Math.round((b[t.account] + t.amount) * 100) / 100; });
    return b;
  }
  function next(payDay) {
    var y = 2026, m = 11;
    var d = Math.min(payDay, new Date(Date.UTC(y, m, 0)).getUTCDate());
    var s = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    if (s > today) return s;
    m = 12; d = Math.min(payDay, 31);
    return y + '-12-' + String(d).padStart(2, '0');
  }
  function state() {
    return {
      today: today,
      kids: kids.map(function (k) {
        var last = '';
        txns.forEach(function (t) { if (t.kidId === k.kidId && t.type === 'Allowance' && t.date > last) last = t.date; });
        return Object.assign({ avatarFileId: '', backgroundFileId: '' }, k, { balances: bal(k.kidId), nextPayday: next(k.payDay), lastPayday: last });
      })
    };
  }
  function history(kid) {
    var list = txns.filter(function (t) { return t.kidId === kid && t.status === 'Active'; })
      .slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var run = { Main: 0, Charity: 0, Savings: 0 };
    var out = list.map(function (t) {
      run[t.account] = Math.round((run[t.account] + t.amount) * 100) / 100;
      return Object.assign({}, t, { balanceAfter: run[t.account] });
    });
    return { kidId: kid, entries: out.reverse() };
  }
  function delay(v) {
    return new Promise(function (res, rej) {
      setTimeout(function () { qs.get('offline') ? rej(Object.assign(new Error('offline'), { code: 'OFFLINE' })) : res(v); }, 350);
    });
  }
  function fail(msg, code) { return Promise.reject(Object.assign(new Error(msg), { code: code || null })); }
  var tokens = {};
  var images = {}, imgN = 0;

  window.MockApi = {
    get: function (p) {
      if (p.action === 'image') return images[p.id] ? delay({ id: p.id, mime: images[p.id].mime, data: images[p.id].data }) : fail('Image not found.');
      return delay(p.action === 'history' ? history(p.kid) : state());
    },
    post: function (b) {
      if (b.action === 'unlock') {
        if (b.pin !== '123456') return delay(null).then(function () { return fail('Wrong PIN. 4 tries left.'); });
        var t = 'tok' + Math.random(); tokens[t] = 1;
        return delay({ token: t, expiresInSeconds: 600 });
      }
      if (!tokens[b.token]) return fail('Locked. Please enter the parent PIN.', 'LOCKED');
      var k = kids.filter(function (x) { return x.kidId === b.kid; })[0];
      switch (b.action) {
        case 'purchase': add(b.date, b.kid, b.account, 'Purchase', -Math.abs(+b.amount), b.note); return delay(state());
        case 'deposit': add(b.date, b.kid, b.account, 'Deposit', Math.abs(+b.amount), b.note); return delay(state());
        case 'saveAllowance':
          k.payDay = +b.payDay; k.perPay = b.perPay; k.chores = b.chores;
          var cur = bal(b.kid);
          Object.keys(b.balances || {}).forEach(function (a) {
            var d = Math.round((+b.balances[a] - cur[a]) * 100) / 100;
            if (d) add(today, b.kid, a, 'Adjustment', d, 'Balance set to $' + (+b.balances[a]).toFixed(2));
          });
          return delay(state());
        case 'saveKid': k.name = b.name; k.theme = b.theme; return delay(state());
        case 'uploadImage':
          if (!/^image\/(jpeg|gif)$/.test(b.mime)) return fail('Please use a JPG or GIF.');
          var id = 'img' + (++imgN); images[id] = { mime: b.mime, data: b.data };
          k[b.kind === 'avatar' ? 'avatarFileId' : 'backgroundFileId'] = id;
          return delay(state());
        case 'removeImage':
          k[b.kind === 'avatar' ? 'avatarFileId' : 'backgroundFileId'] = '';
          return delay(state());
        case 'editTxn':
          txns.forEach(function (t) { if (t.txnId === b.txnId) { t.amount = +b.amount; t.note = b.note; t.date = b.date; t.account = b.account; t.edited = true; } });
          return delay(history(txns.filter(function (t) { return t.txnId === b.txnId; })[0].kidId));
        case 'deleteTxn':
          var row = txns.filter(function (t) { return t.txnId === b.txnId; })[0]; row.status = 'Deleted';
          return delay(history(row.kidId));
      }
      return fail('Unknown action');
    }
  };
})();
