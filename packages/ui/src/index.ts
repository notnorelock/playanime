/**
 * @playanime/ui — the PlayAnime design system.
 *
 * Generic, domain-free components only. Anything that knows what an anime is
 * — AnimeCard, EpisodeList, SourceSelector, WatchPartyChat — belongs in a web
 * feature, not here. The test: if a component would be meaningless in a
 * different product, it does not go in this package.
 *
 * Built on Kobalte for behaviour and accessibility, CVA for variants, following
 * the shadcn pattern of owned source rather than a themed dependency.
 */

export { Button, buttonVariants } from './components/Button.js';
export type { ButtonProps, ButtonVariants } from './components/Button.js';

export { Input, Textarea } from './components/Input.js';
export type { InputProps, TextareaProps } from './components/Input.js';

export { Select } from './components/Select.js';
export type { SelectProps, SelectOption } from './components/Select.js';

export { Checkbox } from './components/Checkbox.js';
export type { CheckboxProps } from './components/Checkbox.js';

export { Switch } from './components/Switch.js';
export type { SwitchProps } from './components/Switch.js';

export { Badge, badgeVariants } from './components/Badge.js';
export type { BadgeProps } from './components/Badge.js';

export { Avatar } from './components/Avatar.js';
export type { AvatarProps } from './components/Avatar.js';

export { Skeleton, SkeletonCard } from './components/Skeleton.js';
export type { SkeletonProps } from './components/Skeleton.js';

export { Spinner } from './components/Spinner.js';
export type { SpinnerProps } from './components/Spinner.js';

export { Progress } from './components/Progress.js';
export type { ProgressProps } from './components/Progress.js';

export { Dialog, Drawer, DialogTrigger, DialogRoot } from './components/Dialog.js';
export type { DialogProps, DrawerProps } from './components/Dialog.js';

export { Dropdown, DropdownRoot } from './components/Dropdown.js';
export type { DropdownProps, DropdownItem } from './components/Dropdown.js';

export { Tooltip } from './components/Tooltip.js';
export type { TooltipProps } from './components/Tooltip.js';

export { Tabs } from './components/Tabs.js';
export type { TabsProps, TabItem } from './components/Tabs.js';

export { showToast, ToastViewport, toaster } from './components/Toast.js';
export type { ShowToastOptions, ToastKind } from './components/Toast.js';

export { cn } from './utils/cn.js';
