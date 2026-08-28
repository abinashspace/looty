import { Placeholder } from '@/components/placeholder';
import { TierGate } from '@/components/tier-gate';

export default function Chats() {
  return (
    <TierGate capability="directMessage">
      <Placeholder title="Chats" phase="Phase 2">
        Friend DMs and Connected chats. DM images are unmoderated because they are
        friend-gated; Connected chats are between strangers, so images there are
        blurred until tapped.
      </Placeholder>
    </TierGate>
  );
}
