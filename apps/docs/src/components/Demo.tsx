import React, {type ReactNode} from 'react';

import styles from './Demo.module.css';

type Props = {
  /**
   * The animation. Import it from `@bookmark-ai/ui/demos/*` — these are the
   * SAME components the marketing landing page and the in-app onboarding tour
   * render, not docs-only copies, so the docs can't drift from the product.
   */
  children: ReactNode;
  /**
   * Required, not optional. Every demo component is `aria-hidden` (they're
   * narration, not UI), so the caption is the only thing a screen reader gets —
   * it has to say what the animation shows, and the surrounding prose has to
   * carry the actual meaning.
   */
  caption: ReactNode;
  /** Max render width in px. Use it for the narrow, popup-shaped demos. */
  maxWidth?: number;
};

/**
 * A framed product animation — the moving counterpart to `<Screenshot>`, and
 * deliberately wearing the same frame so a page that uses both reads as one set.
 *
 * The `bmk-demo` class is what scopes the compiled Tailwind utilities and their
 * stand-in reset to this subtree (see src/css/demos.src.css). Without it the
 * animation renders as unstyled divs.
 *
 * Motion: every one of these components already gates its own animation behind
 * `prefers-reduced-motion` and is authored to settle on its FINAL phase, so a
 * reduced-motion visitor — and server-rendered HTML before hydration — gets a
 * complete, true picture rather than a frozen half state. Nothing extra needed
 * here.
 */
export default function Demo({children, caption, maxWidth}: Props): ReactNode {
  return (
    <figure className={styles.figure} style={maxWidth ? {maxWidth} : undefined}>
      <div className={`${styles.frame} bmk-demo`}>{children}</div>
      <figcaption className={styles.caption}>{caption}</figcaption>
    </figure>
  );
}
