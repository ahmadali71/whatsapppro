import React, { useEffect, useRef, useState } from 'react';
import EmojiPicker, { EmojiClickData, Theme as EmojiTheme } from 'emoji-picker-react';
import {
  Smile,
  Paperclip,
  Send,
  Mic,
  Trash2,
  X,
  Image as ImageIcon,
  FileText,
  MapPin,
  UserPlus,
  BarChart2,
  Sparkles,
  Eye,
} from 'lucide-react';
import { ConversationType, MessageType, User } from '@whatsapp-pro/shared-types';
import { ConversationWithMeta, useChatStore } from '@/stores/chatStore';
import { useThemeStore } from '@/stores/themeStore';
import { API_ORIGIN, extractErrorMessage } from '@/lib/api';
import { socketManager } from '@/lib/socket';
import { toast } from '@/stores/toastStore';

const SAMPLE_STICKERS = ['🎉', '🔥', '🚀', '💯', '🤩', '🥳', '❤️‍🔥', '🙌'];
const SAMPLE_GIFS = [
  { label: 'Thumbs Up', url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif' },
  { label: 'Celebrate', url: 'https://media.giphy.com/media/g9582DNuQppxC/giphy.gif' },
  { label: 'Mind Blown', url: 'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif' },
  { label: 'Clapping', url: 'https://media.giphy.com/media/l3q2XhfQ8oCkm1Ts4/giphy.gif' },
];

interface MessageComposerProps {
  conversation: ConversationWithMeta;
  currentUserId: string;
}

export const MessageComposer: React.FC<MessageComposerProps> = ({ conversation, currentUserId }) => {
  const {
    replyingTo,
    editingMessage,
    setReplyingTo,
    setEditingMessage,
    sendMessage,
    sendMediaMessage,
    editMessage,
    contacts,
  } = useChatStore();
  const { resolvedTheme, enterToSend } = useThemeStore();

  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGifSticker, setShowGifSticker] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [viewOnce, setViewOnce] = useState(false);

  // @mentions
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  // Voice recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  // Modals for Poll / Location / Contact
  const [pollModalOpen, setPollModalOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);

  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [locLat, setLocLat] = useState('');
  const [locLng, setLocLng] = useState('');
  const [locLabel, setLocLabel] = useState('');
  const [locIsLive, setLocIsLive] = useState(false);

  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.decryptedContent || editingMessage.content || '');
    }
  }, [editingMessage]);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  const groupMembers: User[] = (conversation.members || [])
    .map((m) => m.user)
    .filter((u): u is User => Boolean(u && u.id !== currentUserId));

  const mentionCandidates =
    mentionQuery !== null && conversation.type !== ConversationType.DIRECT
      ? groupMembers.filter(
          (u) =>
            (u.username || '').toLowerCase().includes(mentionQuery.toLowerCase()) ||
            u.displayName.toLowerCase().includes(mentionQuery.toLowerCase()),
        )
      : [];

  const handleTextChange = (val: string) => {
    setText(val);

    // Check @mention trigger at cursor end
    const match = val.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);
    setMentionQuery(match ? match[1] : null);

    socketManager.sendTypingStart(conversation.id);
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => {
      socketManager.sendTypingStop(conversation.id);
    }, 2500);
  };

  const insertMention = (user: User) => {
    const handle = user.username || user.displayName.replace(/\s+/g, '_');
    const replaced = text.replace(/@([a-zA-Z0-9_]*)$/, `@${handle} `);
    setText(replaced);
    setMentionQuery(null);
  };

  const handleSendText = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    socketManager.sendTypingStop(conversation.id);
    setShowEmoji(false);

    if (editingMessage) {
      try {
        await editMessage(editingMessage.id, conversation.id, trimmed);
        setText('');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to edit message');
      }
      return;
    }

    setText('');
    try {
      await sendMessage(conversation.id, {
        messageType: MessageType.TEXT,
        content: trimmed,
        replyToId: replyingTo?.id,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && enterToSend) {
      e.preventDefault();
      void handleSendText();
    }
  };

  const handleFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>,
    defaultType: MessageType,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setShowAttachMenu(false);

    let messageType = defaultType;
    if (file.type.startsWith('image/')) messageType = MessageType.IMAGE;
    else if (file.type.startsWith('video/')) messageType = MessageType.VIDEO;
    else if (file.type.startsWith('audio/')) messageType = MessageType.AUDIO;
    else messageType = MessageType.DOCUMENT;

    if (
      messageType !== MessageType.IMAGE &&
      API_ORIGIN.includes('.vercel.app') &&
      file.size > 4 * 1024 * 1024
    ) {
      toast.error('Files larger than 4 MB cannot be uploaded in serverless mode.');
      return;
    }

    await sendMediaMessage(conversation.id, {
      file,
      fileName: file.name,
      messageType,
      isViewOnce: viewOnce,
    });
    setViewOnce(false);
  };

  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch {
      toast.error('Microphone permission denied');
    }
  };

  const cancelVoiceRecording = () => {
    const rec = mediaRecorderRef.current;
    if (rec) {
      rec.stream.getTracks().forEach((t) => t.stop());
      rec.stop();
    }
    if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
    setIsRecording(false);
    setRecordSeconds(0);
  };

  const finishVoiceRecording = () => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    const duration = recordSeconds;
    if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);

    rec.onstop = async () => {
      rec.stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      setIsRecording(false);
      setRecordSeconds(0);
      if (blob.size > 0) {
        await sendMediaMessage(conversation.id, {
          file: blob,
          fileName: `voice-${Date.now()}.webm`,
          messageType: MessageType.VOICE,
          duration,
        });
      }
    };
    rec.stop();
  };

  const handleCreatePoll = async (e: React.FormEvent) => {
    e.preventDefault();
    const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (!pollQuestion.trim() || opts.length < 2) {
      toast.error('Provide a question and at least 2 options');
      return;
    }
    const payload = {
      question: pollQuestion.trim(),
      options: opts.map((opt, idx) => ({ id: `opt-${idx}`, text: opt, votes: [] })),
    };
    try {
      await sendMessage(conversation.id, {
        messageType: MessageType.POLL,
        content: JSON.stringify(payload),
        encryptE2EE: false,
      });
      setPollModalOpen(false);
      setPollQuestion('');
      setPollOptions(['', '']);
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to create poll'));
    }
  };

  const detectCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported in this browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocLat(String(pos.coords.latitude));
        setLocLng(String(pos.coords.longitude));
      },
      () => toast.error('Unable to retrieve GPS coordinates'),
    );
  };

  const handleSendLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    const lat = parseFloat(locLat);
    const lng = parseFloat(locLng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      toast.error('Enter valid latitude and longitude');
      return;
    }
    try {
      await sendMessage(conversation.id, {
        messageType: MessageType.LOCATION,
        content: JSON.stringify({
          latitude: lat,
          longitude: lng,
          label: locLabel.trim() || undefined,
          isLive: locIsLive,
        }),
        latitude: lat,
        longitude: lng,
        encryptE2EE: false,
      });
      setLocationModalOpen(false);
      setLocLabel('');
      setLocIsLive(false);
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to share location'));
    }
  };

  const handleSendContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactName.trim() || !contactPhone.trim()) {
      toast.error('Enter contact name and phone');
      return;
    }
    try {
      await sendMessage(conversation.id, {
        messageType: MessageType.CONTACT,
        content: JSON.stringify({ name: contactName.trim(), phone: contactPhone.trim() }),
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
        encryptE2EE: false,
      });
      setContactModalOpen(false);
      setContactName('');
      setContactPhone('');
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to share contact'));
    }
  };

  return (
    <div className="relative bg-[#f0f2f5] dark:bg-[#202c33] border-t border-gray-200 dark:border-[#2a3942] px-3 py-2.5 shrink-0">
      {/* Mention Autocomplete Popup */}
      {mentionCandidates.length > 0 && (
        <div className="absolute bottom-full left-4 mb-2 w-64 bg-white dark:bg-[#233138] border border-gray-200 dark:border-[#2a3942] rounded-xl shadow-xl overflow-hidden z-30">
          {mentionCandidates.slice(0, 6).map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => insertMention(u)}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-[#182229] flex items-center justify-between"
            >
              <span className="font-medium truncate">{u.displayName}</span>
              {u.username && <span className="text-xs text-[#00A884]">@{u.username}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Emoji Picker Popover */}
      {showEmoji && (
        <div className="absolute bottom-full left-2 mb-2 z-30 shadow-2xl rounded-xl overflow-hidden">
          <EmojiPicker
            theme={resolvedTheme === 'dark' ? EmojiTheme.DARK : EmojiTheme.LIGHT}
            onEmojiClick={(emojiData: EmojiClickData) => setText((prev) => prev + emojiData.emoji)}
            lazyLoadEmojis
          />
        </div>
      )}

      {/* GIF & Sticker Picker Popover */}
      {showGifSticker && (
        <div className="absolute bottom-full left-12 mb-2 z-30 w-72 bg-white dark:bg-[#233138] border border-gray-200 dark:border-[#2a3942] rounded-2xl shadow-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#667781]">Stickers & GIFs</span>
            <button type="button" onClick={() => setShowGifSticker(false)}>
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {SAMPLE_STICKERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  void sendMessage(conversation.id, {
                    messageType: MessageType.STICKER,
                    content: s,
                    encryptE2EE: false,
                  });
                  setShowGifSticker(false);
                }}
                className="text-2xl p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-[#182229]"
              >
                {s}
              </button>
            ))}
          </div>
          <p className="text-[11px] font-semibold text-[#667781] mb-1.5">Trending GIFs</p>
          <div className="grid grid-cols-2 gap-2">
            {SAMPLE_GIFS.map((g) => (
              <button
                key={g.url}
                type="button"
                onClick={() => {
                  void sendMessage(conversation.id, {
                    messageType: MessageType.GIF,
                    content: g.url,
                    attachmentUrl: g.url,
                    encryptE2EE: false,
                  });
                  setShowGifSticker(false);
                }}
                className="rounded-lg overflow-hidden border border-gray-200 dark:border-[#2a3942] hover:opacity-90"
              >
                <img src={g.url} alt={g.label} className="w-full h-16 object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Attachment Menu Popover */}
      {showAttachMenu && (
        <div className="absolute bottom-full left-14 mb-2 z-30 w-56 bg-white dark:bg-[#233138] border border-gray-200 dark:border-[#2a3942] rounded-2xl shadow-xl p-2 space-y-1">
          <label className="flex items-center justify-between px-3 py-1.5 text-xs text-[#667781] dark:text-[#8696a0] border-b border-gray-100 dark:border-[#2a3942] cursor-pointer">
            <span className="flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-[#00A884]" /> View Once
            </span>
            <input
              type="checkbox"
              checked={viewOnce}
              onChange={(e) => setViewOnce(e.target.checked)}
              className="accent-[#00A884]"
            />
          </label>
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-[#182229] text-sm"
          >
            <ImageIcon className="w-4 h-4 text-purple-500" /> Photos & Videos
          </button>
          <button
            type="button"
            onClick={() => docInputRef.current?.click()}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-[#182229] text-sm"
          >
            <FileText className="w-4 h-4 text-blue-500" /> Document / PDF
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAttachMenu(false);
              setPollModalOpen(true);
            }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-[#182229] text-sm"
          >
            <BarChart2 className="w-4 h-4 text-emerald-500" /> Poll
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAttachMenu(false);
              detectCurrentLocation();
              setLocationModalOpen(true);
            }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-[#182229] text-sm"
          >
            <MapPin className="w-4 h-4 text-red-500" /> Location
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAttachMenu(false);
              setContactModalOpen(true);
            }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-[#182229] text-sm"
          >
            <UserPlus className="w-4 h-4 text-amber-500" /> Contact
          </button>
        </div>
      )}

      {/* Hidden File Inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => void handleFileSelected(e, MessageType.IMAGE)}
      />
      <input
        ref={docInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,*/*"
        className="hidden"
        onChange={(e) => void handleFileSelected(e, MessageType.DOCUMENT)}
      />

      {/* Reply / Edit Banner */}
      {(replyingTo || editingMessage) && (
        <div className="flex items-center justify-between gap-3 mb-2 px-3 py-2 rounded-xl bg-white dark:bg-[#111b21] border-l-4 border-[#00A884]">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#00A884]">
              {editingMessage ? 'Editing message' : 'Replying to message'}
            </p>
            <p className="text-xs text-[#667781] dark:text-[#8696a0] truncate">
              {(editingMessage || replyingTo)?.decryptedContent ||
                (editingMessage || replyingTo)?.content ||
                (editingMessage || replyingTo)?.messageType}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setReplyingTo(null);
              setEditingMessage(null);
              if (editingMessage) setText('');
            }}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Composer Row */}
      {isRecording ? (
        <div className="flex items-center justify-between gap-3 py-1 px-2">
          <button
            type="button"
            onClick={cancelVoiceRecording}
            className="p-2 rounded-full text-red-500 hover:bg-red-500/10"
            title="Cancel recording"
          >
            <Trash2 className="w-5 h-5" />
          </button>
          <div className="flex-1 flex items-center gap-3 px-4 py-2 rounded-full bg-white dark:bg-[#2a3942]">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="font-mono text-sm font-semibold">
              {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, '0')}
            </span>
            <span className="text-xs text-[#667781] dark:text-[#8696a0]">Recording voice note...</span>
          </div>
          <button
            type="button"
            onClick={finishVoiceRecording}
            className="p-2.5 rounded-full bg-[#00A884] hover:bg-[#008f6f] text-white"
            title="Send Voice Note"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => {
              setShowEmoji((v) => !v);
              setShowGifSticker(false);
              setShowAttachMenu(false);
            }}
            className="p-2 rounded-full text-[#54656f] dark:text-[#aebac1] hover:bg-gray-200 dark:hover:bg-[#2a3942]"
            title="Emoji"
          >
            <Smile className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => {
              setShowGifSticker((v) => !v);
              setShowEmoji(false);
              setShowAttachMenu(false);
            }}
            className="p-2 rounded-full text-[#54656f] dark:text-[#aebac1] hover:bg-gray-200 dark:hover:bg-[#2a3942]"
            title="Stickers & GIFs"
          >
            <Sparkles className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => {
              setShowAttachMenu((v) => !v);
              setShowEmoji(false);
              setShowGifSticker(false);
            }}
            className="p-2 rounded-full text-[#54656f] dark:text-[#aebac1] hover:bg-gray-200 dark:hover:bg-[#2a3942]"
            title="Attach"
          >
            <Paperclip className="w-5 h-5" />
          </button>

          <textarea
            rows={1}
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message"
            className="flex-1 max-h-32 resize-none px-4 py-2.5 rounded-2xl bg-white dark:bg-[#2a3942] text-sm focus:outline-none placeholder:text-[#667781] dark:placeholder:text-[#8696a0]"
          />

          {text.trim() ? (
            <button
              type="button"
              onClick={() => void handleSendText()}
              className="p-2.5 rounded-full bg-[#00A884] hover:bg-[#008f6f] text-white shrink-0 transition"
              title="Send"
            >
              <Send className="w-5 h-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void startVoiceRecording()}
              className="p-2.5 rounded-full bg-[#00A884] hover:bg-[#008f6f] text-white shrink-0 transition"
              title="Record Voice Note"
            >
              <Mic className="w-5 h-5" />
            </button>
          )}
        </div>
      )}

      {/* Poll Modal */}
      {pollModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleCreatePoll}
            className="bg-white dark:bg-[#202c33] rounded-2xl p-6 max-w-md w-full shadow-xl border border-gray-200 dark:border-[#2a3942]"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-base">Create Poll</h3>
              <button type="button" onClick={() => setPollModalOpen(false)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <input
              type="text"
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              placeholder="Ask a question..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm mb-3"
              required
            />
            <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
              {pollOptions.map((opt, idx) => (
                <input
                  key={idx}
                  type="text"
                  value={opt}
                  onChange={(e) => {
                    const next = [...pollOptions];
                    next[idx] = e.target.value;
                    setPollOptions(next);
                  }}
                  placeholder={`Option ${idx + 1}`}
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm"
                />
              ))}
            </div>
            {pollOptions.length < 6 && (
              <button
                type="button"
                onClick={() => setPollOptions([...pollOptions, ''])}
                className="text-xs text-[#00A884] font-semibold mb-4 hover:underline"
              >
                + Add option
              </button>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPollModalOpen(false)}
                className="px-4 py-2 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-[#2a3942]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-sm bg-[#00A884] text-white font-medium"
              >
                Send Poll
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Location Modal */}
      {locationModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleSendLocation}
            className="bg-white dark:bg-[#202c33] rounded-2xl p-6 max-w-md w-full shadow-xl border border-gray-200 dark:border-[#2a3942]"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-base">Share Location</h3>
              <button type="button" onClick={() => setLocationModalOpen(false)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <input
                type="text"
                value={locLat}
                onChange={(e) => setLocLat(e.target.value)}
                placeholder="Latitude"
                className="px-3 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm"
                required
              />
              <input
                type="text"
                value={locLng}
                onChange={(e) => setLocLng(e.target.value)}
                placeholder="Longitude"
                className="px-3 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm"
                required
              />
            </div>
            <input
              type="text"
              value={locLabel}
              onChange={(e) => setLocLabel(e.target.value)}
              placeholder="Location name (optional)"
              className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm mb-3"
            />
            <label className="flex items-center gap-2 text-xs mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={locIsLive}
                onChange={(e) => setLocIsLive(e.target.checked)}
                className="accent-[#00A884]"
              />
              Share Live Location (real-time badge)
            </label>
            <div className="flex justify-between items-center">
              <button
                type="button"
                onClick={detectCurrentLocation}
                className="text-xs text-[#00A884] font-semibold hover:underline"
              >
                Use Current GPS
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-sm bg-[#00A884] text-white font-medium"
              >
                Send Location
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Contact Share Modal */}
      {contactModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleSendContact}
            className="bg-white dark:bg-[#202c33] rounded-2xl p-6 max-w-md w-full shadow-xl border border-gray-200 dark:border-[#2a3942]"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-base">Share Contact</h3>
              <button type="button" onClick={() => setContactModalOpen(false)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {contacts.length > 0 && (
              <div className="mb-3 max-h-32 overflow-y-auto border border-gray-200 dark:border-[#2a3942] rounded-xl divide-y divide-gray-100 dark:divide-[#2a3942]">
                {contacts.slice(0, 10).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setContactName(c.nickname || c.contactUser?.displayName || '');
                      setContactPhone(c.contactUser?.phoneNumber || '');
                    }}
                    className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50 dark:hover:bg-[#111b21] flex justify-between"
                  >
                    <span className="font-medium">{c.nickname || c.contactUser?.displayName}</span>
                    <span className="text-[#667781]">{c.contactUser?.phoneNumber}</span>
                  </button>
                ))}
              </div>
            )}

            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Contact Name"
              className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm mb-3"
              required
            />
            <input
              type="tel"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="Phone Number (+1...)"
              className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm mb-4"
              required
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setContactModalOpen(false)}
                className="px-4 py-2 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-[#2a3942]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-sm bg-[#00A884] text-white font-medium"
              >
                Send Contact
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
