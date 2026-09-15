import { Image } from '@kobalte/core/image';
import { splitProps } from 'solid-js';
import { cn } from '../utils/cn.js';

/**
 * User avatar with an initials fallback.
 *
 * Kobalte's Image primitive only swaps to the fallback once the image has
 * genuinely failed, avoiding the flash of initials that appears when a naive
 * implementation renders the fallback first and the image second.
 */
export interface AvatarProps {
  src?: string | null;
  /** Used for the alt text and to derive the fallback initials. */
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  loading?: 'eager' | 'lazy';
  /** Overrides initials when a short, stable fallback is preferred. */
  fallback?: string;
  class?: string;
}

const SIZES = {
  xs: 'size-6 text-2xs',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-base',
  xl: 'size-20 text-xl',
} as const;

/** First letters of the first two words — "Jan Kowalski" becomes "JK". */
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export function Avatar(props: AvatarProps) {
  const [local] = splitProps(props, ['src', 'name', 'size', 'loading', 'fallback', 'class']);

  return (
    <Image
      class={cn(
        'image-frame relative inline-flex shrink-0 rounded-full',
        'border border-ink-600',
        SIZES[local.size ?? 'md'],
        local.class,
      )}
    >
      <Image.Img
        src={local.src ?? undefined}
        alt={local.name}
        class="size-full object-cover"
        loading={local.loading ?? 'lazy'}
      />
      <Image.Fallback class="flex size-full items-center justify-center font-medium text-slate-300">
        {local.fallback ?? initials(local.name)}
      </Image.Fallback>
    </Image>
  );
}
