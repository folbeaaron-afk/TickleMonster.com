# They’re Ticklish

An interactive horror piece for **TICKLE MONSTER**. It's a self-contained page at `/tickle/`.

> GO AHEAD. THEY’RE TICKLISH.

A person lies on a bed, seen from above. Click (or tap) their neck, ribs, stomach or feet, and a long, pale hand reaches in to tickle that exact spot. Each tickle escalates. In stage 4, if the visitor stops clicking, the hands don't stop. A STOP button appears. It doesn't work right away. Then everything freezes, the screen cuts to black, and the title appears.

## Run it

It's static files with no build step and no dependencies.

```sh
python3 -m http.server 8000      # from the repo root
open http://localhost:8000/tickle/
```

ES modules need a server, so it won't run from `file://`.

Tests (Node 20+):

```sh
node --test 'tickle/tests/*.test.mjs'
```

Optional type-check (the JS is annotated with `// @ts-check` + JSDoc):

```sh
npx -p typescript tsc --noEmit --allowJs --checkJs --target es2022 --module es2022 \
  --moduleResolution bundler --lib es2022,dom tickle/js/*.js
```

## Integrating with the main site

Everything lives in `tickle/`. All CSS is scoped under `.tm-page` / `.tm-*`, and no global names are used except `window.__tickle`, which is a debug handle. To integrate:

- **Static site**: link to `/tickle/` from the homepage, e.g. *“Click on this person’s stomach.”*
- **Next.js / Astro / Vite etc.**: copy the folder into `public/tickle/` and link to `/tickle/index.html`, or route `/ticklish` to it. Keep it as its own page. The piece takes over the viewport and should not be embedded inside other layouts.
- The end screen's **leave** link points to `/`. Change it in `index.html` if the home page lives elsewhere.

## How it works

| File | Role |
| --- | --- |
| `js/state.js` | **Deterministic state machine.** Pure `reduce(state, event)`. Phases: `idle → play (stages 1–4) → auto (stage 5) → stopping → frozen → black → title`. All timings and click thresholds are at the top. |
| `js/scene.js` | Owns the inline SVG: applies body poses, draws the face procedurally, and maps hotspot-local ↔ scene coordinates so hands land on the exact touched point at any screen size, even while the body squirms. |
| `js/hands.js` | Procedural hands: arm, palm, five jointed fingers, nails, knuckle creases and veins, regenerated per frame. `HAND_STAGE` defines how each stage moves. `HandDirector` decides which hand goes where, including the stage-5 autopilot. |
| `js/person.js` | Turns stage, contact and laugh rhythm into a body pose and a face. Later stages keep the mouth laughing while the brows, eyes, tears and missing catchlights disagree. |
| `js/laugh.js` | Seeded laugh schedule (syllables, inhales, wheezes, sobs) shared by the audio *and* the mouth, so the mouth stays in sync with the sound and keeps laughing when muted. |
| `js/audio.js` | Web Audio. Synthesized formant laughter, room tone, drone, a dissonant tone, high whine, clock, heartbeat and bed creaks. One bus per run, so `cut()` silences everything at once (the freeze). |
| `js/main.js` | Input, render loop, transitions, captions, toggles, ending. |

**Escalation (default):**

| Stage | Reached by | What changes |
| --- | --- | --- |
| 1 | 1st tickle | one hand, slow and natural; giggles; eyes squint happily |
| 2 | 3 tickles | bigger laugh, squirming, brows begin to worry |
| 3 | 6 tickles | a second, longer hand with an extra knuckle. Wide eyes stare straight up at **you** while the mouth laughs. Tears. |
| 4 | 9 tickles | hands snap in, fingers move too fast, they stop leaving. The body pulls away, the eyes squeeze shut, a heartbeat starts. |
| 5 | stop clicking for 2.2 s in stage 4 (or 14 tickles) | **autopilot**: clicks are ignored, four hands roam the body, there's no blinking and no catchlight, the head sometimes locks still. STOP appears after 4.5 s. |
| — | STOP | 2.6 s of worse, then a hard freeze (sound cut mid-syllable), 1.3 s hold, black, a distant giggle, then the title |

Each stage has a minimum dwell, so hammering the screen can't skip the build-up. The same seed and the same inputs always give the same experience.

**Handmade look:** the person is drawn at 15 fps (24 later) with a re-seeded displacement filter ("line boil"). The hands run at 15 fps early on, then 30–60 fps in stages 4–5, so they become *too smooth and too fast* next to everything else. Some frames in late stages hold the face for a beat. On slow devices the filters are dropped automatically after about 45 slow frames.

## Accessibility

- Every hotspot is a focusable `role="button"` with a label. **Enter / Space** tickles.
- **Reduced motion** follows `prefers-reduced-motion` and can be toggled on the page (the choice is remembered). The hands fade in place, the body barely moves, there's no line boil, grain or push-in, and the face still carries the escalation.
- **Captions** describe the sound (`(laughing. it sounds wrong.)`, `“please”`) for muted and deaf or hard-of-hearing visitors.
- **Sound** never starts before a user gesture. The toggle is always visible, the `M` key mutes, and the choice is remembered. There are no strobing effects.

## Swapping in final art

The current art is coherent placeholder vector art, built so it can be replaced layer by layer. AI-generated art can drop in the same way.

1. **Room / bed** (`#tm-bed` in `index.html`): replace the contents with a single `<image href="assets/bed.webp" x="0" y="0" width="600" height="900"/>`. The scene's coordinate system is a fixed 600×900 viewBox.
2. **Body parts**: each moving group keeps its pivot, so you can replace its contents with a cut-out `<image>` of the same region:
   - `#tm-legL/R` (hip pivot 256,540 / 344,540) with `#tm-footL/R` inside (ankle 262,796 / 338,796)
   - `#tm-torso` (pivot 300,480) → `#tm-armL/R` (shoulders 214,244 / 386,244), `#tm-chest`, `#tm-head` (neck 300,214)
3. **Face**: `#tm-face` is drawn in code (eyes, brows, mouth, tears) on top of the head. Keep it over a painted head with neutral features, or drop the procedural face and swap pre-rendered expression images per stage in `Scene.setFace`.
4. **Hotspots** are the `.tm-hot` ellipses. Move or resize them to match new art. Hand placement adapts automatically.
5. **Hands** are procedural on purpose, because they have to reach any point. To texture them, change `.tm-hand-*` styles or add an SVG pattern fill.

Export art as WebP/AVIF at about 1200×1800 for the full scene, and keep the total under about 400 KB to stay fast on mobile.

## Swapping in real audio

In `js/audio.js`, fill in `SAMPLE_MANIFEST`:

```js
export const SAMPLE_MANIFEST = {
  ambience: 'audio/room-tone.mp3',
  laughs: { 1: ['audio/giggle-1.mp3', 'audio/giggle-2.mp3'], 3: [...], 5: [...] },
};
```

When a stage has recorded laughs, each bout plays one sample instead of the synthesized syllables. The mouth still follows the procedural rhythm. Missing files fall back to synthesis.

## Tuning

- Click thresholds, dwell times and all ending timings: `STAGE_CLICKS`, `STAGE_MIN_DWELL`, `TIMING` in `js/state.js`.
- Hand behaviour per stage: `HAND_STAGE` in `js/hands.js`.
- Faces per stage: `REST` / `LAUGHING` in `js/person.js`.
- Laugh rhythm per stage: `LAUGH` in `js/laugh.js`. Ambient levels: `AMBIENT` in `js/audio.js`.
- Captions: `LINES` in `js/main.js`.
