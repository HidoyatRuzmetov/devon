import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.js'

/** DESIGN.md §6 / spec.md: 44px touch target at 390, >=24px everywhere. `size="touch"` is the
 * 44x44 variant used in the shell (☰, search icon, avatar trigger at 390); `md` (36px) is for
 * desktop-density chrome. An accessible name is mandatory -- there is no icon-only affordance
 * without one, so `aria-label` is a required prop, not optional. */
export const iconButtonVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded-sm text-foreground ' +
    'transition-colors duration-(--dur-micro) ease-out hover:bg-accent ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
    'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  {
    variants: {
      size: {
        md: 'size-9 max-md:size-11 [&_svg]:size-4.5',
        touch: 'size-11 [&_svg]:size-5',
      },
    },
    defaultVariants: { size: 'md' },
  },
)

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconButtonVariants> {
  'aria-label': string
  /** Contextual icons use the same concise description on hover and keyboard focus.
   * The application supplies TooltipProvider; the accessible name remains mandatory. */
  tooltip?: React.ReactNode
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size, tooltip, ...props }, ref) => {
    const button = (
      <button
        ref={ref}
        type="button"
        className={cn(iconButtonVariants({ size }), className)}
        {...props}
      />
    )
    return tooltip ? (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    ) : (
      button
    )
  },
)
IconButton.displayName = 'IconButton'
