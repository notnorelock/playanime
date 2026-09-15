import { TextField } from '@kobalte/core/text-field';
import { cva, type VariantProps } from 'class-variance-authority';
import { Show, splitProps, type JSX } from 'solid-js';
import { cn } from '../utils/cn.js';

/**
 * Text input, textarea, and their label/description/error scaffolding.
 *
 * Kobalte's TextField wires the label, description and error message to the
 * control with the right `aria-describedby` and `aria-invalid` — the part
 * hand-rolled inputs almost always get wrong, and the part a screen-reader user
 * depends on to know a field failed validation.
 */

const fieldVariants = cva(
  cn(
    'w-full bg-ink-850 text-paper placeholder:text-slate-500',
    'border border-ink-600 rounded-md',
    'transition-colors duration-[120ms] ease-out',
    'hover:border-ink-500',
    'focus:border-amber-400 focus:outline-none',
    'focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900',
    'disabled:opacity-45 disabled:cursor-not-allowed',
    // Kobalte sets data-invalid on the control when validation fails.
    'data-[invalid]:border-rose-400',
  ),
  {
    variants: {
      size: {
        sm: 'h-8 px-2.5 text-xs',
        md: 'h-10 px-3 text-sm',
        lg: 'h-12 px-4 text-base',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface InputProps extends VariantProps<typeof fieldVariants> {
  label?: string;
  /** Helper text. Rendered below the field and linked via aria-describedby. */
  description?: string;
  /** Validation message. Replaces the description and marks the field invalid. */
  error?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  type?: 'text' | 'email' | 'password' | 'url' | 'search' | 'tel';
  name?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  autocomplete?: string;
  maxLength?: number;
  /** Class applied to the field wrapper; `class` styles the input itself. */
  rootClass?: string;
  class?: string;
  /** Rendered inside the field, before the text. */
  icon?: JSX.Element;
  /** Interactive or presentational content aligned after the text. */
  endAdornment?: JSX.Element;
}

export function Input(props: InputProps) {
  const [local, rest] = splitProps(props, [
    'label',
    'description',
    'error',
    'size',
    'rootClass',
    'class',
    'icon',
    'endAdornment',
    'onChange',
    'autocomplete',
  ]);

  return (
    <TextField
      class={cn('flex flex-col gap-1.5', local.rootClass)}
      validationState={local.error === undefined ? 'valid' : 'invalid'}
      onChange={local.onChange}
      {...rest}
    >
      <Show when={local.label}>
        {(label) => (
          <TextField.Label class="text-xs font-medium text-slate-300">
            {label()}
            <Show when={props.required}>
              {/* Marked for sighted users and announced for others. */}
              <span class="text-amber-400 ml-0.5" aria-hidden="true">
                *
              </span>
            </Show>
          </TextField.Label>
        )}
      </Show>

      <div class="relative flex items-center">
        <Show when={local.icon}>
          <span class="absolute left-3 text-slate-400 pointer-events-none [&_svg]:size-4">{local.icon}</span>
        </Show>

        <TextField.Input
          class={cn(
            fieldVariants({ size: local.size }),
            local.icon !== undefined && 'pl-9',
            local.endAdornment !== undefined && 'pr-10',
            local.class,
          )}
          autocomplete={local.autocomplete}
        />
        <Show when={local.endAdornment}>
          <span class="absolute right-2.5 inline-flex items-center text-slate-400 [&_svg]:size-4">
            {local.endAdornment}
          </span>
        </Show>
      </div>

      <Show when={local.description !== undefined && local.error === undefined}>
        <TextField.Description class="text-xs text-slate-400">{local.description}</TextField.Description>
      </Show>

      <Show when={local.error}>
        {(error) => <TextField.ErrorMessage class="text-xs text-rose-400">{error()}</TextField.ErrorMessage>}
      </Show>
    </TextField>
  );
}

export interface TextareaProps extends Omit<InputProps, 'type' | 'icon' | 'endAdornment' | 'size'> {
  rows?: number;
  /** Grows with content up to a cap, rather than scrolling internally. */
  autoResize?: boolean;
}

export function Textarea(props: TextareaProps) {
  const [local, rest] = splitProps(props, [
    'label',
    'description',
    'error',
    'rootClass',
    'class',
    'rows',
    'autoResize',
    'onChange',
  ]);

  return (
    <TextField
      class={cn('flex flex-col gap-1.5', local.rootClass)}
      validationState={local.error === undefined ? 'valid' : 'invalid'}
      onChange={local.onChange}
      {...rest}
    >
      <Show when={local.label}>
        {(label) => <TextField.Label class="text-xs font-medium text-slate-300">{label()}</TextField.Label>}
      </Show>

      <TextField.TextArea
        rows={local.rows ?? 4}
        autoResize={local.autoResize}
        class={cn(
          'w-full bg-ink-850 text-paper placeholder:text-slate-500 text-sm',
          'border border-ink-600 rounded-md px-3 py-2.5',
          'transition-colors duration-[120ms] ease-out resize-y',
          'hover:border-ink-500 focus:border-amber-400 focus:outline-none',
          'focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900',
          'disabled:opacity-45 data-[invalid]:border-rose-400',
          local.class,
        )}
      />

      <Show when={local.description !== undefined && local.error === undefined}>
        <TextField.Description class="text-xs text-slate-400">{local.description}</TextField.Description>
      </Show>

      <Show when={local.error}>
        {(error) => <TextField.ErrorMessage class="text-xs text-rose-400">{error()}</TextField.ErrorMessage>}
      </Show>
    </TextField>
  );
}
