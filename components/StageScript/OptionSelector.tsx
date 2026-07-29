import React from 'react';
import { ChevronRight } from 'lucide-react';
import { STYLES } from './constants';
import { useLocale } from '../../contexts/LocaleContext';

interface Option {
  label: string;
  value: string;
  desc?: string;
}

interface Props {
  label: string;
  icon?: React.ReactNode;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  customInput?: string;
  onCustomInputChange?: (value: string) => void;
  customPlaceholder?: string;
  gridCols?: 1 | 2;
  helpText?: string;
  helpLink?: { text: string; url: string };
}

const OptionSelector: React.FC<Props> = ({
  label,
  icon,
  options,
  value,
  onChange,
  customInput,
  onCustomInputChange,
  customPlaceholder,
  gridCols = 2,
  helpText,
  helpLink
}) => {
  const { t } = useLocale();
  return (
    <div className="space-y-2">
      <label className={`${STYLES.label} flex items-center gap-2`}>
        {icon}
        {label}
      </label>
      <div className={`grid grid-cols-${gridCols} gap-2`}>
        {options.map((opt) => (
          <button
            type="button"
            key={opt.value}
            onClick={() => onChange(opt.value)}
            title={opt.desc}
            className={`min-h-11 px-${gridCols === 1 ? '3' : '2'} py-2.5 text-[11px] font-medium rounded-md transition-all text-${gridCols === 1 ? 'left' : 'center'} border ${
              value === opt.value
                ? STYLES.button.selected
                : `${STYLES.button.secondary} border`
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {value === 'custom' && onCustomInputChange && (
        <div className="pt-1">
          <input 
            type="text"
            aria-label={label}
            value={customInput}
            onChange={(e) => onCustomInputChange(e.target.value)}
            className={`${STYLES.input} font-mono`}
            placeholder={customPlaceholder}
          />
        </div>
      )}
      {helpText && (
        <div className="pt-1 px-3 py-2 bg-white/[0.04] border border-white/10 rounded-xl">
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            {t('script.helpPrefix')} {helpText}
            {helpLink && (
              <>
                {' '}
                <a 
                  href={helpLink.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-zinc-400 hover:text-white underline underline-offset-2 transition-colors font-medium"
                >
                  {helpLink.text}
                </a>
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
};

export default OptionSelector;
