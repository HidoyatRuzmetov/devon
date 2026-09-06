import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** The one place class names are combined. `twMerge` resolves conflicting Tailwind utilities
 * (e.g. a caller overriding `p-4` with `p-2`) so component `className` props are safe to accept. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
