import { Placeholder } from '@/components/placeholder';

// The one screen Tier 0 can use. Reading is open; posting is gated per-message,
// so no TierGate wraps the whole screen.
export default function Groups() {
  return (
    <Placeholder title="Groups" phase="Phase 3">
      Study, Sports and Friends. Global, text only, 1024 members per room, then
      Study 2, Study 3 and so on. New joiners see the last 50 messages. Tier 0 can
      read here; posting needs verification.
    </Placeholder>
  );
}
