export const DURATION_OPTIONS = [
  { label: '30 giây (quảng cáo)', value: '30s' },
  { label: '60 giây (phim giới thiệu)', value: '60s' },
  { label: '2 phút (đoạn nhá hàng)', value: '120s' },
  { label: '5 phút (phim ngắn)', value: '300s' },
  { label: '15 phút (tập phim)', value: '900s' },
  { label: 'Tùy chỉnh', value: 'custom' }
];

export const LANGUAGE_OPTIONS = [
  { label: 'Tiếng Việt', value: 'Vietnamese' },
  { label: 'Tiếng Anh (Mỹ)', value: 'English' },
  { label: 'Tiếng Nhật', value: 'Japanese' },
  { label: 'Tiếng Pháp', value: 'French' },
  { label: 'Tiếng Tây Ban Nha', value: 'Spanish' }
];

export const VISUAL_STYLE_OPTIONS = [
  { label: 'Anime Nhật Bản', value: 'anime', desc: 'Phong cách anime Nhật với đường nét rõ' },
  { label: 'Hoạt hình 2D', value: '2d-animation', desc: 'Phong cách hoạt hình 2D kinh điển' },
  { label: 'Hoạt hình 3D', value: '3d-animation', desc: 'Phong cách phim hoạt hình 3D điện ảnh' },
  { label: 'Viễn tưởng công nghệ', value: 'cyberpunk', desc: 'Thẩm mỹ tương lai với ánh sáng neon và công nghệ cao' },
  { label: 'Tranh sơn dầu', value: 'oil-painting', desc: 'Chất liệu nghệ thuật sơn dầu' },
  { label: 'Phim người đóng', value: 'live-action', desc: 'Phong cách phim điện ảnh chân thực' },
  { label: 'Phong cách khác', value: 'custom', desc: 'Tự nhập phong cách mong muốn' }
];

export const STYLES = {
  input: 'w-full bg-white/[0.06] border border-white/10 text-white px-3 py-2.5 text-sm rounded-xl focus:border-cyan-300/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/10 transition-all placeholder:text-slate-500',
  label: 'text-[10px] font-bold text-cyan-100/55 uppercase tracking-widest',
  select: 'w-full bg-white/[0.06] border border-white/10 text-white px-3 py-2.5 text-sm rounded-xl appearance-none focus:border-cyan-300/40 focus:outline-none transition-all cursor-pointer',
  button: {
    primary: 'bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-950 hover:from-cyan-200 hover:to-sky-300 shadow-lg shadow-cyan-500/20',
    secondary: 'bg-white/[0.04] border-white/10 text-slate-400 hover:border-cyan-300/30 hover:text-cyan-50',
    selected: 'bg-cyan-300 text-slate-950 border-cyan-300 shadow-sm shadow-cyan-500/20',
    disabled: 'bg-white/[0.05] text-slate-500 cursor-not-allowed border-white/10'
  },
  editor: {
    textarea: 'w-full bg-white/[0.06] border border-white/10 text-slate-200 px-3 py-2 text-sm rounded-xl focus:border-cyan-300/40 focus:outline-none resize-none',
    mono: 'font-mono',
    serif: 'font-serif italic'
  }
};

export const DEFAULTS = {
  duration: '60s',
  language: 'Vietnamese',
  model: 'gpt-5.2',
  visualStyle: 'live-action'
};
