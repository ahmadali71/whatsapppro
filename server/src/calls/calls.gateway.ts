import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { CallsService } from './calls.service';
import {
  CallActionPayload,
  CallAnswerPayload,
  CallMediaTogglePayload,
  CallOfferPayload,
  IceCandidatePayload,
} from './dto/call-signal.dto';

interface JwtSocketPayload {
  sub?: string;
  id?: string;
  userId?: string;
}

/**
 * WebRTC Signaling Gateway over Socket.IO.
 *
 * - Each active call uses room `call:{callId}`.
 * - Pure signaling relay (SDP offers/answers and ICE candidates); no media traverses this server.
 * - Group calls with >2 and <=8 participants use full-mesh topology (peer-to-peer between all pairs).
 * - Group calls exceeding 8 participants require an SFU (e.g., mediasoup).
 */
@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/',
})
export class CallsGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(CallsGateway.name);

  constructor(
    private readonly callsService: CallsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  afterInit(server: Server): void {
    this.callsService.setServer(server);

    // JWT authentication middleware for all Socket.IO call signaling connections
    server.use(async (socket: Socket, next) => {
      try {
        const userId = this.verifySocketToken(socket);
        socket.data.userId = userId;
        await socket.join(`user:${userId}`);
        next();
      } catch (error) {
        this.logger.warn(
          `Rejected unauthorized WebSocket connection ${socket.id}: ${(error as Error).message}`,
        );
        next(new Error('Unauthorized: Invalid or missing JWT token'));
      }
    });

    this.logger.log('CallsGateway WebRTC signaling & JWT middleware initialized');
  }

  @SubscribeMessage('call_join')
  async handleCallJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CallActionPayload,
  ) {
    const userId = this.requireAuthenticatedUser(client);
    const { callId } = payload ?? {};
    if (!callId) {
      throw new WsException('callId is required');
    }

    await client.join(`call:${callId}`);
    return this.callsService.joinCall(callId, userId);
  }

  @SubscribeMessage('call:accept')
  async handleCallAccept(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CallActionPayload,
  ) {
    return this.handleCallJoin(client, payload);
  }

  @SubscribeMessage('call_offer')
  async handleCallOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CallOfferPayload,
  ) {
    const userId = this.requireAuthenticatedUser(client);
    const { callId, toUserId, offer, sdp } = payload ?? {};
    if (!callId || (offer === undefined && sdp === undefined)) {
      throw new WsException('callId and offer/sdp are required');
    }

    await client.join(`call:${callId}`);

    return this.callsService.handleSignal(callId, userId, toUserId, {
      event: 'call_offer_received',
      type: 'offer',
      offer: offer ?? sdp,
      sdp: sdp ?? offer,
    });
  }

  @SubscribeMessage('call_answer')
  async handleCallAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CallAnswerPayload,
  ) {
    const userId = this.requireAuthenticatedUser(client);
    const { callId, toUserId, answer, sdp } = payload ?? {};
    if (!callId || (answer === undefined && sdp === undefined)) {
      throw new WsException('callId and answer/sdp are required');
    }

    await client.join(`call:${callId}`);

    return this.callsService.handleSignal(callId, userId, toUserId, {
      event: 'call_answer_received',
      type: 'answer',
      answer: answer ?? sdp,
      sdp: sdp ?? answer,
    });
  }

  @SubscribeMessage('ice_candidate')
  async handleIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: IceCandidatePayload,
  ) {
    const userId = this.requireAuthenticatedUser(client);
    const { callId, toUserId, candidate } = payload ?? {};
    if (!callId || candidate === undefined) {
      throw new WsException('callId and candidate are required');
    }

    return this.callsService.handleSignal(callId, userId, toUserId, {
      event: 'ice_candidate_received',
      type: 'ice_candidate',
      candidate,
    });
  }

  @SubscribeMessage('call_reject')
  async handleCallReject(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CallActionPayload,
  ) {
    const userId = this.requireAuthenticatedUser(client);
    const { callId } = payload ?? {};
    if (!callId) {
      throw new WsException('callId is required');
    }

    return this.callsService.rejectCall(callId, userId);
  }

  @SubscribeMessage('call_end')
  async handleCallEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CallActionPayload,
  ) {
    const userId = this.requireAuthenticatedUser(client);
    const { callId } = payload ?? {};
    if (!callId) {
      throw new WsException('callId is required');
    }

    await client.leave(`call:${callId}`);
    return this.callsService.endCall(callId, userId);
  }

  @SubscribeMessage('call_toggle_mute')
  async handleToggleMute(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CallMediaTogglePayload,
  ) {
    const userId = this.requireAuthenticatedUser(client);
    const { callId, isMuted } = payload ?? {};
    if (!callId || isMuted === undefined) {
      throw new WsException('callId and isMuted are required');
    }

    return this.callsService.updateParticipantMedia(callId, userId, { isMuted });
  }

  @SubscribeMessage('call_toggle_video')
  async handleToggleVideo(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CallMediaTogglePayload,
  ) {
    const userId = this.requireAuthenticatedUser(client);
    const { callId, isVideoOn } = payload ?? {};
    if (!callId || isVideoOn === undefined) {
      throw new WsException('callId and isVideoOn are required');
    }

    return this.callsService.updateParticipantMedia(callId, userId, { isVideoOn });
  }

  private verifySocketToken(socket: Socket): string {
    const rawToken =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.headers?.authorization as string | undefined) ??
      (socket.handshake.query?.token as string | undefined);

    if (!rawToken) {
      throw new Error('Missing JWT token');
    }

    const token = rawToken.startsWith('Bearer ')
      ? rawToken.slice(7).trim()
      : rawToken.trim();

    if (!token) {
      throw new Error('Empty JWT token');
    }

    const secret = this.configService.get<string>(
      'JWT_SECRET',
      'whatsapp-pro-dev-jwt-secret',
    );
    const payload = this.jwtService.verify<JwtSocketPayload>(token, { secret });
    const userId = payload.sub ?? payload.id ?? payload.userId;

    if (!userId) {
      throw new Error('JWT token missing user subject');
    }

    return userId;
  }

  private requireAuthenticatedUser(client: Socket): string {
    if (client.data?.userId) {
      return client.data.userId as string;
    }

    try {
      const userId = this.verifySocketToken(client);
      client.data.userId = userId;
      return userId;
    } catch {
      throw new WsException('Unauthorized');
    }
  }
}
