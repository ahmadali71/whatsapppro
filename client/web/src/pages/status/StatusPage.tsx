import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Type,
  Image as ImageIcon,
  Eye,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  Send,
  Pencil,
  RotateCcw,
} from 'lucide-react';
import {
  PrivacyVisibility,
  Status,
  StatusContentType,
  StatusView,
  User,
} from '@whatsapp-pro/shared-types';
import { mediaApi, statusesApi } from '@/services/api.services';
import { useAuthStore } from '@/stores/authStore';
import { extractErrorMessage, resolveMediaUrl } from '@/lib/api';
import { compressImageFile } from '@/lib/imageUtils';
import { Avatar } from '@/components/common/Avatar';
import { toast } from '@/stores/toastStore';

const BG_COLORS = ['#00A884', '#128C7E', '#075E54', '#1E3A8A', '#7C3AED', '#BE185D', '#B45309', '#1F2937'];
const FONT_STYLES = [
  { id: 'sans', label: 'Modern', cls: 'font-sans' },
  { id: 'serif', label: 'Classic', cls: 'font-serif' },
  { id: 'mono', label: 'Typewriter', cls: 'font-mono' },
];
const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '👏', '🔥'];

export const StatusPage: React.FC = () => {
  const { user } = useAuthStore();
  const [myStatuses, setMyStatuses] = useState<Status[]>([]);
  const [contactStatuses, setContactStatuses] = useState<Status[]>([]);
  const [loading, setLoading] = useState(true);

  // Creators
  const [textModalOpen, setTextModalOpen] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [bgColor, setBgColor] = useState(BG_COLORS[0]);
  const [fontStyle, setFontStyle] = useState('sans');
  const [privacy, setPrivacy] = useState<PrivacyVisibility>(PrivacyVisibility.CONTACTS);

  // Media + Canvas Drawing Creator
  const [mediaModalOpen, setMediaModalOpen] = useState(false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [mediaCaption, setMediaCaption] = useState('');
  const [drawMode, setDrawMode] = useState(false);
  const [drawColor, setDrawColor] = useState('#25D366');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  // Story Viewer
  const [viewerGroup, setViewerGroup] = useState<{ ownerName: string; avatarUrl?: string | null; items: Status[]; isMine: boolean } | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const [paused, setPaused] = useState(false);
  const [viewersList, setViewersList] = useState<StatusView[]>([]);
  const [showViewersDrawer, setShowViewersDrawer] = useState(false);
  const [replyText, setReplyText] = useState('');

  const loadStatuses = async () => {
    setLoading(true);
    try {
      const [mine, contacts] = await Promise.all([
        statusesApi.getMyStatuses(),
        statusesApi.getContactsStatuses(),
      ]);
      setMyStatuses(mine);
      setContactStatuses(contacts);
    } catch {
      // Ignore empty/unloaded
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatuses();
  }, []);

  // Group contact statuses by userId
  const groupedContacts = useMemo(() => {
    const map = new Map<string, { user: User; items: Status[] }>();
    contactStatuses.forEach((s) => {
      const uid = s.userId;
      const existing = map.get(uid);
      if (existing) {
        existing.items.push(s);
      } else {
        map.set(uid, {
          user: s.user || ({ id: uid, displayName: 'Contact', phoneNumber: '' } as User),
          items: [s],
        });
      }
    });
    return Array.from(map.values());
  }, [contactStatuses]);

  // Story Viewer auto-advance timer
  useEffect(() => {
    if (!viewerGroup || paused) return;
    const currentStatus = viewerGroup.items[viewerIndex];
    if (!currentStatus) return;

    if (!viewerGroup.isMine) {
      void statusesApi.markViewed(currentStatus.id).catch(() => {});
    } else {
      void statusesApi.getViewers(currentStatus.id).then(setViewersList).catch(() => {});
    }

    setProgressPct(0);
    const interval = window.setInterval(() => {
      setProgressPct((prev) => {
        if (prev >= 100) {
          if (viewerIndex + 1 < viewerGroup.items.length) {
            setViewerIndex((i) => i + 1);
          } else {
            setViewerGroup(null);
          }
          return 0;
        }
        return prev + 2;
      });
    }, 100);

    return () => window.clearInterval(interval);
  }, [viewerGroup, viewerIndex, paused]);

  const handleCreateTextStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusText.trim()) return;
    setSubmitting(true);
    try {
      await statusesApi.createStatus({
        contentType: StatusContentType.TEXT,
        textContent: statusText.trim(),
        backgroundColor: bgColor,
        fontStyle,
        privacy,
      });
      setTextModalOpen(false);
      setStatusText('');
      await loadStatuses();
      toast.success('Status update posted!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post status');
    } finally {
      setSubmitting(false);
    }
  };

  // Initialize canvas when image selected
  useEffect(() => {
    if (!mediaPreviewUrl || !mediaFile?.type.startsWith('image/') || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = 480;
      canvas.height = Math.round((img.height / img.width) * 480) || 480;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = mediaPreviewUrl;
  }, [mediaPreviewUrl, mediaFile]);

  const startCanvasDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawMode || !canvasRef.current) return;
    isDrawingRef.current = true;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvasRef.current.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvasRef.current.height;
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const moveCanvasDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawMode || !isDrawingRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvasRef.current.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvasRef.current.height;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const endCanvasDraw = () => {
    isDrawingRef.current = false;
  };

  const handleCreateMediaStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mediaFile) return;
    setSubmitting(true);
    try {
      let uploadTarget: File | Blob = mediaFile;
      let uploadName = mediaFile.name;
      if (mediaFile.type.startsWith('image/') && canvasRef.current) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvasRef.current!.toBlob(resolve, 'image/jpeg', 0.9),
        );
        if (blob) uploadTarget = blob;
      }

      if (mediaFile.type.startsWith('image/') && mediaFile.type !== 'image/gif') {
        uploadTarget = await compressImageFile(uploadTarget, {
          maxDimension: 1280,
          quality: 0.85,
        });
        if (!uploadName.toLowerCase().endsWith('.jpg') && uploadTarget.type === 'image/jpeg') {
          uploadName = uploadName.replace(/\.[^.]+$/, '') + '.jpg';
        }
      }

      const uploaded = await mediaApi.uploadFile(uploadTarget, 'statuses', undefined, uploadName);
      await statusesApi.createStatus({
        contentType: mediaFile.type.startsWith('video/')
          ? StatusContentType.VIDEO
          : StatusContentType.IMAGE,
        contentUrl: uploaded.url,
        caption: mediaCaption.trim() || undefined,
        privacy,
      });
      setMediaModalOpen(false);
      setMediaFile(null);
      setMediaPreviewUrl(null);
      setMediaCaption('');
      await loadStatuses();
      toast.success('Media status published!');
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to upload status'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMyStatus = async (statusId: string) => {
    try {
      await statusesApi.deleteStatus(statusId);
      setViewerGroup(null);
      await loadStatuses();
      toast.success('Status deleted');
    } catch {
      toast.error('Failed to delete status');
    }
  };

  const handleReactStatus = async (emoji: string) => {
    const current = viewerGroup?.items[viewerIndex];
    if (!current) return;
    try {
      await statusesApi.reactToStatus(current.id, emoji);
      toast.success(`Reacted ${emoji}`);
    } catch {
      toast.error('Failed to react');
    }
  };

  const handleReplyStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    const current = viewerGroup?.items[viewerIndex];
    if (!current || !replyText.trim()) return;
    try {
      await statusesApi.replyToStatus(current.id, replyText.trim());
      setReplyText('');
      toast.success('Reply sent to chat!');
    } catch {
      toast.error('Failed to send reply');
    }
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden bg-white dark:bg-[#111b21]">
      {/* Left Sidebar */}
      <section className="w-full md:w-[380px] border-r border-gray-200 dark:border-[#2a3942] flex flex-col h-full">
        <div className="h-14 px-4 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-gray-200 dark:border-[#2a3942] flex items-center justify-between">
          <h1 className="text-lg font-bold">Status Updates</h1>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTextModalOpen(true)}
              className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-[#2a3942] text-[#00A884]"
              title="New Text Status"
            >
              <Type className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => setMediaModalOpen(true)}
              className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-[#2a3942] text-[#00A884]"
              title="New Photo/Video Status"
            >
              <ImageIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* My Status */}
          <div
            onClick={() => {
              if (myStatuses.length > 0) {
                setViewerIndex(0);
                setViewerGroup({
                  ownerName: 'My Status',
                  avatarUrl: user?.avatarUrl,
                  items: myStatuses,
                  isMine: true,
                });
              } else {
                setMediaModalOpen(true);
              }
            }}
            className="flex items-center gap-3 p-3 rounded-2xl hover:bg-[#f5f6f6] dark:hover:bg-[#202c33] cursor-pointer"
          >
            <div className="relative">
              <div
                className={`p-0.5 rounded-full ${
                  myStatuses.length > 0 ? 'ring-2 ring-[#25D366]' : ''
                }`}
              >
                <Avatar src={user?.avatarUrl} name={user?.displayName} size="md" />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[#00A884] text-white flex items-center justify-center border-2 border-white dark:border-[#111b21]">
                <Plus className="w-3 h-3" />
              </span>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm">My Status</p>
              <p className="text-xs text-[#667781] dark:text-[#8696a0]">
                {myStatuses.length > 0
                  ? `${myStatuses.length} active update(s) · Tap to view`
                  : 'Tap to add status update'}
              </p>
            </div>
          </div>

          {myStatuses.length === 0 && (
            <div className="mx-2 p-3 rounded-2xl border border-dashed border-[#00A884]/40 bg-[#00A884]/5 flex items-center justify-between gap-2">
              <span className="text-xs text-[#54656f] dark:text-[#aebac1]">
                Share a photo or text update for 24h
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setMediaModalOpen(true)}
                  className="px-2.5 py-1 rounded-lg bg-[#00A884] text-white text-[11px] font-semibold"
                >
                  Photo
                </button>
                <button
                  type="button"
                  onClick={() => setTextModalOpen(true)}
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#2a3942] border border-gray-200 dark:border-[#3b4a54] text-[11px] font-semibold"
                >
                  Text
                </button>
              </div>
            </div>
          )}

          <div className="px-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#00A884] mb-2">
              Recent Updates
            </p>
            {loading ? (
              <p className="text-xs text-[#667781] py-4">Loading updates...</p>
            ) : groupedContacts.length === 0 ? (
              <p className="text-xs text-[#667781] py-6 text-center">
                No recent status updates from your contacts.
              </p>
            ) : (
              <div className="space-y-1">
                {groupedContacts.map((group) => (
                  <button
                    key={group.user.id}
                    type="button"
                    onClick={() => {
                      setViewerIndex(0);
                      setViewerGroup({
                        ownerName: group.user.displayName,
                        avatarUrl: group.user.avatarUrl,
                        items: group.items,
                        isMine: false,
                      });
                    }}
                    className="w-full flex items-center gap-3 p-2.5 rounded-2xl hover:bg-[#f5f6f6] dark:hover:bg-[#202c33] text-left"
                  >
                    <div className="p-0.5 rounded-full ring-2 ring-[#25D366]">
                      <Avatar src={group.user.avatarUrl} name={group.user.displayName} size="md" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{group.user.displayName}</p>
                      <p className="text-xs text-[#667781] dark:text-[#8696a0]">
                        {new Date(group.items[group.items.length - 1].createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Right Preview Area */}
      <section className="hidden md:flex flex-1 flex-col items-center justify-center bg-[#f0f2f5] dark:bg-[#0b141a] p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-[#00A884]/15 text-[#00A884] flex items-center justify-center mb-5">
          <Eye className="w-9 h-9" />
        </div>
        <h2 className="text-xl font-medium mb-2">Share ephemeral moments</h2>
        <p className="text-sm text-[#667781] dark:text-[#8696a0] max-w-sm mb-6">
          Status updates disappear automatically after 24 hours and respect your privacy settings.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setTextModalOpen(true)}
            className="px-4 py-2.5 rounded-full bg-[#00A884] text-white text-sm font-medium flex items-center gap-2"
          >
            <Type className="w-4 h-4" /> Text Status
          </button>
          <button
            type="button"
            onClick={() => setMediaModalOpen(true)}
            className="px-4 py-2.5 rounded-full border border-gray-300 dark:border-[#2a3942] text-sm font-medium flex items-center gap-2"
          >
            <ImageIcon className="w-4 h-4" /> Photo / Video
          </button>
        </div>
      </section>

      {/* Text Status Creator Modal */}
      {textModalOpen && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: bgColor }}>
          <div className="flex items-center justify-between p-4 text-white">
            <button type="button" onClick={() => setTextModalOpen(false)} className="p-2 rounded-full bg-black/20">
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              {BG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setBgColor(c)}
                  className={`w-6 h-6 rounded-full border-2 ${
                    bgColor === c ? 'border-white scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <select
                value={fontStyle}
                onChange={(e) => setFontStyle(e.target.value)}
                className="ml-2 px-2.5 py-1 rounded-lg bg-black/30 text-white text-xs"
              >
                {FONT_STYLES.map((f) => (
                  <option key={f.id} value={f.id} className="text-black">
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <form onSubmit={handleCreateTextStatus} className="flex-1 flex flex-col items-center justify-center p-6">
            <textarea
              value={statusText}
              onChange={(e) => setStatusText(e.target.value)}
              placeholder="Type a status..."
              rows={4}
              className={`w-full max-w-xl bg-transparent text-white placeholder:text-white/60 text-2xl sm:text-3xl text-center resize-none focus:outline-none ${
                FONT_STYLES.find((f) => f.id === fontStyle)?.cls || ''
              }`}
              autoFocus
            />

            <div className="mt-8 flex items-center gap-4">
              <select
                value={privacy}
                onChange={(e) => setPrivacy(e.target.value as PrivacyVisibility)}
                className="px-3 py-2 rounded-full bg-black/30 text-white text-xs"
              >
                <option value={PrivacyVisibility.CONTACTS} className="text-black">
                  My Contacts
                </option>
                <option value={PrivacyVisibility.ALL} className="text-black">
                  Everyone
                </option>
                <option value={PrivacyVisibility.NOBODY} className="text-black">
                  Only Me
                </option>
              </select>
              <button
                type="submit"
                disabled={submitting || !statusText.trim()}
                className="px-6 py-2.5 rounded-full bg-white text-[#075E54] font-semibold text-sm flex items-center gap-2 shadow-lg disabled:opacity-50"
              >
                <Send className="w-4 h-4" /> {submitting ? 'Posting...' : 'Post Status'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Media + Drawing Status Creator Modal */}
      {mediaModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateMediaStatus}
            className="bg-white dark:bg-[#202c33] rounded-2xl max-w-lg w-full p-6 space-y-4 border border-gray-200 dark:border-[#2a3942]"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-base">Create Photo / Video Status</h3>
              <button type="button" onClick={() => setMediaModalOpen(false)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {!mediaFile ? (
              <label className="border-2 border-dashed border-gray-300 dark:border-[#2a3942] rounded-2xl p-10 flex flex-col items-center justify-center cursor-pointer hover:border-[#00A884]">
                <ImageIcon className="w-10 h-10 text-[#00A884] mb-2" />
                <span className="text-sm font-medium">Choose Photo or Video</span>
                <input
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setMediaFile(f);
                      setMediaPreviewUrl(URL.createObjectURL(f));
                    }
                  }}
                />
              </label>
            ) : (
              <div className="space-y-3">
                {mediaFile.type.startsWith('image/') ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setDrawMode((d) => !d)}
                        className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 ${
                          drawMode ? 'bg-[#00A884] text-white' : 'bg-gray-100 dark:bg-[#2a3942]'
                        }`}
                      >
                        <Pencil className="w-3.5 h-3.5" /> {drawMode ? 'Drawing Active' : 'Draw / Markup'}
                      </button>
                      <div className="flex items-center gap-1.5">
                        {['#25D366', '#EF4444', '#F59E0B', '#3B82F6', '#FFFFFF'].map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setDrawColor(c)}
                            className={`w-5 h-5 rounded-full border ${
                              drawColor === c ? 'ring-2 ring-[#00A884]' : ''
                            }`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            setMediaFile(null);
                            setMediaPreviewUrl(null);
                          }}
                          className="p-1 text-xs text-gray-500"
                          title="Reset"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <canvas
                      ref={canvasRef}
                      onPointerDown={startCanvasDraw}
                      onPointerMove={moveCanvasDraw}
                      onPointerUp={endCanvasDraw}
                      onPointerLeave={endCanvasDraw}
                      className={`w-full max-h-72 object-contain rounded-xl bg-black ${
                        drawMode ? 'cursor-crosshair touch-none' : ''
                      }`}
                    />
                  </div>
                ) : (
                  <video src={mediaPreviewUrl || ''} controls className="w-full max-h-72 rounded-xl bg-black" />
                )}

                <input
                  type="text"
                  value={mediaCaption}
                  onChange={(e) => setMediaCaption(e.target.value)}
                  placeholder="Add a caption..."
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm"
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <select
                value={privacy}
                onChange={(e) => setPrivacy(e.target.value as PrivacyVisibility)}
                className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-[#111b21] text-xs"
              >
                <option value={PrivacyVisibility.CONTACTS}>My Contacts</option>
                <option value={PrivacyVisibility.ALL}>Everyone</option>
                <option value={PrivacyVisibility.NOBODY}>Only Me</option>
              </select>
              <button
                type="submit"
                disabled={!mediaFile || submitting}
                className="px-5 py-2 rounded-xl bg-[#00A884] text-white text-sm font-semibold disabled:opacity-50"
              >
                {submitting ? 'Publishing...' : 'Publish Status'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Stories Viewer */}
      {viewerGroup && viewerGroup.items[viewerIndex] && (
        <div
          className="fixed inset-0 z-[80] bg-black flex flex-col text-white select-none"
          onMouseDown={() => setPaused(true)}
          onMouseUp={() => setPaused(false)}
        >
          {/* Progress Bars */}
          <div className="flex gap-1.5 px-4 pt-3">
            {viewerGroup.items.map((item, idx) => (
              <div key={item.id} className="flex-1 h-1 rounded-full bg-white/30 overflow-hidden">
                <div
                  className="h-full bg-white transition-all duration-100"
                  style={{
                    width:
                      idx < viewerIndex ? '100%' : idx === viewerIndex ? `${progressPct}%` : '0%',
                  }}
                />
              </div>
            ))}
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <Avatar src={viewerGroup.avatarUrl} name={viewerGroup.ownerName} size="sm" />
              <div>
                <p className="font-semibold text-sm">{viewerGroup.ownerName}</p>
                <p className="text-[11px] text-white/70">
                  {new Date(viewerGroup.items[viewerIndex].createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {viewerGroup.isMine && (
                <button
                  type="button"
                  onClick={() => void handleDeleteMyStatus(viewerGroup.items[viewerIndex].id)}
                  className="p-2 rounded-full hover:bg-white/10 text-red-400"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setViewerGroup(null)}
                className="p-2 rounded-full hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Story Content */}
          <div className="flex-1 relative flex items-center justify-center p-4 overflow-hidden">
            {(() => {
              const curr = viewerGroup.items[viewerIndex];
              if (curr.contentType === StatusContentType.TEXT) {
                return (
                  <div
                    className="w-full max-w-xl h-full max-h-[70vh] rounded-3xl flex items-center justify-center p-8 text-center"
                    style={{ backgroundColor: curr.backgroundColor || '#00A884' }}
                  >
                    <p className="text-2xl sm:text-3xl font-medium">{curr.textContent}</p>
                  </div>
                );
              }
              if (curr.contentType === StatusContentType.VIDEO) {
                return (
                  <video
                    src={resolveMediaUrl(curr.contentUrl) || ''}
                    autoPlay
                    controls
                    className="max-h-[75vh] max-w-full rounded-2xl"
                  />
                );
              }
              return (
                <img
                  src={resolveMediaUrl(curr.contentUrl) || ''}
                  alt="Status"
                  className="max-h-[75vh] max-w-full rounded-2xl object-contain"
                />
              );
            })()}

            {viewerIndex > 0 && (
              <button
                type="button"
                onClick={() => setViewerIndex((i) => i - 1)}
                className="absolute left-4 p-2 rounded-full bg-black/40 hover:bg-black/60"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}
            {viewerIndex + 1 < viewerGroup.items.length && (
              <button
                type="button"
                onClick={() => setViewerIndex((i) => i + 1)}
                className="absolute right-4 p-2 rounded-full bg-black/40 hover:bg-black/60"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}
          </div>

          {viewerGroup.items[viewerIndex].caption && (
            <p className="text-center text-sm px-6 pb-2">{viewerGroup.items[viewerIndex].caption}</p>
          )}

          {/* Footer: Viewers (own) OR Reactions + Reply (others) */}
          <div className="p-4 border-t border-white/10">
            {viewerGroup.isMine ? (
              <div className="max-w-md mx-auto">
                <button
                  type="button"
                  onClick={() => setShowViewersDrawer((v) => !v)}
                  className="mx-auto flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-xs font-medium"
                >
                  <Eye className="w-4 h-4" /> {viewersList.length} Viewers
                </button>
                {showViewersDrawer && (
                  <div className="mt-3 max-h-36 overflow-y-auto bg-[#202c33] rounded-xl p-3 space-y-2">
                    {viewersList.length === 0 ? (
                      <p className="text-xs text-center text-white/60">No views yet</p>
                    ) : (
                      viewersList.map((v) => (
                        <div key={v.id} className="flex items-center justify-between text-xs">
                          <span>{v.viewer?.displayName || v.viewerId}</span>
                          <span className="text-white/60">
                            {new Date(v.viewedAt).toLocaleTimeString()}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="max-w-lg mx-auto space-y-2.5">
                <div className="flex justify-center gap-3">
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => void handleReactStatus(emoji)}
                      className="text-xl hover:scale-125 transition"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                <form onSubmit={handleReplyStatus} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Reply to status..."
                    className="flex-1 px-4 py-2 rounded-full bg-white/15 text-sm placeholder:text-white/60 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="p-2.5 rounded-full bg-[#00A884] text-white"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
