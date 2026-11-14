import type { MicrophoneStatus, VoiceLiveEvent } from '../types/voiceLive';

export interface VoiceLiveWebRTCTransportOptions {
  url: string;
  session: Record<string, unknown>;
  autoStartMic: boolean;
  audioConstraints?: MediaTrackConstraints | boolean;
  rtcConfiguration?: RTCConfiguration;
  connectionTimeoutMs?: number;
  iceGatheringTimeoutMs?: number;
  onEvent: (event: VoiceLiveEvent) => void;
  onAudioStream: (stream: MediaStream | null) => void;
  onStateChange: (state: 'connecting' | 'connected' | 'disconnected' | 'error', error?: Error) => void;
  onMicStateChange: (active: boolean, muted: boolean) => void;
}

const MAX_SEEN_EVENTS = 512;

/** WSS signaling and session control, RTP audio, and a WebRTC event data channel. */
export class VoiceLiveWebRTCTransport {
  private readonly options: VoiceLiveWebRTCTransportOptions;
  private peer: RTCPeerConnection | null = null;
  private socket: WebSocket | null = null;
  private channel: RTCDataChannel | null = null;
  private sender: RTCRtpSender | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private generation = 0;
  private micRevision = 0;
  private active = false;
  private connected = false;
  private muted = false;
  private offerSent = false;
  private answerPending = false;
  private answerApplied = false;
  private seenEvents = new Set<string>();
  private connectPromise: Promise<void> | null = null;
  private resolveConnect: (() => void) | null = null;
  private rejectConnect: ((error: Error) => void) | null = null;
  private micPromise: Promise<void> | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelIceWait: (() => void) | null = null;

  constructor(options: VoiceLiveWebRTCTransportOptions) {
    this.options = options;
  }

  connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    if (this.connected) return Promise.resolve();
    if (this.active) {
      // An existing ICE connection is recovering; do not leak a second peer/socket.
      this.connectPromise = new Promise<void>((resolve, reject) => {
        this.resolveConnect = resolve;
        this.rejectConnect = reject;
      });
      return this.connectPromise;
    }

    const generation = ++this.generation;
    this.active = true;
    this.offerSent = false;
    this.answerPending = false;
    this.answerApplied = false;
    this.seenEvents.clear();
    const promise = new Promise<void>((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });
    this.connectPromise = promise;
    this.options.onStateChange('connecting');

    try {
      if (this.options.session.avatar) {
        throw new Error('Avatar configuration is not supported by the Voice Live WebRTC transport.');
      }
      for (const [name, value] of Object.entries({
        connectionTimeoutMs: this.options.connectionTimeoutMs ?? 30000,
        iceGatheringTimeoutMs: this.options.iceGatheringTimeoutMs ?? 10000,
      })) {
        if (!Number.isFinite(value) || value <= 0 || value > 2147483647) {
          throw new Error(`${name} must be a positive finite number no greater than 2147483647.`);
        }
      }
      this.connectionTimer = setTimeout(() => {
        this.fail(new Error('Voice Live WebRTC connection timed out.'), generation);
      }, this.options.connectionTimeoutMs ?? 30000);

      const peer = new RTCPeerConnection(this.options.rtcConfiguration);
      this.peer = peer;
      // Negotiate sending even with the microphone disabled, so startMic needs no new SDP.
      this.sender = peer.addTransceiver('audio', { direction: 'sendrecv' }).sender;
      const channel = peer.createDataChannel('voice-live-events');
      this.channel = channel;
      channel.onopen = () => this.checkReady(generation);
      channel.onmessage = (event) => this.receive(event.data, generation);
      channel.onerror = () => this.fail(new Error('Voice Live WebRTC data channel failed.'), generation);
      channel.onclose = () => this.fail(new Error('Voice Live WebRTC data channel closed.'), generation);

      peer.onconnectionstatechange = () => {
        if (!this.isCurrent(generation)) return;
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
          this.fail(new Error(`Voice Live WebRTC peer ${peer.connectionState}.`), generation);
        } else if (peer.connectionState === 'disconnected') {
          // A transient network outage may recover through ICE without renegotiation.
          this.connected = false;
          this.options.onStateChange('connecting');
          if (!this.connectionTimer) {
            this.connectionTimer = setTimeout(() => {
              this.fail(new Error('Voice Live WebRTC reconnection timed out.'), generation);
            }, this.options.connectionTimeoutMs ?? 30000);
          }
        } else {
          this.checkReady(generation);
        }
      };
      peer.oniceconnectionstatechange = () => {
        if (peer.iceConnectionState === 'failed') {
          this.fail(new Error('Voice Live WebRTC ICE connection failed.'), generation);
        }
      };
      peer.ontrack = (event) => {
        if (!this.isCurrent(generation) || event.track.kind !== 'audio') return;
        this.remoteStream = event.streams[0] ?? new MediaStream([event.track]);
        this.options.onAudioStream(this.remoteStream);
      };

      const socket = new WebSocket(this.options.url, ['realtime']);
      this.socket = socket;
      socket.onopen = () => {
        void this.negotiate(generation).catch((error: unknown) => this.fail(asError(error), generation));
      };
      socket.onmessage = (event) => this.receive(event.data, generation);
      socket.onerror = () => this.fail(new Error('Voice Live WebRTC signaling connection failed.'), generation);
      socket.onclose = () => this.fail(new Error('Voice Live WebRTC signaling connection closed.'), generation);
    } catch (error) {
      this.fail(asError(error), generation);
    }
    return promise;
  }

  disconnect(): void {
    const reject = this.rejectConnect;
    this.release();
    reject?.(new Error('Voice Live WebRTC connection canceled.'));
    this.options.onStateChange('disconnected');
  }

  sendEvent(event: VoiceLiveEvent): void {
    if (event.type === 'input_audio_buffer.append') {
      throw new Error('WebRTC sends microphone audio through RTP tracks; input_audio_buffer.append is not supported.');
    }
    if (event.type.startsWith('rtc.call.') || event.type === 'session.avatar.connect') {
      throw new Error('WebRTC signaling is managed by the transport.');
    }
    if (!this.active || !this.connected) throw new Error('Voice Live WebRTC is not connected.');
    // Keep client commands on one ordered channel. Sending a tool result on WSS
    // followed by response.create on the data channel can overtake the result.
    // The data channel still receives low-latency lifecycle, VAD, and transcript events.
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('Voice Live WebRTC control channel is not open.');
    this.socket.send(JSON.stringify(event));
  }

  startMic(audioConstraints = this.options.audioConstraints): Promise<void> {
    if (this.micPromise) return this.micPromise;
    if (this.localStream?.getAudioTracks().some((track) => track.readyState === 'live')) return Promise.resolve();
    if (!this.active || !this.sender) return Promise.reject(new Error('Connect WebRTC before starting the microphone.'));
    const generation = this.generation;
    const revision = ++this.micRevision;
    const sender = this.sender;
    const promise = (async (): Promise<void> => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints ?? true });
      try {
        if (!this.isCurrent(generation) || revision !== this.micRevision) throw new Error('Microphone start canceled.');
        const track = stream.getAudioTracks()[0];
        if (!track) throw new Error('The microphone stream contains no audio track.');
        await sender.replaceTrack(track);
        if (!this.isCurrent(generation) || revision !== this.micRevision) throw new Error('Microphone start canceled.');
        this.localStream = stream;
        this.muted = false;
        track.enabled = true;
        track.onended = () => {
          if (this.isCurrent(generation) && this.localStream === stream) this.stopMic();
        };
        this.options.onMicStateChange(true, false);
      } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        throw error;
      }
    })();
    this.micPromise = promise;
    // Register both handlers so cancellation never creates an unhandled finally promise.
    const clearPending = (): void => { if (this.micPromise === promise) this.micPromise = null; };
    void promise.then(clearPending, clearPending);
    return promise;
  }

  stopMic(): void {
    ++this.micRevision;
    this.micPromise = null;
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.muted = false;
    const generation = this.generation;
    if (this.sender) {
      void this.sender.replaceTrack(null).catch((error: unknown) => this.fail(asError(error), generation));
    }
    this.options.onMicStateChange(false, false);
  }

  toggleMute(): void {
    const tracks = this.localStream?.getAudioTracks().filter((track) => track.readyState === 'live');
    if (!tracks?.length) return;
    this.muted = !this.muted;
    tracks.forEach((track) => { track.enabled = !this.muted; });
    this.options.onMicStateChange(true, this.muted);
  }

  async getMicrophoneStatus(): Promise<MicrophoneStatus | null> {
    const stream = this.localStream;
    const track = stream?.getAudioTracks()[0];
    const sender = this.sender;
    if (!track || !sender) return null;
    const stats = await sender.getStats();
    if (this.localStream !== stream || this.sender !== sender) return null;
    let source: { audioLevel?: number; totalAudioEnergy?: number } | undefined;
    let outbound: RTCOutboundRtpStreamStats | undefined;
    stats.forEach((entry) => {
      if (entry.type === 'media-source' && entry.kind === 'audio' && entry.trackIdentifier === track.id) source = entry;
      if (entry.type === 'outbound-rtp' && entry.kind === 'audio') outbound = entry;
    });
    return {
      deviceLabel: track.label,
      deviceId: track.getSettings().deviceId ?? '',
      readyState: track.readyState,
      enabled: track.enabled,
      sourceMuted: track.muted,
      audioLevel: source?.audioLevel ?? null,
      totalAudioEnergy: source?.totalAudioEnergy ?? null,
      packetsSent: outbound?.packetsSent ?? null,
      bytesSent: outbound?.bytesSent ?? null,
    };
  }

  private isCurrent(generation: number): boolean {
    return this.active && generation === this.generation;
  }

  private async negotiate(generation: number): Promise<void> {
    const peer = this.peer;
    if (!this.isCurrent(generation) || !peer) return;
    if (this.options.autoStartMic) await this.startMic();
    if (!this.isCurrent(generation)) return;
    const offer = await peer.createOffer();
    if (!this.isCurrent(generation)) return;
    await peer.setLocalDescription(offer);
    if (!this.isCurrent(generation)) return;
    await this.waitForIce(peer, generation);
    if (!this.isCurrent(generation)) return;
    const sdp = peer.localDescription?.sdp;
    if (typeof sdp !== 'string' || !sdp.trim()) throw new Error('WebRTC did not produce an SDP offer.');
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('WebRTC signaling socket is not open.');
    this.offerSent = true;
    this.socket.send(JSON.stringify({ type: 'rtc.call.sdp.create', sdp_offer: sdp, session: this.options.session }));
  }

  private waitForIce(peer: RTCPeerConnection, generation: number): Promise<void> {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', onChange);
        if (this.cancelIceWait === cancel) this.cancelIceWait = null;
      };
      const onChange = (): void => {
        if (this.isCurrent(generation) && peer.iceGatheringState === 'complete') {
          cleanup();
          resolve();
        }
      };
      const cancel = (): void => { cleanup(); reject(new Error('WebRTC ICE gathering canceled.')); };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('WebRTC ICE gathering timed out.'));
      }, this.options.iceGatheringTimeoutMs ?? 10000);
      this.cancelIceWait = cancel;
      peer.addEventListener('icegatheringstatechange', onChange);
      onChange();
    });
  }

  private receive(value: unknown, generation: number): void {
    if (!this.isCurrent(generation)) return;
    void this.handleMessage(value, generation).catch((error: unknown) => this.fail(asError(error), generation));
  }

  private async handleMessage(value: unknown, generation: number): Promise<void> {
    if (typeof value !== 'string') throw new Error('Expected a JSON event on the WebRTC control channel.');
    const event: VoiceLiveEvent = JSON.parse(value);
    if (!event || typeof event.type !== 'string') throw new Error('Invalid Voice Live WebRTC event.');
    if (event.event_id) {
      if (this.seenEvents.has(event.event_id)) return;
      this.seenEvents.add(event.event_id);
      if (this.seenEvents.size > MAX_SEEN_EVENTS) this.seenEvents.delete(this.seenEvents.values().next().value!);
    }
    if (event.type === 'rtc.call.error' || (event.type === 'error' && !this.connected)) {
      const error = event.error as { message?: string } | undefined;
      this.options.onEvent(event);
      throw new Error(error?.message ?? 'Voice Live WebRTC negotiation failed.');
    }
    if (event.type === 'rtc.call.sdp.created') {
      if (this.answerApplied || this.answerPending) return;
      if (!this.offerSent) throw new Error('Received a WebRTC SDP answer before sending an offer.');
      if (typeof event.sdp_answer !== 'string' || !event.sdp_answer.trim()) {
        throw new Error('Voice Live returned an invalid WebRTC SDP answer.');
      }
      this.answerPending = true;
      const peer = this.peer;
      if (!peer) return;
      await peer.setRemoteDescription({ type: 'answer', sdp: event.sdp_answer });
      if (!this.isCurrent(generation)) return;
      this.answerApplied = true;
      this.answerPending = false;
      this.checkReady(generation);
    }
    if (this.isCurrent(generation)) this.options.onEvent(event);
  }

  private checkReady(generation: number): void {
    if (!this.isCurrent(generation) || this.connected || !this.answerApplied
      || this.peer?.connectionState !== 'connected' || this.channel?.readyState !== 'open') return;
    this.connected = true;
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
    const resolve = this.resolveConnect;
    this.connectPromise = null;
    this.resolveConnect = null;
    this.rejectConnect = null;
    this.options.onStateChange('connected');
    resolve?.();
  }

  private fail(error: Error, generation: number): void {
    if (!this.isCurrent(generation)) return;
    const reject = this.rejectConnect;
    this.release();
    reject?.(error);
    this.options.onStateChange('error', error);
  }

  private release(): void {
    this.active = false;
    this.connected = false;
    ++this.generation;
    ++this.micRevision;
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
    this.cancelIceWait?.();
    this.cancelIceWait = null;
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.remoteStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.remoteStream = null;
    this.muted = false;
    this.micPromise = null;
    if (this.channel) {
      this.channel.onopen = this.channel.onclose = this.channel.onerror = this.channel.onmessage = null;
      this.channel.close();
    }
    if (this.socket) {
      this.socket.onopen = this.socket.onclose = this.socket.onerror = this.socket.onmessage = null;
      this.socket.close();
    }
    if (this.peer) {
      this.peer.ontrack = this.peer.onconnectionstatechange = this.peer.oniceconnectionstatechange = null;
      this.peer.close();
    }
    this.peer = null;
    this.socket = null;
    this.channel = null;
    this.sender = null;
    this.connectPromise = null;
    this.resolveConnect = null;
    this.rejectConnect = null;
    this.seenEvents.clear();
    this.options.onAudioStream(null);
    this.options.onMicStateChange(false, false);
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
