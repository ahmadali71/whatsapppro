export const SocketEvents = {
  // Connection lifecycle
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  CONNECT_ERROR: 'connect_error',
  AUTHENTICATE: 'auth:authenticate',
  AUTHENTICATED: 'auth:authenticated',

  // Presence & Typing
  USER_ONLINE: 'user:online',
  USER_OFFLINE: 'user:offline',
  PRESENCE_SUBSCRIBE: 'presence:subscribe',
  PRESENCE_UPDATE: 'presence:update',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
  TYPING_UPDATE: 'typing:update',

  // Conversations
  CONVERSATION_JOIN: 'conversation:join',
  CONVERSATION_LEAVE: 'conversation:leave',
  CONVERSATION_CREATED: 'conversation:created',
  CONVERSATION_UPDATED: 'conversation:updated',
  CONVERSATION_ARCHIVED: 'conversation:archived',
  CONVERSATION_MUTED: 'conversation:muted',

  // Messages
  MESSAGE_SEND: 'message:send',
  MESSAGE_NEW: 'message:new',
  MESSAGE_EDIT: 'message:edit',
  MESSAGE_EDITED: 'message:edited',
  MESSAGE_DELETE: 'message:delete',
  MESSAGE_DELETED: 'message:deleted',
  MESSAGE_DELIVERED: 'message:delivered',
  MESSAGE_READ: 'message:read',
  MESSAGE_RECEIPT_UPDATE: 'message:receipt:update',
  MESSAGE_REACT: 'message:react',
  MESSAGE_REACTION_UPDATE: 'message:reaction:update',
  MESSAGE_STAR: 'message:star',

  // Groups
  GROUP_CREATED: 'group:created',
  GROUP_UPDATED: 'group:updated',
  GROUP_MEMBER_ADDED: 'group:member:added',
  GROUP_MEMBER_REMOVED: 'group:member:removed',
  GROUP_MEMBER_ROLE_UPDATED: 'group:member:role_updated',

  // Status / Stories
  STATUS_CREATED: 'status:created',
  STATUS_VIEWED: 'status:viewed',
  STATUS_REACTED: 'status:reacted',
  STATUS_DELETED: 'status:deleted',

  // Calls & WebRTC Signaling
  CALL_INITIATE: 'call:initiate',
  CALL_INCOMING: 'call:incoming',
  CALL_ACCEPT: 'call:accept',
  CALL_ACCEPTED: 'call:accepted',
  CALL_REJECT: 'call:reject',
  CALL_REJECTED: 'call:rejected',
  CALL_END: 'call:end',
  CALL_ENDED: 'call:ended',
  CALL_PARTICIPANT_JOINED: 'call:participant:joined',
  CALL_PARTICIPANT_LEFT: 'call:participant:left',
  CALL_TOGGLE_MUTE: 'call:toggle_mute',
  CALL_TOGGLE_VIDEO: 'call:toggle_video',
  WEBRTC_OFFER: 'webrtc:offer',
  WEBRTC_ANSWER: 'webrtc:answer',
  WEBRTC_ICE_CANDIDATE: 'webrtc:ice_candidate',

  // Notifications
  NOTIFICATION_NEW: 'notification:new',
  NOTIFICATION_READ: 'notification:read',
} as const;

export type SocketEventName = (typeof SocketEvents)[keyof typeof SocketEvents];
