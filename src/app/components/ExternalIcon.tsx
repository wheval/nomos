// The "opens elsewhere" mark. Was a literal arrow character, which renders as
// whatever arrow the system font happens to ship — heavy, misaligned with the
// text beside it, and different on every platform. An inline SVG sits on the
// baseline, inherits colour, and looks the same everywhere.
export default function ExternalIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      style={{ display: "inline-block", verticalAlign: "baseline", marginLeft: 4, flex: "none" }}
    >
      <path
        d="M4.5 2h5.5v5.5M10 2L2.5 9.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
