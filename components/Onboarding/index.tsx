import React, { useState } from 'react';
import { X } from 'lucide-react';
import { ONBOARDING_STORAGE_KEY, ONBOARDING_PAGES, TOTAL_PAGES } from './constants';
import ProgressDots from './ProgressDots';
import WelcomePage from './WelcomePage';
import WorkflowPage from './WorkflowPage';
import HighlightPage from './HighlightPage';
import ApiKeyPage from './ApiKeyPage';
import ActionPage from './ActionPage';

interface OnboardingProps {
  onComplete: () => void;
  onQuickStart?: (option: 'script' | 'example') => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onComplete, onQuickStart }) => {
  const [currentPage, setCurrentPage] = useState(ONBOARDING_PAGES.WELCOME);
  const [isAnimating, setIsAnimating] = useState(false);

  // Điều khiển chuyển cảnh giữa các bước.
  const handlePageChange = (newPage: number) => {
    if (newPage === currentPage || isAnimating) return;
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentPage(newPage);
      setIsAnimating(false);
    }, 150);
  };

  const handleNext = () => {
    if (currentPage < TOTAL_PAGES - 1) {
      handlePageChange(currentPage + 1);
    }
  };

  const handleSkip = () => {
    markOnboardingComplete();
    onComplete();
  };

  const handleCompleteOnboarding = () => {
    markOnboardingComplete();
    onComplete();
  };

  const handleQuickStart = (option: 'script' | 'example') => {
    markOnboardingComplete();
    onQuickStart?.(option);
    onComplete();
  };

  const markOnboardingComplete = () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
  };

  // Cho phép cấu hình khóa API sau.
  const handleSkipApiKey = () => {
    handlePageChange(ONBOARDING_PAGES.ACTION);
  };

  // Hiển thị bước hiện tại.
  const renderPage = () => {
    switch (currentPage) {
      case ONBOARDING_PAGES.WELCOME:
        return <WelcomePage onNext={handleNext} onSkip={handleSkip} />;
      case ONBOARDING_PAGES.WORKFLOW:
        return <WorkflowPage onNext={handleNext} />;
      case ONBOARDING_PAGES.HIGHLIGHTS:
        return <HighlightPage onNext={handleNext} />;
      case ONBOARDING_PAGES.API_KEY:
        return (
          <ApiKeyPage
            onNext={handleNext}
            onSkip={handleSkipApiKey}
          />
        );
      case ONBOARDING_PAGES.ACTION:
        return <ActionPage onComplete={handleCompleteOnboarding} onQuickStart={handleQuickStart} />;
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Lớp nền */}
      <div 
        className="absolute inset-0 bg-slate-950/90 backdrop-blur-xl"
        onClick={handleSkip}
      />

      {/* Hộp hướng dẫn */}
      <div className="relative z-10 w-full max-w-lg mx-4 bg-slate-950/90 border border-cyan-200/15 rounded-[1.75rem] shadow-2xl shadow-cyan-950/30 overflow-hidden animate-in zoom-in-95 fade-in duration-300 backdrop-blur-xl">
        {/* Nút đóng */}
        <button
          onClick={handleSkip}
          className="absolute top-4 right-4 z-20 w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-white transition-colors rounded-xl hover:bg-white/10"
          aria-label="Đóng hướng dẫn"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Nội dung */}
        <div 
          className={`p-8 pt-12 transition-opacity duration-150 ${
            isAnimating ? 'opacity-0' : 'opacity-100'
          }`}
        >
          {renderPage()}
        </div>

        {/* Tiến độ */}
        <div className="pb-6">
          <ProgressDots 
            currentPage={currentPage} 
            onPageChange={handlePageChange} 
          />
        </div>
      </div>
    </div>
  );
};

// Kiểm tra trạng thái hiển thị hướng dẫn.
export const shouldShowOnboarding = (): boolean => {
  return localStorage.getItem(ONBOARDING_STORAGE_KEY) !== 'true';
};

// Đặt lại hướng dẫn để có thể mở lại từ menu trợ giúp.
export const resetOnboarding = (): void => {
  localStorage.removeItem(ONBOARDING_STORAGE_KEY);
};

export default Onboarding;
