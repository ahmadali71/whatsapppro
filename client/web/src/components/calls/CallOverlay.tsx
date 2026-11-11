import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  PhoneIncoming,
  MonitorUp,
  Volume2,
  VolumeX,
  Minimize2,
  Maximize2,
  Wifi,
} from 'lucide-react';
import { CallStatus, CallType } from '@whatsapp-pro/shared-types';
import { useCallStore } from '@/stores/callStore';
import { Avatar } from '@/components/common/Avatar';

const VideoStreamTile: React.FC<{
  stream: MediaStream | null;
  muted?: boolean;
  label: string;
  avatarUrl?: string | null;
  mirror?: boolean;
}> = ({ stream, muted = false, label, avatarUrl, mirror = false }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hasVideo = Boolean(stream && stream.getVideoTracks().some((t) => t.enabled));

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative rounded-2xl overflow-hidden bg-[#202c33] flex items-center justify-center border border-[#2a3942] min-h-[200px]">
      {stream && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className={`w-full h-full object-cover ${mirror ? 'scale-x-[-1]' : ''} ${
            hasVideo ? 'block' : 'hidden'
          }`}
        />
      )}
      {!hasVideo && (
        <div className="flex flex-col items-center gap-3 p-6">
          <Avatar src={avatarUrl} name={label} size="xl" />
          <span className="text-white font-medium text-sm">{label}</span>
        </div>
      )}
      <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-black/50 text-white text-xs font-medium backdrop-blur-sm">
        {label}
      </div>
    </div>
  );
};

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const CallOverlay: React.FC = () => {
  const {
    activeCall,
    incomingCall,
    localStream,
    remoteStreams,
    isMuted,
    isCameraOff,
    isScreenSharing,
    isSpeakerOn,
    durationSeconds,
    connectionQuality,
    acceptIncomingCall,
    rejectIncomingCall,
    endActiveCall,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    toggleSpeaker,
  } = useCallStore();

  const [minimized, setMinimized] = useState(false);

  // Incoming Call Banner / Modal
  if (incomingCall && !activeCall) {
    const caller = incomingCall.peerUsers[0];
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
        <div className="bg-[#111b21] border border-[#2a3942] rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
          <div className="relative inline-block mb-5">
            <div className="absolute inset-0 rounded-full bg-[#25D366]/30 animate-ping" />
            <Avatar src={caller?.avatarUrl} name={caller?.displayName || 'Unknown Caller'} size="xl" />
          </div>
          <h3 className="text-xl font-semibold text-white mb-1">
            {caller?.displayName || 'Incoming Call'}
          </h3>
          <p className="text-sm text-[#8696a0] mb-8 flex items-center justify-center gap-2">
            {incomingCall.callType === CallType.VIDEO ? (
              <>
                <Video className="w-4 h-4 text-[#25D366]" /> Incoming Video Call
              </>
            ) : (
              <>
                <PhoneIncoming className="w-4 h-4 text-[#25D366]" /> Incoming Voice Call
              </>
            )}
          </p>

          <div className="flex items-center justify-center gap-8">
            <button
              type="button"
              onClick={() => void rejectIncomingCall()}
              className="flex flex-col items-center gap-2 group"
            >
              <span className="w-14 h-14 rounded-full bg-red-600 group-hover:bg-red-700 flex items-center justify-center text-white shadow-lg transition">
                <PhoneOff className="w-6 h-6" />
              </span>
              <span className="text-xs text-[#8696a0]">Decline</span>
            </button>
            <button
              type="button"
              onClick={() => void acceptIncomingCall()}
              className="flex flex-col items-center gap-2 group"
            >
              <span className="w-14 h-14 rounded-full bg-[#25D366] group-hover:bg-[#1ebe5d] flex items-center justify-center text-white shadow-lg transition animate-bounce">
                {incomingCall.callType === CallType.VIDEO ? (
                  <Video className="w-6 h-6" />
                ) : (
                  <PhoneIncoming className="w-6 h-6" />
                )}
              </span>
              <span className="text-xs text-[#25D366]">Accept</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!activeCall) return null;

  const remoteEntries = Object.entries(remoteStreams);
  const title =
    activeCall.peerUsers.length === 1
      ? activeCall.peerUsers[0]?.displayName || 'Call'
      : activeCall.peerUsers.map((u) => u.displayName).join(', ') || 'Group Call';

  if (minimized) {
    return (
      <div className="fixed bottom-20 md:bottom-6 right-6 z-[90] bg-[#111b21] border border-[#2a3942] rounded-2xl shadow-2xl p-4 flex items-center gap-4 text-white w-72">
        <Avatar src={activeCall.peerUsers[0]?.avatarUrl} name={title} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>
          <p className="text-xs text-[#25D366]">
            {activeCall.status === CallStatus.ONGOING ? formatDuration(durationSeconds) : 'Calling...'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="p-2 rounded-full hover:bg-[#202c33] text-[#8696a0] hover:text-white"
          title="Expand"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => void endActiveCall()}
          className="p-2 rounded-full bg-red-600 hover:bg-red-700 text-white"
          title="End Call"
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const qualityColor =
    connectionQuality.quality === 'good'
      ? 'text-[#25D366]'
      : connectionQuality.quality === 'fair'
        ? 'text-amber-400'
        : 'text-red-400';

  return (
    <div className="fixed inset-0 z-[90] bg-[#0b141a] flex flex-col text-white">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-[#111b21]/80 border-b border-[#2a3942]">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-[#25D366] animate-pulse" />
          <div>
            <h2 className="font-semibold text-base">{title}</h2>
            <p className="text-xs text-[#8696a0]">
              {activeCall.status === CallStatus.ONGOING
                ? formatDuration(durationSeconds)
                : activeCall.status === CallStatus.RINGING
                  ? 'Ringing...'
                  : 'Connecting...'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-1.5 text-xs ${qualityColor}`}>
            <Wifi className="w-4 h-4" />
            <span className="capitalize">{connectionQuality.quality}</span>
            {connectionQuality.rttMs !== undefined && <span>({connectionQuality.rttMs}ms)</span>}
          </div>
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="p-2 rounded-full hover:bg-[#202c33] text-[#8696a0] hover:text-white"
            title="Minimize"
          >
            <Minimize2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Video Grid */}
      <div className="flex-1 p-4 sm:p-6 overflow-auto grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr">
        {remoteEntries.length > 0 ? (
          remoteEntries.map(([peerId, stream]) => {
            const peer = activeCall.peerUsers.find((u) => u.id === peerId);
            return (
              <VideoStreamTile
                key={peerId}
                stream={stream}
                label={peer?.displayName || 'Participant'}
                avatarUrl={peer?.avatarUrl}
              />
            );
          })
        ) : (
          <div className="col-span-full flex flex-col items-center justify-center bg-[#111b21] rounded-2xl border border-[#2a3942] p-8">
            <Avatar src={activeCall.peerUsers[0]?.avatarUrl} name={title} size="xl" />
            <p className="mt-4 text-lg font-medium">{title}</p>
            <p className="text-sm text-[#8696a0] mt-1">
              {activeCall.isOutgoing ? 'Waiting for answer...' : 'Connecting audio/video...'}
            </p>
          </div>
        )}

        {/* Local preview tile */}
        <VideoStreamTile
          stream={localStream}
          muted
          mirror={!isScreenSharing}
          label={isScreenSharing ? 'You (Screen)' : 'You'}
        />
      </div>

      {/* Controls Bar */}
      <div className="py-5 px-6 bg-[#111b21] border-t border-[#2a3942] flex items-center justify-center gap-4 sm:gap-6">
        <button
          type="button"
          onClick={toggleMute}
          className={`p-3.5 rounded-full transition ${
            isMuted ? 'bg-red-500/20 text-red-400' : 'bg-[#202c33] hover:bg-[#2a3942] text-white'
          }`}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>

        <button
          type="button"
          onClick={toggleCamera}
          className={`p-3.5 rounded-full transition ${
            isCameraOff ? 'bg-red-500/20 text-red-400' : 'bg-[#202c33] hover:bg-[#2a3942] text-white'
          }`}
          title={isCameraOff ? 'Turn Camera On' : 'Turn Camera Off'}
        >
          {isCameraOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
        </button>

        <button
          type="button"
          onClick={() => void toggleScreenShare()}
          className={`p-3.5 rounded-full transition ${
            isScreenSharing ? 'bg-[#00A884] text-white' : 'bg-[#202c33] hover:bg-[#2a3942] text-white'
          }`}
          title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
        >
          <MonitorUp className="w-6 h-6" />
        </button>

        <button
          type="button"
          onClick={toggleSpeaker}
          className={`p-3.5 rounded-full transition ${
            !isSpeakerOn ? 'bg-amber-500/20 text-amber-400' : 'bg-[#202c33] hover:bg-[#2a3942] text-white'
          }`}
          title={isSpeakerOn ? 'Speaker On' : 'Speaker Muted'}
        >
          {isSpeakerOn ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
        </button>

        <button
          type="button"
          onClick={() => void endActiveCall()}
          className="p-3.5 px-6 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center gap-2 font-medium transition shadow-lg"
          title="End Call"
        >
          <PhoneOff className="w-6 h-6" />
          <span className="hidden sm:inline">End</span>
        </button>
      </div>
    </div>
  );
};
