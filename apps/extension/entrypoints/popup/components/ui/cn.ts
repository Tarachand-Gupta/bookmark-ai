/**
 * The popup's entire class-composition toolkit. `clsx`/`cva` are not dependencies
 * of this workspace and the popup ships in a size-sensitive extension bundle, so
 * variants are plain lookup records joined by this three-line helper instead.
 *
 * IT DOES NO CONFLICT RESOLUTION (no tailwind-merge). Two classes touching the
 * same CSS property are resolved by STYLESHEET ORDER, not argument order — e.g.
 * Tailwind emits `.relative` after `.absolute`, so a `relative` baked into a
 * primitive's base silently beats a caller's `absolute`. Rule: a primitive's
 * base must never declare a property a caller is expected to set (position and
 * margin above all); leave those to the call site.
 */
export type ClassValue = string | false | null | undefined;

export function cn(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(" ");
}
