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
    private i18n = initTranslate();
    private socket: any = null; // UDP socket for SSDP
    private searching = false; // Discovery state
    private devices: Map<string, Device> = new Map(); // Discovered devices
    private timeout: NodeJS.Timeout | null = null; // Search timeout
    private currentMediaUri: string | null = null;
    private currentDevice: Device | null = null; // Currently connected device
    private pollingInterval: NodeJS.Timeout | null = null; // Polling
    private castDeviceListener: any = null; // Cast device listener subscription
    private sessionListener: any = null; // Session listener subscription
    private mediaListener: any = null; // Media listener subscription
    private xmlParser = new XMLParser();
    private soapCache = new Map<string, CacheEntry>(); // SOAP response cache
    private currentPollInterval = CastConfig.DEFAULT_POLL_INTERVAL;

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
     * Checks if a search is in progress.
     * @returns True if searching, false otherwise.
     */
    isSearching(): boolean {
        return this.searching;
    }

    /**
     * Starts searching for casting devices.
     * @param duration - Duration of the search in milliseconds.
     */
    async startSearch(duration: number = CastConfig.DEFAULT_SEARCH_DURATION): Promise<void> {
        if (this.searching) return;

        const state = await NetInfo.fetch();
        if (!state.isConnected) {
            this.emit('error', this.i18n.t('error.noNetwork'));
            return;
        }

        this.emit('searchStarted');
        this.searching = true;
        this.devices.clear(); // Clear previous discoveries

        // Start SSDP
        this.socket = Udp.createSocket({type: 'udp4'});
        this.socket.bind(0, () => {
            this.socket.addMembership(MULTICAST_ADDRESS);
            this.sendSearchMessage();
        });

        this.socket.on('message', (msg: Buffer, rinfo: any) => {
            this.handleSsdpResponse(msg.toString(), rinfo);
        });

        this.socket.on('error', (err: Error) => {
            this.emit('error', this.i18n.t('error.socket', {message: err.message}));
        });

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

        if (this.socket) {
            try {
                this.socket.dropMembership(MULTICAST_ADDRESS);
            } catch (err) {
                console.warn('Error dropping membership:', err);
            }
            this.socket.close();
            this.socket = null;
        }

        // Clean up listeners
        this.cleanupListeners();
        this.emit('searchStopped');
    }

    /**
     * Connects to a casting device.
     * @param device - The device to connect to.
     */
    async connect(device: Device): Promise<void> {
        try {
            // Verify device is still reachable
            const isReachable = await this.checkDeviceReachability(device);
            if (!isReachable) {
                this.emit('error', this.i18n.t('error.deviceUnreachable'));
                return;
            }

            this.currentDevice = device;
            this.startPolling();
            this.emit('connected', device);
        } catch (err) {
            this.emit('error', this.i18n.t('error.connect', {message: (err as Error).message}));
        }
    }

    /**
     * Disconnects from the current device.
     */
    async disconnect(): Promise<void> {
        if (!this.currentDevice) {
            this.emit('error', this.i18n.t('error.noDevice'));
            return;
        }

        try {
            await this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'Stop', `<InstanceID>0</InstanceID>`);

            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
                this.pollingInterval = null;
            }

            this.currentDevice = null;
            this.currentMediaUri = null;
            this.soapCache.clear(); // Clear cache on disconnect
            this.emit('disconnected');
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
            this.emit('error', this.i18n.t('error.noDevice'));
            return;
        }

        // Validate media info
        const validation = CastUtils.validateMediaInfo(mediaInfo);
        if (!validation.isValid) {
            this.emit('error', this.i18n.t('error.mediaValidation', {errors: validation.errors.join(', ')}));
            return;
        }

        // Check if device supports this media type
        if (!CastUtils.deviceSupportsMediaType(this.currentDevice, mediaInfo.contentType || '')) {
            console.warn(`Device may not support media type: ${mediaInfo.contentType}`);
        }

        this.currentMediaUri = mediaInfo.contentUrl;

        try {
            // Clear cache before starting new media
            this.soapCache.clear();

            // Build basic DIDL metadata for images/videos
            const didlMetadata = this.buildDIDLMetadata(mediaInfo);
            await this.dlnaSetAVTransportURI(mediaInfo.contentUrl, didlMetadata);
            await this.dlnaPlay();

            // Reset progress to 0 when starting new media
            this.emit('progressChanged', 0);

            // Then get actual status after a brief delay
            this.forceStatusUpdate();

            this.emit('castingStarted');
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
     * Plays media on a DLNA device.
     */
    async play(): Promise<void> {
        if (!this.currentDevice) {
            this.emit('error', this.i18n.t('error.noDevice'));
            return;
        }

        try {
            await this.dlnaPlay();
            // Force immediate status update after play command
            this.forceStatusUpdate();
        } catch (err) {
            this.emit('error', this.i18n.t('error.play', {message: (err as Error).message}));
        }
    }

    /**
     * Pauses the currently playing media.
     */
    async pause(): Promise<void> {
        if (!this.currentDevice) {
            this.emit('error', this.i18n.t('error.noDevice'));
            return;
        }

        try {
            await this.dlnaPause();
            // Force immediate status update after pause command
            this.forceStatusUpdate();
        } catch (err) {
            this.emit('error', this.i18n.t('error.pause', {message: (err as Error).message}));
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

        // Check if this device is already known to not support seek
        if (this.currentDevice.capabilities?.includes('NoSeek')) {
            console.log('Device known to not support seek - ignoring request');
            return;
        }

        try {
            // Validate seek position
            if (position < 0) {
                console.warn('Seek position cannot be negative, clamping to 0');
                position = 0;
            }

            // Get current status for validation
            const currentStatus = await this.dlnaGetStatus();
            if (currentStatus.duration <= 0) {
                console.warn('Cannot seek: No media duration available');
                return;
            }

            if (position > currentStatus.duration) {
                console.warn('Seek position beyond duration, clamping to duration');
                position = currentStatus.duration;
            }

            // Don't seek if already at the target position
            if (Math.abs(currentStatus.position - position) < 3) {
                console.log('Already near target position, skipping seek');
                return;
            }

            console.log(`Attempting seek from ${currentStatus.position}s to ${position}s`);

            // Try standard DLNA seek
            await this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'Seek', `<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>${this.secondsToTime(position)}</Target>`);

            console.log('Seek command sent successfully');

            // Update UI immediately for responsiveness
            this.emit('progressChanged', position);

            // Verify actual position after delay
            setTimeout(async () => {
                try {
                    const updatedStatus = await this.dlnaGetStatus();
                    this.emit('stateChanged', updatedStatus);
                    this.emit('progressChanged', updatedStatus.position);
                    console.log(`Seek result - Target: ${position}s, Actual: ${updatedStatus.position}s`);
                } catch (err) {
                    console.warn('Error verifying seek result:', err);
                }
            }, 1000);

        } catch (err) {
            const errorMessage = (err as Error).message;

            // Handle specific DLNA error codes and mark device capabilities
            if (errorMessage.includes('501') || errorMessage.includes('Action Failed') ||
                errorMessage.includes('701') || errorMessage.includes('714')) {

                console.log('Device does not support DLNA seek - marking as NoSeek');

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
                console.warn('Invalid seek target');
                this.emit('error', this.i18n.t('error.seekPosition'));
                return;
            }

            // For other errors, revert to current position
            try {
                const currentStatus = await this.dlnaGetStatus();
                this.emit('progressChanged', currentStatus.position);
            } catch {
            }

            console.warn('Seek failed with error:', errorMessage);
            this.emit('error', this.i18n.t('error.seek', {message: CastUtils.formatErrorMessage(err as Error)}));
        }
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

        try {
            await this.dlnaSetVolume(Math.round(volume * 100));
        } catch (err) {
            this.emit('error', this.i18n.t('error.volume', {message: (err as Error).message}));
        }
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

        try {
            await this.dlnaSetMute(muted);
        } catch (err) {
            this.emit('error', this.i18n.t('error.mute', {message: (err as Error).message}));
        }
    }

    /**
     * Retrieves the current playback status.
     * @returns A promise resolving to the playback state.
     */
    async getStatus(): Promise<PlaybackState> {
        if (!this.currentDevice) {
            this.emit('error', this.i18n.t('error.noDevice'));
            return {position: 0, duration: 1000, isPlaying: false, volume: 0.5, muted: false};
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
        this.stopSearch();
        this.disconnect();
        this.soapCache.clear();
        this.devices.clear();
        this.removeAllListeners();
    }

    /**
     * Send a SSDP M-SEARCH message
     */
    private sendSearchMessage(): void {
        const message = Buffer.from(
            `M-SEARCH * HTTP/1.1\r\n` +
            `HOST: ${MULTICAST_ADDRESS}:${SSDP_PORT}\r\n` +
            `MAN: "ssdp:discover"\r\n` +
            `MX: 3\r\n` +
            `ST: ${SEARCH_TARGET_ALL}\r\n\r\n`
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
        try {
            const headers = this.parseHeaders(response);
            const st = headers['ST'];
            const location = headers['LOCATION'];
            const usn = headers['USN']?.trim();

            // Validate headers and check for duplicates early
            if (!st || !location || !usn) {
                console.warn('Invalid SSDP response: missing ST, LOCATION, or USN');
                return;
            }

            if (this.devices.has(usn)) return; // Skip if device already exists

            // Only process DLNA devices
            if (st !== DLNA_RENDERER_ST) {
                return;
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CastConfig.DESCRIPTION_TIMEOUT);

            const descRes = await fetch(location, {
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!descRes.ok) {
                console.warn(`Failed to fetch device description: ${descRes.status}`);
                return;
            }

            const descXml = await descRes.text();
            const parsed = this.xmlParser.parse(descXml);

            if (!parsed?.root?.device) {
                console.warn('Invalid device description XML');
                return;
            }

            const deviceInfo = parsed.root.device;
            const friendlyName = deviceInfo.friendlyName || 'Unknown Device';

            const device: Device = {
                id: usn,
                name: friendlyName,
                location,
                ip: rinfo.address,
                port: rinfo.port,
                services: this.extractServices(parsed),
                manufacturer: deviceInfo.manufacturer,
                modelName: deviceInfo.modelName,
                capabilities: this.extractCapabilities(deviceInfo),
                iconUrl: await this.extractDeviceIcon(parsed, location),
            };

            this.devices.set(usn, device);
            this.emit('deviceAdded', device);
        } catch (err) {
            console.warn('Error handling SSDP response:', (err as Error).message);
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

        try {
            const serviceList = parsed.root?.device?.serviceList?.service;
            if (!serviceList) return services;

            const servicesArray = Array.isArray(serviceList) ? serviceList : [serviceList];

            servicesArray.forEach((service: any) => {
                if (service?.serviceType && service?.controlURL) {
                    const type = service.serviceType;
                    if (type.includes('AVTransport') || type.includes('RenderingControl')) {
                        services[type] = service.controlURL;
                    }
                }
            });
        } catch (err) {
            console.warn('Error extracting services:', err);
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
            console.warn('Error extracting capabilities:', err);
        }

        return capabilities;
    }

    /**
     * Performs a DLNA SOAP action with caching and retry logic.
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
        const baseUrl = device.location.replace(/\/desc\.xml$/, '').replace(/\/+$/, '');
        const servicePath = device.services![serviceType].replace(/^\/+/, '');
        const serviceUrl = `${baseUrl}/${servicePath}`;

        let lastError: Error | null = null;

        // Retry logic
        for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

                const response = await fetch(serviceUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'text/xml; charset="utf-8"',
                        'SOAPACTION': `"${serviceType}#${action}"`,
                    },
                    body: this.wrapSoapBody(serviceType, action, body),
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }

                const xml = await response.text();
                const parsed = this.xmlParser.parse(xml);

                if (!parsed?.['s:Envelope']?.['s:Body']) {
                    throw new Error('Invalid SOAP response structure');
                }

                const result = parsed['s:Envelope']['s:Body'];

                // Cache if requested
                if (useCache) {
                    this.soapCache.set(cacheKey, {data: result, timestamp: Date.now()});
                }

                return result;

            } catch (err) {
                lastError = err as Error;
                if (attempt < MAX_RETRY_ATTEMPTS - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                }
            }
        }

        throw lastError;
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
    }

    /**
     * Mutes or unmutes a DLNA device.
     * @param muted - True to mute, false to unmute.
     */
    private async dlnaSetMute(muted: boolean): Promise<void> {
        await this.dlnaSoapAction('urn:schemas-upnp-org:service:RenderingControl:1', 'SetMute', `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>${muted ? 1 : 0}</DesiredMute>`);
    }

    /**
     * Gets the playback status for a DLNA device.
     * @returns A promise resolving to the playback state.
     */
    private async dlnaGetStatus(): Promise<PlaybackState> {
        try {
            // Don't cache position info - we need real-time data
            const [posInfo, transInfo, volInfo, muteInfo, mediaInfo] = await Promise.all([
                this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'GetPositionInfo', `<InstanceID>0</InstanceID>`, false),
                this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'GetTransportInfo', `<InstanceID>0</InstanceID>`, false),
                this.dlnaSoapAction('urn:schemas-upnp-org:service:RenderingControl:1', 'GetVolume', `<InstanceID>0</InstanceID><Channel>Master</Channel>`, true),
                this.dlnaSoapAction('urn:schemas-upnp-org:service:RenderingControl:1', 'GetMute', `<InstanceID>0</InstanceID><Channel>Master</Channel>`, true),
                this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'GetMediaInfo', `<InstanceID>0</InstanceID>`, true)
            ]);

            const position = this.timeToSeconds(posInfo['u:GetPositionInfoResponse']?.RelTime || '00:00:00');
            const duration = this.timeToSeconds(mediaInfo['u:GetMediaInfoResponse']?.MediaDuration || '00:00:00');
            const isPlaying = transInfo['u:GetTransportInfoResponse']?.CurrentTransportState === 'PLAYING';
            const volume = parseInt(volInfo['u:GetVolumeResponse']?.CurrentVolume || '50', 10) / 100;

            // Handle mute state - some devices don't support GetMute, others report incorrectly
            let muted = false;
            try {
                muted = muteInfo['u:GetMuteResponse']?.CurrentMute === '1';
            } catch {
                // If GetMute fails, consider volume 0 as muted
                muted = volume === 0;
            }

            // Some devices report mute status incorrectly, use volume as fallback
            if (!muted && volume === 0) {
                muted = true;
            }

            return {position, duration, isPlaying, volume, muted};
        } catch (err) {
            console.warn('Error getting DLNA status:', err);
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
     * Starts polling for playback status updates.
     */
    private startPolling(): void {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }

        const poll = async () => {
            try {
                if (!await this.checkNetworkAndDevice()) {
                    console.log('Network/device check failed, disconnecting');
                    this.disconnect();
                    return;
                }

                const status = await this.getStatus();
                this.emit('stateChanged', status);
                this.emit('progressChanged', status.position);

                console.log(`Poll update - Position: ${Math.floor(status.position)}s/${Math.floor(status.duration)}s, Playing: ${status.isPlaying}`);

            } catch (err) {
                console.warn('Polling error:', err);
            }

            // Always schedule next poll with consistent interval
            this.pollingInterval = setTimeout(poll, CastConfig.DEFAULT_POLL_INTERVAL);
        };

        // Start first poll immediately
        console.log(`Starting polling every ${CastConfig.DEFAULT_POLL_INTERVAL}ms`);
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
            return response.ok;
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
            // Use specific DLNA profile for MP4 (H.264/AAC is common)
            protocolInfo = `http-get:*:${mimeType}:DLNA.ORG_PN=MPEG4_P2_MP4_ASP_AAC;DLNA.ORG_OP=01;DLNA.ORG_CI=0`;

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
            protocolInfo = `http-get:*:${mimeType}:DLNA.ORG_PN=MP3;DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01500000000000000000000000000000`;
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

            console.log('Force status update:', status);
        } catch (err) {
            console.warn('Force status update failed:', err);
            // Don't emit error, regular polling will handle it
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
            console.warn('Error extracting device icon:', err);
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
        } else {
            const baseUrl = baseLocation.replace(/\/desc\.xml$/, '').replace(/\/+$/, '');
            return `${baseUrl}${iconPath.startsWith('/') ? '' : '/'}${iconPath}`;
        }
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