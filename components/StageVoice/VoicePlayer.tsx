import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Pause, Play } from 'lucide-react';

interface Props {
  src: string;
  fileName?: string;
  duration?: number;
  compact?: boolean;
}

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
};

const VoicePlayer: React.FC<Props> = ({ src, fileName = 'egoric-voice.mp3', duration, compact = false }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [resolvedDuration, setResolvedDuration] = useState(duration || 0);
  const bars = useMemo(() => Array.from({ length: compact ? 28 : 48 }, (_, index) => 5 + ((index * 17 + src.length * 3) % 23)), [compact, src]);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setResolvedDuration(duration || 0);
  }, [src, duration]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play();
    else audio.pause();
  };

  const progress = resolvedDuration > 0 ? Math.min(100, (currentTime / resolvedDuration) * 100) : 0;

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-white/[.07] bg-black/20 p-2.5">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setResolvedDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : duration || 0)}
      />
      <button type="button" onClick={toggle} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center rounded-full" aria-label={playing ? 'Tạm dừng' : 'Phát bản thu'}>
        {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="eg-waveform relative w-full cursor-pointer"
          onClick={(event) => {
            const audio = audioRef.current;
            if (!audio || !resolvedDuration) return;
            const box = event.currentTarget.getBoundingClientRect();
            audio.currentTime = ((event.clientX - box.left) / box.width) * resolvedDuration;
          }}
          aria-label="Tua bản thu"
        >
          {bars.map((height, index) => (
            <span key={index} style={{ height, opacity: (index / bars.length) * 100 <= progress ? 1 : 0.28 }} />
          ))}
        </button>
        <div className="mt-0.5 flex justify-between font-mono text-[9px] text-zinc-600">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(resolvedDuration)}</span>
        </div>
      </div>
      <a href={src} download={fileName} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center" aria-label="Tải bản thu" title="Tải bản thu">
        <Download className="h-4 w-4" />
      </a>
    </div>
  );
};

export default VoicePlayer;

