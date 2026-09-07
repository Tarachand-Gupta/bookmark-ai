import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { contentLayout, type ContentLayout } from "../lib/layout";

/**
 * The shared content-width mechanism, live: re-derives `contentLayout` from the
 * window width, so rotation and iPad Split View resizes re-flow every surface
 * that uses it. Screens spend `inset` as extra horizontal padding (on a list's
 * `contentContainerStyle`, or added to a header's own 20pt gutter) and the
 * Library grid spends `gridColumns`. Zero cost on phones: `inset` is 0 there.
 *
 * Window, not screen, on purpose — inside a Split View pane the window IS the
 * pane, which is what the phone-width fallback keys off (see ../lib/layout).
 */
export function useContentWidth(): ContentLayout {
  const { width } = useWindowDimensions();
  return useMemo(() => contentLayout(width), [width]);
}
