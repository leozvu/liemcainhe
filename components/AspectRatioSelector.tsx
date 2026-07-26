import React from 'react';
import { Monitor, Smartphone, Square } from 'lucide-react';
import { AspectRatio, VideoDuration } from '../types';

interface AspectRatioSelectorProps {
  value: AspectRatio;
  onChange: (value: AspectRatio) => void;
  /** Cho phép tỷ lệ vuông 1:1; một số mô hình video không hỗ trợ. */
  allowSquare?: boolean;
  /** Chế độ gọn, chỉ hiển thị biểu tượng. */
  compact?: boolean;
  /** Trạng thái vô hiệu hóa. */
  disabled?: boolean;
}

/**
 * Bộ chọn tỷ lệ khung hình cho ảnh và video.
 */
export const AspectRatioSelector: React.FC<AspectRatioSelectorProps> = ({
  value,
  onChange,
  allowSquare = true,
  compact = false,
  disabled = false
}) => {
  const options: { value: AspectRatio; label: string; icon: React.ReactNode; desc: string }[] = [
    { 
      value: '16:9', 
      label: 'Ngang',
      icon: <Monitor className="w-4 h-4" />,
      desc: '1280x720'
    },
    { 
      value: '9:16', 
      label: 'Dọc',
      icon: <Smartphone className="w-4 h-4" />,
      desc: '720x1280'
    },
    { 
      value: '1:1', 
      label: 'Vuông',
      icon: <Square className="w-4 h-4" />,
      desc: '720x720'
    },
  ];

  const filteredOptions = allowSquare ? options : options.filter(o => o.value !== '1:1');

  return (
    <div className="flex gap-1">
      {filteredOptions.map((option) => (
        <button
          key={option.value}
          onClick={() => !disabled && onChange(option.value)}
          disabled={disabled}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-all
            ${value === option.value
              ? 'bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-500/20'
              : 'bg-white/[0.06] text-slate-400 hover:bg-white/10 hover:text-cyan-100 border border-white/10'
            }
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
          title={`${option.label} (${option.desc})`}
        >
          {option.icon}
          {!compact && <span>{option.label}</span>}
        </button>
      ))}
    </div>
  );
};

interface VideoDurationSelectorProps {
  value: VideoDuration;
  onChange: (value: VideoDuration) => void;
  /** Trạng thái vô hiệu hóa. */
  disabled?: boolean;
}

/**
 * Bộ chọn thời lượng video cho các mô hình hỗ trợ.
 */
export const VideoDurationSelector: React.FC<VideoDurationSelectorProps> = ({
  value,
  onChange,
  disabled = false
}) => {
  const durations: VideoDuration[] = [4, 8, 12];

  return (
    <div className="flex gap-1">
      {durations.map((d) => (
        <button
          key={d}
          onClick={() => !disabled && onChange(d)}
          disabled={disabled}
          className={`
            px-3 py-1.5 rounded-md text-xs transition-all
            ${value === d
              ? 'bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-500/20'
              : 'bg-white/[0.06] text-slate-400 hover:bg-white/10 hover:text-cyan-100 border border-white/10'
            }
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          {d} giây
        </button>
      ))}
    </div>
  );
};

interface VideoSettingsPanelProps {
  aspectRatio: AspectRatio;
  onAspectRatioChange: (value: AspectRatio) => void;
  duration: VideoDuration;
  onDurationChange: (value: VideoDuration) => void;
  /** Loại mô hình video; một số loại không hỗ trợ tỷ lệ vuông hoặc thời lượng tùy chọn. */
  modelType: 'sora' | 'veo';
  disabled?: boolean;
  /** Danh sách tỷ lệ khung hình được hỗ trợ. */
  supportedAspectRatios?: AspectRatio[];
  /** Danh sách thời lượng được hỗ trợ. */
  supportedDurations?: VideoDuration[];
}

/**
 * Bảng cài đặt tỷ lệ và thời lượng video.
 */
export const VideoSettingsPanel: React.FC<VideoSettingsPanelProps> = ({
  aspectRatio,
  onAspectRatioChange,
  duration,
  onDurationChange,
  modelType,
  disabled = false,
  supportedAspectRatios,
  supportedDurations,
}) => {
  // Lọc theo tỷ lệ mà mô hình hỗ trợ.
  const allowSquare = supportedAspectRatios 
    ? supportedAspectRatios.includes('1:1')
    : modelType === 'sora';
  
  // Chỉ hiển thị thời lượng khi mô hình cho phép.
  const showDuration = supportedDurations 
    ? supportedDurations.length > 1
    : modelType === 'sora';
  
  // Danh sách thời lượng có thể chọn.
  const availableDurations = supportedDurations || [4, 8, 12];

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-zinc-500 uppercase">Tỷ lệ</span>
        <AspectRatioSelector
          value={aspectRatio}
          onChange={onAspectRatioChange}
          allowSquare={allowSquare}
          disabled={disabled}
        />
      </div>
      
      {showDuration && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 uppercase">Thời lượng</span>
          <div className="flex gap-1">
            {availableDurations.map((d) => (
              <button
                key={d}
                onClick={() => !disabled && onDurationChange(d)}
                disabled={disabled}
                className={`
                  px-3 py-1.5 rounded-md text-xs transition-all
                  ${duration === d
                    ? 'bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-500/20'
                    : 'bg-white/[0.06] text-slate-400 hover:bg-white/10 hover:text-cyan-100 border border-white/10'
                  }
                  ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                {d} giây
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AspectRatioSelector;
