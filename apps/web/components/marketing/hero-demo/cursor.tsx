/**
 * The hand.
 *
 * Two nested elements on purpose:
 *
 * - the **rig** is exactly stage-sized, so animating its `xPercent`/`yPercent`
 *   moves the pointer to a percentage of the stage. That keeps every waypoint a
 *   unitless ratio, which means the whole demo survives a window resize without
 *   remeasuring a single pixel.
 * - the **glyph** hangs off the rig's top-left corner with its tip exactly at
 *   the origin, and owns the click's press-scale — so pressing never fights the
 *   rig's travel for the same transform.
 *
 * The rig lives *outside* the camera: a pointer that grew 2.4x when the shot
 * pushed in would read as a zoomed screenshot, not as someone using the app.
 * The timeline maps scene coordinates through the camera pose instead.
 */
export function Cursor() {
  return (
    <div
      data-demo="cursor-rig"
      className="pointer-events-none absolute inset-0 opacity-0"
      style={{ willChange: "transform" }}
      aria-hidden
    >
      <svg
        data-demo="cursor-glyph"
        viewBox="0 0 12 19"
        className="absolute left-0 top-0 h-[1.6em] w-auto drop-shadow-[0_1px_3px_rgb(0_0_0/0.5)]"
        style={{ transformOrigin: "0% 0%" }}
      >
        <path
          d="M0 0 L0 14.6 L3.6 11.3 L6.05 16.9 L8.6 15.8 L6.2 10.3 L10.7 10.3 Z"
          fill="white"
          stroke="rgb(15 15 15 / 0.85)"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
