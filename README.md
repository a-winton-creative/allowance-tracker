# Allowance

A two-kid allowance tracker. Each kid gets half the screen, with their own theme, balance, chores and buttons.

**Live page:** https://a-winton-creative.github.io/allowance-tracker/

## How it works

- **This repository** is the page: plain HTML, CSS and JavaScript, served as-is by GitHub Pages. There's nothing to install or build.
- **Google Apps Script** is the back end. It reads and writes a Google Sheet, checks the parent PIN and pays allowances every night. Its address is in `js/config.js`.
- **The Google Sheet** keeps every event (payday, purchase, gift, adjustment) as a row. Balances are the sum of those rows.

## Files

| File | What it does |
|---|---|
| `index.html` | The page shell |
| `css/app.css` | Layout, cards, buttons, pop-ups |
| `css/themes.css` | The six themes (generated from the approved designs) |
| `js/art.js` | Theme artwork (generated) |
| `js/config.js` | The back end address |
| `js/api.js` | Talking to the back end; the 10-minute unlock |
| `js/app.js` | Drawing the screen and all the pop-ups |
| `js/mock.js` | Fake data for testing (only loaded with `?mock=1`) |

## Testing without touching real money

Add `?mock=1` to the address to use fake data. The test PIN is `123456`. Extra switches:

- `&theme1=Quest&theme2=Kitty%20Caf%C3%A9`: try themes
- `&offline=1`: pretend there's no signal
- `&long=1`: try a long balance
