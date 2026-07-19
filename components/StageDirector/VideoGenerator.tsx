import React, { useState, useEffect } from 'react';
import { Video, Loader2, Edit2, Sparkles } from 'lucide-react';
import { Shot, AspectRatio, VideoDuration } from '../../types';
import { VideoSettingsPanel } from '../AspectRatioSelector';
import { 
  getDefaultAspectRatio, 
  getDefaultVideoDuration,
  getVideoModels,
  getActiveVideoModel,
} from '../../services/modelRegistry';
import { VideoModelDefinition, DEFAULT_VIDEO_MODEL_ID } from '../../types/model';

interface VideoGeneratorProps {
  shot: Shot;
  hasStartFrame: boolean;
  hasEndFrame: boolean;
  onGenerate: (aspectRatio: AspectRatio, duration: VideoDuration, modelId: string, textToVideoOnly: boolean) => void;
  textToVideoOnly?: boolean;
  onTextToVideoOnlyChange?: (enabled: boolean) => void;
  onEditPrompt: () => void;
  onOptimizeForModeration?: () => void | Promise<void>;
  isOptimizingForModeration?: boolean;
}

const VideoGenerator: React.FC<VideoGeneratorProps> = ({
  shot,
  hasStartFrame,
  hasEndFrame,
  onGenerate,
  onEditPrompt,
  onOptimizeForModeration,
  isOptimizingForModeration = false,
  textToVideoOnly = false,
  onTextToVideoOnlyChange,
}) => {
  const videoModels = getVideoModels().filter(m => m.isEnabled);
  const defaultModel = getActiveVideoModel();
  
  const [selectedModelId, setSelectedModelId] = useState<string>(
    shot.videoModel || defaultModel?.id || videoModels[0]?.id || DEFAULT_VIDEO_MODEL_ID
  );
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(() => getDefaultAspectRatio());
  const [duration, setDuration] = useState<VideoDuration>(() => getDefaultVideoDuration());
  
  const selectedModel = videoModels.find(m => m.id === selectedModelId) as VideoModelDefinition | undefined;
  const modelType: 'sora' | 'veo' = selectedModel?.params.mode === 'async' ? 'sora' : 'veo';
  
  const isGenerating = shot.interval?.status === 'generating';
  const hasVideo = !!shot.interval?.videoUrl;

  useEffect(() => {
    if (selectedModel) {
      if (!selectedModel.params.supportedAspectRatios.includes(aspectRatio)) {
        setAspectRatio(selectedModel.params.defaultAspectRatio);
      }
      if (!selectedModel.params.supportedDurations.includes(duration)) {
        setDuration(selectedModel.params.defaultDuration);
      }
    }
  }, [selectedModelId]);

  const canGenerate = textToVideoOnly || hasStartFrame;

  const handleGenerate = () => {
    onGenerate(aspectRatio, duration, selectedModelId, textToVideoOnly);
  };

  return (
    <div className="bg-white/[0.045] rounded-2xl p-5 border border-white/10 space-y-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
          <Video className="w-3 h-3 text-cyan-300" />
          Tạo video
          <button 
            onClick={onEditPrompt}
            className="p-1 text-yellow-400 hover:text-white transition-colors"
            title="Xem trước/chỉnh prompt video"
          >
            <Edit2 className="w-3 h-3" />
          </button>
        </h4>
        {shot.interval?.status === 'completed' && (
          <span className="text-[10px] text-green-500 font-mono flex items-center gap-1">
            ● READY
          </span>
        )}
      </div>
      
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">
          Chọn model video
        </label>
        <select
          value={selectedModelId}
          onChange={(e) => setSelectedModelId(e.target.value)}
          className="w-full bg-white/[0.06] text-white border border-white/10 rounded-xl px-3 py-2 text-xs outline-none focus:border-cyan-300/40 transition-colors"
          disabled={isGenerating}
        >
          {videoModels.map((model) => {
            const vm = model as VideoModelDefinition;
            const modeLabel = vm.params.mode === 'async' ? 'Bất đồng bộ' : 'Đồng bộ';
            return (
              <option key={model.id} value={model.id}>
                {model.name} ({modeLabel})
              </option>
            );
          })}
        </select>
        {selectedModel && (
          <p className="text-[9px] text-zinc-600 font-mono">
            ✦ {selectedModel.name}: 
            {selectedModel.params.mode === 'async' 
              ? ` Hỗ trợ ${selectedModel.params.supportedAspectRatios.join('/')}, thời lượng ${selectedModel.params.supportedDurations.join('/')} giây`
              : ` Tạo nhanh, hỗ trợ ${selectedModel.params.supportedAspectRatios.join('/')}`
            }
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">
          Cài đặt video
        </label>
        <VideoSettingsPanel
          aspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          duration={duration}
          onDurationChange={setDuration}
          modelType={modelType}
          disabled={isGenerating}
          supportedAspectRatios={selectedModel?.params.supportedAspectRatios}
          supportedDurations={selectedModel?.params.supportedDurations}
        />
      </div>

      <label className="flex items-start gap-2.5 cursor-pointer group">
        <input
          type="checkbox"
          checked={textToVideoOnly}
          onChange={(e) => onTextToVideoOnlyChange?.(e.target.checked)}
          disabled={isGenerating}
          className="mt-0.5 rounded border-white/20 bg-white/[0.06] text-cyan-300 focus:ring-cyan-300/40"
        />
        <span className="flex-1">
          <span className="text-xs text-zinc-300 group-hover:text-white transition-colors">
            Chỉ tạo video từ văn bản (không dùng khung đầu)
          </span>
          <span className="block text-[9px] text-zinc-600 mt-0.5 leading-relaxed">
            Không tải keyframe bắt đầu lên làm ảnh tham chiếu; video chỉ được tạo từ mô tả. Hữu ích khi khung đầu có nhân vật bị bộ lọc nội dung chặn.
          </span>
        </span>
      </label>
      
      {hasVideo ? (
        <div className="w-full aspect-video bg-black rounded-lg overflow-hidden border border-zinc-700 relative shadow-lg">
          <video src={shot.interval.videoUrl} controls className="w-full h-full" />
        </div>
      ) : (
        <div className="w-full aspect-video bg-slate-950/55 rounded-2xl border border-dashed border-cyan-200/15 flex items-center justify-center">
          <span className="text-xs text-zinc-600 font-mono">PREVIEW AREA</span>
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={!canGenerate || isGenerating}
        className={`w-full py-3 rounded-lg font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
          hasVideo 
            ? 'bg-white/10 text-zinc-300 hover:bg-white/15'
            : 'bg-cyan-300 text-slate-950 hover:bg-cyan-200 shadow-lg shadow-cyan-500/20'
        } ${!canGenerate ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Đang tạo video ({aspectRatio}, {modelType === 'sora' ? `${duration} giây` : selectedModel?.name}
            {textToVideoOnly ? ', chỉ từ văn bản' : ''})...
          </>
        ) : (
          <>{hasVideo ? 'Tạo lại video' : 'Bắt đầu tạo video'}</>
        )}
      </button>

      {!canGenerate && !textToVideoOnly && (
        <p className="text-[9px] text-amber-500/90 text-center">
          Hãy tạo khung bắt đầu hoặc chọn chế độ chỉ từ văn bản
        </p>
      )}

      {shot.interval?.status === 'failed' && shot.interval?.videoPrompt && onOptimizeForModeration && (
        <button
          type="button"
          onClick={() => onOptimizeForModeration()}
          disabled={isOptimizingForModeration}
          className="w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
        >
          {isOptimizingForModeration ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Đang tối ưu mô tả…
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              AI tối ưu mô tả
            </>
          )}
        </button>
      )}
      
      {!textToVideoOnly && !hasEndFrame && (
        <div className="text-[9px] text-zinc-500 text-center font-mono">
          * Không có khung kết thúc; sẽ dùng chế độ một ảnh (Image-to-Video)
        </div>
      )}
      {textToVideoOnly && (
        <div className="text-[9px] text-cyan-400/80 text-center font-mono">
          * Chế độ văn bản: không tải khung đầu/cuối, chỉ gửi mô tả video
        </div>
      )}
    </div>
  );
};

export default VideoGenerator;
