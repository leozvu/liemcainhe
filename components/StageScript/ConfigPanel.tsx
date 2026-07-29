import React from 'react';
import { BookOpen, Wand2, BrainCircuit, AlertCircle, ChevronRight, Aperture } from 'lucide-react';
import OptionSelector from './OptionSelector';
import { DURATION_OPTIONS, LANGUAGE_OPTIONS, VISUAL_STYLE_OPTIONS, STYLES } from './constants';
import ModelSelector from '../ModelSelector';
import { useLocale } from '../../contexts/LocaleContext';

interface Props {
  title: string;
  duration: string;
  language: string;
  model: string;
  visualStyle: string;
  customDurationInput: string;
  customModelInput: string;
  customStyleInput: string;
  isProcessing: boolean;
  error: string | null;
  onTitleChange: (value: string) => void;
  onDurationChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onVisualStyleChange: (value: string) => void;
  onCustomDurationChange: (value: string) => void;
  onCustomModelChange: (value: string) => void;
  onCustomStyleChange: (value: string) => void;
  onAnalyze: () => void;
}

const ConfigPanel: React.FC<Props> = ({
  title,
  duration,
  language,
  model,
  visualStyle,
  customDurationInput,
  customModelInput,
  customStyleInput,
  isProcessing,
  error,
  onTitleChange,
  onDurationChange,
  onLanguageChange,
  onModelChange,
  onVisualStyleChange,
  onCustomDurationChange,
  onCustomModelChange,
  onCustomStyleChange,
  onAnalyze
}) => {
  const { t } = useLocale();
  const localizeOptions = (options: typeof DURATION_OPTIONS) => options.map((option) => ({
    ...option,
    label: t(option.label),
    desc: option.desc ? t(option.desc) : undefined,
  }));

  return (
    <div className="w-full border-b border-cyan-300/10 bg-slate-950/60 backdrop-blur-2xl md:w-96 md:border-b-0 md:border-r flex flex-col">
      <div className="h-16 px-5 border-b border-white/10 flex items-center justify-between shrink-0 bg-white/[0.03]">
        <h2 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-cyan-300" />
          {t('script.configTitle')}
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        <div className="space-y-2">
          <label htmlFor="script-project-title" className={STYLES.label}>{t('script.projectName')}</label>
          <input 
            id="script-project-title"
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            className={STYLES.input}
            placeholder={t('script.projectPlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="script-output-language" className={STYLES.label}>{t('script.outputLanguage')}</label>
          <div className="relative">
            <select
              id="script-output-language"
              value={language}
              onChange={(e) => onLanguageChange(e.target.value)}
              className={STYLES.select}
            >
              {LANGUAGE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{t(opt.label)}</option>
              ))}
            </select>
            <div className="absolute right-3 top-3 pointer-events-none">
              <ChevronRight className="w-4 h-4 text-zinc-600 rotate-90" />
            </div>
          </div>
        </div>

        <OptionSelector
          label={t('script.targetDuration')}
          options={localizeOptions(DURATION_OPTIONS)}
          value={duration}
          onChange={onDurationChange}
          customInput={customDurationInput}
          onCustomInputChange={onCustomDurationChange}
          customPlaceholder={t('script.durationPlaceholder')}
          gridCols={2}
        />

        <div className="space-y-2">
          <ModelSelector
            type="chat"
            value={model}
            onChange={onModelChange}
            disabled={isProcessing}
            label={t('script.storyboardModel')}
          />
          <p className="text-[9px] text-slate-500">
            {t('script.modelHelp')} <span className="text-cyan-300">{t('script.modelSettings')}</span>
          </p>
        </div>

        <OptionSelector
          label={t('script.visualStyle')}
          icon={<Wand2 className="w-3 h-3" />}
          options={localizeOptions(VISUAL_STYLE_OPTIONS)}
          value={visualStyle}
          onChange={onVisualStyleChange}
          customInput={customStyleInput}
          onCustomInputChange={onCustomStyleChange}
          customPlaceholder={t('script.stylePlaceholder')}
          gridCols={2}
        />
      </div>

      <div className="p-6 border-t border-white/10 bg-slate-950/70">
        <button
          onClick={onAnalyze}
          disabled={isProcessing}
          className={`w-full py-3.5 font-bold text-xs tracking-widest uppercase rounded-lg flex items-center justify-center gap-2 transition-all shadow-lg ${
            isProcessing 
              ? STYLES.button.disabled
              : STYLES.button.primary
          }`}
        >
          {isProcessing ? (
            <>
              <BrainCircuit className="w-4 h-4 animate-spin" />
              {t('script.analyzing')}
            </>
          ) : (
            <>
              <Wand2 className="w-4 h-4" />
              {t('script.createStoryboard')}
            </>
          )}
        </button>
        {error && (
          <div role="alert" className="mt-4 p-3 bg-red-900/10 border border-red-900/50 text-red-400 text-xs rounded flex items-center gap-2">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConfigPanel;
