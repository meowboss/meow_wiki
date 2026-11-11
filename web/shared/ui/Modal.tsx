import type { ReactNode } from 'react';

type ModalProps = {
  children: ReactNode;
  className: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  onBackdropClick: () => void;
};

// Presentation only: callers retain their existing focus, Escape and busy guards.
// Keeping the same div > section structure also preserves modal CSS selectors.
export default function Modal({ children, className, onBackdropClick, ...label }: ModalProps) {
  return (
    <div className="modal-backdrop" onClick={onBackdropClick}>
      <section
        className={className}
        role="dialog"
        aria-modal="true"
        {...label}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}
