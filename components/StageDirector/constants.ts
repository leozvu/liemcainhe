export const STYLES = {
  mainContainer: "flex flex-col h-full bg-slate-950/35 relative overflow-hidden",
  toolbar: "h-16 border-b border-white/10 bg-slate-950/55 px-6 flex items-center justify-between shrink-0 backdrop-blur-xl",
  workbench: "w-[480px] bg-slate-950/80 border-l border-white/10 flex flex-col h-full shadow-2xl shadow-cyan-950/30 animate-in slide-in-from-right-10 duration-300 relative z-20 backdrop-blur-2xl",
  workbenchHeader: "h-16 px-6 border-b border-white/10 flex items-center justify-between bg-white/[0.04] shrink-0",
  workbenchContent: "flex-1 overflow-y-auto p-6 space-y-8",
  
  card: "group relative flex flex-col bg-white/[0.045] border rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 backdrop-blur",
  cardActive: "border-cyan-300/60 ring-1 ring-cyan-300/35 shadow-xl shadow-cyan-950/25 scale-[0.98]",
  cardInactive: "border-white/10 hover:border-cyan-200/35 hover:shadow-lg",
  
  primaryButton: "px-4 py-2 bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-950 hover:from-cyan-200 hover:to-sky-300 rounded-xl text-xs font-bold uppercase tracking-wide transition-all flex items-center gap-2 shadow-lg shadow-cyan-500/20",
  secondaryButton: "px-4 py-2 bg-white/[0.05] text-slate-400 border border-white/10 hover:text-white hover:border-cyan-300/30 rounded-xl text-xs font-bold uppercase tracking-wide transition-all flex items-center gap-2",
  iconButton: "p-2 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-colors",
  
  modalOverlay: "fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center p-4",
  modalContainer: "bg-slate-950/90 border border-cyan-200/15 rounded-[1.75rem] p-6 max-w-2xl w-full space-y-4 shadow-2xl shadow-cyan-950/30",
  modalTextarea: "w-full h-64 bg-white/[0.06] text-white border border-white/10 rounded-2xl p-4 text-sm outline-none focus:border-cyan-300/40 transition-colors resize-none",
  
  sectionHeader: "flex items-center gap-2 border-b border-white/10 pb-2",
  contentBox: "bg-white/[0.045] p-5 rounded-2xl border border-white/10 backdrop-blur",
};

export const VISUAL_STYLE_PROMPTS: Record<string, string> = {
  'live-action': 'photorealistic, cinematic film quality, real human actors, professional cinematography, natural lighting, 8K resolution',
  'anime': 'Japanese anime style, cel-shaded, vibrant colors, expressive eyes, dynamic poses, Studio Ghibli/Makoto Shinkai quality',
  '2d-animation': 'classic 2D animation, hand-drawn style, Disney/Pixar quality, smooth lines, expressive characters, painterly backgrounds',
  '3d-animation': 'high-quality 3D CGI animation, Pixar/DreamWorks style, subsurface scattering, detailed textures, stylized characters',
  'cyberpunk': 'cyberpunk aesthetic, neon-lit, rain-soaked streets, holographic displays, high-tech low-life, Blade Runner style',
  'oil-painting': 'oil painting style, visible brushstrokes, rich textures, classical art composition, museum quality fine art',
};

export const VIDEO_PROMPT_TEMPLATES = {
  sora2: {
    standard: `Tạo video chuyển động mượt mà từ hình ảnh đầu tiên (khung hình bắt đầu) đến hình ảnh thứ hai (khung hình kết thúc).

Mô tả hành động: {actionSummary}

Yêu cầu kỹ thuật:
- QUAN TRỌNG: Video phải bắt đầu chính xác theo bố cục của hình ảnh đầu và chuyển dần đến bố cục chính xác của hình ảnh cuối
- Chuyển động máy quay: {cameraMovement}
- Chuyển tiếp: Bảo đảm chuyển động tự nhiên, liền mạch, không nhảy cóc hoặc đứt quãng
- Phong cách hình ảnh: Chất lượng điện ảnh, ánh sáng và tông màu nhất quán
- Chi tiết: Giữ nhân vật và bối cảnh liên tục, nhất quán giữa hai khung hình
- Ngôn ngữ: Dùng {language} cho lời thoại và phụ đề`
  },
  
  veo: {
    simple: `{actionSummary}

Chuyển động máy quay: {cameraMovement}
Ngôn ngữ lời thoại: {language}`
  }
};

export const DEFAULTS = {
  videoModel: 'doubao-seedance-2-0-fast' as const,
  batchGenerateDelay: 3000,
};
