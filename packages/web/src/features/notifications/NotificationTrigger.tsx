import { A } from '@solidjs/router';
import Bell from 'lucide-solid/icons/bell';
import { buttonVariants } from '@playanime/ui';

/**
 * Notification entry point. It deliberately renders no badge until the API
 * supplies an unread count; an invented zero would imply the inbox was loaded.
 */
export function NotificationTrigger() {
  return (
    <A
      href="/powiadomienia"
      class={buttonVariants({ variant: 'ghost', size: 'icon' })}
      aria-label="Powiadomienia"
    >
      <Bell aria-hidden="true" />
    </A>
  );
}
