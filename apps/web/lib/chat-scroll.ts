/** scrollHeight/clientHeight are rounded, but scrollTop can be fractional at
 * browser zoom levels. Accept the reached pixel instead of chasing an
 * unrepresentable fraction forever. Keep larger movements under user control. */
export function chatScrollTarget(target: number, current: number): number {
  const remaining = target - current;
  return remaining > 0 && remaining <= 1 ? current : target;
}
