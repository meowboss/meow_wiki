import { useEffect, useRef, type ComponentProps } from 'react';
import { FolderOpen, X } from 'lucide-react';
import Modal from '../../shared/ui/Modal';
import WorkshopProjectPicker from './WorkshopProjectPicker';
import './project-menu.css';
type Props = ComponentProps<typeof WorkshopProjectPicker> & {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
};
export default function WorkshopProjectMenu({ open, onOpen, onClose, ...picker }: Props) {
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const dialog = closeButton.current?.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const items = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ),
      ).filter((node) => !node.closest('[hidden], [inert]') && node.getClientRects().length > 0);
    closeButton.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const list = items();
      const first = list[0];
      const last = list.at(-1);
      if (
        !dialog.contains(document.activeElement) ||
        (event.shiftKey ? document.activeElement === first : document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
      trigger.current?.focus();
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        className="workshop-project-menu-trigger"
        type="button"
        aria-label="项目与页面"
        title="项目与页面"
        onClick={onOpen}
      >
        <FolderOpen size={19} />
      </button>
      {open && (
        <Modal className="workshop-project-modal" aria-label="项目与页面" onBackdropClick={onClose}>
          <header>
            <h2>项目与页面</h2>
            <button ref={closeButton} type="button" aria-label="关闭项目菜单" onClick={onClose}>
              <X size={18} />
            </button>
          </header>
          <WorkshopProjectPicker {...picker} />
        </Modal>
      )}
    </>
  );
}
