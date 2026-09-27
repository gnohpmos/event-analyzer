import React from 'react';

interface ConfirmModalProps {
  modal: {
    open: boolean;
    title: string;
    message: string;
    confirmText: string;
    isDestructive: boolean;
    onConfirm: () => Promise<void>;
  } | null;
  onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({ modal, onClose }) => {
  if (!modal || !modal.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
        <div className="flex items-center space-x-3">
          <div
            className={`p-2.5 rounded-xl ${
              modal.isDestructive
                ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                : 'bg-primary/10 text-primary border border-primary/20'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={
                  modal.isDestructive
                    ? 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
                    : 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                }
              />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-foreground">{modal.title}</h3>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">{modal.message}</p>

        <div className="flex items-center justify-end space-x-3 pt-3 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg border border-border hover:bg-muted text-foreground transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={modal.onConfirm}
            className={`px-4 py-2 text-xs font-semibold rounded-lg text-white shadow-sm transition-all ${
              modal.isDestructive
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-primary hover:bg-primary/90 text-primary-foreground'
            }`}
          >
            {modal.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
