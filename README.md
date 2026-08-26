# Hero Kids App

A two-iPad companion for running [Hero Kids](https://www.drivethrurpg.com/browse/pub/5762/Hero-Forge-Games)
at the table: one iPad is the GM screen, the other lies flat as the battle map.
No printing, no cutting out paper minis, no server, no internet.

**No rules automation.** The app replaces the printed map and the cardboard
stand-ups. Dice, damage, and judgement stay with the people playing.

## Layout

```
pdfs/            source PDFs — NOT in git
tools/hkpack/    CLI that turns a Hero Kids PDF into a .hkpack
packs/           generated .hkpack files — NOT in git
app/             the PWA both iPads run
```

## Running the app

```sh
cd app
npm install
npm run dev -- --host      # then open the printed LAN address on the iPad
```

## Getting it onto the iPads

Pairing scans a QR code and Add to Home Screen keeps the app offline. Both need
a **secure context**, and `http://192.168.…` is not one — so pairing genuinely
cannot work over `npm run dev`. Publish the app once and install from there.

### 1. Publish the shell

```sh
cd "Hero Kids App"
git init && git add -A && git commit -m "Hero Kids app"
gh repo create hero-kids-app --public --source=. --push
```

Public is fine and is what makes Pages free: the repository contains **no** Hero
Kids content — `pdfs/` and `packs/` are gitignored, and the app ships empty.

Then in the repo: **Settings → Pages → Source: GitHub Actions**. The workflow in
`.github/workflows/pages.yml` builds `app/` and publishes on every push. It lands
at `https://<you>.github.io/hero-kids-app/`.

### 2. Install on each iPad

1. Open that URL in Safari.
2. Share → **Add to Home Screen**.
3. Open it from the Home Screen icon (not the tab) — that's what makes it
   full-screen and offline.
4. **Add pack** → pick the three `.hkpack` files. AirDrop them over from the Mac
   first; both iPads need their own copy for now.
5. **Party** → tap the heroes your kids play. Do this on both iPads so the hero
   minis and cards resolve on each.

After this the app never needs the network again.

### 3. Pair them

GM iPad → connection chip → **This is the GM iPad**. Table iPad → chip → **This
is the table iPad** → scan → hold up the code it shows back → GM scans it.

Safari will ask for the camera. Say yes: it is what the scanner needs, and it is
also what makes the browser willing to publish a real local IP address instead of
a `.local` name that cannot be put in a QR code.

### When it won't connect

Pairing sheet → **Pairing won't connect? Run a check**. It reports whether the
page is secure, whether the camera was granted, and — the one that usually
matters — what addresses the browser handed out before and after the camera was
allowed. **Copy this report** puts it on the clipboard.

The likely failures, in order:

| What the check says | What it means |
|---|---|
| Secure page: no | opened over `http://` — use the published address |
| Camera: refused | Settings → Safari → Camera, or the site's own permission |
| Addresses after camera: masked as .local | Safari kept the address hidden; pairing can't work, use Manual Sync |
| Addresses after camera: none at all | not on Wi-Fi, or the network blocks it entirely |

Manual Sync (same sheet) works in every one of those cases — it is slower but it
only needs the two screens to see each other.

For fiddling on the LAN without publishing, `npm run dev:https` serves over TLS
with a throwaway certificate. You have to tap through Safari's warning on each
iPad, and the camera may still refuse an untrusted certificate.

### When the screen is blank cream

The packs on that iPad were built by an older `hkpack` than the app expects. The
library now says so by name; if it crashed before getting that far, the error
screen offers **Reset this iPad's data**. Either way the fix is the same:

```sh
cd tools/hkpack && npm run pack -- ../../pdfs/*.pdf && npm run verify
```

then AirDrop the rebuilt `.hkpack` files over and **Add pack** again.

The pack format changes when the tool learns to extract something new, so this
will happen again. It should never again be a blank screen.

## At the table

**Start here — the adventure's opening** sits above the encounter list: the
background, the overview, and the boxed text that opens the evening. Encounter 1
of Basement O Rats begins *"Following the adventure intro…"*, so this is not
optional colour — the two read-aloud sections are open on arrival and the GM's
prep notes stay folded between them.

Tap an encounter and you get **the book, not a battle map**: its intro, the
boxed text to read out, the role-playing notes, the ability tests. Five of Reign
of the Dragon's fourteen encounters are pure conversation and have no map at all.

At the bottom of each scene are the routes onward, in the book's own words —
*"Proceed to Encounter 4a: East Forest Road"* — as buttons. Where the adventure
branches you get both, and it remembers which way you went.

When a scene is a fight, **Set up the board** lays it out:

- **The monsters are already on their numbered circles and the heroes on the
  entry**, because the book says where they go and the pack knows. Turn on
  **Grid** to see the printed positions, including the ones a smaller party
  doesn't use. Where a map has no markers, everything stages along an edge to
  drag into place instead.
- Drag with one finger, pan with one finger on empty map, pinch to zoom.
- Tap a mini for its bar: **OK / 1 / 2 / KO** marks damage exactly like the
  printed health boxes, **Card** shows its stat card, **Mini** swaps the artwork,
  **Hide** keeps it off the player screen.
- **+ Add** in the roster brings on another monster mid-fight.
- **‹ Scene** goes back to the text without disturbing the board.
- The board is saved as you go, so a sleeping iPad doesn't lose the fight.

No dice, no damage calculation, no initiative. The app is the map and the minis.

**Rules** — in the header of every screen — opens the rulebook over whatever is
already there. Nineteen chapters, `Health and Damage` through `Glossary`, and a
search box, because the question is always asked mid-fight with everyone
waiting: type *knocked out* and the passage is on screen in one tap. The board
underneath is untouched; closing the sheet returns to the same minis, the same
damage, the same everything.

The table iPad shows the map, the party's cards and only the minis you have
revealed — **Hide** on the GM's token bar keeps a monster staged but unseen. It
stays on the last map through conversation scenes rather than blanking every
time somebody talks.

If a screen locks the link dies (iOS suspends WebRTC), so pair again — it merges
rather than picking a winner, because the board is stored as a log of edits and
both iPads replay the same log. Nothing is lost by pairing again mid-fight.

**Manual Sync** in the same sheet shows the whole board as one code for the other
iPad to photograph. It is slower, but it works on Wi-Fi that blocks
device-to-device traffic, which some guest networks do.

## Tests

```sh
npm run build
npm run spike     # can a ~70-byte QR payload rebuild an SDP that connects?
npm run e2e       # one iPad: import, stage, drag, snap to the printed grid
npm run e2e:two   # two iPads: pair, sync, hide, disconnect, re-pair, merge
npm run e2e:check # the pairing check itself, with the camera allowed and blocked
npm run e2e:walk  # walk Reign of the Dragon: conversation, fight, branch, reload
npm run e2e:recover # a pack from an older hkpack: a message, never a blank screen
npm run e2e:rules # look a rule up mid-fight and leave the board untouched
npm run e2e:place # minis land on the circles the book printed
```

## Copyright

Hero Kids is © Justin Halliday / Hero Forge Games. The maps, art, and text in
these PDFs are his commercial work.

This repository contains **no** Hero Kids content — only the tooling that reads
PDFs you already own and the app that displays the result. `pdfs/` and `packs/`
are gitignored, and the app ships empty: content is imported on-device from a
`.hkpack` you generate yourself. Do not publish generated packs.

## Building content packs

```sh
brew install poppler imagemagick tesseract   # tesseract and imagemagick optional
cd tools/hkpack
npm install
npm run pack -- ../../pdfs/*.pdf
npm run verify
```

Each run writes `packs/<name>.hkpack` and `build/<name>/preview/preview.html`.

- **poppler** is required — `pdfimages`, `pdftotext`, `pdftohtml`, `pdftoppm`.
- **tesseract** is optional. With it, card names are read off the cards by OCR;
  without it they come out blank and get typed into `manifest.json` by hand.
- **imagemagick** is only needed by `npm run verify`.

Open the preview before putting a pack on an iPad. Two things to check on each
map: the pink grid should sit on the printed squares, because that is where the
app will snap tokens all evening, and the blue circles should sit where the GM's
copy of the map prints its numbers, because that is where the monsters will
start.

### What the tool works out on its own

| | how |
|---|---|
| maps, cards, minis, illustrations | image geometry — minis are the cut-outs with a soft mask |
| square size | the printed ruling, measured by frequency across the whole book |
| which map belongs to which encounter | matching the small map beside the text against the full-page maps |
| where each monster starts | the GM's copy of the map is the printable copy plus the markers, so subtracting one from the other leaves exactly the numbered circles and the hero entry |
| read-aloud text | it is the only italic type in the book — minus the inline italic product names, which are put back into the sentence they came from |
| the adventure's opening pages | the headed sections printed before Encounter 1 |
| the rulebook's chapters | the core book sets chapter titles in small caps and sub-headings in title case, so the absence of a lower-case letter is the whole signal |
| every section, in printed order | headings are the only bold-italic type |
| which encounters are fights and which are conversations | whether a roster was printed |
| where each scene leads | cross-references like "Proceed to Encounter 4a", scored so a map note doesn't win over an instruction |
| monster roster per party size | "3 Heroes: 5 x Giant Rats", ranges included |
| card names | OCR of the name line |

Anything it could not place is listed at the top of the preview and in
`manifest.json` under `unresolved`, rather than guessed at.
