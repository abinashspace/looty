import { Placeholder } from '@/components/placeholder';

// Reached from the verify screen when a student's college has no known domain.
// These requests are the growth roadmap: the colleges asked for most often are
// the ones worth chasing a domain for.
export default function College() {
  return (
    <Placeholder title="Request your college" phase="Phase 1">
      For students whose college isn't on the list yet. Looty can't verify them
      until it is, so this queue doubles as the signal for which colleges to add
      next.
    </Placeholder>
  );
}
