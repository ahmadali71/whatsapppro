import { io, Socket } from 'socket.io-client';
import { SocketEvents } from '@whatsapp-pro/shared-types';
import { API_ORIGIN, getOrCreateDeviceId, getStoredTokens } from './api';

type EventCallback<T = unknown> = (payload: T) => void;

interface QueuedAction {
  event: string;
  payload: unknown;
  queuedAt: number;
}

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || API_ORIGIN;

class SocketManager {
  private socket: Socket | null = null;
  private offlineQueue: QueuedAction[] = [];
  private listeners = new Map<string, Set<EventCallback<unknown>>>();
  private connectionStateListeners = new Set<(connected: boolean) => void>();
  private fallbackStateListeners = new Set<(fallback: boolean) => void>();
  private _isConnected = false;
  private _httpFallback = false;
  private consecutiveFailures = 0;

  get isConnected(): boolean {
    return this._isConnected;
  }

  get isHttpFallback(): boolean {
    return this._httpFallback;
  }

  connect(tokenOverride?: string): Socket {
    const token = tokenOverride || getStoredTokens().accessToken;
    if (this.socket?.connected) {
      return this.socket;
    }
    if (this.socket) {
      this.socket.disconnect();
    }

    this.consecutiveFailures = 0;
    this._httpFallback = false;
    this.notifyFallbackState(false);

    this.socket = io(SOCKET_URL, {
      auth: {
        token: token ? `Bearer ${token}` : undefined,
        deviceId: getOrCreateDeviceId(),
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 2,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    this.socket.on(SocketEvents.CONNECT, () => {
      this.consecutiveFailures = 0;
      this._httpFallback = false;
      this.notifyFallbackState(false);
      this._isConnected = true;
      this.notifyConnectionState(true);
      if (token) {
        this.socket?.emit(SocketEvents.AUTHENTICATE, { token: `Bearer ${token}` });
      }
      this.socket?.emit('mark_online', { deviceId: getOrCreateDeviceId() });
      this.flushOfflineQueue();
    });

    this.socket.on(SocketEvents.DISCONNECT, () => {
      this._isConnected = false;
      this.notifyConnectionState(false);
    });

    this.socket.on(SocketEvents.CONNECT_ERROR, () => {
      this.consecutiveFailures += 1;
      this._isConnected = false;
      this.notifyConnectionState(false);
      if (this.consecutiveFailures >= 2) {
        this._httpFallback = true;
        this.notifyFallbackState(true);
        this.socket?.disconnect();
      }
    });

    // Attach any already-registered event listeners
    this.listeners.forEach((callbacks, event) => {
      callbacks.forEach((cb) => {
        this.socket?.on(event, cb);
      });
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.emit('mark_offline');
      this.socket.disconnect();
      this.socket = null;
    }
    this.consecutiveFailures = 0;
    this._httpFallback = false;
    this.notifyFallbackState(false);
    this._isConnected = false;
    this.notifyConnectionState(false);
  }

  emit<T = unknown>(event: string, payload?: T, queueIfOffline = true) {
    if (this.socket?.connected) {
      this.socket.emit(event, payload);
      return true;
    }
    if (queueIfOffline) {
      this.offlineQueue.push({ event, payload, queuedAt: Date.now() });
    }
    return false;
  }

  on<T = unknown>(event: string, callback: EventCallback<T>): () => void {
    const wrapped = callback as EventCallback<unknown>;
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(wrapped);
    this.socket?.on(event, wrapped);

    return () => {
      set?.delete(wrapped);
      this.socket?.off(event, wrapped);
    };
  }

  onConnectionChange(cb: (connected: boolean) => void): () => void {
    this.connectionStateListeners.add(cb);
    cb(this._isConnected);
    return () => {
      this.connectionStateListeners.delete(cb);
    };
  }

  onFallbackChange(cb: (fallback: boolean) => void): () => void {
    this.fallbackStateListeners.add(cb);
    cb(this._httpFallback);
    return () => {
      this.fallbackStateListeners.delete(cb);
    };
  }

  private notifyConnectionState(connected: boolean) {
    this.connectionStateListeners.forEach((cb) => cb(connected));
  }

  private notifyFallbackState(fallback: boolean) {
    this.fallbackStateListeners.forEach((cb) => cb(fallback));
  }

  private flushOfflineQueue() {
    if (!this.socket?.connected || this.offlineQueue.length === 0) return;
    const pending = [...this.offlineQueue];
    this.offlineQueue = [];
    for (const item of pending) {
      // Discard actions older than 10 minutes
      if (Date.now() - item.queuedAt < 10 * 60 * 1000) {
        this.socket.emit(item.event, item.payload);
      }
    }
  }

  // Convenience typed helpers matching SocketEvents + backend gateway events
  joinConversation(conversationId: string) {
    this.emit(SocketEvents.CONVERSATION_JOIN, { conversationId });
    this.emit('join_conversation', { conversationId }, false);
  }

  leaveConversation(conversationId: string) {
    this.emit(SocketEvents.CONVERSATION_LEAVE, { conversationId }, false);
    this.emit('leave_conversation', { conversationId }, false);
  }

  sendTypingStart(conversationId: string) {
    this.emit(SocketEvents.TYPING_START, { conversationId }, false);
    this.emit('typing_start', { conversationId }, false);
  }

  sendTypingStop(conversationId: string) {
    this.emit(SocketEvents.TYPING_STOP, { conversationId }, false);
    this.emit('typing_stop', { conversationId }, false);
  }

  markMessageDelivered(messageId: string, conversationId: string) {
    this.emit(SocketEvents.MESSAGE_DELIVERED, { messageId, conversationId });
    this.emit('message_delivered', { messageId, conversationId }, false);
  }

  markMessageRead(messageId: string, conversationId: string) {
    this.emit(SocketEvents.MESSAGE_READ, { messageId, conversationId });
    this.emit('message_read', { messageId, conversationId }, false);
  }
}

export const socketManager = new SocketManager();
