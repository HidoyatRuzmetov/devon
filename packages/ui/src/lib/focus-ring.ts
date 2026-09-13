/** DESIGN.md §2.4 "Focus ring": one ring everywhere, 2 px, offset 2 px, `--color-ring`.
 *
 * The catalogue asks for the ring to *grow* rather than appear (`--dur-micro`), and a field that
 * only declares `transition-colors` cannot do that — Tailwind paints the ring as a `box-shadow`, and
 * `transition-colors` does not include `box-shadow`, so the ring was snapping on while the border
 * beside it faded. Every text-entry surface in the package now transitions the same four properties,
 * from this one string, so the ring and the border it sits outside of always arrive together.
 *
 * `--dur-micro` is 0 ms under `prefers-reduced-motion` (the backstop in `tokens.css`), so the ring
 * still appears instantly for anyone who asked for that — it is never removed. */
export const FIELD_TRANSITION =
  'transition-[color,background-color,border-color,box-shadow] duration-(--dur-micro) ease-out'
