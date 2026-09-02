/**
 * Screens that change unread / requests / looted-you counts tell the tab bar
 * to recount. thread_reads has no client grants, so realtime cannot do this.
 */

const listeners = new Set<() => void>();

export function subscribeBadges(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function notifyBadges() {
  for (const fn of listeners) fn();
}
