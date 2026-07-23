import React, {type ReactNode} from 'react';
import ThemedImage from '@theme/ThemedImage';
import useBaseUrl from '@docusaurus/useBaseUrl';

import styles from './Screenshot.module.css';

type Props = {
  /** Descriptive alt text (also used as the accessible caption). */
  alt: string;
  /** Path to the dark-mode screenshot, e.g. "/img/screenshots/library-dark.jpg". */
  dark: string;
  /** Path to the light-mode screenshot. Omit for a single-variant image. */
  light?: string;
  /** Optional visible caption under the frame. */
  caption?: ReactNode;
};

/**
 * A framed product screenshot. When both `dark` and `light` are given it swaps
 * with the active theme via ThemedImage; with only `dark` it renders a plain
 * framed <img>. The frame (rounded border + subtle shadow) makes screenshots
 * read as intentional rather than pasted-in.
 */
export default function Screenshot({
  alt,
  dark,
  light,
  caption,
}: Props): ReactNode {
  const darkUrl = useBaseUrl(dark);
  const lightUrl = useBaseUrl(light ?? dark);

  return (
    <figure className={styles.figure}>
      <div className={styles.frame}>
        {light ? (
          <ThemedImage
            className={styles.image}
            alt={alt}
            sources={{light: lightUrl, dark: darkUrl}}
          />
        ) : (
          <img className={styles.image} alt={alt} src={darkUrl} loading="lazy" />
        )}
      </div>
      {caption ? (
        <figcaption className={styles.caption}>{caption}</figcaption>
      ) : null}
    </figure>
  );
}
