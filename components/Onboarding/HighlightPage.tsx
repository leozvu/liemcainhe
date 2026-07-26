import React from 'react';
import { HIGHLIGHTS } from './constants';
import { AudioLines, Frame, Shirt, Palette } from 'lucide-react';

interface HighlightPageProps {
  onNext: () => void;
}

const HighlightPage: React.FC<HighlightPageProps> = ({ onNext }) => {
  const icons = [Frame, Shirt, Palette, AudioLines];
  return (
    <div className="flex flex-col items-center text-center">
      {/* Tiêu đề */}
      <h2 className="text-2xl font-bold text-white mb-8">
        Hình ảnh liền mạch, nhân vật nhất quán
      </h2>

      {/* Điểm nổi bật */}
      <div className="w-full max-w-md space-y-4 mb-8">
        {HIGHLIGHTS.map((highlight, index) => {
          const Icon = icons[index];
          return <div
            key={highlight.title}
            className="flex items-start gap-4 bg-white/[0.045] border border-white/10 rounded-2xl p-4 text-left hover:border-cyan-200/35 transition-colors"
          >
            <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-cyan-300" />
            <div>
              <h3 className="text-white font-bold text-sm mb-1">{highlight.title}</h3>
              <p className="text-zinc-400 text-xs">{highlight.description}</p>
            </div>
          </div>;
        })}
      </div>

      {/* Tình huống sử dụng */}
      <div className="bg-gradient-to-r from-cyan-300/10 via-sky-400/10 to-fuchsia-400/10 border border-cyan-200/20 rounded-2xl px-6 py-4 mb-10 max-w-md">
        <p className="text-zinc-300 text-sm italic">
          “Tạo một phim ngắn chuyển đổi trang phục mà không còn lo nhân vật bị biến dạng.”
        </p>
      </div>

      {/* Hành động chính */}
      <button
        onClick={onNext}
        className="px-8 py-3 bg-cyan-300 text-slate-950 font-bold text-sm rounded-xl hover:bg-cyan-200 transition-all duration-200 transform hover:scale-105 shadow-lg shadow-cyan-500/20"
      >
        Bước cuối cùng
      </button>
    </div>
  );
};

export default HighlightPage;
