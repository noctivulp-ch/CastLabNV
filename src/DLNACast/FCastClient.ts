import {EventEmitter} from 'events';
import TcpSocket from 'react-native-tcp-socket';
import {Buffer} from 'buffer';
import {PlaybackState} from './CastManager';
import {MediaInfo} from './types/MediaInfo';
import {CastUtils} from './utils/CastUtils';
import {LogService} from '../services/LogService';

const FCAST_PORT = 46899;
const MAX_PACKET_SIZE = 32 * 1024; // 32 KB
const PING_INTERVAL = 15000; // 15 seconds
const PONG_TIMEOUT = 10000; // 10s before considering connection dead
const CONNECT_TIMEOUT = 5000;

enum FCastOpcode {
    Play = 1,
    Pause = 2,
    Resume = 3,
    Stop = 4,
    Seek = 5,
    PlaybackUpdate = 6,
    VolumeUpdate = 7,
    SetVolume = 8,
    PlaybackError = 9,
    SetSpeed = 10,
    Version = 11,
    Ping = 12,
    Pong = 13,
    Initial = 14,
    PlayUpdate = 15,
    SetPlaylistItem = 16,
    SubscribeEvent = 17,
    UnsubscribeEvent = 18,
    Event = 19,
}

enum FCastEventType {
    MediaItemStart = 0,
    MediaItemEnd = 1,
    MediaItemChange = 2,
    KeyDown = 3,
    KeyUp = 4,
}

enum FCastPlaybackState {
    Idle = 0,
    Playing = 1,
    Paused = 2,
}

enum FCastMetadataType {
    Generic = 0,
}

interface FCastPlayMessage {
    container: string;
    url: string;
    content?: string;
    time?: number;
    volume?: number;
    speed?: number;
    headers?: Record<string, string>;
    metadata?: {
        type: number;
        title?: string;
        thumbnailUrl?: string;
    };
}

interface FCastPlaybackUpdate {
    generationTime: number;
    time: number;
    duration: number;
    state: FCastPlaybackState;
    speed: number;
}

interface FCastVolumeUpdate {
    generationTime: number;
    volume: number;
}

/**
 * FCast protocol v3 client.
 * Binary TCP protocol: [uint32 LE size][uint8 opcode][JSON body]
 * @see https://docs.fcast.org/
 */
export class FCastClient extends EventEmitter {
    private socket: any = null;
    private connected = false;
    private disconnecting = false;
    private ip: string;
    private port: number;
    private pingInterval: NodeJS.Timeout | null = null;
    private pongTimeout: NodeJS.Timeout | null = null;
    private receiveBuffer: Buffer = Buffer.alloc(0);
    private lastPlaybackState: PlaybackState = {
        position: 0,
        duration: 0,
        isPlaying: false,
        volume: 0.5,
        muted: false,
    };

    constructor(ip: string, port: number = FCAST_PORT) {
        super();
        this.ip = ip;
        this.port = port;
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, CONNECT_TIMEOUT);

            this.socket = TcpSocket.createConnection({
                host: this.ip,
                port: this.port,
            }, () => {
                clearTimeout(timeoutId);
                this.connected = true;
                LogService.info('FCast', `Connected to ${this.ip}:${this.port}`);
                this.sendVersionHandshake();
                this.startPing();
                resolve();
            });

            this.socket.on('data', (data: Buffer) => {
                this.onDataReceived(data);
            });

            this.socket.on('error', (err: Error) => {
                clearTimeout(timeoutId);
                LogService.error('FCast', `Socket error: ${err.message}`);
                if (!this.connected) {
                    reject(err);
                } else {
                    this.handleConnectionLost(`Socket error: ${err.message}`);
                }
            });

            this.socket.on('close', () => {
                LogService.info('FCast', 'Connection closed');
                this.handleConnectionLost('Connection closed by remote');
            });
        });
    }

    disconnect(): void {
        this.disconnecting = true;
        this.stopPing();
        if (this.socket) {
            try {
                this.socket.destroy();
            } catch (err) {
                LogService.warn('FCast', `Error destroying socket: ${err}`);
            }
            this.socket = null;
        }
        this.connected = false;
        this.disconnecting = false;
        this.receiveBuffer = Buffer.alloc(0);
    }

    isConnected(): boolean {
        return this.connected;
    }

    async play(mediaInfo: MediaInfo): Promise<void> {
        const mimeType = mediaInfo.contentType || CastUtils.getMimeTypeFromUrl(mediaInfo.contentUrl);
        const message: FCastPlayMessage = {
            container: mimeType,
            url: mediaInfo.contentUrl,
            time: 0,
        };

        message.metadata = {
            type: FCastMetadataType.Generic,
            title: mediaInfo.metadata?.title,
            thumbnailUrl: mediaInfo.metadata?.images?.[0]?.url,
        };

        LogService.info('FCast', `Play: ${mediaInfo.contentUrl} (${mimeType})`);
        this.sendPacket(FCastOpcode.Play, message);
    }

    async pause(): Promise<void> {
        this.sendPacket(FCastOpcode.Pause);
    }

    async resume(): Promise<void> {
        this.sendPacket(FCastOpcode.Resume);
    }

    async stop(): Promise<void> {
        this.sendPacket(FCastOpcode.Stop);
    }

    /** @param position Position in seconds */
    async seek(position: number): Promise<void> {
        this.sendPacket(FCastOpcode.Seek, {time: position});
    }

    /** @param volume 0-1 */
    async setVolume(volume: number): Promise<void> {
        this.sendPacket(FCastOpcode.SetVolume, {volume});
    }

    getPlaybackState(): PlaybackState {
        return {...this.lastPlaybackState};
    }

    private sendPacket(opcode: FCastOpcode, body?: object): void {
        if (!this.connected || !this.socket) {
            LogService.warn('FCast', 'Cannot send packet: not connected');
            return;
        }

        const bodyStr = body ? JSON.stringify(body) : '';
        const bodyBuffer = Buffer.from(bodyStr, 'utf-8');
        const size = bodyBuffer.length + 1; // +1 for opcode byte

        if (size > MAX_PACKET_SIZE) {
            LogService.error('FCast', `Packet too large: ${size} bytes`);
            return;
        }

        // Build packet: uint32 LE size + uint8 opcode + body
        const header = Buffer.alloc(5);
        header.writeUInt32LE(size, 0);
        header.writeUInt8(opcode, 4);

        const packet = Buffer.concat([header, bodyBuffer]);

        try {
            this.socket.write(packet);
        } catch (err) {
            LogService.error('FCast', `Failed to send packet: ${err}`);
            this.handleConnectionLost(`Write failed: ${err}`);
        }
    }

    private onDataReceived(data: Buffer): void {
        const incoming = Buffer.from(data); // react-native-tcp-socket may pass Uint8Array
        this.receiveBuffer = Buffer.concat([this.receiveBuffer, incoming]);

        // Process complete packets
        while (this.receiveBuffer.length >= 5) {
            const packetSize = this.receiveBuffer.readUInt32LE(0);
            const totalSize = 4 + packetSize; // 4 bytes for size field + packet content

            if (this.receiveBuffer.length < totalSize) {
                break; // Wait for more data
            }

            const opcode = this.receiveBuffer.readUInt8(4);
            const bodyBytes = this.receiveBuffer.slice(5, totalSize);
            // Manual decode — Buffer.toString('utf-8') is broken under Hermes
            let bodyStr = '';
            for (let i = 0; i < bodyBytes.length; i++) {
                bodyStr += String.fromCharCode(bodyBytes[i]);
            }

            this.receiveBuffer = this.receiveBuffer.slice(totalSize);

            this.handlePacket(opcode, bodyStr);
        }
    }

    private handlePacket(opcode: number, bodyStr: string): void {
        this.clearPongTimeout(); // Any packet = sign of life

        let body: any = null;
        if (bodyStr.length > 0) {
            try {
                body = JSON.parse(bodyStr);
            } catch {
                LogService.warn('FCast', `Invalid JSON in packet: ${bodyStr}`);
                return;
            }
        }

        switch (opcode) {
            case FCastOpcode.PlaybackUpdate:
                if (body) {
                    this.handlePlaybackUpdate(body as FCastPlaybackUpdate);
                }
                break;
            case FCastOpcode.VolumeUpdate:
                if (body) {
                    this.handleVolumeUpdate(body as FCastVolumeUpdate);
                }
                break;
            case FCastOpcode.Version:
                LogService.info('FCast', `Receiver version: ${JSON.stringify(body)}`);
                break;
            case FCastOpcode.Ping:
                this.sendPacket(FCastOpcode.Pong);
                break;
            case FCastOpcode.Pong:
                break;
            case FCastOpcode.Initial:
                LogService.info('FCast', `Initial state: ${JSON.stringify(body)}`);
                if (body?.playData) {
                    this.handlePlaybackUpdate(body.playData as FCastPlaybackUpdate);
                }
                break;
            case FCastOpcode.PlaybackError:
                LogService.error('FCast', `Playback error: ${body?.message || JSON.stringify(body)}`);
                this.emit('error', body?.message || 'Playback error');
                break;
            case FCastOpcode.PlayUpdate:
                break;
            case FCastOpcode.Event:
                this.handleEvent(body);
                break;
            default:
                LogService.info('FCast', `Unknown opcode: ${opcode}`);
        }
    }

    private handlePlaybackUpdate(update: FCastPlaybackUpdate): void {
        this.lastPlaybackState = {
            position: update.time || 0,
            duration: update.duration || 0,
            isPlaying: update.state === FCastPlaybackState.Playing,
            volume: this.lastPlaybackState.volume,
            muted: this.lastPlaybackState.muted,
        };

        this.emit('playbackUpdate', this.lastPlaybackState);
    }

    private handleVolumeUpdate(update: FCastVolumeUpdate): void {
        this.lastPlaybackState.volume = update.volume;
        this.emit('volumeUpdate', update.volume);
    }

    private handleEvent(body: any): void {
        if (!body) return;
        if (body.eventType === FCastEventType.MediaItemEnd) {
            LogService.info('FCast', 'MediaItemEnd event received');
            this.emit('mediaItemEnd');
        }
    }

    private sendVersionHandshake(): void {
        this.sendPacket(FCastOpcode.Version, {version: 3});
        this.sendPacket(FCastOpcode.SubscribeEvent, {eventType: FCastEventType.MediaItemEnd});
    }

    private handleConnectionLost(reason: string): void {
        if (this.disconnecting || !this.connected) return;
        this.disconnecting = true;

        LogService.warn('FCast', `Connection lost: ${reason}`);
        this.connected = false;
        this.stopPing();

        if (this.socket) {
            try {
                this.socket.destroy();
            } catch (_) {}
            this.socket = null;
        }
        this.receiveBuffer = Buffer.alloc(0);
        this.disconnecting = false;
        this.emit('disconnected');
    }

    private startPing(): void {
        this.stopPing();
        this.pingInterval = setInterval(() => {
            if (this.connected) {
                this.sendPacket(FCastOpcode.Ping);
                this.clearPongTimeout();
                this.pongTimeout = setTimeout(() => {
                    this.handleConnectionLost('Pong timeout');
                }, PONG_TIMEOUT);
            }
        }, PING_INTERVAL);
    }

    private stopPing(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        this.clearPongTimeout();
    }

    private clearPongTimeout(): void {
        if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
        }
    }
}

export {FCAST_PORT};
