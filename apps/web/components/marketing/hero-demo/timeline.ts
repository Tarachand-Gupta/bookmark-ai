import gsap from "gsap";
import { QUERY, sel } from "./data";

/**
 * The storyboard.
 *
 * Five beats, one continuous camera move, ~13s, then a hold and a hard cut back
 * to the slate. Read `buildFullTimeline` top to bottom — the labels are the
 * shot list.
 *
 * Two conventions make it resolution-independent:
 *
 * 1. Every position is a *fraction of the stage*, driven through `xPercent` /
 *    `yPercent` on stage-sized elements. Nothing is in pixels, so a resize can't
 *    desynchronise the camera from the thing it's pointing at.
 * 2. The camera never touches `transform-origin`. It's pinned at `0 0` and the
 *    shot is solved as translate + scale — a real dolly. Animating the origin
 *    instead makes the frame drift sideways through the move.
 *
 * There's a second, shorter storyboard for narrow columns, where the close-up
 * beats can't be made legible at any zoom — see `buildCompactTimeline`.
 */

type Pt = { x: number; y: number };
/** A camera position: `xFrac`/`yFrac` are stage-widths/heights of translation. */
type Pose = { scale: number; xFrac: number; yFrac: number };

const REST: Pose = { scale: 1, xFrac: 0, yFrac: 0 };

function centerOf(el: Element, stage: DOMRect): Pt {
  const r = el.getBoundingClientRect();
  return {
    x: (r.left + r.width / 2 - stage.left) / stage.width,
    y: (r.top + r.height / 2 - stage.top) / stage.height,
  };
}

/** Solve the pose that frames `target` at `fill` of the stage, centred. */
function poseFor(stage: DOMRect, target: Element, fill: number): Pose {
  const t = target.getBoundingClientRect();
  const scale = Math.min((fill * stage.width) / t.width, (fill * stage.height) / t.height);
  const c = centerOf(target, stage);
  return { scale, xFrac: 0.5 - c.x * scale, yFrac: 0.5 - c.y * scale };
}

/** Where a point in the scene ends up on screen once the camera is in `pose`. */
function toScreen(pose: Pose, p: Pt): Pt {
  return { x: pose.xFrac + p.x * pose.scale, y: pose.yFrac + p.y * pose.scale };
}

/**
 * A pointer move that reads like a hand.
 *
 * The trick is that x and y are two tweens, on different eases and slightly
 * different durations. Neither is a straight line to anywhere; together they
 * bow the path and land the vertical before the horizontal, which is what an
 * arm actually does. (MotionPath would be the obvious tool and isn't licensed
 * here — this is better anyway, it's two lines of code.)
 */
function glide(tl: gsap.core.Timeline, to: Pt, at: number, dur = 0.9) {
  tl.to(sel.cursorRig, { xPercent: to.x * 100, duration: dur, ease: "power2.inOut" }, at);
  tl.to(sel.cursorRig, { yPercent: to.y * 100, duration: dur * 0.8, ease: "power1.inOut" }, at);
}

/** The pointer's own press — weight, not just a position change. */
function press(tl: gsap.core.Timeline, at: number) {
  tl.to(sel.cursorGlyph, { scale: 0.82, duration: 0.08, ease: "power2.out" }, at);
  tl.to(sel.cursorGlyph, { scale: 1, duration: 0.2, ease: "power2.out" }, at + 0.08);
}

/** Typing, without TextPlugin: tween a counter, slice the string. */
function typingRig(root: HTMLElement) {
  const el = root.querySelector(sel.searchText) as HTMLElement;
  const typed = { i: 0 };
  const render = () => {
    el.textContent = QUERY.slice(0, Math.round(typed.i));
  };
  return { typed, render };
}

/**
 * The half of the slate both storyboards share: every dashboard-side property
 * the film touches, wound back to its "before" state.
 *
 * This exists because the *default* DOM is the last frame, not the first — the
 * scene is authored finished so it survives no-JS and reduced-motion intact,
 * and the timeline un-finishes it here. It doubles as the loop's reset, so the
 * repeat is a hard cut through this and never a visible rewind.
 */
function dashboardSlate(tl: gsap.core.Timeline) {
  tl.set(sel.card, { opacity: 1, scale: 1, yPercent: 0 }, 0)
    .set(sel.cardSaved, { opacity: 0 }, 0)
    .set(sel.ring, { opacity: 0 }, 0)
    .set(sel.savedFlash, { opacity: 0 }, 0)
    .set(sel.metaAll, { opacity: 1 }, 0)
    .set(sel.metaResults, { opacity: 0 }, 0)
    .set(sel.searchRing, { opacity: 0 }, 0)
    .set(sel.searchPlaceholder, { opacity: 1 }, 0)
    .set(sel.caret, { opacity: 0 }, 0)
    .set(sel.cursorGlyph, { scale: 1 }, 0);
  // Note: the typed string is deliberately NOT reset here. It's owned entirely
  // by the fromTo in searchBeat — see the comment there.
}

/** The just-saved page arriving at the top of the grid, with a highlight. */
function savedCardLands(tl: gsap.core.Timeline, at: number) {
  tl.fromTo(
    sel.cardSaved,
    { yPercent: -14, scale: 0.94, opacity: 0 },
    { yPercent: 0, scale: 1, opacity: 1, duration: 0.6, ease: "power3.out" },
    at,
  )
    .fromTo(sel.savedFlash, { opacity: 0 }, { opacity: 1, duration: 0.14, ease: "power2.out" }, at + 0.12)
    .to(sel.savedFlash, { opacity: 0, duration: 0.8, ease: "power2.out" }, at + 0.26);
}

/**
 * Beat 5 · the search — shared, because it's the one beat that reads at every
 * width. The cursor lands in the field, the query types itself, and the grid
 * answers. Not one word of the query is in either title that comes back; see
 * QUERY in ./data, which is where that property is guarded.
 *
 * Returns the time the hold ends.
 */
function searchBeat(
  tl: gsap.core.Timeline,
  at: number,
  to: Pt,
  typed: { i: number },
  render: () => void,
): number {
  tl.addLabel("search", at).set(
    sel.cursorRig,
    { xPercent: (to.x - 0.2) * 100, yPercent: (to.y + 0.42) * 100 },
    at,
  );
  tl.to(sel.cursorRig, { opacity: 1, duration: 0.25 }, at + 0.05);
  glide(tl, to, at + 0.2, 0.85);
  press(tl, at + 1.12);

  tl.to(sel.searchRing, { opacity: 1, duration: 0.22 }, at + 1.16)
    .to(sel.searchPlaceholder, { opacity: 0, duration: 0.14 }, at + 1.2)
    .to(sel.caret, { opacity: 1, duration: 0.1 }, at + 1.24)
    .to(sel.cursorRig, { opacity: 0, duration: 0.25 }, at + 1.3)
    // fromTo, not to + a set at t=0. The string isn't a GSAP property — it's
    // written by this onUpdate — and GSAP won't re-fire onUpdate on a tween
    // whose ratio hasn't moved. So a separate `set(typed, {i: 0})` on the slate
    // would win the race on any jump backwards and blank the field for good,
    // leaving the query typed but invisible. Owning both ends here means the
    // start value is re-applied whenever the playhead is before this tween,
    // which is exactly the reset the loop needs.
    .fromTo(
      typed,
      { i: 0 },
      { i: QUERY.length, duration: 1.6, ease: "none", onUpdate: render },
      at + 1.35,
    )
    // Caret blinks through the typing and the wait for results.
    .to(sel.caret, { opacity: 0, duration: 0.42, ease: "steps(1)", repeat: 5, yoyo: true }, at + 3.0);

  // The two that mean it stay lit; everything else drops back.
  const r = at + 3.15;
  tl.addLabel("results", r)
    .to(sel.metaAll, { opacity: 0, duration: 0.2 }, r)
    .to(sel.metaResults, { opacity: 1, duration: 0.3 }, r + 0.07)
    .to(
      sel.cardOther,
      { opacity: 0.22, scale: 0.985, duration: 0.5, ease: "power2.out", stagger: 0.04 },
      r + 0.03,
    )
    .fromTo(sel.ring, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" }, r + 0.13)
    .to(sel.cardKeep, { scale: 1.02, duration: 0.2, ease: "power2.out" }, r + 0.05)
    .to(sel.cardKeep, { scale: 1, duration: 0.45, ease: "power2.out" }, r + 0.25)
    .to(sel.caret, { opacity: 0, duration: 0.25 }, r + 2.45);

  return r + 2.95;
}

function newTimeline(render: () => void, typed: { i: number }) {
  return gsap.timeline({
    paused: true,
    repeat: -1,
    repeatDelay: 0.9,
    // The slate resets everything GSAP owns, but the typed string is text
    // content, which GSAP has no idea about — so it's reset by hand.
    onRepeat: () => {
      typed.i = 0;
      render();
    },
    defaults: { ease: "power2.out" },
  });
}

export function buildDemoTimeline(root: HTMLElement, compact: boolean): gsap.core.Timeline {
  return compact ? buildCompactTimeline(root) : buildFullTimeline(root);
}

function buildFullTimeline(root: HTMLElement): gsap.core.Timeline {
  const pick = <T extends Element = HTMLElement>(s: string) => root.querySelector(s) as T;

  // ── Survey ────────────────────────────────────────────────────────────────
  // Measure once, before any tween has touched a transform, so every reading is
  // of the scene at rest. Everything below is derived from these.
  const stage = pick(sel.stage).getBoundingClientRect();
  const shot = poseFor(stage, pick(sel.closeup), 0.94);

  const pIcon = centerOf(pick(sel.extIcon), stage);
  const pSave = centerOf(pick(sel.saveBtn), stage);
  const pSearch = centerOf(pick(sel.searchField), stage);

  // Beats 1-3 happen under the pushed-in camera, so the pointer's targets go
  // through the pose; beat 5 is at rest, so they don't.
  const sIcon = toScreen(shot, pIcon);
  const sSave = toScreen(shot, pSave);
  const sSearch = toScreen(REST, pSearch);

  // The popup grows out of the icon that opened it, so its origin is wherever
  // that icon happens to be relative to the popup's own box.
  const popupRect = pick(sel.popup).getBoundingClientRect();
  const iconRect = pick(sel.extIcon).getBoundingClientRect();
  const popupOrigin = `${
    ((iconRect.left + iconRect.width / 2 - popupRect.left) / popupRect.width) * 100
  }% 0%`;

  const { typed, render } = typingRig(root);
  const tl = newTimeline(render, typed);

  // ── The slate ─────────────────────────────────────────────────────────────
  tl.set(
    sel.camera,
    {
      transformOrigin: "0 0",
      scale: shot.scale,
      xPercent: shot.xFrac * 100,
      yPercent: shot.yFrac * 100,
      // Un-promoted while zoomed in and held: a will-change'd layer would be
      // rasterized at scale-1 and GPU-upscaled ~2.35x into a blur. It's turned
      // back on only for the beat-4 dolly below. (This also runs on every loop
      // via the slate, re-clearing it before the hard cut back to the closeup.)
      willChange: "auto",
    },
    0,
  )
    .set(sel.browser, { opacity: 1, scale: 1 }, 0)
    .set(sel.dashboard, { opacity: 0 }, 0)
    .set(sel.popup, { opacity: 0, scale: 0.95, yPercent: -3, transformOrigin: popupOrigin }, 0)
    .set(sel.extIconGlow, { opacity: 0 }, 0)
    .set(sel.ripple, { opacity: 0, scale: 0.5 }, 0)
    .set(sel.saveIdle, { opacity: 1 }, 0)
    .set(sel.saveBusy, { opacity: 0 }, 0)
    .set(sel.saveDone, { opacity: 0 }, 0)
    .set(sel.popupUrl, { opacity: 1 }, 0)
    .set(sel.popupChip, { opacity: 0 }, 0)
    // Act two, wound back to "before" the same way the rest of the slate is:
    // hidden scene, tabs not yet landed, caption on act one's line.
    .set(sel.liveScene, { opacity: 0 }, 0)
    .set(sel.liveTab, { opacity: 0, yPercent: 18 }, 0)
    .set(sel.captionAct1, { opacity: 1 }, 0)
    .set(sel.captionAct2, { opacity: 0 }, 0)
    .set(sel.cursorRig, {
      opacity: 0,
      xPercent: (sIcon.x - 0.26) * 100,
      yPercent: (sIcon.y + 0.5) * 100,
    }, 0);
  dashboardSlate(tl);

  // ── Beat 1 · the click ────────────────────────────────────────────────────
  // Open pushed in on the toolbar. A hand arrives and reaches for the ribbon.
  tl.addLabel("click", 0).to(sel.cursorRig, { opacity: 1, duration: 0.3 }, 0.15);
  glide(tl, sIcon, 0.4, 0.95);

  press(tl, 1.32);
  tl.to(sel.extIcon, { scale: 0.86, duration: 0.09, ease: "power2.out" }, 1.34)
    .to(sel.extIcon, { scale: 1, duration: 0.26, ease: "power2.out" }, 1.43)
    .fromTo(
      sel.ripple,
      { opacity: 0.55, scale: 0.5 },
      { opacity: 0, scale: 2.4, duration: 0.5, ease: "power2.out" },
      1.36,
    )
    // The toolbar button stays lit for as long as its popup is open.
    .to(sel.extIconGlow, { opacity: 1, duration: 0.12 }, 1.4);

  // ── Beat 2 · the popover ──────────────────────────────────────────────────
  // Fast, from 95%, a few px of travel, out of the icon. The real popup's feel.
  tl.addLabel("popover", 1.46).to(
    sel.popup,
    { opacity: 1, scale: 1, yPercent: 0, duration: 0.26, ease: "power2.out" },
    1.46,
  );

  // ── Beat 3 · the save ─────────────────────────────────────────────────────
  tl.addLabel("save", 1.9);
  glide(tl, sSave, 1.9, 0.75);
  press(tl, 2.72);

  // Save bookmark → Saving… (spinner) → Saved, and Gemini's category lands.
  tl.to(sel.saveIdle, { opacity: 0, duration: 0.12 }, 2.78)
    .to(sel.saveBusy, { opacity: 1, duration: 0.12 }, 2.78)
    .to(sel.spinner, { rotation: 720, duration: 1.0, ease: "none", transformOrigin: "50% 50%" }, 2.8)
    .to(sel.cursorRig, { opacity: 0, duration: 0.25 }, 3.1)
    .to(sel.saveBusy, { opacity: 0, duration: 0.12 }, 3.8)
    .to(sel.saveDone, { opacity: 1, duration: 0.14 }, 3.8)
    // The URL hands its slot to the category Gemini just filed it under.
    .to(sel.popupUrl, { opacity: 0, duration: 0.16 }, 3.84)
    .fromTo(
      sel.popupChip,
      { opacity: 0, scale: 0.8 },
      { opacity: 1, scale: 1, duration: 0.3, ease: "power3.out" },
      3.9,
    )
    // The real popup closes itself ~1.2s after a save. So does this one.
    .to(sel.popup, { opacity: 0, scale: 0.97, yPercent: -2, duration: 0.22, ease: "power2.in" }, 5.0)
    .to(sel.extIconGlow, { opacity: 0, duration: 0.2 }, 5.05);

  // ── Beat 4 · the pull-back ────────────────────────────────────────────────
  // The one moment that earns the room. The camera retreats ~2.4x, the browser
  // recedes and dissolves, and the library it was talking to the whole time
  // turns out to be right there behind it — with the page we just saved landing
  // last, so the eye has to make the connection itself.
  tl.addLabel("reveal", 5.25)
    // Promote the camera for the one stretch it actually moves, then release it
    // so the wide shot is painted at true resolution too (and the next loop's
    // closeup starts un-promoted — see the slate).
    .set(sel.camera, { willChange: "transform" }, 5.2)
    .to(
      sel.camera,
      { scale: REST.scale, xPercent: 0, yPercent: 0, duration: 1.7, ease: "power3.inOut" },
      5.25,
    )
    .set(sel.camera, { willChange: "auto" }, 7.0)
    .to(sel.browser, { scale: 0.96, opacity: 0, duration: 0.95, ease: "power2.in" }, 5.3)
    .to(sel.dashboard, { opacity: 1, duration: 0.8, ease: "power2.out" }, 5.5)
    .fromTo(
      `${sel.cardOther},${sel.card}[data-role='match']`,
      { yPercent: 5, opacity: 0 },
      { yPercent: 0, opacity: 1, duration: 0.55, ease: "power2.out", stagger: 0.05 },
      5.65,
    );
  savedCardLands(tl, 6.5);

  // ── Beat 5 · the search ───────────────────────────────────────────────────
  const end = searchBeat(tl, 7.5, sSearch, typed, render);

  // ── Caption · act two begins ─────────────────────────────────────────────
  // A beat ahead of the camera move, so the label changes before the scene
  // does — the viewer always knows what they're about to watch, not what they
  // just watched.
  const captionIn = end + 0.3;
  tl.addLabel("act2-caption", captionIn)
    .to(sel.captionAct1, { opacity: 0, duration: 0.4, ease: "power1.inOut" }, captionIn)
    .to(sel.captionAct2, { opacity: 1, duration: 0.4, ease: "power1.inOut" }, captionIn);

  // ── Beat 6 · act two, the return ─────────────────────────────────────────
  // The camera dollies back into *exactly* the pose beat 1 used to open the
  // extension — same `shot`, no new survey — and finds a different scene
  // waiting in that spot: the dashboard dissolves, live tabs take its place.
  const liveIn = end + 0.6;
  tl.addLabel("live-in", liveIn)
    // Promoted only for the dolly itself — see the slate's note on why a
    // held zoom must stay un-promoted to avoid the GPU-upscale blur.
    .set(sel.camera, { willChange: "transform" }, liveIn - 0.05)
    .to(
      sel.camera,
      {
        scale: shot.scale,
        xPercent: shot.xFrac * 100,
        yPercent: shot.yFrac * 100,
        duration: 1.4,
        ease: "power3.inOut",
      },
      liveIn,
    )
    .set(sel.camera, { willChange: "auto" }, liveIn + 1.4)
    .to(sel.dashboard, { opacity: 0, duration: 0.7, ease: "power2.in" }, liveIn)
    .to(sel.liveScene, { opacity: 1, duration: 0.8, ease: "power2.out" }, liveIn + 0.35);

  // ── Beat 7 · the tabs land ────────────────────────────────────────────────
  // The laptop's tabs were already open (nothing to animate there — same as
  // beat 1's toolbar just sitting lit); what streams is the phone catching up.
  const liveArrive = liveIn + 1.5;
  tl.addLabel("live-arrive", liveArrive).fromTo(
    sel.liveTab,
    { yPercent: 18, opacity: 0 },
    { yPercent: 0, opacity: 1, duration: 0.55, ease: "power2.out", stagger: 0.3 },
    liveArrive,
  );

  // ── Beat 8 · hold, then pull back ────────────────────────────────────────
  // The mirror image of beat 4's pull-back: the camera retreats, this scene
  // dissolves, and the dashboard — untouched since beat 5, still holding its
  // search results — reappears to end the loop exactly where it always did.
  const liveOut = liveArrive + 1.9;
  tl.addLabel("live-out", liveOut)
    .set(sel.camera, { willChange: "transform" }, liveOut - 0.05)
    .to(
      sel.camera,
      { scale: REST.scale, xPercent: 0, yPercent: 0, duration: 1.4, ease: "power3.inOut" },
      liveOut,
    )
    .set(sel.camera, { willChange: "auto" }, liveOut + 1.4)
    .to(sel.liveScene, { opacity: 0, duration: 0.6, ease: "power2.in" }, liveOut)
    .to(sel.dashboard, { opacity: 1, duration: 0.8, ease: "power2.out" }, liveOut + 0.5)
    .to(sel.captionAct2, { opacity: 0, duration: 0.4, ease: "power1.inOut" }, liveOut + 0.5)
    .to(sel.captionAct1, { opacity: 1, duration: 0.4, ease: "power1.inOut" }, liveOut + 0.5);

  const finalEnd = liveOut + 1.6;
  tl.set({}, {}, finalEnd);
  return tl;
}

/**
 * The narrow storyboard — two beats, no camera.
 *
 * Below a ~448px column the browser and its popup are `display:none` (see
 * BrowserWindow), so beats 1-3 have nothing to film — and couldn't be read if
 * they did. What's left is the half of the story that still works at 330px: the
 * page arrives at the top of the library, and a search that shares no words with
 * it finds it anyway. Same slate, same ending, ~7s.
 *
 * This is a deliberate cut, not a fallback: shrinking the full film to fit would
 * mean shipping an illegible smudge of a UI as the landing page's main visual.
 * Act two is cut for the same reason — `LiveScene` shares `BrowserWindow`'s
 * `@md:flex` floor, so there's nothing to reveal here either — and the caption
 * simply never advances past its act-one line, which is a true statement of
 * what this storyboard actually plays.
 */
function buildCompactTimeline(root: HTMLElement): gsap.core.Timeline {
  const pick = <T extends Element = HTMLElement>(s: string) => root.querySelector(s) as T;
  const stage = pick(sel.stage).getBoundingClientRect();
  const pSearch = centerOf(pick(sel.searchField), stage);

  const { typed, render } = typingRig(root);
  const tl = newTimeline(render, typed);

  // The camera stays at rest for the whole thing; the dashboard is simply there.
  tl.set(sel.camera, { transformOrigin: "0 0", scale: 1, xPercent: 0, yPercent: 0 }, 0)
    .set(sel.dashboard, { opacity: 1 }, 0)
    .set(sel.cursorRig, {
      opacity: 0,
      xPercent: (pSearch.x - 0.2) * 100,
      yPercent: (pSearch.y + 0.42) * 100,
    }, 0);
  dashboardSlate(tl);

  tl.addLabel("saved", 0.5);
  savedCardLands(tl, 0.6);

  const end = searchBeat(tl, 1.9, pSearch, typed, render);
  tl.set({}, {}, end);
  return tl;
}
