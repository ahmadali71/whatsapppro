import { io, Socket } from 'socket.io-client';
import { SocketEvents } from '@whatsapp-pro/shared-types';
import { getAccessToken, getSocketBaseUrl } from './api';

type EventCallback = (payload: any) => void;

class MobileSocketService {
  private socket: Socket | null = null;
  private joinedConversations = new Set<string>();
  private listeners = new Map<string, Set<EventCallback>>();
  private isConnecting = false;

  async connect(): Promise<Socket | null> {
    if (this.socket?.connected) return this.socket;
    if (this.isConnecting && this.socket) return this.socket;

    this.isConnecting = true;
    const token = await getAccessToken();
    if (!token) {
      this.isConnecting = false;
      return null;
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    const socket = io(getSocketBaseUrl(), {
      transports: ['websocket', 'polling'],
      auth: { token: `Bearer ${token}` },
      extraHeaders: { Authorization: `Bearer ${token}` },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    socket.on(SocketEvents.CONNECT, () => {
      this.isConnecting = false;
      socket.emit('mark_online');
      socket.emit(SocketEvents.AUTHENTICATE, { token });
      // Rejoin active conversation rooms on reconnect
      this.joinedConversations.forEach((conversationId) => {
        socket.emit('join_conversation', { conversationId });
        socket.emit(SocketEvents.CONVERSATION_JOIN, { conversationId });
      });
      this.dispatchLocal('socket:connected', {});
      this.dispatchLocal('socket:reconnected', {});
    });

    socket.on(SocketEvents.DISCONNECT, () => {
      this.isConnecting = false;
      this.dispatchLocal('socket:disconnected', {});
    });

    socket.on(SocketEvents.CONNECT_ERROR, async () => {
      this.isConnecting = false;
      this.dispatchLocal('socket:disconnected', {});
      const latestToken = await getAccessToken();
      if (latestToken && this.socket) {
        this.socket.auth = { token: `Bearer ${latestToken}` };
      }
    });

    // Forward all registered event channels
    this.listeners.forEach((_, event) => {
      this.bindSocketListener(socket, event);
    });

    this.socket = socket;
    return socket;
  }

  disconnect() {
    if (this.socket) {
      try {
        this.socket.emit('mark_offline');
        this.socket.disconnect();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.isConnecting = false;
    this.joinedConversations.clear();
  }

  async reconnect(): Promise<Socket | null> {
    this.disconnect();
    return this.connect();
  }

  isConnected(): boolean {
    return Boolean(this.socket?.connected);
  }

  private bindSocketListener(socket: Socket, event: string) {
    socket.off(event);
    socket.on(event, (payload: unknown) => {
      this.dispatchLocal(event, payload);
    });
  }

  private dispatchLocal(event: string, payload: unknown) {
    const callbacks = this.listeners.get(event);
    if (!callbacks) return;
    callbacks.forEach((cb) => {
      try {
        cb(payload);
      } catch {
        // Keep other listeners running
      }
    });
  }

  on(event: string, callback: EventCallback): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
      if (this.socket) {
        this.bindSocketListener(this.socket, event);
      }
    }
    set.add(callback);

    return () => {
      const current = this.listeners.get(event);
      if (current) {
        current.delete(callback);
      }
    };
  }

  emit(event: string, payload?: unknown) {
    if (this.socket?.connected) {
      this.socket.emit(event, payload);
    }
  }

  joinConversation(conversationId: string) {
    if (!conversationId) return;
    if (this.joinedConversations.has(conversationId) && this.socket?.connected) {
      return;
    }
    this.joinedConversations.add(conversationId);
    this.emit('join_conversation', { conversationId });
    this.emit(SocketEvents.CONVERSATION_JOIN, { conversationId });
  }

  leaveConversation(conversationId: string) {
    this.joinedConversations.delete(conversationId);
    this.emit('leave_conversation', { conversationId });
    this.emit(SocketEvents.CONVERSATION_LEAVE, { conversationId });
  }

  sendTyping(conversationId: string, isTyping: boolean) {
    const primary = isTyping ? SocketEvents.TYPING_START : SocketEvents.TYPING_STOP;
    const legacy = isTyping ? 'typing_start' : 'typing_stop';
    this.emit(primary, { conversationId });
    this.emit(legacy, { conversationId });
  }

  markMessageDelivered(messageId: string, conversationId: string) {
    this.emit(SocketEvents.MESSAGE_DELIVERED, { messageId, conversationId });
    this.emit('message_delivered', { messageId, conversationId });
  }

  markMessageRead(messageId: string, conversationId: string) {
    this.emit(SocketEvents.MESSAGE_READ, { messageId, conversationId });
    this.emit('message_read', { messageId, conversationId });
  }
}

export const socketService = new MobileSocketService();
export default socketService;
