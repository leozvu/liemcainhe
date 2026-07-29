import { TranslationKey } from '../../services/i18n';

export interface ScriptOption {
  label: TranslationKey;
  value: string;
  desc?: TranslationKey;
}

export const DURATION_OPTIONS: ScriptOption[] = [
  { label: 'script.option.duration.30s', value: '30s' },
  { label: 'script.option.duration.60s', value: '60s' },
  { label: 'script.option.duration.120s', value: '120s' },
  { label: 'script.option.duration.300s', value: '300s' },
  { label: 'script.option.duration.900s', value: '900s' },
  { label: 'script.option.custom', value: 'custom' }
];

export const LANGUAGE_OPTIONS: ScriptOption[] = [
  { label: 'script.option.language.vi', value: 'Vietnamese' },
  { label: 'script.option.language.en', value: 'English' },
  { label: 'script.option.language.ja', value: 'Japanese' },
  { label: 'script.option.language.fr', value: 'French' },
  { label: 'script.option.language.es', value: 'Spanish' }
];

export const VISUAL_STYLE_OPTIONS: ScriptOption[] = [
  { label: 'script.option.style.anime', value: 'anime', desc: 'script.option.style.animeDetail' },
  { label: 'script.option.style.2d', value: '2d-animation', desc: 'script.option.style.2dDetail' },
  { label: 'script.option.style.3d', value: '3d-animation', desc: 'script.option.style.3dDetail' },
  { label: 'script.option.style.cyberpunk', value: 'cyberpunk', desc: 'script.option.style.cyberpunkDetail' },
  { label: 'script.option.style.oil', value: 'oil-painting', desc: 'script.option.style.oilDetail' },
  { label: 'script.option.style.live', value: 'live-action', desc: 'script.option.style.liveDetail' },
  { label: 'script.option.style.custom', value: 'custom', desc: 'script.option.style.customDetail' }
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
