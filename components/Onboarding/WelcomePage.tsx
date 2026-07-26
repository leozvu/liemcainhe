import React from 'react';
import { Sparkles } from 'lucide-react';
const LOGO_URL = '/egoric-agency-logo.png';

interface WelcomePageProps {
  onNext: () => void;
  onSkip: () => void;
}

const WelcomePage: React.FC<WelcomePageProps> = ({ onNext, onSkip }) => {
  return (
    <div className="flex flex-col items-center text-center">
      {/* Khu vực nhận diện thương hiệu */}
      <div className="relative mb-8 flex min-h-28 items-center justify-center">
        <div className="absolute -inset-8 bg-gradient-to-r from-cyan-300/20 via-sky-400/20 to-fuchsia-400/20 rounded-full blur-3xl opacity-50"></div>
        <img 
          src={LOGO_URL} 
          alt="Egoric Agency"
          className="w-72 max-w-[78vw] h-auto relative z-10 object-contain"
        />
        <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-yellow-400 animate-pulse" />
      </div>

      {/* Lời chào */}
      <h1 className="text-3xl font-bold text-white mb-3">
        Chào nhà sáng tạo
      </h1>

      {/* Giá trị cốt lõi */}
      <p className="text-xl text-zinc-300 mb-2">
        Biến câu chuyện của bạn thành phim ngắn sống động
      </p>

      {/* Mô tả */}
      <p className="text-sm text-zinc-500 mb-10 max-w-xs">
        Chỉ cần một kịch bản, Egoric Film Studio sẽ kết nối toàn bộ quy trình còn lại
      </p>

      {/* Hành động chính */}
      <button
        onClick={onNext}
        className="px-8 py-3 bg-cyan-300 text-slate-950 font-bold text-sm rounded-xl hover:bg-cyan-200 transition-all duration-200 transform hover:scale-105 shadow-lg shadow-cyan-500/20"
      >
        Khám phá quy trình
      </button>

      {/* Bỏ qua hướng dẫn */}
      <button
        onClick={onSkip}
        className="mt-6 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
      >
        Bỏ qua và bắt đầu ngay
      </button>
    </div>
  );
};

export default WelcomePage;
