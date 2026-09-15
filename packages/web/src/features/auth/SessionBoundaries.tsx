import { useNavigate } from '@solidjs/router';
import { Spinner } from '@playanime/ui';
import { createEffect, Show, type JSX } from 'solid-js';
import { useSession } from './SessionProvider.js';

interface BoundaryProps {
  children: JSX.Element;
  /** Destination used once the session has resolved to the opposite state. */
  redirectTo?: string;
  fallback?: JSX.Element;
}

function LoadingSession(props: { fallback?: JSX.Element }) {
  return (
    <Show
      when={props.fallback}
      fallback={
        <div class="flex min-h-48 items-center justify-center">
          <Spinner label="Sprawdzanie sesji…" />
        </div>
      }
    >
      {props.fallback}
    </Show>
  );
}

/**
 * Protects a page that requires a session. It is intentionally not wired into
 * the route table yet, so a route can opt in when its page is introduced.
 */
export function RouteGuard(props: BoundaryProps) {
  const session = useSession();
  const navigate = useNavigate();

  createEffect(() => {
    if (!session.loading() && session.user() === null) {
      navigate(props.redirectTo ?? '/logowanie', { replace: true });
    }
  });

  return (
    <Show when={!session.loading()} fallback={<LoadingSession fallback={props.fallback} />}>
      <Show when={session.isAuthenticated()}>{props.children}</Show>
    </Show>
  );
}

/**
 * Keeps signed-in users out of guest-only pages such as login and registration.
 */
export function GuestBoundary(props: BoundaryProps) {
  const session = useSession();
  const navigate = useNavigate();

  createEffect(() => {
    if (!session.loading() && session.isAuthenticated()) {
      navigate(props.redirectTo ?? '/', { replace: true });
    }
  });

  return (
    <Show when={!session.loading()} fallback={<LoadingSession fallback={props.fallback} />}>
      <Show when={session.user() === null}>{props.children}</Show>
    </Show>
  );
}
