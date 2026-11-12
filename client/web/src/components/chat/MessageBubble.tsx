import React, { useState } from 'react';
import {
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  Lock,
  Star,
  Pin,
  Reply,
  Forward,
  Edit3,
  Trash2,
  Copy,
  Info,
  SmilePlus,
  FileText,
  Download,
  MapPin,
  User as UserIcon,
  ExternalLink,
  Eye,
  RotateCcw,
  ChevronDown,
  CheckSquare,
  Square,
} from 'lucide-react';
import { MessageType } from '@whatsapp-pro/shared-types';
import { LocalMessage } from '@/stores/chatStore';
import { toast } from '@/stores/toastStore';
import { resolveMediaUrl } from '@/lib/api';
import { VoicePlayer } from './VoicePlayer';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const MORE_EMOJIS = ['🔥', '👏', '🎉', '🤔', '💯', '😍', '🤯', '🥳', '😎', '🤝', '✅', '👀'];

interface PollData {
  question: string;
  options: Array<{ id: string; text: string; votes?: string[] }>;
}

interface LocationData {
  latitude: number;
  longitude: number;
  label?: string;
  isLive?: boolean;
  expiresAt?: string;
}

interface ContactCardData {
  name: string;
  phone: string;
}

interface MessageBubbleProps {
  message: LocalMessage;
  isOwn: boolean;
  showSenderName?: boolean;
  isPinned?: boolean;
  currentUserId: string;
  fontSizeClass: string;
  onReply: (msg: LocalMessage) => void;
  onForward: (msg: LocalMessage) => void;
  onEdit: (msg: LocalMessage) => void;
  onDelete: (msg: LocalMessage, forEveryone: boolean) => void;
  onStar: (msg: LocalMessage) => void;
  onPin: (msg: LocalMessage) => void;
  onReact: (msg: LocalMessage, emoji: string) => void;
  onShowInfo: (msg: LocalMessage) => void;
  onRetry: (tempId: string) => void;
  onVotePoll?: (msg: LocalMessage, optionId: string) => void;
  onJumpToMessage?: (messageId: string) => void;
  onImagePreview?: (url: string) => void;
  memberNamesById?: Record<string, string>;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (msg: LocalMessage) => void;
}

function parseJsonSafe<T>(text?: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function extractFirstUrl(text?: string | null): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
}

function formatMessageTime(dateVal: string | Date): string {
  const d = new Date(dateVal);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes?: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isOwn,
  showSenderName,
  isPinned,
  currentUserId,
  fontSizeClass,
  onReply,
  onForward,
  onEdit,
  onDelete,
  onStar,
  onPin,
  onReact,
  onShowInfo,
  onRetry,
  onVotePoll,
  onJumpToMessage,
  onImagePreview,
  memberNamesById,
  selectionMode = false,
  selected = false,
  onToggleSelect,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMoreEmojis, setShowMoreEmojis] = useState(false);
  const [viewOnceOpened, setViewOnceOpened] = useState(false);

  const text = message.decryptedContent ?? message.content ?? '';
  const attachment = message.attachments?.[0];
  const urlPreview = message.messageType === MessageType.TEXT ? extractFirstUrl(text) : null;

  // Group reactions by emoji
  const reactionMap = new Map<string, string[]>();
  (message.reactions || []).forEach((r) => {
    const arr = reactionMap.get(r.emoji) || [];
    arr.push(r.userId);
    reactionMap.set(r.emoji, arr);
  });

  const renderTextWithMentionsAndLinks = (rawText: string) => {
    const tokens = rawText.split(/(@[a-zA-Z0-9_]+|https?:\/\/[^\s]+)/g);
    return tokens.map((part, idx) => {
      if (part.startsWith('@') && part.length > 1) {
        return (
          <span key={idx} className="text-[#027eb5] dark:text-[#53bdeb] font-semibold">
            {part}
          </span>
        );
      }
      if (/^https?:\/\//i.test(part)) {
        return (
          <a
            key={idx}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#027eb5] dark:text-[#53bdeb] underline break-all"
          >
            {part}
          </a>
        );
      }
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
  };

  const renderBody = () => {
    if (message.isDeletedForEveryone) {
      return (
        <p className="italic text-[#667781] dark:text-[#8696a0] text-sm flex items-center gap-1.5">
          <Trash2 className="w-3.5 h-3.5" />
          This message was deleted
        </p>
      );
    }

    if (message.isViewOnce && !viewOnceOpened && (message.messageType === MessageType.IMAGE || message.messageType === MessageType.VIDEO)) {
      return (
        <button
          type="button"
          onClick={() => setViewOnceOpened(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-black/5 dark:bg-white/10 text-sm font-medium hover:bg-black/10"
        >
          <Eye className="w-4 h-4 text-[#00A884]" />
          <span>View Once {message.messageType === MessageType.IMAGE ? 'Photo' : 'Video'}</span>
        </button>
      );
    }

    switch (message.messageType) {
      case MessageType.IMAGE:
      case MessageType.GIF:
      case MessageType.STICKER: {
        const rawImgUrl = attachment?.fileUrl || text;
        const imgUrl = resolveMediaUrl(rawImgUrl);
        const isSticker = message.messageType === MessageType.STICKER;
        return (
          <div className="space-y-1.5">
            {imgUrl && (
              <div className="relative">
                <img
                  src={imgUrl}
                  alt={attachment?.fileName || 'Image'}
                  onClick={() => onImagePreview?.(imgUrl)}
                  className={`rounded-xl cursor-pointer object-cover ${
                    isSticker ? 'w-32 h-32 bg-transparent' : 'max-h-72 w-full'
                  }`}
                />
                {typeof message.uploadProgress === 'number' && message.uploadProgress < 100 && (
                  <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center text-white text-xs font-semibold">
                    Uploading {message.uploadProgress}%
                  </div>
                )}
              </div>
            )}
            {text && text !== rawImgUrl && text !== imgUrl && (
              <p className={`${fontSizeClass} whitespace-pre-wrap`}>{text}</p>
            )}
          </div>
        );
      }

      case MessageType.VIDEO: {
        const rawVideoUrl = attachment?.fileUrl || text;
        const videoUrl = resolveMediaUrl(rawVideoUrl);
        return (
          <div className="space-y-1.5">
            {videoUrl && (
              <video
                src={videoUrl}
                controls
                className="rounded-xl max-h-72 w-full bg-black"
              />
            )}
            {text && text !== rawVideoUrl && text !== videoUrl && (
              <p className={`${fontSizeClass} whitespace-pre-wrap`}>{text}</p>
            )}
          </div>
        );
      }

      case MessageType.AUDIO:
      case MessageType.VOICE: {
        const audioUrl = resolveMediaUrl(attachment?.fileUrl || text);
        return audioUrl ? (
          <VoicePlayer src={audioUrl} duration={attachment?.duration} isOwn={isOwn} />
        ) : (
          <p className="text-sm text-[#667781]">Voice message</p>
        );
      }

      case MessageType.DOCUMENT: {
        const docUrl = resolveMediaUrl(attachment?.fileUrl) || '#';
        const fileName = attachment?.fileName || text || 'Document.pdf';
        return (
          <a
            href={docUrl}
            target="_blank"
            rel="noopener noreferrer"
            download={fileName}
            className="flex items-center gap-3 p-2.5 rounded-xl bg-black/5 dark:bg-white/10 hover:bg-black/10 transition min-w-[220px]"
          >
            <div className="w-10 h-10 rounded-lg bg-[#00A884]/15 text-[#00A884] flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{fileName}</p>
              <p className="text-[11px] text-[#667781] dark:text-[#8696a0]">
                {formatBytes(attachment?.fileSize) || 'Document'}
              </p>
            </div>
            <Download className="w-4 h-4 text-[#667781] shrink-0" />
          </a>
        );
      }

      case MessageType.LOCATION: {
        const loc = parseJsonSafe<LocationData>(text);
        const lat = loc?.latitude ?? 0;
        const lng = loc?.longitude ?? 0;
        const mapLink = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`;
        return (
          <a
            href={mapLink}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-xl overflow-hidden border border-black/10 dark:border-white/10 min-w-[220px] bg-black/5 dark:bg-white/5 hover:opacity-95"
          >
            <div className="h-24 bg-gradient-to-br from-emerald-100 to-teal-200 dark:from-emerald-950 dark:to-teal-900 flex flex-col items-center justify-center relative">
              <MapPin className="w-7 h-7 text-red-500 drop-shadow" />
              {loc?.isLive && (
                <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-[#25D366] text-white text-[10px] font-bold animate-pulse">
                  LIVE
                </span>
              )}
            </div>
            <div className="p-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">
                  {loc?.label || (loc?.isLive ? 'Live Location' : 'Shared Location')}
                </p>
                <p className="text-[11px] text-[#667781] dark:text-[#8696a0] font-mono">
                  {lat.toFixed(5)}, {lng.toFixed(5)}
                </p>
              </div>
              <ExternalLink className="w-4 h-4 text-[#00A884] shrink-0" />
            </div>
          </a>
        );
      }

      case MessageType.CONTACT: {
        const card = parseJsonSafe<ContactCardData>(text);
        return (
          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-black/5 dark:bg-white/10 min-w-[210px]">
            <div className="w-10 h-10 rounded-full bg-[#00A884]/20 text-[#00A884] flex items-center justify-center shrink-0">
              <UserIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{card?.name || 'Shared Contact'}</p>
              <p className="text-xs text-[#667781] dark:text-[#8696a0] font-mono">
                {card?.phone || text}
              </p>
            </div>
          </div>
        );
      }

      case MessageType.POLL: {
        const poll = parseJsonSafe<PollData>(text);
        if (!poll) return <p className={fontSizeClass}>{text}</p>;
        const totalVotes = poll.options.reduce((sum, o) => sum + (o.votes?.length || 0), 0);
        return (
          <div className="min-w-[230px] sm:min-w-[270px] space-y-2">
            <p className="font-semibold text-sm">{poll.question}</p>
            <div className="space-y-1.5">
              {poll.options.map((opt) => {
                const votes = opt.votes || [];
                const voted = votes.includes(currentUserId);
                const pct = totalVotes > 0 ? Math.round((votes.length / totalVotes) * 100) : 0;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onVotePoll?.(message, opt.id)}
                    className={`w-full text-left p-2 rounded-lg border transition relative overflow-hidden ${
                      voted
                        ? 'border-[#00A884] bg-[#00A884]/10'
                        : 'border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    <div
                      className="absolute inset-y-0 left-0 bg-[#00A884]/15 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                    <div className="relative flex items-center justify-between gap-2 text-xs font-medium">
                      <span>{opt.text}</span>
                      <span className="text-[#667781] dark:text-[#8696a0]">
                        {votes.length} ({pct}%)
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[#667781] dark:text-[#8696a0]">
              {totalVotes} vote{totalVotes === 1 ? '' : 's'}
            </p>
          </div>
        );
      }

      default:
        return (
          <div className="space-y-1.5">
            <p className={`${fontSizeClass} whitespace-pre-wrap break-words leading-relaxed`}>
              {renderTextWithMentionsAndLinks(text)}
            </p>
            {urlPreview && (
              <a
                href={urlPreview}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 p-2 rounded-lg bg-black/5 dark:bg-white/5 border-l-2 border-[#00A884] text-xs hover:bg-black/10"
              >
                <ExternalLink className="w-3.5 h-3.5 text-[#00A884] shrink-0" />
                <span className="truncate text-[#027eb5] dark:text-[#53bdeb]">{urlPreview}</span>
              </a>
            )}
          </div>
        );
    }
  };

  const renderTicks = () => {
    if (!isOwn) return null;
    if (message.clientStatus === 'sending') {
      return <Clock className="w-3.5 h-3.5 text-[#667781]" />;
    }
    if (message.clientStatus === 'failed') {
      return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
    }
    if (message.readAt) {
      return <CheckCheck className="w-4 h-4 text-[#53bdeb]" />;
    }
    if (message.deliveredAt) {
      return <CheckCheck className="w-4 h-4 text-[#667781] dark:text-[#8696a0]" />;
    }
    return <Check className="w-3.5 h-3.5 text-[#667781] dark:text-[#8696a0]" />;
  };

  return (
    <div
      id={`msg-${message.id}`}
      onClick={() => {
        if (selectionMode && onToggleSelect) {
          onToggleSelect(message);
        }
      }}
      className={`group flex ${isOwn ? 'justify-end' : 'justify-start'} items-center gap-2 px-3 sm:px-6 py-0.5 relative ${
        selected ? 'bg-[#00A884]/10 rounded-lg' : ''
      } ${selectionMode ? 'cursor-pointer' : ''}`}
    >
      {selectionMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.(message);
          }}
          className="text-[#00A884] shrink-0"
          title={selected ? 'Deselect message' : 'Select message'}
        >
          {selected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-[#667781]" />}
        </button>
      )}
      <div
        className={`relative max-w-[85%] sm:max-w-[68%] rounded-2xl px-3 py-2 shadow-sm ${
          isOwn
            ? 'bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] rounded-tr-sm'
            : 'bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] rounded-tl-sm'
        }`}
      >
        {/* Sender Name for Group */}
        {showSenderName && !isOwn && message.sender && (
          <p className="text-xs font-semibold text-[#00A884] mb-0.5">
            {message.sender.displayName}
          </p>
        )}

        {/* Forwarded Label */}
        {message.forwardedFromId && (
          <p className="text-[11px] italic text-[#667781] dark:text-[#8696a0] flex items-center gap-1 mb-1">
            <Forward className="w-3 h-3" /> Forwarded
          </p>
        )}

        {/* Reply Quote */}
        {message.replyTo && (
          <button
            type="button"
            onClick={() => onJumpToMessage?.(message.replyTo!.id)}
            className="w-full text-left mb-1.5 p-2 rounded-lg bg-black/5 dark:bg-black/20 border-l-4 border-[#00A884] text-xs"
          >
            <p className="font-semibold text-[#00A884] truncate">
              {message.replyTo.senderId === currentUserId ? 'You' : 'Replied message'}
            </p>
            <p className="text-[#667781] dark:text-[#8696a0] truncate">
              {message.replyTo.content || message.replyTo.messageType}
            </p>
          </button>
        )}

        {/* Main Content */}
        {renderBody()}

        {/* Footer Metadata */}
        <div className="flex items-center justify-end gap-1.5 mt-1 select-none">
          {message.isEncrypted && (
            <span title="End-to-End Encrypted">
              <Lock className="w-3 h-3 text-[#667781] dark:text-[#8696a0]" />
            </span>
          )}
          {isPinned && <Pin className="w-3 h-3 text-[#00A884]" />}
          {message.isStarred && <Star className="w-3 h-3 text-amber-400 fill-amber-400" />}
          {message.isEdited && !message.isDeletedForEveryone && (
            <span className="text-[10px] text-[#667781] dark:text-[#8696a0]">Edited</span>
          )}
          <span className="text-[10px] text-[#667781] dark:text-[#8696a0]">
            {formatMessageTime(message.createdAt)}
          </span>
          {renderTicks()}
        </div>

        {/* Failed Retry Button */}
        {message.clientStatus === 'failed' && (
          <button
            type="button"
            onClick={() => onRetry(message.id)}
            className="mt-1.5 flex items-center gap-1 text-xs text-red-500 font-medium hover:underline"
          >
            <RotateCcw className="w-3 h-3" /> Retry send
          </button>
        )}

        {/* Reaction Pills */}
        {reactionMap.size > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {Array.from(reactionMap.entries()).map(([emoji, userIds]) => {
              const mine = userIds.includes(currentUserId);
              const reactorNames = userIds.map((uid) =>
                uid === currentUserId ? 'You' : memberNamesById?.[uid] || 'Member',
              );
              return (
                <button
                  key={emoji}
                  type="button"
                  title={`${emoji} · ${reactorNames.join(', ')}`}
                  onClick={() => onReact(message, emoji)}
                  className={`px-1.5 py-0.5 rounded-full text-xs flex items-center gap-1 border transition ${
                    mine
                      ? 'bg-[#00A884]/20 border-[#00A884] text-[#00A884]'
                      : 'bg-white/80 dark:bg-[#111b21]/80 border-gray-200 dark:border-[#2a3942]'
                  }`}
                >
                  <span>{emoji}</span>
                  {reactorNames.length === 1 && (
                    <span className="text-[10px] max-w-[72px] truncate opacity-80">
                      {reactorNames[0]}
                    </span>
                  )}
                  {userIds.length > 1 && <span className="text-[10px]">{userIds.length}</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Always-accessible Menu / Reaction Trigger (visible on touch, hover on desktop) */}
        {!message.isDeletedForEveryone && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
              setShowMoreEmojis(false);
            }}
            className={`absolute top-1.5 right-1.5 p-1 rounded-full bg-black/5 dark:bg-white/10 hover:bg-black/15 dark:hover:bg-white/20 text-[#54656f] dark:text-[#e9edef] transition ${
              menuOpen ? 'opacity-100' : 'opacity-70 md:opacity-0 md:group-hover:opacity-100'
            }`}
            title="React & message actions"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Hover Quick Toolbar */}
        {!message.isDeletedForEveryone && (
          <div
            className={`hidden md:group-hover:flex items-center gap-0.5 absolute -top-4 ${
              isOwn ? 'left-0 -translate-x-2' : 'right-0 translate-x-2'
            } bg-white dark:bg-[#2a3942] border border-gray-200 dark:border-[#3b4a54] rounded-full px-1.5 py-0.5 shadow-md z-10`}
          >
            {QUICK_EMOJIS.slice(0, 4).map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onReact(message, emoji)}
                className="hover:scale-125 transition px-1 text-sm"
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setMenuOpen((o) => !o);
                setShowMoreEmojis(false);
              }}
              className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-[#3b4a54] text-[#667781] dark:text-[#e9edef]"
              title="More reactions & actions"
            >
              <SmilePlus className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Context Action Menu */}
        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-20"
              onClick={() => {
                setMenuOpen(false);
                setShowMoreEmojis(false);
              }}
            />
            <div
              className={`absolute top-6 ${
                isOwn ? 'right-0' : 'left-0'
              } z-30 w-56 bg-white dark:bg-[#233138] rounded-xl shadow-xl border border-gray-200 dark:border-[#2a3942] py-1.5 text-sm`}
            >
              <div className="flex items-center justify-around px-2 py-1.5 border-b border-gray-100 dark:border-[#2a3942]">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      onReact(message, emoji);
                      setMenuOpen(false);
                      setShowMoreEmojis(false);
                    }}
                    className="hover:scale-125 transition text-base"
                  >
                    {emoji}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowMoreEmojis((v) => !v)}
                  className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-[#182229] text-[#667781] dark:text-[#aebac1]"
                  title="More emojis"
                >
                  <SmilePlus className="w-4 h-4" />
                </button>
              </div>
              {showMoreEmojis && (
                <div className="grid grid-cols-6 gap-1 px-2 py-2 border-b border-gray-100 dark:border-[#2a3942]">
                  {MORE_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        onReact(message, emoji);
                        setMenuOpen(false);
                        setShowMoreEmojis(false);
                      }}
                      className="hover:scale-125 transition text-base py-0.5"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            <button
              type="button"
              onClick={() => {
                onReply(message);
                setMenuOpen(false);
              }}
              className="w-full px-3.5 py-2 text-left hover:bg-gray-100 dark:hover:bg-[#182229] flex items-center gap-2.5"
            >
              <Reply className="w-4 h-4" /> Reply
            </button>
            <button
              type="button"
              onClick={() => {
                onForward(message);
                setMenuOpen(false);
              }}
              className="w-full px-3.5 py-2 text-left hover:bg-gray-100 dark:hover:bg-[#182229] flex items-center gap-2.5"
            >
              <Forward className="w-4 h-4" /> Forward
            </button>
            {text && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(text);
                  toast.success('Copied to clipboard');
                  setMenuOpen(false);
                }}
                className="w-full px-3.5 py-2 text-left hover:bg-gray-100 dark:hover:bg-[#182229] flex items-center gap-2.5"
              >
                <Copy className="w-4 h-4" /> Copy
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onStar(message);
                setMenuOpen(false);
              }}
              className="w-full px-3.5 py-2 text-left hover:bg-gray-100 dark:hover:bg-[#182229] flex items-center gap-2.5"
            >
              <Star className="w-4 h-4" /> {message.isStarred ? 'Unstar' : 'Star'}
            </button>
            <button
              type="button"
              onClick={() => {
                onPin(message);
                setMenuOpen(false);
              }}
              className="w-full px-3.5 py-2 text-left hover:bg-gray-100 dark:hover:bg-[#182229] flex items-center gap-2.5"
            >
              <Pin className="w-4 h-4" /> {isPinned ? 'Unpin' : 'Pin'}
            </button>
            {isOwn && message.messageType === MessageType.TEXT && (
              <button
                type="button"
                onClick={() => {
                  onEdit(message);
                  setMenuOpen(false);
                }}
                className="w-full px-3.5 py-2 text-left hover:bg-gray-100 dark:hover:bg-[#182229] flex items-center gap-2.5"
              >
                <Edit3 className="w-4 h-4" /> Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onShowInfo(message);
                setMenuOpen(false);
              }}
              className="w-full px-3.5 py-2 text-left hover:bg-gray-100 dark:hover:bg-[#182229] flex items-center gap-2.5"
            >
              <Info className="w-4 h-4" /> Message info
            </button>
            {onToggleSelect && (
              <button
                type="button"
                onClick={() => {
                  onToggleSelect(message);
                  setMenuOpen(false);
                }}
                className="w-full px-3.5 py-2 text-left hover:bg-gray-100 dark:hover:bg-[#182229] flex items-center gap-2.5"
              >
                <CheckSquare className="w-4 h-4" /> {selected ? 'Deselect' : 'Select'}
              </button>
            )}
            <div className="border-t border-gray-100 dark:border-[#2a3942] my-1" />
            <button
              type="button"
              onClick={() => {
                onDelete(message, false);
                setMenuOpen(false);
              }}
              className="w-full px-3.5 py-2 text-left text-red-500 hover:bg-gray-100 dark:hover:bg-[#182229] flex items-center gap-2.5"
            >
              <Trash2 className="w-4 h-4" /> Delete for me
            </button>
            {isOwn && (
              <button
                type="button"
                onClick={() => {
                  onDelete(message, true);
                  setMenuOpen(false);
                }}
                className="w-full px-3.5 py-2 text-left text-red-500 hover:bg-gray-100 dark:hover:bg-[#182229] flex items-center gap-2.5"
              >
                <Trash2 className="w-4 h-4" /> Delete for everyone
              </button>
            )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
