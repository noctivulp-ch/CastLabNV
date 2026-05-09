import {Device} from './types/Device';
import {MediaInfo} from './types/MediaInfo';
import {EventEmitter} from 'events';
import Udp from 'react-native-udp';
import {XMLParser} from "fast-xml-parser";
import NetInfo from '@react-native-community/netinfo';
import {Buffer} from 'buffer';
import {initTranslate} from "../localization/translate";
import {CastUtils} from './utils/CastUtils';
import {CastConfig} from './config/CastConfig';
import {LogService} from '../services/LogService';
import {FCAST_PORT, FCastClient} from './FCastClient';
import Zeroconf from 'react-native-zeroconf';
import {ExternalDisplayController} from './types/ExternalDisplayController';

// Constants for SSDP discovery (from config)
const MULTICAST_ADDRESS = CastConfig.MULTICAST_ADDRESS;
const SSDP_PORT = CastConfig.SSDP_PORT;
const SEARCH_TARGET_ALL = CastConfig.SEARCH_TARGET_ALL;
const DLNA_RENDERER_ST = CastConfig.DLNA_RENDERER_ST;
const CACHE_TTL = CastConfig.CACHE_TTL;
const MAX_RETRY_ATTEMPTS = CastConfig.MAX_RETRY_ATTEMPTS;
const REQUEST_TIMEOUT = CastConfig.REQUEST_TIMEOUT;

export interface PlaybackState {
    position: number; // Current playback position in seconds
    duration: number; // Media duration in seconds
    isPlaying: boolean; // Is media playing
    volume: number; // Volume (0-1)
    muted: boolean; // Mute state
}

interface CacheEntry {
    data: any;
    timestamp: number;
}

export class CastManager extends EventEmitter {
    private static readonly FCAST_MAX_RECONNECT = 3;
    private static readonly FCAST_RECONNECT_DELAY = 3000;
    private i18n = initTranslate();
    private socket: any = null; // UDP socket for SSDP (M-SEARCH)
    private notifySocket: any = null; // UDP socket for SSDP NOTIFY (port 1900)
    private searching = false; // Discovery state
    private devices: Map<string, Device> = new Map(); // Discovered devices
    private timeout: NodeJS.Timeout | null = null; // Search timeout
    private currentMediaUri: string | null = null;
    private currentDevice: Device | null = null; // Currently connected device
    private currentMediaInfo: MediaInfo | null = null;
    private pollingInterval: NodeJS.Timeout | null = null; // Polling
    private castDeviceListener: any = null; // Cast device listener subscription
    private sessionListener: any = null; // Session listener subscription
    private mediaListener: any = null; // Media listener subscription
    private xmlParser = new XMLParser();
    private soapCache = new Map<string, CacheEntry>(); // SOAP response cache
    private currentPollInterval = CastConfig.DEFAULT_POLL_INTERVAL;
    private heartbeatInterval: NodeJS.Timeout | null = null; // Heartbeat to maintain the connection
    private searchRetryTimers: NodeJS.Timeout[] = []; // Timers for M-SEARCH retries
    private pendingLocations: Set<string> = new Set(); // Track locations being processed to avoid duplicates
    private fcastClient: FCastClient | null = null; // FCast protocol client
    private zeroconf: Zeroconf | null = null;
    private fcastReconnectAttempts = 0;
    private fcastReconnectTimer: NodeJS.Timeout | null = null;
    private intentionalDisconnect = false;
    private externalDisplayController: ExternalDisplayController | null = null;
    private externalDisplayState: PlaybackState = {position: 0, duration: 1000, isPlaying: false, volume: 0.5, muted: false};

    constructor() {
        super();

        // Clean up cache periodically
        setInterval(() => {
            this.cleanupCache();
        }, CastConfig.CACHE_CLEANUP_INTERVAL);
    }

    /**
     * Checks if a device is currently connected.
     * @returns True if connected, false otherwise.
     */
    isConnected(): boolean {
        return this.currentDevice !== null;
    }

    /**
     * Gets the currently connected device.
     * @returns The connected device or null.
     */
    connectedDevice(): Device | null {
        return this.currentDevice;
    }

    /**
     * Gets information about the currently playing media.
     * @returns The current media info or null.
     */
    getCurrentMediaInfo(): MediaInfo | null {
        return this.currentMediaInfo;
    }

    /**
     * Gets the title of the currently playing media.
     * @returns The current media title or null.
     */
    getCurrentMediaTitle(): string | null {
        return this.currentMediaInfo?.metadata?.title || null;
    }

    setExternalDisplayController(controller: ExternalDisplayController | null): void {
        this.externalDisplayController = controller;
    }

    updateExternalDisplayState(state: PlaybackState): void {
        this.externalDisplayState = state;
        this.emit('stateChanged', state);
        this.emit('progressChanged', state.position);
    }

    addExternalDisplay(screenId: string, name: string): void {
        const deviceId = `display-${screenId}`;
        if (this.devices.has(deviceId)) return;
        const device: Device = {
            id: deviceId,
            name,
            location: '',
            ip: '',
            port: 0,
            services: {},
            protocol: 'external-display',
        };
        this.devices.set(deviceId, device);
        LogService.info('ExternalDisplay', `Screen detected: ${name}`);
        this.emit('deviceAdded', device);
    }

    removeExternalDisplay(screenId: string): void {
        const deviceId = `display-${screenId}`;
        this.devices.delete(deviceId);
        if (this.currentDevice?.id === deviceId) {
            this.currentDevice = null;
            this.currentMediaUri = null;
            this.currentMediaInfo = null;
            this.emit('disconnected');
            this.emit('mediaCleared');
        }
    }

    /**
     * Adds a manually configured FCast device.
     * @param ip - The IP address of the FCast receiver.
     * @param port - The port (default 46899).
     * @param name - An optional name for the device.
     */
    addFCastDevice(ip: string, port: number = 46899, name?: string): void {
        const device: Device = {
            id: `fcast-${ip}:${port}`,
            name: name || `FCast (${ip})`,
            location: `tcp://${ip}:${port}`,
            ip,
            port,
            services: {},
            protocol: 'fcast',
        };
        this.devices.set(device.id, device);
        LogService.info('FCast', `Manual device added: ${device.name} at ${ip}:${port}`);
        this.emit('deviceAdded', device);
    }

    /**
     * Checks if a search is in progress.
     * @returns True if searching, false otherwise.
     */
    isSearching(): boolean {
        return this.searching;
    }

    /**
     * Starts searching for casting devices.
     * Sends multiple M-SEARCH messages for reliability (UDP is lossy).
     * @param duration - Duration of the search in milliseconds.
     */
    async startSearch(duration: number = CastConfig.DEFAULT_SEARCH_DURATION): Promise<void> {
        if (this.searching) {
            await this.stopSearch();
        }

        const netState = await NetInfo.fetch();
        if (!netState.isConnected) {
            this.emit('error', this.i18n.t('error.noNetwork'));
            return;
        }

        this.emit('searchStarted');
        this.searching = true;
        // Preserve external display devices during search
        const externalDisplays = Array.from(this.devices.entries())
            .filter(([_, d]) => d.protocol === 'external-display');
        this.devices.clear();
        for (const [id, device] of externalDisplays) {
            this.devices.set(id, device);
        }
        // Re-emit after searchStarted has been processed by reducer
        if (externalDisplays.length > 0) {
            setTimeout(() => {
                for (const [_, device] of externalDisplays) {
                    this.emit('deviceAdded', device);
                }
            }, 0);
        }
        this.pendingLocations.clear();

        // Resolve WiFi IP for multicast interface binding
        let localIp: string | undefined;
        try {
            if (netState.type === 'wifi' && netState.details) {
                localIp = (netState.details as any).ipAddress ?? undefined;
            }
        } catch (err) {
            LogService.warn('Multicast', `Could not resolve WiFi IP: ${err}`);
        }

        // Start SSDP
        this.socket = Udp.createSocket({type: 'udp4'});
        this.socket.bind(0, () => {
            try {
                this.socket.addMembership(MULTICAST_ADDRESS, localIp);
            } catch (err) {
                LogService.warn('Multicast', `addMembership with interface failed, retrying without: ${err}`);
                try {
                    this.socket.addMembership(MULTICAST_ADDRESS, null);
                } catch (err2) {
                    LogService.warn('Multicast', `Multicast group join failed: ${err2}`);
                }
            }
            // Send multiple M-SEARCH with varied search targets for reliability
            // Some devices only respond to specific ST values
            LogService.info('SSDP', 'Search started, sending M-SEARCH requests');
            this.sendSearchMessage(SEARCH_TARGET_ALL);
            this.searchRetryTimers = [];
            this.searchRetryTimers.push(setTimeout(() => {
                if (this.searching) this.sendSearchMessage(DLNA_RENDERER_ST);
            }, 2000));
            this.searchRetryTimers.push(setTimeout(() => {
                if (this.searching) this.sendSearchMessage(SEARCH_TARGET_ALL);
            }, 5000));
        });

        this.socket.on('message', (msg: Buffer, rinfo: any) => {
            this.handleSsdpResponse(msg.toString(), rinfo);
        });

        this.socket.on('error', (err: Error) => {
            this.emit('error', this.i18n.t('error.socket', {message: err.message}));
        });

        // Start SSDP NOTIFY listener (port 1900 for receiving multicast advertisements)
        // Some devices may not respond to M-SEARCH but broadcast NOTIFY
        this.notifySocket = Udp.createSocket({type: 'udp4', reusePort: true});
        this.notifySocket.bind(SSDP_PORT, () => {
            try {
                this.notifySocket.addMembership(MULTICAST_ADDRESS, localIp);
            } catch (err) {
                try {
                    this.notifySocket.addMembership(MULTICAST_ADDRESS, null);
                } catch (err2) {
                    LogService.warn('Multicast', `NOTIFY socket: multicast join failed: ${err2}`);
                }
            }
            LogService.info('SSDP', 'NOTIFY listener started on port 1900');
        });

        this.notifySocket.on('message', (msg: Buffer, rinfo: any) => {
            this.handleSsdpResponse(msg.toString(), rinfo);
        });

        this.notifySocket.on('error', (err: Error) => {
            LogService.warn('SSDP', `NOTIFY socket error: ${err.message}`);
        });

        // Start FCast mDNS discovery
        this.startFCastDiscovery();

        // Stop after duration
        this.timeout = setTimeout(() => this.stopSearch(), duration);
    }

    /**
     * Stops the device search.
     */
    async stopSearch(): Promise<void> {
        if (!this.searching) return;

        this.searching = false;

        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }

        // Clear M-SEARCH retry timers
        this.searchRetryTimers.forEach(t => clearTimeout(t));
        this.searchRetryTimers = [];

        if (this.socket) {
            try {
                this.socket.dropMembership(MULTICAST_ADDRESS);
            } catch (err) {
                LogService.warn('Multicast', `Failed to leave multicast group: ${err}`);
            }
            const socketToClose = this.socket;
            this.socket = null;
            await new Promise<void>((resolve) => {
                socketToClose.once?.('close', resolve);
                socketToClose.close();
                // Fallback timeout in case 'close' event doesn't fire
                setTimeout(resolve, 500);
            });
        }

        if (this.notifySocket) {
            try {
                this.notifySocket.dropMembership(MULTICAST_ADDRESS);
            } catch (err) {
                LogService.warn('Multicast', `NOTIFY socket: failed to leave multicast group: ${err}`);
            }
            const notifyToClose = this.notifySocket;
            this.notifySocket = null;
            await new Promise<void>((resolve) => {
                notifyToClose.once?.('close', resolve);
                notifyToClose.close();
                setTimeout(resolve, 500);
            });
        }

        // Stop FCast mDNS discovery
        this.stopFCastDiscovery();

        // Clean up listeners
        this.cleanupListeners();
        LogService.info('SSDP', `Search stopped, ${this.devices.size} device(s) found`);
        this.emit('searchStopped');
    }

    /**
     * Connects to a casting device.
     * @param device - The device to connect to.
     */
    async connect(device: Device): Promise<void> {
        try {
            if (device.protocol === 'external-display') {
                this.currentDevice = device;
                LogService.info('ExternalDisplay', `Connected to ${device.name}`);
                this.emit('connected', device);
            } else if (device.protocol === 'fcast') {
                // FCast connection via TCP
                this.fcastClient = new FCastClient(device.ip, device.port);

                this.fcastClient.on('playbackUpdate', (state: PlaybackState) => {
                    this.emit('stateChanged', state);
                    this.emit('progressChanged', state.position);
                });

                this.fcastClient.on('volumeUpdate', (volume: number) => {
                    // Volume update handled via playbackUpdate
                });

                this.fcastClient.on('error', (message: string) => {
                    this.emit('error', message);
                });

                this.fcastClient.on('disconnected', () => {
                    this.fcastClient = null;
                    if (this.intentionalDisconnect) {
                        return; // Manual disconnect — don't reconnect
                    }
                    this.attemptFCastReconnect(device);
                });

                await this.fcastClient.connect();
                this.currentDevice = device;
                this.fcastReconnectAttempts = 0;
                this.intentionalDisconnect = false;
                this.emit('connected', device);
            } else {
                // DLNA connection
                const isReachable = await this.checkDeviceReachability(device);
                if (!isReachable) {
                    this.emit('error', this.i18n.t('error.deviceUnreachable'));
                    return;
                }
                this.currentDevice = device;
                this.startPolling();
                this.emit('connected', device);
            }
        } catch (err) {
            this.emit('error', this.i18n.t('error.connect', {message: (err as Error).message}));
        }
    }

    /**
     * Stop media playback but keep device connected
     */
    async stop(): Promise<void> {
        if (!this.currentDevice) {
            this.emit('error', this.i18n.t('error.noDevice'));
            return;
        }

        if (this.isExternalDisplayDevice()) {
            if (this.externalDisplayController) {
                this.externalDisplayController.stop();
            }
            this.currentMediaUri = null;
            this.currentMediaInfo = null;
            this.emit('castingStopped');
            this.emit('mediaCleared');
            return;
        }

        if (this.isFCastDevice() && this.fcastClient) {
            try {
                await this.fcastClient.stop();
            } catch (err) {
                this.emit('error', this.i18n.t('error.stop', {message: (err as Error).message}));
            }
            this.currentMediaUri = null;
            this.currentMediaInfo = null;
            this.emit('castingStopped');
            this.emit('mediaCleared');
            return;
        }

        // DLNA stop
        this.stopHeartbeat();
        this.dlnaStop().then(() => {
            this.currentMediaUri = null;
            this.currentMediaInfo = null;
            this.emit('castingStopped');
            this.emit('mediaCleared');
            setTimeout(() => this.forceStatusUpdate(), 500);
        }).catch((err) => {
            this.currentMediaUri = null;
            this.currentMediaInfo = null;
            this.emit('castingStopped');
            this.emit('mediaCleared');
            this.emit('error', this.i18n.t('error.stop', {message: err.message}));
        });
    }

    /**
     * Disconnects from the current device completely
     */
    async disconnect(): Promise<void> {
        if (!this.currentDevice) {
            this.emit('error', this.i18n.t('error.noDevice'));
            return;
        }

        try {
            if (this.isExternalDisplayDevice()) {
                if (this.externalDisplayController) {
                    this.externalDisplayController.stop();
                }
                this.currentDevice = null;
                this.currentMediaUri = null;
                this.currentMediaInfo = null;
                this.emit('disconnected');
                this.emit('mediaCleared');
            } else if (this.isFCastDevice() && this.fcastClient) {
                this.intentionalDisconnect = true;
                this.cancelFCastReconnect();
                await this.fcastClient.stop();
                this.fcastClient.disconnect();
                this.fcastClient = null;
                this.currentDevice = null;
                this.currentMediaUri = null;
                this.currentMediaInfo = null;
                this.emit('disconnected');
                this.emit('mediaCleared');
            } else {
                this.stopHeartbeat();
                this.stopPolling();
                await this.stop();
                this.currentDevice = null;
                this.currentMediaUri = null;
                this.currentMediaInfo = null;
                this.emit('disconnected');
                this.emit('mediaCleared');
            }
        } catch (err) {
            this.emit('error', this.i18n.t('error.disconnect', {message: (err as Error).message}));
        }
    }

    /**
     * Casts media to the connected device.
     * @param mediaInfo - Information about the media to cast.
     */
    async castMedia(mediaInfo: MediaInfo): Promise<void> {
        if (!this.currentDevice) {
            // Emit error only once by stopping any background tasks first
            this.stopHeartbeat();
            this.stopPolling();
            this.emit('error', this.i18n.t('error.noDevice'));
            throw new Error(this.i18n.t('error.noDevice'));
        }

        // Validate media info
        const validation = CastUtils.validateMediaInfo(mediaInfo);
        if (!validation.isValid) {
            this.emit('error', this.i18n.t('error.mediaValidation', {errors: validation.errors.join(', ')}));
            return;
        }

        // Check if device supports this media type
        if (!CastUtils.deviceSupportsMediaType(this.currentDevice, mediaInfo.contentType || '')) {
            LogService.warn('Cast', `Device may not support media type: ${mediaInfo.contentType}`);
        }

        this.currentMediaInfo = mediaInfo;
        this.currentMediaUri = mediaInfo.contentUrl;

        try {
            if (this.isExternalDisplayDevice()) {
                LogService.info('ExternalDisplay', `Casting: ${mediaInfo.contentUrl} (${mediaInfo.contentType})`);
                this.emit('mediaCast', mediaInfo);
                this.emit('progressChanged', 0);
                this.emit('castingStarted');
            } else if (this.isFCastDevice() && this.fcastClient) {
                // FCast protocol
                await this.fcastClient.play(mediaInfo);
                this.emit('progressChanged', 0);
                this.emit('castingStarted');
            } else {
                // DLNA protocol
                this.soapCache.clear();
                const didlMetadata = this.buildDIDLMetadata(mediaInfo);
                LogService.info('Cast', `SetAVTransportURI: ${mediaInfo.contentUrl} (${mediaInfo.contentType})`);
                await this.dlnaSetAVTransportURI(mediaInfo.contentUrl, didlMetadata);
                LogService.info('Cast', 'Play command sent');
                await this.dlnaPlay();
                this.startHeartbeat();
                this.emit('progressChanged', 0);
                this.forceStatusUpdate();
                this.emit('castingStarted');
            }
        } catch (err) {
            this.emit('error', this.i18n.t('error.cast', {message: CastUtils.formatErrorMessage(err as Error)}));
        }
    }

    /**
     * Gets the duration of the current media.
     * @returns A promise resolving to the duration in seconds.
     */
    async getMediaDuration(): Promise<number> {
        if (!this.currentDevice) {
            this.emit('error', this.i18n.t('error.noDevice'));
            return 0;
        }

        try {
            // Don't cache media info during polling
            const mediaInfo = await this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'GetMediaInfo', `<InstanceID>0</InstanceID>`, false);
            return this.timeToSeconds(mediaInfo['u:GetMediaInfoResponse'].MediaDuration || '00:00:00');
        } catch (err) {
            this.emit('error', this.i18n.t('error.duration', {message: (err as Error).message}));
            return 0;
        }
    }

    /**
     * Seeks to a specific position in the media.
     * @param position - The position to seek to in seconds.
     */
    async seek(position: number): Promise<void> {
        if (!this.currentDevice) {
            this.emit('error', this.i18n.t('error.noDevice'));
            return;
        }

        if (this.isExternalDisplayDevice()) {
            this.externalDisplayController?.seek(position);
            this.emit('progressChanged', position);
            return;
        }

        if (this.isFCastDevice() && this.fcastClient) {
            await this.fcastClient.seek(position);
            this.emit('progressChanged', position);
            return;
        }

        // Check if this device is already known to not support seek
        if (this.currentDevice.capabilities?.includes('NoSeek')) {
            return;
        }

        try {
            // Validate seek position
            if (position < 0) {
                LogService.warn('Seek', 'Position clamped to 0 (negative value)');
                position = 0;
            }

            // Get current status for validation
            const currentStatus = await this.dlnaGetStatus();
            if (currentStatus.duration <= 0) {
                LogService.warn('Seek', 'Cannot seek: no media duration available');
                return;
            }

            if (position > currentStatus.duration) {
                LogService.warn('Seek', 'Position clamped to duration (exceeded media length)');
                position = currentStatus.duration;
            }

            // Don't seek if already at the target position
            if (Math.abs(currentStatus.position - position) < 3) {
                return;
            }

            // Try standard DLNA seek
            await this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'Seek', `<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>${this.secondsToTime(position)}</Target>`);

            // Update UI immediately for responsiveness
            this.emit('progressChanged', position);

            // Verify actual position after delay
            setTimeout(async () => {
                try {
                    const updatedStatus = await this.dlnaGetStatus();
                    this.emit('stateChanged', updatedStatus);
                    this.emit('progressChanged', updatedStatus.position);
                } catch (err) {
                }
            }, 1000);

        } catch (err) {
            const errorMessage = (err as Error).message;

            // Handle specific DLNA error codes and mark device capabilities
            if (errorMessage.includes('501') || errorMessage.includes('Action Failed') ||
                errorMessage.includes('701') || errorMessage.includes('714')) {

                // Mark this device as not supporting seek
                if (this.currentDevice) {
                    this.currentDevice.capabilities = this.currentDevice.capabilities || [];
                    if (!this.currentDevice.capabilities.includes('NoSeek')) {
                        this.currentDevice.capabilities.push('NoSeek');
                    }
                }

                // Emit event to notify UI about capability change
                this.emit('deviceCapabilityUpdated', this.currentDevice);

                // Silently ignore - don't show error to user
                return;
            } else if (errorMessage.includes('711')) {
                LogService.warn('Seek', 'Invalid seek target (error 711)');
                this.emit('error', this.i18n.t('error.seekPosition'));
                return;
            }

            // For other errors, revert to current position
            try {
                const currentStatus = await this.dlnaGetStatus();
                this.emit('progressChanged', currentStatus.position);
            } catch {
            }

            LogService.warn('Seek', `Seek failed: ${errorMessage}`);
            this.emit('error', this.i18n.t('error.seek', {message: CastUtils.formatErrorMessage(err as Error)}));
        }
    }

    /**
     * Retrieves the current playback status.
     * @returns A promise resolving to the playback state.
     */
    async getStatus(): Promise<PlaybackState> {
        if (!this.currentDevice) {
            this.stopHeartbeat();
            this.stopPolling();
            return {position: 0, duration: 1000, isPlaying: false, volume: 0.5, muted: false};
        }

        if (this.isExternalDisplayDevice()) {
            return this.externalDisplayState;
        }

        if (this.isFCastDevice() && this.fcastClient) {
            // FCast pushes updates via events; return last known state
            return this.fcastClient.getPlaybackState();
        }

        try {
            return await this.dlnaGetStatus();
        } catch (err) {
            this.emit('error', this.i18n.t('error.status', {message: (err as Error).message}));
            return {position: 0, duration: 1000, isPlaying: false, volume: 0.5, muted: false};
        }
    }

    /**
     * Checks if the current device supports seeking.
     * @returns True if seeking is supported.
     */
    canSeek(): boolean {
        if (!this.currentDevice) return false;

        // Check if device is known to not support seek
        return !this.currentDevice.capabilities?.includes('NoSeek');
    }

    /**
     * Get detected devices
     * @returns an array of Device
     */
    getDevices(): Device[] {
        return Array.from(this.devices.values());
    }

    /**
     * Cleanup method to be called when the instance is no longer needed.
     */
    public cleanup(): void {
        this.intentionalDisconnect = true;
        this.cancelFCastReconnect();
        this.stopSearch();
        this.stopHeartbeat();
        this.stopFCastDiscovery();
        if (this.fcastClient) {
            this.fcastClient.disconnect();
            this.fcastClient = null;
        }
        this.disconnect();
        this.soapCache.clear();
        this.devices.clear();
        this.removeAllListeners();
    }

    /**
     * Mutes or unmutes the device.
     * @param muted - True to mute, false to unmute.
     */
    async mute(muted: boolean): Promise<void> {
        if (!this.currentDevice) {
            this.emit('error', this.i18n.t('error.noDevice'));
            return;
        }

        if (this.isExternalDisplayDevice()) {
            this.externalDisplayController?.mute(muted);
            return;
        }

        if (this.isFCastDevice() && this.fcastClient) {
            // FCast doesn't have a dedicated mute opcode; set volume to 0 or restore
            await this.fcastClient.setVolume(muted ? 0 : 0.5);
            return;
        }

        this.dlnaSetMute(muted).then(() => {
            setTimeout(() => this.forceStatusUpdate(), 500);
        }).catch((err) => {
            this.emit('error', this.i18n.t('error.mute', {message: err.message}));
        });
    }

    /**
     * Sets the volume level.
     * @param volume - The volume level (0 to 1).
     */
    async setVolume(volume: number): Promise<void> {
        if (!this.currentDevice) {
            this.emit('error', this.i18n.t('error.noDevice'));
            return;
        }

        if (this.isExternalDisplayDevice()) {
            this.externalDisplayController?.setVolume(volume);
            return;
        }

        if (this.isFCastDevice() && this.fcastClient) {
            await this.fcastClient.setVolume(volume);
            return;
        }

        await this.dlnaSetVolume(Math.round(volume * 100)).then(() => {
            setTimeout(() => this.forceStatusUpdate(), 500);
        }).catch((err) => {
            this.emit('error', this.i18n.t('error.mute', {message: err.message}));
        });
    }

    /**
     * Non-blocking pause method - returns immediately, command executes in background
     */
    async pause(): Promise<void> {
        if (!this.currentDevice) {
            this.emit('error', this.i18n.t('error.noDevice'));
            return;
        }

        if (this.isExternalDisplayDevice()) {
            this.externalDisplayController?.pause();
            return;
        }

        if (this.isFCastDevice() && this.fcastClient) {
            this.fcastClient.pause().catch((err) => {
                this.emit('error', this.i18n.t('error.pause', {message: (err as Error).message}));
            });
            return;
        }

        this.dlnaPause().then(() => {
            setTimeout(() => this.forceStatusUpdate(), 500);
        }).catch((err) => {
            this.emit('error', this.i18n.t('error.pause', {message: err.message}));
        });
    }

    /**
     * Non-blocking play method - returns immediately, command executes in background
     */
    async play(): Promise<void> {
        if (!this.currentDevice) {
            this.emit('error', this.i18n.t('error.noDevice'));
            return;
        }

        if (this.isExternalDisplayDevice()) {
            this.externalDisplayController?.play();
            return;
        }

        if (this.isFCastDevice() && this.fcastClient) {
            this.fcastClient.resume().catch((err) => {
                this.emit('error', this.i18n.t('error.play', {message: (err as Error).message}));
            });
            return;
        }

        this.dlnaPlay().then(() => {
            setTimeout(() => this.forceStatusUpdate(), 500);
        }).catch((err) => {
            this.emit('error', this.i18n.t('error.pause', {message: err.message}));
        });
    }

    /**
     * Checks if the current device uses the FCast protocol.
     */
    private isFCastDevice(): boolean {
        return this.currentDevice?.protocol === 'fcast';
    }

    private isExternalDisplayDevice(): boolean {
        return this.currentDevice?.protocol === 'external-display';
    }

    /**
     * Starts mDNS discovery for FCast receivers (_fcast._tcp).
     */
    private startFCastDiscovery(): void {
        try {
            this.zeroconf = new Zeroconf();

            this.zeroconf.on('resolved', (service: any) => {
                const ip = service.addresses?.find((addr: string) => addr.includes('.'));
                if (!ip) return;

                const port = service.port || FCAST_PORT;
                const name = service.name || `FCast (${ip})`;
                const deviceId = `fcast-${ip}:${port}`;

                if (!this.devices.has(deviceId)) {
                    const device: Device = {
                        id: deviceId,
                        name,
                        location: `tcp://${ip}:${port}`,
                        ip,
                        port,
                        services: {},
                        protocol: 'fcast',
                    };
                    this.devices.set(deviceId, device);
                    LogService.info('FCast', `Discovered via mDNS: ${name} at ${ip}:${port}`);
                    this.emit('deviceAdded', device);
                }
            });

            this.zeroconf.on('error', (err: any) => {
                LogService.warn('FCast', `mDNS discovery error: ${err}`);
            });

            this.zeroconf.scan('fcast', 'tcp');
            LogService.info('FCast', 'mDNS discovery started (_fcast._tcp)');
        } catch (err) {
            LogService.warn('FCast', `Failed to start mDNS discovery: ${err}`);
        }
    }

    private stopFCastDiscovery(): void {
        if (this.zeroconf) {
            try {
                this.zeroconf.stop();
                this.zeroconf.removeAllListeners();
            } catch (err) {
                LogService.warn('FCast', `Error stopping mDNS discovery: ${err}`);
            }
            this.zeroconf = null;
        }
    }

    private attemptFCastReconnect(device: Device): void {
        this.fcastReconnectAttempts++;

        if (this.fcastReconnectAttempts > CastManager.FCAST_MAX_RECONNECT) {
            LogService.warn('FCast', `Reconnect failed after ${CastManager.FCAST_MAX_RECONNECT} attempts, giving up`);
            this.currentDevice = null;
            this.fcastReconnectAttempts = 0;
            this.cancelFCastReconnect();
            this.emit('disconnected');
            this.emit('mediaCleared');
            return;
        }

        LogService.info('FCast', `Reconnect attempt ${this.fcastReconnectAttempts}/${CastManager.FCAST_MAX_RECONNECT} in ${CastManager.FCAST_RECONNECT_DELAY / 1000}s...`);

        this.fcastReconnectTimer = setTimeout(async () => {
            try {
                this.fcastClient = new FCastClient(device.ip, device.port);

                this.fcastClient.on('playbackUpdate', (state: PlaybackState) => {
                    this.emit('stateChanged', state);
                    this.emit('progressChanged', state.position);
                });

                this.fcastClient.on('volumeUpdate', (_volume: number) => {});

                this.fcastClient.on('error', (message: string) => {
                    this.emit('error', message);
                });

                this.fcastClient.on('disconnected', () => {
                    this.fcastClient = null;
                    if (this.intentionalDisconnect) return;
                    this.attemptFCastReconnect(device);
                });

                await this.fcastClient.connect();
                this.fcastReconnectAttempts = 0;
                LogService.info('FCast', 'Reconnected successfully');
            } catch (err) {
                LogService.warn('FCast', `Reconnect attempt ${this.fcastReconnectAttempts} failed: ${err}`);
                this.fcastClient = null;
                this.attemptFCastReconnect(device);
            }
        }, CastManager.FCAST_RECONNECT_DELAY);
    }

    private cancelFCastReconnect(): void {
        if (this.fcastReconnectTimer) {
            clearTimeout(this.fcastReconnectTimer);
            this.fcastReconnectTimer = null;
        }
        this.fcastReconnectAttempts = 0;
    }

    /**
     * Start heartbeat to maintain connection during media playback
     */
    private startHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.heartbeatInterval = setInterval(async () => {
            if (this.currentDevice && this.currentMediaUri) {
                try {
                    // Lightweight ping to maintain connection
                    await this.dlnaGetStatus();
                } catch (error) {
                    LogService.warn('Heartbeat', `Heartbeat failed: ${error}`);
                }
            }
        }, 30000); // Every 30 seconds during playback
    }

    /**
     * Stop heartbeat when not needed
     */
    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Performs a DLNA SOAP action with aggressive timeout handling
     * @param serviceType - The service type.
     * @param action - The action to perform.
     * @param body - The SOAP body.
     * @param useCache - Whether to use caching for this request.
     */
    private async dlnaSoapAction(serviceType: string, action: string, body: string, useCache = false): Promise<any> {
        const cacheKey = `${serviceType}:${action}:${body}`;

        // Check cache for certain actions
        if (useCache && this.soapCache.has(cacheKey)) {
            const cached = this.soapCache.get(cacheKey)!;
            if (Date.now() - cached.timestamp < CACHE_TTL) {
                return cached.data;
            }
        }

        const device = this.currentDevice!;
        const serviceUrl = new URL(device.services![serviceType], device.location).toString();

        // Use a much shorter timeout for play/pause actions
        const actionTimeout = (action === 'Play' || action === 'Pause') ? 3000 : REQUEST_TIMEOUT;

        let lastError: Error | null = null;

        // Only retry once for play/pause to avoid long delays
        const maxAttempts = (action === 'Play' || action === 'Pause') ? 1 : MAX_RETRY_ATTEMPTS;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {

                // Create a promise that will definitely resolve/reject within the timeout
                const soapRequest = new Promise<any>(async (resolve, reject) => {
                    let controller: AbortController | null = null;
                    let timeoutId: NodeJS.Timeout | null = null;
                    let completed = false;

                    try {
                        // Set up timeout that will force resolution
                        timeoutId = setTimeout(() => {
                            if (!completed) {
                                completed = true;
                                if (controller) {
                                    controller.abort();
                                }
                                reject(new Error(`Force timeout after ${actionTimeout}ms`));
                            }
                        }, actionTimeout);

                        controller = new AbortController();

                        const response = await fetch(serviceUrl, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'text/xml; charset="utf-8"',
                                'SOAPACTION': `"${serviceType}#${action}"`,
                            },
                            body: this.wrapSoapBody(serviceType, action, body),
                            signal: controller.signal,
                        });

                        if (!completed) {

                            if (!response.ok) {
                                const errorText = await response.text();
                                // Parse UPnP error from SOAP fault XML
                                const descMatch = errorText.match(/<errorDescription>([^<]+)<\/errorDescription>/);
                                const codeMatch = errorText.match(/<errorCode>([^<]+)<\/errorCode>/);
                                if (descMatch) {
                                    throw new Error(codeMatch ? `UPnP ${codeMatch[1]}: ${descMatch[1]}` : descMatch[1]);
                                }
                                throw new Error(`HTTP ${response.status}`);
                            }

                            const xml = await response.text();

                            const parsed = this.xmlParser.parse(xml);

                            if (!parsed?.['s:Envelope']?.['s:Body']) {
                                throw new Error('Invalid SOAP response structure');
                            }

                            const result = parsed['s:Envelope']['s:Body'];

                            if (!completed) {
                                completed = true;
                                if (timeoutId) clearTimeout(timeoutId);
                                resolve(result);
                            }
                        }
                    } catch (err) {
                        if (!completed) {
                            completed = true;
                            if (timeoutId) clearTimeout(timeoutId);
                            LogService.error('SOAP', `Fetch error for ${action}: ${(err as Error).message}`);
                            reject(err);
                        }
                    }
                });

                const result = await soapRequest;

                // Cache if requested
                if (useCache) {
                    this.soapCache.set(cacheKey, {data: result, timestamp: Date.now()});
                }

                return result;

            } catch (err) {
                lastError = err as Error;
                LogService.error('SOAP', `Attempt ${attempt + 1} failed for ${action}: ${lastError.message}`);

                // For play/pause, don't retry - fail fast
                if (action === 'Play' || action === 'Pause') {
                    break;
                }

                // Wait before retry for other actions
                if (attempt < maxAttempts - 1) {
                    const delay = 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        LogService.error('SOAP', `Action ${action} failed after all retries: ${lastError?.message}`);
        throw lastError || new Error(`SOAP action ${action} failed`);
    }

    /**
     * Send a SSDP M-SEARCH message
     */
    /**
     * Send an SSDP M-SEARCH message with the given search target.
     * @param searchTarget - UPnP search target (ST header value)
     */
    private sendSearchMessage(searchTarget: string = SEARCH_TARGET_ALL): void {
        const message = Buffer.from(
            `M-SEARCH * HTTP/1.1\r\n` +
            `HOST: ${MULTICAST_ADDRESS}:${SSDP_PORT}\r\n` +
            `MAN: "ssdp:discover"\r\n` +
            `MX: 3\r\n` +
            `ST: ${searchTarget}\r\n\r\n`
        );

        this.socket.send(message, 0, message.length, SSDP_PORT, MULTICAST_ADDRESS, (err: Error | null) => {
            if (err) this.emit('error', this.i18n.t('error.send', {message: err.message}));
        });
    }

    /**
     * Handle SSDP response
     * @param response
     * @param rinfo
     * @private
     */
    private async handleSsdpResponse(response: string, rinfo: any): Promise<void> {
        let deviceLocation: string | undefined;
        try {
            const headers = this.parseHeaders(response);

            // Support both M-SEARCH responses (ST header) and NOTIFY advertisements (NT header)
            const st = headers['ST'] || headers['NT'];
            deviceLocation = headers['LOCATION'];
            const usn = headers['USN']?.trim();

            // Handle NOTIFY byebye: device is leaving the network
            if (headers['NTS'] === 'ssdp:byebye') {
                if (usn && this.devices.has(usn)) {
                    const device = this.devices.get(usn)!;
                    this.devices.delete(usn);
                    this.pendingLocations.delete(deviceLocation || '');
                    LogService.info('SSDP', `Device left: ${device.name}`);
                    this.emit('deviceRemoved', device);
                }
                return;
            }

            // Validate headers and check for duplicates early
            if (!st || !deviceLocation || !usn) {
                return;
            }

            if (this.devices.has(usn)) return;

            // Skip if this location is already being processed or was already added
            if (this.pendingLocations.has(deviceLocation)) return;
            this.pendingLocations.add(deviceLocation);

            // Accept MediaRenderer or any UPnP device (AVTransport is verified below)
            const isRenderer = st === DLNA_RENDERER_ST;
            const isUpnpDevice = st.includes('upnp') || st.includes('schemas-upnp-org') || st === SEARCH_TARGET_ALL;
            if (!isRenderer && !isUpnpDevice) {
                this.pendingLocations.delete(deviceLocation);
                return;
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CastConfig.DESCRIPTION_TIMEOUT);

            let descRes;
            try {
                descRes = await fetch(deviceLocation, {
                    signal: controller.signal
                });
            } catch (fetchErr) {
                this.pendingLocations.delete(deviceLocation);
                throw fetchErr;
            }

            clearTimeout(timeoutId);

            if (!descRes.ok) {
                LogService.warn('SSDP', `Device description fetch failed with HTTP ${descRes.status}`);
                this.pendingLocations.delete(deviceLocation);
                return;
            }

            const descXml = await descRes.text();
            const parsed = this.xmlParser.parse(descXml);

            if (!parsed?.root?.device) {
                LogService.warn('SSDP', `Invalid device description XML: ${deviceLocation}`);
                this.pendingLocations.delete(deviceLocation);
                return;
            }

            const services = this.extractServices(parsed);

            // Must have AVTransport to be a usable renderer
            const hasAVTransport = Object.keys(services).some(s => s.includes('AVTransport'));
            if (!hasAVTransport) {
                this.pendingLocations.delete(deviceLocation);
                return;
            }

            const deviceInfo = parsed.root.device;
            const friendlyName = deviceInfo.friendlyName || 'Unknown Device';

            const device: Device = {
                id: usn,
                name: friendlyName,
                location: deviceLocation,
                ip: rinfo.address,
                port: rinfo.port,
                services,
                manufacturer: deviceInfo.manufacturer,
                modelName: deviceInfo.modelName,
                capabilities: this.extractCapabilities(deviceInfo),
                iconUrl: await this.extractDeviceIcon(parsed, deviceLocation),
                protocol: 'dlna',
            };

            this.devices.set(usn, device);
            LogService.info('SSDP', `Device found: ${device.name} (${device.modelName || 'unknown model'}) at ${device.ip}`);
            this.emit('deviceAdded', device);
        } catch (err) {
            if (deviceLocation) this.pendingLocations.delete(deviceLocation);
            LogService.warn('SSDP', `Error processing device response: ${(err as Error).message}`);
        }
    }

    /**
     * Parses SSDP response headers.
     * @param response - The SSDP response string.
     * @returns A record of header key-value pairs.
     */
    private parseHeaders(response: string): Record<string, string> {
        const lines = response.split('\r\n');
        const headers: Record<string, string> = {};

        for (let i = 1; i < lines.length; i++) {
            const colonIndex = lines[i].indexOf(':');
            if (colonIndex > 0) {
                const key = lines[i].substring(0, colonIndex).trim().toUpperCase();
                const value = lines[i].substring(colonIndex + 1).trim();
                if (key && value) {
                    headers[key] = value;
                }
            }
        }

        return headers;
    }

    /**
     * Extracts services from parsed XML with better error handling.
     * @param parsed - The parsed XML object.
     * @returns A record of service types and URLs.
     */
    private extractServices(parsed: any): Record<string, string> {
        const services: Record<string, string> = {};

        const collectFromDevice = (device: any) => {
            const serviceList = device?.serviceList?.service;
            if (serviceList) {
                const list = Array.isArray(serviceList) ? serviceList : [serviceList];
                list.forEach((service: any) => {
                    if (service?.serviceType && service?.controlURL) {
                        const type = service.serviceType;
                        if (type.includes('AVTransport') || type.includes('RenderingControl')) {
                            services[type] = service.controlURL;
                        }
                    }
                });
            }
            // Recurse into embedded devices
            const embedded = device?.deviceList?.device;
            if (embedded) {
                const devices = Array.isArray(embedded) ? embedded : [embedded];
                devices.forEach(collectFromDevice);
            }
        };

        try {
            collectFromDevice(parsed.root?.device);
        } catch (err) {
            LogService.warn('SSDP', `Error extracting device services: ${err}`);
        }

        return services;
    }

    /**
     * Extracts device capabilities from device info.
     * @param deviceInfo - The device info object.
     * @returns An array of capabilities.
     */
    private extractCapabilities(deviceInfo: any): string[] {
        const capabilities: string[] = [];

        try {
            // Extract capabilities based on device type and services
            if (deviceInfo.deviceType?.includes('MediaRenderer')) {
                capabilities.push('MediaRenderer');
            }

            // Add more capability detection logic as needed

        } catch (err) {
            LogService.warn('SSDP', `Error extracting device capabilities: ${err}`);
        }

        return capabilities;
    }


    /**
     * Wraps SOAP body dynamically based on serviceType.
     * @param serviceType - The service type for namespace.
     * @param action - The action name.
     * @param body - The inner body.
     * @returns SOAP envelope string.
     */
    private wrapSoapBody(serviceType: string, action: string, body: string): string {
        return `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body>
<u:${action} xmlns:u="${serviceType}">
${body}
</u:${action}>
</s:Body>
</s:Envelope>`;
    }

    /**
     * Sets the AVTransport URI for DLNA with optional metadata.
     * @param uri - The media URI.
     * @param metadata - DIDL metadata (optional, for images).
     */
    private async dlnaSetAVTransportURI(uri: string, metadata: string = ''): Promise<void> {
        const escapedMetadata = metadata.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        await this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'SetAVTransportURI', `<InstanceID>0</InstanceID><CurrentURI>${uri}</CurrentURI><CurrentURIMetaData>${escapedMetadata}</CurrentURIMetaData>`);
    }

    /**
     * Plays media on a DLNA device.
     */
    private async dlnaPlay(): Promise<void> {
        await this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'Play', `<InstanceID>0</InstanceID><Speed>1</Speed>`);
    }


    /**
     * Stop playing media on a DLNA device.
     */
    private async dlnaStop(): Promise<void> {
        await this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'Stop', `<InstanceID>0</InstanceID>`);
    }

    /**
     * Pauses media on a DLNA device.
     */
    private async dlnaPause(): Promise<void> {
        await this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'Pause', `<InstanceID>0</InstanceID>`);
    }

    /**
     * Seeks to a position on a DLNA device.
     * @param time - The time to seek to.
     */
    private async dlnaSeek(time: string): Promise<void> {
        await this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'Seek', `<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>${time}</Target>`);
    }

    /**
     * Sets the volume on a DLNA device.
     * @param volume - The volume level (0-100).
     */
    private async dlnaSetVolume(volume: number): Promise<void> {
        await this.dlnaSoapAction('urn:schemas-upnp-org:service:RenderingControl:1', 'SetVolume', `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${volume}</DesiredVolume>`);

        // Clear volume and mute cache after volume change
        this.clearVolumeCache();
    }

    /**
     * Mutes or unmutes a DLNA device.
     * @param muted - True to mute, false to unmute.
     */
    private async dlnaSetMute(muted: boolean): Promise<void> {
        await this.dlnaSoapAction('urn:schemas-upnp-org:service:RenderingControl:1', 'SetMute', `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>${muted ? 1 : 0}</DesiredMute>`);

        // Clear volume and mute cache after mute change
        this.clearVolumeCache();
    }

    /**
     * Clear volume and mute related cache entries
     */
    private clearVolumeCache(): void {
        const volumeKeys = Array.from(this.soapCache.keys()).filter(key =>
            key.includes('GetVolume') || key.includes('GetMute')
        );

        volumeKeys.forEach(key => {
            this.soapCache.delete(key);
        });

    }

    /**
     * Gets the playback status for a DLNA device.
     * @returns A promise resolving to the playback state.
     */
    private async dlnaGetStatus(): Promise<PlaybackState> {
        // Check device before doing anything
        if (!this.currentDevice) {
            // Stop heartbeat if it's running without a device
            this.stopHeartbeat();
            this.stopPolling();
            // Return default state without emitting error
            return {position: 0, duration: 1000, isPlaying: false, volume: 0.5, muted: false};
        }
        try {
            // Don't cache position info - we need real-time data
            // Also don't cache volume/mute during active volume changes
            const [posInfo, transInfo, volInfo, muteInfo, mediaInfo] = await Promise.all([
                this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'GetPositionInfo', `<InstanceID>0</InstanceID>`, false),
                this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'GetTransportInfo', `<InstanceID>0</InstanceID>`, false),
                this.dlnaSoapAction('urn:schemas-upnp-org:service:RenderingControl:1', 'GetVolume', `<InstanceID>0</InstanceID><Channel>Master</Channel>`, false), // Don't cache volume
                this.dlnaSoapAction('urn:schemas-upnp-org:service:RenderingControl:1', 'GetMute', `<InstanceID>0</InstanceID><Channel>Master</Channel>`, false), // Don't cache mute
                this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'GetMediaInfo', `<InstanceID>0</InstanceID>`, true)
            ]);

            const position = this.timeToSeconds(posInfo['u:GetPositionInfoResponse']?.RelTime || '00:00:00');
            const duration = this.timeToSeconds(mediaInfo['u:GetMediaInfoResponse']?.MediaDuration || '00:00:00');
            const isPlaying = transInfo['u:GetTransportInfoResponse']?.CurrentTransportState === 'PLAYING';

            const rawVolume = volInfo['u:GetVolumeResponse']?.CurrentVolume;
            const volume = (rawVolume !== undefined && rawVolume !== null) ? parseInt(rawVolume, 10) / 100 : 0.5;

            // Handle mute state more carefully
            let muted = false;
            let deviceSupportsMute = true;

            try {
                // Try to get mute status from the device
                const muteValue = muteInfo['u:GetMuteResponse']?.CurrentMute;
                if (muteValue !== undefined && muteValue !== null) {
                    muted = muteValue === '1' || muteValue === 1 || muteValue === true;
                } else {
                    // Device doesn't support GetMute properly, fall back to volume check
                    deviceSupportsMute = false;
                }
            } catch (muteError) {
                // GetMute failed completely, device doesn't support it
                deviceSupportsMute = false;
                LogService.info('Status', 'Device does not support GetMute, using volume-based detection');
            }

            // If device doesn't support native mute, use volume-based logic
            // Also use volume-based logic if volume is 0 (which should mean muted)
            if (!deviceSupportsMute || volume === 0) {
                muted = volume === 0;
            }

            return {position, duration, isPlaying, volume, muted};
        } catch (err) {
            LogService.warn('Status', `Failed to get DLNA playback status: ${err}`);
            return {position: 0, duration: 1000, isPlaying: false, volume: 0.5, muted: false};
        }
    }

    /**
     * Converts seconds to a time string (HH:MM:SS).
     * @param seconds - The time in seconds.
     * @returns The formatted time string.
     */
    private secondsToTime(seconds: number): string {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    /**
     * Converts a time string (HH:MM:SS) to seconds.
     * @param time - The time string.
     * @returns The time in seconds.
     */
    private timeToSeconds(time: string): number {
        if (!time || time === 'NOT_IMPLEMENTED') return 0;

        const parts = time.split(':');
        if (parts.length !== 3) return 0;

        const [h, m, s] = parts.map(part => parseInt(part, 10) || 0);
        return h * 3600 + m * 60 + s;
    }


    /**
     * Stops the polling interval if it's running.
     */
    private stopPolling(): void {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    /**
     * Starts polling for playback status updates.
     */
    private startPolling(): void {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }

        const poll = async () => {
            try {
                if (!this.currentDevice) {
                    this.stopPolling();
                    return;
                }
                if (!await this.checkNetworkAndDevice()) {
                    this.disconnect();
                    return;
                }

                const status = await this.getStatus();
                this.emit('stateChanged', status);
                this.emit('progressChanged', status.position);

            } catch (err) {
                LogService.warn('Polling', `Playback status polling error: ${err}`);
            }
            this.pollingInterval = setTimeout(poll, CastConfig.DEFAULT_POLL_INTERVAL);
        };

        // Start first poll immediately
        poll();
    }

    /**
     * Checks network connectivity and device reachability.
     * @returns True if network and device are accessible.
     */
    private async checkNetworkAndDevice(): Promise<boolean> {
        try {
            const netInfo = await NetInfo.fetch();
            if (!netInfo.isConnected) {
                this.emit('error', this.i18n.t('error.noNetwork'));
                return false;
            }

            if (this.currentDevice) {
                return await this.checkDeviceReachability(this.currentDevice);
            }

            return true;
        } catch {
            return false;
        }
    }

    /**
     * Checks if a device is reachable.
     * @param device - The device to check.
     * @returns True if device is reachable.
     */
    private async checkDeviceReachability(device: Device): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CastConfig.CONNECTIVITY_CHECK_TIMEOUT);
            const response = await fetch(device.location, {
                method: 'HEAD',
                signal: controller.signal,
            });

            clearTimeout(timeoutId);
            return response.status <= 400;
        } catch {
            return false;
        }
    }

    /**
     * Cleans up expired cache entries.
     */
    private cleanupCache(): void {
        const now = Date.now();
        for (const [key, entry] of this.soapCache.entries()) {
            if (now - entry.timestamp > CACHE_TTL * 2) { // Keep cache 2x longer than TTL for cleanup
                this.soapCache.delete(key);
            }
        }
    }

    /**
     * Cleans up event listeners.
     */
    private cleanupListeners(): void {
        if (this.castDeviceListener) {
            this.castDeviceListener.remove();
            this.castDeviceListener = null;
        }
        if (this.sessionListener) {
            this.sessionListener.remove();
            this.sessionListener = null;
        }
        if (this.mediaListener) {
            this.mediaListener.remove();
            this.mediaListener = null;
        }
    }

    /**
     * Builds basic DIDL-Lite metadata for the media item (required for images and videos in DLNA)
     * @param mediaInfo - Media info
     * @returns DIDL XML string
     */
    private buildDIDLMetadata(mediaInfo: MediaInfo): string {
        // Auto-detect content type if not provided
        if (!mediaInfo.contentType) {
            mediaInfo.contentType = CastUtils.getMimeTypeFromUrl(mediaInfo.contentUrl);
        }

        let upnpClass = 'object.item';
        let protocolInfo = 'http-get:*:*:*'; // Fallback
        let mimeType = mediaInfo.contentType || '*/*';

        if (mimeType.includes('image')) {
            upnpClass = 'object.item.imageItem.photo';
            protocolInfo = `http-get:*:${mimeType}:DLNA.ORG_PN=${mimeType.includes('jpeg') ? 'JPEG_SM' : 'PNG_LRG'};DLNA.ORG_CI=0;DLNA.ORG_FLAGS=00D00000000000000000000000000000`;
        } else if (mimeType.includes('video')) {
            upnpClass = 'object.item.videoItem';
            protocolInfo = `http-get:*:${mimeType}:DLNA.ORG_OP=01;DLNA.ORG_CI=0`;

            // Add duration if available
            if (mediaInfo.streamDuration) {
                const durationSeconds = Math.floor(mediaInfo.streamDuration / 1000);
                const durationStr = this.secondsToTime(durationSeconds);
                protocolInfo += `;DLNA.ORG_FLAGS=01500000000000000000000000000000`; // Streaming flags

                const title = this.escapeXml(mediaInfo.metadata?.title || mediaInfo.contentUrl.split('/').pop() || 'Media');
                const contentUrl = this.escapeXml(mediaInfo.contentUrl);

                return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="media-${CastUtils.generateUniqueId()}" parentID="0" restricted="true"><dc:title>${title}</dc:title><upnp:class>${upnpClass}</upnp:class><res protocolInfo="${protocolInfo}" duration="${durationStr}">${contentUrl}</res></item></DIDL-Lite>`;
            }
        } else if (mimeType.includes('audio')) {
            upnpClass = 'object.item.audioItem.musicTrack';
            protocolInfo = `http-get:*:${mimeType}:DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01500000000000000000000000000000`;
        }

        // Use metadata.title if available, fallback to filename from contentUrl
        const title = this.escapeXml(mediaInfo.metadata?.title || mediaInfo.contentUrl.split('/').pop() || 'Media');
        const contentUrl = this.escapeXml(mediaInfo.contentUrl);

        return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="media-${CastUtils.generateUniqueId()}" parentID="0" restricted="true"><dc:title>${title}</dc:title><upnp:class>${upnpClass}</upnp:class><res protocolInfo="${protocolInfo}">${contentUrl}</res></item></DIDL-Lite>`;
    }

    /**
     * Escapes XML characters in strings.
     * @param str - The string to escape.
     * @returns The escaped string.
     */
    private escapeXml(str: string): string {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    /**
     * Forces an immediate status update (used after play/pause/seek commands)
     */
    private async forceStatusUpdate(): Promise<void> {
        try {
            // Clear cache to ensure fresh data
            this.soapCache.clear();
            // Wait a bit longer for the device to process the command
            await new Promise(resolve => setTimeout(resolve, 500));
            const status = await this.getStatus();
            this.emit('stateChanged', status);
            this.emit('progressChanged', status.position);

        } catch (err) {
        }
    }

    /**
     * Extracts and validates device icon URL from device description.
     * @param parsed - The parsed XML object.
     * @param baseLocation - The device base location for relative URLs.
     * @returns Promise resolving to icon URL or undefined.
     */
    private async extractDeviceIcon(parsed: any, baseLocation: string): Promise<string | undefined> {
        try {
            const iconList = parsed.root?.device?.iconList?.icon;
            if (!iconList) return undefined;

            const icons = Array.isArray(iconList) ? iconList : [iconList];

            // Sort icons by preference: PNG first, then by size (largest first)
            const sortedIcons = icons.sort((a, b) => {
                // Prefer PNG
                if (a.mimetype === 'image/png' && b.mimetype !== 'image/png') return -1;
                if (b.mimetype === 'image/png' && a.mimetype !== 'image/png') return 1;

                // Then prefer larger size
                const aSize = (a.width || 0) * (a.height || 0);
                const bSize = (b.width || 0) * (b.height || 0);
                return bSize - aSize;
            });

            // Test each icon URL until we find one that works
            for (const icon of sortedIcons) {
                if (!icon.url) continue;

                const iconUrl = this.buildIconUrl(icon.url, baseLocation);
                const isValid = await this.validateIconUrl(iconUrl);

                if (isValid) {
                    return iconUrl;
                }
            }

            return undefined;
        } catch (err) {
            LogService.warn('SSDP', `Error extracting device icon: ${err}`);
            return undefined;
        }
    }

    /**
     * Builds complete icon URL from relative or absolute path.
     * @param iconPath - The icon path from device description.
     * @param baseLocation - The device base location.
     * @returns Complete icon URL.
     */
    private buildIconUrl(iconPath: string, baseLocation: string): string {
        if (iconPath.startsWith('http')) {
            return iconPath;
        }
        const baseUrl = baseLocation.replace(/\/[^/]*\.[^/]*$/, '').replace(/\/+$/, '');
        return `${baseUrl}${iconPath.startsWith('/') ? '' : '/'}${iconPath}`;
    }

    /**
     * Validates if an icon URL is accessible.
     * @param iconUrl - The icon URL to validate.
     * @returns Promise resolving to boolean indicating if URL is valid.
     */
    private async validateIconUrl(iconUrl: string): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

            const response = await fetch(iconUrl, {
                method: 'HEAD',
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                return false;
            }

            const contentType = response.headers.get('content-type');
            return contentType ? contentType.startsWith('image/') : false;

        } catch {
            return false;
        }
    }
}