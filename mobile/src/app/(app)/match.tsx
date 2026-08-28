import { Placeholder } from '@/components/placeholder';
import { TierGate } from '@/components/tier-gate';

export default function Match() {
  return (
    <TierGate capability="lootyMatch">
      <Placeholder title="Looty Match" phase="Phase 4">
        Vertical feed of DP, username and name. Loot or pass, 10 loots a day free.
        A mutual loot means Connected — never call it a match in anything a user
        can read.
      </Placeholder>
    </TierGate>
  );
}
