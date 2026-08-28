import { Placeholder } from '@/components/placeholder';

export default function Verify() {
  return (
    <Placeholder title="Student ID + selfie" phase="Phase 1">
      Selfie must be camera-only with a random prompt, so a photo of a photo fails.
      Face-matching the card against the selfie is the highest-value check here:
      almost nobody forges a card, they use someone else's real one.
    </Placeholder>
  );
}
