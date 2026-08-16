/**
 * Mock mode banner — persistent, unsuppressible amber bar (context.md §6.4).
 */

interface MockBannerProps {
  visible: boolean;
}

export function MockBanner({ visible }: MockBannerProps) {
  if (!visible) return null;

  return (
    <div className="bg-amber-600 text-black text-center py-2 px-4 text-sm font-medium sticky top-0 z-50">
      ⚠️ MOCK MODE — not a real Kiro session
    </div>
  );
}
