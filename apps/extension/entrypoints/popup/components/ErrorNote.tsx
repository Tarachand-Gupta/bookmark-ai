/**
 * A failed action, in the new card chrome: the same 10px radius and hairline
 * border as every other block, tinted destructive. 11px so it reads as a note
 * under the control that failed, not a panel of its own.
 */
export function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] leading-snug text-destructive"
    >
      {message}
    </p>
  );
}
