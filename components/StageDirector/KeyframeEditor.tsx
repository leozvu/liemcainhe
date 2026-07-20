import React from 'react';
import { Loader2, Edit2, Upload, ArrowRight, ArrowLeft, Sparkles, Wand2 } from 'lucide-react';
import { Keyframe } from '../../types';

interface KeyframeEditorProps {
  startKeyframe?: Keyframe;
  endKeyframe?: Keyframe;
  canCopyPrevious: boolean;
  canCopyNext: boolean;
  isAIOptimizing?: boolean;
  useAIEnhancement: boolean;
  onToggleAIEnhancement: () => void;
  onGenerateKeyframe: (type: 'start' | 'end') => void;
  onUploadKeyframe: (type: 'start' | 'end') => void;
  onEditPrompt: (type: 'start' | 'end', prompt: string) => void;
  onOptimizeWithAI: (type: 'start' | 'end') => void;
  onOptimizeBothWithAI: () => void;
  onCopyPrevious: () => void;
  onCopyNext: () => void;
  onImageClick: (url: string, title: string) => void;
}

const KeyframeEditor: React.FC<KeyframeEditorProps> = ({
  startKeyframe,
  endKeyframe,
  canCopyPrevious,
  canCopyNext,
  isAIOptimizing = false,
  useAIEnhancement,
  onToggleAIEnhancement,
  onGenerateKeyframe,
  onUploadKeyframe,
  onEditPrompt,
  onOptimizeWithAI,
  onOptimizeBothWithAI,
  onCopyPrevious,
  onCopyNext,
  onImageClick
}) => {
  const renderKeyframePanel = (
    type: 'start' | 'end',
    label: string,
    keyframe?: Keyframe
  ) => {
    const isGenerating = keyframe?.status === 'generating';
    const hasFailed = keyframe?.status === 'failed';
    
    return (
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
            {label}
          </label>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onOptimizeWithAI(type)}
              disabled={isAIOptimizing}
              className="p-1 text-cyan-300 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="AI tối ưu câu lệnh"
            >
              {isAIOptimizing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
            </button>
            {keyframe?.visualPrompt && (
              <button
                onClick={() => onEditPrompt(type, keyframe.visualPrompt!)}
                className="p-1 text-yellow-400 hover:text-white transition-colors"
                title="Chỉnh sửa câu lệnh"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        
        <div className="aspect-video bg-slate-950/70 rounded-2xl border border-white/10 overflow-hidden relative group">
          {keyframe?.imageUrl ? (
            <>
              <img
                src={keyframe.imageUrl}
                className="w-full h-full object-cover cursor-pointer transition-transform duration-300 group-hover:scale-105"
                onClick={() => onImageClick(keyframe.imageUrl!, `${label} - Khung hình chính`)}
                alt={label}
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                <span className="text-white text-xs font-mono">Nhấn để xem trước</span>
              </div>
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-700 p-2">
              {isGenerating ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin mb-2 text-cyan-300" />
                  <span className="text-[10px] text-zinc-500">Đang tạo...</span>
                </>
              ) : hasFailed ? (
                <>
                  <span className="text-[10px] text-red-500 mb-2">Tạo ảnh thất bại</span>
                  <span className="text-[9px] text-zinc-500 text-center px-1 mb-2">Nếu bị bộ lọc an toàn chặn, hãy chỉnh câu lệnh ở phía trên rồi thử lại</span>
                  <button
                    onClick={() => onGenerateKeyframe(type)}
                    className="px-2 py-1 bg-red-900/30 text-red-400 hover:bg-red-900/50 rounded text-[9px] font-bold transition-colors border border-red-700"
                  >
                    Thử lại
                  </button>
                </>
              ) : (
                <span className="text-[10px] text-center">Chưa tạo</span>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          {!isGenerating && (
            <>
              <button
                onClick={() => onGenerateKeyframe(type)}
                disabled={isGenerating}
                className="flex-1 py-1.5 bg-cyan-300 hover:bg-cyan-200 text-slate-950 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
              >
                {keyframe?.imageUrl ? 'Tạo lại' : 'Tạo ảnh'}
              </button>
              <button
                onClick={() => onUploadKeyframe(type)}
                className="flex-1 py-1.5 bg-white/10 hover:bg-white/15 text-zinc-300 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1"
              >
                <Upload className="w-3 h-3" />
                Tải lên
              </button>
            </>
          )}
        </div>

        {type === 'start' && canCopyPrevious && !keyframe?.imageUrl && (
          <button
            onClick={onCopyPrevious}
            className="w-full py-1.5 bg-white/[0.06] hover:bg-white/10 text-zinc-400 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1 border border-white/10"
          >
            <ArrowRight className="w-3 h-3" />
            Sao chép khung cuối của cảnh trước
          </button>
        )}

        {type === 'end' && canCopyNext && !keyframe?.imageUrl && (
          <button
            onClick={onCopyNext}
            className="w-full py-1.5 bg-white/[0.06] hover:bg-white/10 text-zinc-400 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1 border border-white/10"
          >
            <ArrowLeft className="w-3 h-3" />
            Sao chép khung đầu của cảnh sau
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-white/10 pb-2">
        <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex-1">
          Sản xuất hình ảnh
        </span>
        
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500">
            AI tăng cường câu lệnh
          </span>
          <button
            onClick={onToggleAIEnhancement}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              useAIEnhancement ? 'bg-cyan-300' : 'bg-slate-700'
            }`}
            title={useAIEnhancement ? 'Tắt AI tăng cường để tạo nhanh bằng câu lệnh cơ bản' : 'Bật AI tăng cường để mở rộng thành mô tả điện ảnh'}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                useAIEnhancement ? 'translate-x-5' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        
        <button
          onClick={onOptimizeBothWithAI}
          disabled={isAIOptimizing}
          className="px-3 py-1.5 bg-cyan-300 hover:bg-cyan-200 text-slate-950 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          title="AI tối ưu cả khung hình bắt đầu và kết thúc"
        >
          {isAIOptimizing ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Đang tối ưu...</span>
            </>
          ) : (
            <>
              <Wand2 className="w-3 h-3" />
              <span>AI tối ưu hai khung</span>
            </>
          )}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {renderKeyframePanel('start', 'Khung bắt đầu', startKeyframe)}
        {renderKeyframePanel('end', 'Khung kết thúc', endKeyframe)}
      </div>
    </div>
  );
};

export default KeyframeEditor;
