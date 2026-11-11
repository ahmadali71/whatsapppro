import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Mic } from 'lucide-react';
import { resolveMediaUrl } from '@/lib/api';

interface VoicePlayerProps {
  src: string;
  duration?: number | null;
  isOwn?: boolean;
}

const BARS = [28, 52, 74, 42, 86, 60, 35, 92, 65, 48, 78, 55, 40, 82, 68, 30, 62, 88, 50, 38, 70, 45];

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const VoicePlayer: React.FC<VoicePlayerProps> = ({ src, duration, isOwn }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration || 0);
  const [playbackRate, setPlaybackRate] = useState(1);

  const resolvedSrc = resolveMediaUrl(src) || src;

  useEffect(() => {
    const audio = new Audio(resolvedSrc);
    audioRef.current = audio;

    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setTotalDuration(audio.duration);
      }
    };
    audio.ontimeupdate = () => setCurrentTime(audio.currentTime);
    audio.onended = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, [resolvedSrc]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      void audio.play();
      setIsPlaying(true);
    }
  };

  const cycleSpeed = () => {
    const next = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const progress = totalDuration > 0 ? currentTime / totalDuration : 0;

  return (
    <div className="flex items-center gap-2.5 min-w-[220px] sm:min-w-[260px] py-1">
      <button
        type="button"
        onClick={togglePlay}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition ${
          isOwn
            ? 'bg-[#00A884] text-white hover:bg-[#008f6f]'
            : 'bg-[#00A884]/15 text-[#00A884] hover:bg-[#00A884]/25'
        }`}
      >
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>

      <div className="flex-1 flex flex-col gap-1">
        <div
          className="flex items-center gap-[2px] h-7 cursor-pointer"
          onClick={(e) => {
            if (!audioRef.current || !totalDuration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            audioRef.current.currentTime = ratio * totalDuration;
            setCurrentTime(ratio * totalDuration);
          }}
        >
          {BARS.map((height, idx) => {
            const barProgress = idx / BARS.length;
            const active = barProgress <= progress;
            return (
              <div
                key={idx}
                className={`flex-1 rounded-full transition-colors ${
                  active ? 'bg-[#00A884]' : 'bg-gray-400/40 dark:bg-gray-500/50'
                }`}
                style={{ height: `${Math.max(20, height)}%` }}
              />
            );
          })}
        </div>
        <div className="flex items-center justify-between text-[10px] text-[#667781] dark:text-[#8696a0]">
          <span>{fmtTime(isPlaying ? currentTime : totalDuration)}</span>
          <span className="flex items-center gap-1">
            <Mic className="w-3 h-3 text-[#00A884]" />
            Voice
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={cycleSpeed}
        className="px-1.5 py-0.5 rounded-full bg-black/10 dark:bg-white/10 text-[10px] font-semibold hover:bg-black/20"
      >
        {playbackRate}x
      </button>
    </div>
  );
};
