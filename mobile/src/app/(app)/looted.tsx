import { Placeholder } from '@/components/placeholder';
import { TierGate } from '@/components/tier-gate';

export default function Looted() {
  return (
    <TierGate capability="lootyMatch">
      <Placeholder title="Looted you" phase="Phase 4">
        Blurred by default. Revealing it is the paid tier's main draw, alongside
        ad-free and 50 loots a day.
      </Placeholder>
    </TierGate>
  );
}
