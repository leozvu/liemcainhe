import React from 'react';
import { Edit2, Check, X } from 'lucide-react';
import { STYLES } from './constants';
import { useLocale } from '../../contexts/LocaleContext';

interface Props {
  isEditing: boolean;
  value: string;
  displayValue?: string;
  onEdit: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
  italic?: boolean;
  showEditButton?: boolean;
  emptyText?: string;
}

const InlineEditor: React.FC<Props> = ({
  isEditing,
  value,
  displayValue,
  onEdit,
  onChange,
  onSave,
  onCancel,
  placeholder,
  rows = 4,
  mono = false,
  italic = false,
  showEditButton = true,
  emptyText,
}) => {
  const { t } = useLocale();
  const resolvedPlaceholder = placeholder || t('script.inlinePlaceholder');
  const resolvedEmptyText = emptyText || t('script.inlineEmpty');
  if (isEditing) {
    return (
      <div className="space-y-2">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${STYLES.editor.textarea} ${mono ? STYLES.editor.mono : ''} ${italic ? STYLES.editor.serif : ''}`}
          rows={rows}
          placeholder={resolvedPlaceholder}
          aria-label={resolvedPlaceholder}
          autoFocus
        />
        <div className="flex gap-2">
          <button
            onClick={onSave}
            type="button"
            className="min-h-11 px-3 py-1.5 bg-cyan-300 text-slate-950 text-xs font-bold rounded-xl flex items-center gap-1 hover:bg-cyan-200 transition-colors"
          >
            <Check className="w-3 h-3" />
            {t('script.save')}
          </button>
          <button
            onClick={onCancel}
            type="button"
            className="min-h-11 px-3 py-1.5 bg-white/10 text-zinc-400 text-xs font-bold rounded-xl flex items-center gap-1 hover:bg-white/15 transition-colors"
          >
            <X className="w-3 h-3" />
            {t('script.cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 group">
      <p className={`flex-1 text-[10px] text-zinc-500 leading-relaxed ${mono ? 'font-mono' : ''} ${italic ? 'font-serif italic' : ''} ${!displayValue && !value ? 'text-zinc-700' : ''}`}>
        {displayValue || value || resolvedEmptyText}
      </p>
      {showEditButton && (
        <button
          onClick={onEdit}
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center opacity-70 transition-opacity hover:bg-white/10 hover:opacity-100 rounded-xl flex-shrink-0"
          title={t('script.edit')}
          aria-label={t('script.edit')}
        >
          <Edit2 className="w-3 h-3 text-zinc-500 hover:text-white" />
        </button>
      )}
    </div>
  );
};

export default InlineEditor;
