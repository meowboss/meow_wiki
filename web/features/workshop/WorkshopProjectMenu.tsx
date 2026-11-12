import { useRef, type ComponentProps } from 'react';
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
            <button type="button" aria-label="关闭项目菜单" onClick={onClose}>
              <X size={18} />
            </button>
          </header>
          <WorkshopProjectPicker {...picker} />
        </Modal>
      )}
    </>
  );
}
