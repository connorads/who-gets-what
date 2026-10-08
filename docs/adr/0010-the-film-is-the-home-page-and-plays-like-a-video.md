# The film is the home page, and plays like a video

Supersedes in part
[ADR 0003](0003-one-deckgl-canvas-and-one-gsap-clock.md): scroll position no
longer always drives the film's clock. The one canvas and the one GSAP
timeline stand.

The film, "Where benefit money goes", is the home page (`/`). `/film` answers 301 to `/` with its
parameters. Play runs the film like a narrated video: the narration's audio
clock drives the film's progress, and the player scrolls the page to match.
The film waits at the guess ("Now it's your turn") until the reader locks or
skips it. The reader's own scroll (wheel, touch, scroll keys or scrollbar)
takes over: the voice fades, the captions stay, and Resume plays on from the
beat on screen.

`src/film/programme.ts` lays every beat end to end on one film clock and maps
that clock to progress through the same knots the scroll-driven captions use,
run the other way. `src/film/playback.ts` is a pure reducer over six states
(idle, playing, paused, guess, manual, ended). `src/film/player.ts` is the
shell: the audio context's time is the master clock while playing, and a beat
not yet decoded holds the clock for up to 4 s.

## Context

- Readers found the paper-ledger home page busy, and the film is the clearest
  way into the data.
- A scroll film asks the reader to do the work. Most readers expect a film to
  play, with sound, once they press Play.
- Browsers start sound only from a gesture, so the film cannot play on load.
- The frame, the caption and the voice must agree at every moment, or a
  caption names a figure the picture does not show (ADR 0004).

## Consequences

- One tap starts the film; nothing plays before it.
- Voice, caption and frame share one clock, so they cannot drift.
- `/` is rendered by the Worker on each request, not prerendered, so
  `?mode=read` works there.
- Read mode (reduced motion, `?mode=read`, no WebGL2) steps through each
  chapter's still and words with the voice, with no scrolling motion.
- A beat that changes the film's wait or its prompts changes the script, which
  re-records narration through a paid speech API.
- The old home page content (coverage, house rules, figure specimen) left `/`.
- Playback frame rates are not yet measured on a real GPU.

## Alternatives considered

- **Keep the film at `/film` and a separate home page.** Two front doors, and
  the busier one is the one readers land on.
- **Autoplay on load, muted.** Browsers block sound without a gesture, and a
  silent start with captions only loses the narration that carries the film.
- **A rendered video file.** It would lose the reader's guess, the shape
  switch, the postcode landing and the Read mode, and its numbers could not
  be checked against the release by a test.
- **Wall-clock playback with the audio following.** A slow decode or a
  backgrounded tab lets the picture run ahead of the words.
