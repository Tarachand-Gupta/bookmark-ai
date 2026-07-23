// CREDIT
// Component inspired by Can Tastemel's original work for the lambda.ai landing
// page — https://cantastemel.com — via React Bits <Cubes /> (gsap variant).
// Adapted for Bookmark AI: TypeScript, neutral (currentColor) palette, a static
// SSR-safe lattice, and a document-level (pointer-events: none) hover driver so
// it can live as a background behind clickable page content.

"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import gsap from "gsap";

const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

type CubesProps = {
  /** Lattice columns. Each column is `cell`px wide (matches the grid pitch). */
  cols: number;
  /** Lattice rows. */
  rows: number;
  /** Cell pitch in px — the lattice's repeat distance (58). */
  cell: number;
  /** Gutter between cubes in px; the pitch stays `cell` (cube size = cell − gap). */
  gap?: number;
  /** Peak tilt at the pointer, degrees. */
  maxAngle?: number;
  /** Falloff radius, in cells, of the tilt around the pointer. */
  radius?: number;
  easing?: string;
  duration?: { enter: number; leave: number };
  /**
   * Element whose on-screen presence gates the effect. Observe a normal-flow
   * sentinel here (the scene itself is `fixed`, so it never leaves the
   * viewport). When it scrolls out, or the tab is hidden, all GSAP work stops.
   */
  activeSentinelRef?: React.RefObject<HTMLElement | null>;
};

/**
 * A flat grid of 3D cubes. Renders statically (deterministic — safe to SSR),
 * then attaches a single throttled document `pointermove` that tilts the cubes
 * under the pointer. Nothing here captures pointer events; the wrapper sets
 * `pointer-events: none`, so this reads clientX/clientY off the document and
 * translates them into scene coordinates via getBoundingClientRect.
 */
export function Cubes({
  cols,
  rows,
  cell,
  gap = 6,
  maxAngle = 40,
  radius = 2.5,
  easing = "power3.out",
  duration = { enter: 0.35, leave: 0.7 },
  activeSentinelRef,
}: CubesProps) {
  const sceneRef = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    // Honor reduced motion: leave the static lattice exactly as rendered.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const cubes = Array.from(
      scene.querySelectorAll<HTMLElement>(".marketing-cube"),
    );
    const enterDur = duration.enter;
    const leaveDur = duration.leave;

    // Active only while the sentinel is in view AND the tab is visible.
    let onScreen = true;
    let visible = !document.hidden;
    const isActive = () => onScreen && visible;

    let rafId = 0;
    let pending: { row: number; col: number } | null = null;
    // Cubes currently tilted away from rest. Tracking this keeps each frame's
    // work proportional to the pointer's neighbourhood, not the whole lattice:
    // we only tween cubes inside the radius plus the few that just left it.
    let active = new Set<HTMLElement>();

    const rest = (cube: HTMLElement) => {
      gsap.to(cube, {
        duration: leaveDur,
        ease: "power3.out",
        overwrite: true,
        rotateX: 0,
        rotateY: 0,
      });
    };

    const tiltAt = (rowCenter: number, colCenter: number) => {
      const next = new Set<HTMLElement>();
      for (const cube of cubes) {
        const r = Number(cube.dataset.row);
        const c = Number(cube.dataset.col);
        const dist = Math.hypot(r - rowCenter, c - colCenter);
        if (dist <= radius) {
          const angle = (1 - dist / radius) * maxAngle;
          gsap.to(cube, {
            duration: enterDur,
            ease: easing,
            overwrite: true,
            rotateX: -angle,
            rotateY: angle,
          });
          next.add(cube);
        }
      }
      // Cubes that were tilted but are no longer in range → ease back to rest.
      for (const cube of active) if (!next.has(cube)) rest(cube);
      active = next;
    };

    const resetAll = () => {
      if (active.size === 0) return;
      for (const cube of active) rest(cube);
      active = new Set();
    };

    // rAF-throttled: pointermove only stashes the latest position; the tilt is
    // computed at most once per frame.
    const flush = () => {
      rafId = 0;
      if (!pending || !isActive()) return;
      const rect = scene.getBoundingClientRect();
      // Map document coords to lattice indices by pitch, so the tilt peak lands
      // on the cube under the pointer regardless of the gutter.
      const colCenter = (pending.col - rect.left) / cell;
      const rowCenter = (pending.row - rect.top) / cell;
      pending = null;
      tiltAt(rowCenter, colCenter);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isActive()) return;
      pending = { col: e.clientX, row: e.clientY };
      if (!rafId) rafId = requestAnimationFrame(flush);
    };

    const stop = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      pending = null;
      resetAll();
    };

    const onVisibility = () => {
      visible = !document.hidden;
      if (!visible) stop();
    };

    // Gate on the sentinel's visibility (the scene is fixed, so we can't observe
    // it directly). Flattening when it leaves the viewport pauses all tweens.
    let observer: IntersectionObserver | null = null;
    const sentinel = activeSentinelRef?.current ?? null;
    if (sentinel && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          onScreen = entries[0]?.isIntersecting ?? true;
          if (!onScreen) stop();
        },
        { rootMargin: "10% 0px" },
      );
      observer.observe(sentinel);
    }

    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      gsap.killTweensOf(cubes);
      gsap.set(cubes, { clearProps: "transform" });
    };
  }, [
    cols,
    rows,
    cell,
    maxAngle,
    radius,
    easing,
    duration.enter,
    duration.leave,
    activeSentinelRef,
  ]);

  // Deterministic markup — no Math.random, no measurement — so server and
  // client render identically. GSAP only mutates transforms post-hydration.
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(
        <div
          key={`${r}-${c}`}
          className="marketing-cube"
          data-row={r}
          data-col={c}
        >
          <div className="marketing-cube-face marketing-cube-face--front" />
          <div className="marketing-cube-face marketing-cube-face--top" />
          <div className="marketing-cube-face marketing-cube-face--bottom" />
          <div className="marketing-cube-face marketing-cube-face--left" />
          <div className="marketing-cube-face marketing-cube-face--right" />
        </div>,
      );
    }
  }

  return (
    <div
      ref={sceneRef}
      className="marketing-cubes-scene"
      style={{
        // Tracks are (cell − gap) with a `gap` gutter, so the repeat pitch stays
        // exactly `cell` while the cubes read as distinct dashed squares.
        gridTemplateColumns: `repeat(${cols}, ${cell - gap}px)`,
        gridTemplateRows: `repeat(${rows}, ${cell - gap}px)`,
        gap: `${gap}px`,
        width: cols * cell - gap,
        height: rows * cell - gap,
      }}
    >
      {cells}
    </div>
  );
}
