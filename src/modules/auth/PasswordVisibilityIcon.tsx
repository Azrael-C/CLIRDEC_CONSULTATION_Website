export function PasswordVisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {visible ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.3A10.8 10.8 0 0 1 12 4c5.2 0 9 4.7 9 8a8.5 8.5 0 0 1-2.1 3.9M6.6 6.6C4.3 8 3 10.3 3 12c0 3.3 3.8 8 9 8 1.1 0 2.2-.2 3.1-.6" />
        </>
      ) : (
        <>
          <path d="M3 12c0-3.3 3.8-8 9-8s9 4.7 9 8-3.8 8-9 8-9-4.7-9-8Z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      )}
    </svg>
  );
}
