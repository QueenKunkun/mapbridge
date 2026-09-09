/** Small inline outline icons used by the popup. */
export function IconGear({ className = '' }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M9.3 1.6 9 3.2a5 5 0 0 1 1.6.66l1.3-1 1.24 1.24-1 1.3a5 5 0 0 1 .66 1.6l1.6.3v1.8l-1.6.3a5 5 0 0 1-.66 1.6l1 1.3-1.24 1.24-1.3-1a5 5 0 0 1-1.6.66l-.3 1.6H7.1l-.3-1.6a5 5 0 0 1-1.6-.66l-1.3 1L2.66 12.1l1-1.3A5 5 0 0 1 3 9.2l-1.6-.3V7.1l1.6-.3a5 5 0 0 1 .66-1.6l-1-1.3L3.9 2.66l1.3 1a5 5 0 0 1 1.6-.66l.3-1.6Z" />
      <circle cx="8" cy="8" r="2.1" />
    </svg>
  );
}

export function IconSearch({ className = '' }: { className?: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2L14 14" />
    </svg>
  );
}
