import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/** twMerge's default config has no idea the Devon type scale (`--text-caption` … `--text-hero` in
 * `tokens.css`) exists, so it falls back to treating any `text-<word>` utility -- a font size like
 * `text-lead` and a colour like `text-primary-foreground` alike -- as the same ambiguous conflict
 * group and keeps only the last one written. That silently deletes button label colours whenever a
 * size class is applied after the colour class in the same `cn()` call (see button.tsx: base emits
 * `text-body`, the variant emits `text-primary-foreground`, and `size="lg"`/`size="sm"` emit
 * `text-lead`/`text-small` last, so the colour class is the one that gets dropped -- `size="md"` has
 * no size class of its own and survives by accident). Registering the scale as its own `font-size`
 * classGroup tells twMerge these are sizes, not colours, so they merge only against each other. */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['caption', 'small', 'body', 'lead', 'h3', 'h2', 'h1', 'hero'] }],
    },
  },
})

/** The one place class names are combined. `twMerge` resolves conflicting Tailwind utilities
 * (e.g. a caller overriding `p-4` with `p-2`) so component `className` props are safe to accept. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
