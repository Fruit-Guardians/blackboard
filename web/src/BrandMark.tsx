/** Open trace: shared with design/blackboard-logo; inline for offline exports. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 128 128" fill="none" aria-hidden="true">
    <path d="M73 20H38C28.059 20 20 28.059 20 38V90C20 99.941 28.059 108 38 108H90C99.941 108 108 99.941 108 90V65" stroke="currentColor" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M46 80L76 50" stroke="currentColor" strokeWidth="12" strokeLinecap="round" />
    <circle cx="98" cy="28" r="10" fill="currentColor" />
  </svg>;
}
