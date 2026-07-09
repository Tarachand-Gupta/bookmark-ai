export function ErrorNote({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
    >
      {message}
    </div>
  );
}
