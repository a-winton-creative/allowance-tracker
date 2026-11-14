// The one setting the page needs: where the Apps Script back end lives.
// Anyone with this address can *view* balances; every change still needs the parent PIN.
window.APP_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbykd3lc5Ti9rVOoYNoaiDyhTHa6rFsGk8Bck6KKcaHlcFAV5YqiIWeUhJ5vL-TapZsu/exec',
  refreshMinutes: 5,
  timeZone: 'America/Los_Angeles'
};
