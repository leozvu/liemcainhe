import React from 'react';
import { Upload, Sparkles, Loader2 } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';

interface ImageUploadButtonProps {
  onUpload: (file: File) => void;
  onGenerate?: () => void;
  isGenerating?: boolean;
  hasImage?: boolean;
  uploadLabel?: string;
  generateLabel?: string;
  size?: 'small' | 'medium' | 'large';
  variant?: 'inline' | 'separate';
}

const ImageUploadButton: React.FC<ImageUploadButtonProps> = ({
  onUpload,
  onGenerate,
  isGenerating = false,
  hasImage = false,
  uploadLabel,
  generateLabel,
  size = 'medium',
  variant = 'separate',
}) => {
  const { t } = useLocale();
  const resolvedUploadLabel = uploadLabel || t('assets.upload');
  const resolvedGenerateLabel = generateLabel || t('assets.generateImage');
  const sizeClasses = {
    small: 'px-3 py-1.5 text-[10px]',
    medium: 'px-4 py-2 text-xs',
    large: 'px-6 py-3 text-sm',
  };

  const buttonClass = `${sizeClasses[size]} min-h-11 bg-white/[0.07] text-slate-300 hover:bg-white/10 hover:text-white rounded-xl font-bold transition-all border border-white/10 hover:border-cyan-300/30 flex items-center gap-1 cursor-pointer`;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
      e.target.value = '';
    }
  };

  if (variant === 'inline') {
    return (
      <div className="flex gap-1">
        {onGenerate && (
          <button
            type="button"
            onClick={onGenerate}
            disabled={isGenerating}
            className={buttonClass}
          >
            {isGenerating ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            {resolvedGenerateLabel}
          </button>
        )}
        <label className={buttonClass}>
          <Upload className="w-3 h-3" />
          {resolvedUploadLabel}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </label>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      {onGenerate && hasImage && (
        <button
          type="button"
          onClick={onGenerate}
          disabled={isGenerating}
          className="flex-1 min-h-11 py-1.5 bg-white/[0.06] hover:bg-white/10 text-slate-400 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 border border-white/10 hover:border-cyan-300/30 transition-colors"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              {t('assets.generating')}
            </>
          ) : (
            <>
              <Sparkles className="w-3 h-3" />
              {t('assets.regenerate')}
            </>
          )}
        </button>
      )}
      <label className="flex-1 min-h-11 py-1.5 bg-white/[0.06] hover:bg-white/10 text-slate-400 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 border border-white/10 hover:border-cyan-300/30 transition-colors cursor-pointer">
        <Upload className="w-3 h-3" />
        {resolvedUploadLabel}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </label>
    </div>
  );
};

export default ImageUploadButton;
