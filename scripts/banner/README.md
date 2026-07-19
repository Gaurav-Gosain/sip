# banner

Generates the 1280x360 README header and the 1280x640 GitHub social preview from
one config file. `tuitest` holds the canonical copy; this directory, `vtgl` and
`webterm` carry it at the same path, so a change to the house style is made there
and copied out.

## Usage

```sh
node make-banner.mjs configs/sip.json -o ../../docs/images/banner.png
node make-banner.mjs configs/sip.json --preset social -o ../../docs/images/social-preview.png
```

`docs/images/social-preview.png` is not picked up from the repository. GitHub
serves it only after it is uploaded by hand under Settings, General, Social
preview.

Flags override the config file, and a banner can be made without one:

```sh
node make-banner.mjs --name vtgl --split 2 \
  --tagline "a WebGL2 glyph-atlas terminal renderer" \
  --accent blue --motif atlas \
  --meta "instanced draws,damage-driven uploads,shelf-packed atlas" \
  -o out.png
```

`node make-banner.mjs --help` lists every flag.

## Config

| field | meaning |
| --- | --- |
| `name` | the wordmark |
| `split` | character index where the accent colour starts |
| `cursor` | draw an accented block cursor after the name instead of splitting it |
| `tagline` | one line under the wordmark; keep it under ~46 characters |
| `meta` | array of lines, each an array of short chips |
| `accent` | `teal`, `green`, `blue`, `violet`, `amber`, `rose`, or a hex colour |
| `motif` | `graph`, `cells`, `atlas`, `chrome`, `browser`, `none` |
| `motifOpts` | per-motif parameters, including `seed` |
| `palette` | overrides for `bg0`, `bg1`, `fg`, `muted`, `dim` |

Both presets read the same config. Nothing in it is preset-specific: the preset
decides the canvas, the vertical rhythm, the type scale and how much of `meta` is
drawn.

## Presets

| preset | size | layout |
| --- | --- | --- |
| `banner` | 1280x360 | text left, motif in the right third |
| `social` | 1280x640 | wordmark and tagline centred, motif as a wide band under them |

`social` is composed again rather than resized, because 2:1 is a different shape
from 3.55:1 and because a social card is read small, as a 400-600px wide unfurl
in a feed or a chat. Three things follow from that.

Every size is about 1.44x the banner's, so the type is set for the card at half
scale rather than for a header at full width. Only the first line of `meta` is
drawn: two lines of six chips is a README's worth of detail, and on a card the
second line is the first thing to become unreadable. The meta tier is set
proportionally heavier than the banner's 0.19 of the wordmark, because that ratio
is what falls apart first when the card is scaled down.

The wordmark, tagline and meta sit well inside a centred safe area rather than
running to the gutters, since every surface that unfurls a link crops it
differently. The composition is inset by the same 100px on all four sides: the
band's width and bottom edge are set by the gutter, and the wordmark's ink lands
on the same margin at the top.

The band is 1080x144, which is a different shape from the banner's 360x270 panel,
so a motif is re-laid-out for it rather than stretched. `cells`, `graph` and
`atlas` all fill it: the first has a second hand-placed run set for wide grids,
and the other two are procedural and spread across whatever box they are given.
`browser` fills it too, from a second hand-placed shape. `chrome` does not,
because its frame rectangles are fixed and taller than the band. It needs a wide
`frames` set in `motifOpts` before `webterm` generates a social preview.

## House style

The name splits into a neutral head and an accented tail at a real morpheme
boundary: `tui|test`, `vt|gl`, `web|term`, `turbo|graph`. That is what keeps the
two-tone wordmark from looking arbitrary, and it is the strongest single cue
that these repositories belong together.

A name with no such boundary does not get one invented for it. `sip` is three
letters and every cut through it is arbitrary; `si|p` reads as a highlighted
typo, not as a logotype. `cursor: true` is the way out: the accent comes off the
letters and onto a block cursor set after the name, so it keeps the position, the
colour and the bloom the family puts on a tail, and it marks something that is
already part of a terminal rather than a seam that is not there.

The block is drawn in CSS rather than set as U+258C, because a block glyph fills
the em box. That is taller than the cap height at every size, and at the social
preset's 122px wordmark it reaches down into the tagline. The drawn block is cap
height on the baseline, so it matches the letters beside it and cannot collide
with the line below whatever the preset does to the type scale.

The motif, on the right of the banner and under the wordmark on the social
preview, is a diagram of what the project actually does, not decoration: a cell
grid with a lit assertion region for `tuitest`, a shelf-packed
atlas page for `vtgl`, stacked window chrome for `webterm`, a browser window with
a terminal grid, an image placement and a selection in it for `sip`. Adding a
project means adding a motif to `motifs.mjs` that means something.

Type is JetBrains Mono throughout, the same face the projects are set in.
Everything sits inside a 100px gutter, so nothing crops when GitHub rounds the
corners. On the banner the 16px meta line is the smallest element and renders at
8px once GitHub halves the image, which is the floor: do not add anything
smaller. The social preset raises the same line to 25px because it is scaled down
much further than half.

## How it renders

The image is laid out as HTML and screenshotted with headless chromium at 2x,
then downsampled with ImageMagick. A browser is used because the wordmark has to
be JetBrains Mono and a browser is the one tool here that shapes an installed
system font correctly; the 2x supersample is what makes the small type survive
GitHub scaling the image down.

Chromium is asked for a window twice the canvas height and the result is cropped
to a known rectangle, because headless chromium does not give the page a CSS
viewport equal to `--window-size` and the ratio moves between versions. Relying
on it would silently clip the last line of meta text.

Requirements: `chromium` (or `BANNER_CHROMIUM` pointing at a chromium or chrome
binary), ImageMagick 6 or 7, and JetBrains Mono installed. No `node_modules` and
no network access. Output is deterministic: motifs use a seeded PRNG, so
regenerating an image from the same config and preset reproduces it byte for
byte.
