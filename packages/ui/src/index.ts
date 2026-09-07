// Public API of @devon/ui (mirrors the @devon/db / @devon/i18n convention: consumers import only
// from here, never from a deep `src/*` path). Tokens are consumed as CSS, not JS -- see
// `styles/tokens.css` and `styles/fonts.css`, exported as package subpaths in `package.json`.

export { cn } from './lib/cn.js'
export { isMacPlatform, modKeyLabel } from './lib/platform.js'
export { useReducedMotion } from './lib/use-reduced-motion.js'
export { useFontsLoaded } from './lib/use-fonts-loaded.js'
export { labelChipColors, type LabelChipColors } from './lib/label-color.js'
// The motion catalogue (UI-OVERHAUL.md §3): tokens, provider, and one reusable piece per row.
// Re-exports the duration/ease/spring constants from `lib/motion-tokens.ts` too, so a consumer that
// mixes CSS transitions and `motion` animations still has exactly one import.
export * from './motion/index.js'

export { Button, buttonVariants, type ButtonProps } from './primitives/button.js'
export { IconButton, iconButtonVariants, type IconButtonProps } from './primitives/icon-button.js'
export { Input, type InputProps } from './primitives/input.js'
export { Textarea, type TextareaProps } from './primitives/textarea.js'
export { Select, type SelectOption, type SelectProps } from './primitives/select.js'
export { Field, type FieldProps } from './primitives/field.js'
export { Kbd, ModKbd, type KbdProps } from './primitives/kbd.js'
export { Badge, badgeVariants, type BadgeProps } from './primitives/badge.js'
export { Avatar, initialsFromName, unitHueClass, type AvatarProps } from './primitives/avatar.js'
export { Separator } from './primitives/separator.js'
export { Skeleton, type SkeletonProps } from './primitives/skeleton.js'

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './primitives/tooltip.js'
export {
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from './primitives/popover.js'
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './primitives/dropdown-menu.js'
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogTrigger,
  type DialogContentProps,
} from './primitives/dialog.js'
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetOverlay,
  SheetPortal,
  SheetTrigger,
  type SheetContentProps,
} from './primitives/sheet.js'
export {
  Toaster,
  toast,
  toastWithUndo,
  TOAST_DURATION_MS,
  type UndoToastOptions,
} from './primitives/toast.js'

// -- Overhaul primitives (UI-OVERHAUL.md §2 / DESIGN.md §3) ----------------------------------------
export { Checkbox, type CheckboxProps } from './primitives/checkbox.js'
export { Switch, type SwitchProps } from './primitives/switch.js'
export {
  RadioGroup,
  RadioGroupItem,
  RadioOption,
  type RadioOptionProps,
} from './primitives/radio-group.js'
export {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type TabsTriggerProps,
} from './primitives/tabs.js'
export {
  Combobox,
  comboboxScore,
  normalizeForSearch,
  type ComboboxOption,
  type ComboboxProps,
} from './primitives/combobox.js'
export {
  Calendar,
  DatePicker,
  type CalendarProps,
  type DatePickerProps,
} from './primitives/date-picker.js'
export { Progress, type ProgressProps } from './primitives/progress.js'
export {
  Chip,
  chipVariants,
  FilterChip,
  type ChipProps,
  type FilterChipProps,
} from './primitives/chip.js'
export { Breadcrumb, type BreadcrumbItem, type BreadcrumbProps } from './primitives/breadcrumb.js'
export {
  Card,
  cardVariants,
  SectionCard,
  type CardProps,
  type SectionCardProps,
} from './primitives/card.js'
export { KpiTile, type KpiTileProps } from './primitives/kpi-tile.js'
export {
  AvatarStack,
  type AvatarStackPerson,
  type AvatarStackProps,
} from './primitives/avatar-stack.js'
export { DataList, DataRow, type DataListProps, type DataRowProps } from './primitives/data-list.js'
export { PageHeader, type PageHeaderProps } from './primitives/page-header.js'
export { SparkleButton, type SparkleButtonProps } from './primitives/sparkle-button.js'
export { AiPreviewPanel, type AiPreviewPanelProps } from './primitives/ai-preview-panel.js'

export {
  StateView,
  type StateKind,
  type StateViewAction,
  type StateViewProps,
} from './states/state-view.js'
export {
  EmptyState,
  ErrorState,
  NoPermissionState,
  OfflineState,
  COMPACT_STATE_ICON,
  type StateAction,
  type ErrorStateProps,
} from './states/empty-state.js'
export { OfflineBanner, type OfflineBannerProps } from './states/offline-banner.js'

// Open-licence illustration set, recoloured to tokens (DESIGN.md v2 §2.7).
export * from './illustrations/index.js'

export { resolveNavEntries, type NavContext, type NavEntry } from './shell/nav-registry.js'
export { Sidebar, type NavGroup, type SidebarProps } from './shell/sidebar.js'
export {
  DepartmentSwitcher,
  type DepartmentOption,
  type DepartmentSwitcherProps,
} from './shell/department-switcher.js'
export {
  SidebarUserBlock,
  type UserBlockAction,
  type SidebarUserBlockProps,
} from './shell/sidebar-user-block.js'
export { ThemeToggle, type ThemeToggleValue, type ThemeToggleProps } from './shell/theme-toggle.js'
export { InboxBell, type InboxBellProps } from './shell/inbox-bell.js'
export { QuickAdd, type QuickAddAction, type QuickAddProps } from './shell/quick-add.js'
export { BottomTabBar, type BottomTabBarProps } from './shell/bottom-tab-bar.js'
export {
  PageContainer,
  RouteSkeleton,
  type PageContainerProps,
  type RouteSkeletonProps,
} from './shell/page-container.js'
export { TopBar, type TopBarProps } from './shell/top-bar.js'
export { SearchTrigger, type SearchTriggerProps } from './shell/search-trigger.js'
export { DemoChip, type DemoChipProps } from './shell/demo-chip.js'
export { LocaleMenu, type LocaleOption, type LocaleMenuProps } from './shell/locale-menu.js'
export { AvatarMenu, type ThemeOption, type AvatarMenuProps } from './shell/avatar-menu.js'
export {
  CommandPalette,
  type CommandPaletteGroup,
  type CommandPaletteItem,
  type CommandPaletteProps,
} from './shell/command-palette.js'
export {
  ShortcutOverlay,
  type ShortcutEntry,
  type ShortcutOverlayProps,
} from './shell/shortcut-overlay.js'
