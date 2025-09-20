import {Device} from './types/Device';
import {MediaInfo} from './types/MediaInfo';
import {EventEmitter} from 'events';
import Udp from 'react-native-udp';
import {XMLParser} from "fast-xml-parser";
import NetInfo from '@react-native-community/netinfo';
import {Buffer} from 'buffer';
import {initTranslate} from "../localization/translate";

// Constants for SSDP discovery
const MULTICAST_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const SEARCH_TARGET_ALL = 'ssdp:all';
const DLNA_RENDERER_ST = 'urn:schemas-upnp-org:device:MediaRenderer:1';

export interface PlaybackState {
    position: number; // Current playback position in seconds
    duration: number; // Media duration in seconds
    isPlaying: boolean; // Is media playing
    volume: number; // Volume (0-1)
    muted: boolean; // Mute state
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

    constructor() {
        super();
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
    async startSearch(duration: number = 30000): Promise<void> {
        if (this.searching) return;
        const state = await NetInfo.fetch();
        if (!state.isConnected) {
            this.emit('error', this.i18n.t('error.noNetwork'));
            return;
        }
        this.emit('searchStarted');
        this.searching = true;
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
        if (this.timeout) clearTimeout(this.timeout);
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        // Clean up listeners
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
        this.emit('searchStopped');
    }

    /**
     * Connects to a casting device.
     * @param device - The device to connect to.
     */
    async connect(device: Device): Promise<void> {
        this.currentDevice = device;
        try {
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
        this.currentMediaUri = mediaInfo.contentUrl;
        try {
            // Build basic DIDL metadata for images/videos (helps DLNA renderers like Kodi)
            const didlMetadata = this.buildDIDLMetadata(mediaInfo);
            await this.dlnaSetAVTransportURI(mediaInfo.contentUrl, didlMetadata);
            await this.dlnaPlay();
            this.emit('castingStarted');
        } catch (err) {
            this.emit('error', this.i18n.t('error.cast', {message: (err as Error).message}));
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
            const mediaInfo = await this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'GetMediaInfo', `<InstanceID>0</InstanceID>`);
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
        try {
            await this.dlnaSeek(this.secondsToTime(position));
        } catch (err) {
            this.emit('error', this.i18n.t('error.seek', {message: (err as Error).message}));
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
     * Get detected devices
     * @returns an array of Device
     */
    getDevices(): Device[] {
        return Array.from(this.devices.values());
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
        const headers = this.parseHeaders(response);
        const st = headers['ST'];
        const location = headers['LOCATION'];
        const usn = headers['USN']?.trim(); // Normalize USN

        // Validate headers and check for duplicates early
        if (!st || !location || !usn) {
            this.emit('error', this.i18n.t('error.invalidSsdpResponse', {message: 'Missing ST, LOCATION, or USN'}));
            return;
        }
        if (this.devices.has(usn)) return; // Skip if device already exists

        // Only process DLNA devices
        if (st !== DLNA_RENDERER_ST) {
            return;
        }

        try {
            const descRes = await fetch(location);
            const descXml = await descRes.text();
            const parsed = this.xmlParser.parse(descXml);
            if (!parsed || !parsed.root || !parsed.root.device) {
                return;
            }
            const friendlyName = parsed.root.device?.friendlyName || 'Unknown Device';
            const device: Device = {
                id: usn,
                name: friendlyName,
                location,
                ip: rinfo.address,
                port: rinfo.port,
                services: this.extractServices(parsed),
            };

            this.devices.set(usn, device);
            this.emit('deviceAdded', device);
        } catch (err) {
            this.emit('error', this.i18n.t('error.description', {message: (err as Error).message}));
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
            const [key, value] = lines[i].split(': ');
            if (key && value) headers[key.toUpperCase()] = value.trim();
        }
        return headers;
    }

    /**
     * Extracts services from parsed XML.
     * @param parsed - The parsed XML object.
     * @returns A record of service types and URLs.
     */
    private extractServices(parsed: any): Record<string, string> {
        const services: Record<string, string> = {};
        const serviceList = parsed.root.device?.serviceList?.service || [];
        serviceList.forEach((service: any) => {
            const type = service.serviceType;
            const controlUrl = service.controlURL;
            if (type && controlUrl && (type.includes('AVTransport') || type.includes('RenderingControl'))) {
                services[type] = controlUrl;
            }
        });
        return services;
    }


    /**
     * Performs a DLNA SOAP action.
     * @param serviceType - The service type.
     * @param action - The action to perform.
     * @param body - The SOAP body.
     */
    private async dlnaSoapAction(serviceType: string, action: string, body: string): Promise<any> {
        const device = this.currentDevice!;
        // Fix potential double slashes in service URL
        const baseUrl = device.location.replace(/\/desc\.xml$/, '').replace(/\/+$/, '');
        const servicePath = device.services![serviceType].replace(/^\/+/, '');
        const serviceUrl = `${baseUrl}/${servicePath}`;
        try {
            const response = await fetch(serviceUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/xml; charset="utf-8"',
                    'SOAPACTION': `"${serviceType}#${action}"`,
                },
                body: this.wrapSoapBody(serviceType, action, body),
            });
            if (!response.ok) {
                const errorText = await response.text();
                console.error('SOAP error body:', errorText);
                this.emit('error', this.i18n.t('error.dlnaSoap', {message: `HTTP ${response.status}: ${errorText}`}));
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            const xml = await response.text();
            const parsed = this.xmlParser.parse(xml);
            if (!parsed || !parsed["s:Envelope"]?.["s:Body"]) {
                console.error('Invalid SOAP response structure');
                throw new Error("Invalid SOAP response structure");
            }
            return parsed['s:Envelope']['s:Body'];
        } catch (err) {
            console.error(`SOAP action ${action} failed:`, (err as Error).message);
            throw err;
        }
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
    async dlnaSetMute(muted: boolean): Promise<void> {
        await this.dlnaSoapAction('urn:schemas-upnp-org:service:RenderingControl:1', 'SetMute', `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>${muted ? 1 : 0}</DesiredMute>`);
    }

    /**
     * Gets the playback status for a DLNA device.
     * @returns A promise resolving to the playback state.
     */
    private async dlnaGetStatus(): Promise<PlaybackState> {
        const posInfo = await this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'GetPositionInfo', `<InstanceID>0</InstanceID>`);
        if (!posInfo) {
            return {position: 0, duration: 1000, isPlaying: false, volume: 0.5, muted: false};
        }
        const transInfo = await this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'GetTransportInfo', `<InstanceID>0</InstanceID>`);
        if (!transInfo) {
            return {position: 0, duration: 1000, isPlaying: false, volume: 0.5, muted: false};
        }
        const volInfo = await this.dlnaSoapAction('urn:schemas-upnp-org:service:RenderingControl:1', 'GetVolume', `<InstanceID>0</InstanceID><Channel>Master</Channel>`);
        if (!volInfo) {
            return {position: 0, duration: 1000, isPlaying: false, volume: 0.5, muted: false};
        }
        const muteInfo = await this.dlnaSoapAction('urn:schemas-upnp-org:service:RenderingControl:1', 'GetMute', `<InstanceID>0</InstanceID><Channel>Master</Channel>`);
        if (!muteInfo) {
            return {position: 0, duration: 1000, isPlaying: false, volume: 0.5, muted: false};
        }
        const mediaInfo = await this.dlnaSoapAction('urn:schemas-upnp-org:service:AVTransport:1', 'GetMediaInfo', `<InstanceID>0</InstanceID>`);
        if (!mediaInfo) {
            return {position: 0, duration: 1000, isPlaying: false, volume: 0.5, muted: false};
        }

        const position = this.timeToSeconds(posInfo['u:GetPositionInfoResponse'].RelTime || '00:00:00');
        const duration = this.timeToSeconds(mediaInfo['u:GetMediaInfoResponse'].MediaDuration || '00:00:00');
        const isPlaying = transInfo['u:GetTransportInfoResponse'].CurrentTransportState === 'PLAYING';
        const volume = parseInt(volInfo['u:GetVolumeResponse'].CurrentVolume, 10) / 100;
        const muted = muteInfo['u:GetMuteResponse'].CurrentMute === '1';

        return {position, duration, isPlaying, volume, muted};
    }

    /**
     * Converts seconds to a time string (HH:MM:SS).
     * @param seconds - The time in seconds.
     * @returns The formatted time string.
     */
    private secondsToTime(seconds: number): string {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    /**
     * Converts a time string (HH:MM:SS) to seconds.
     * @param time - The time string.
     * @returns The time in seconds.
     */
    private timeToSeconds(time: string): number {
        const [h, m, s] = time.split(':').map(Number);
        return h * 3600 + m * 60 + s;
    }

    /**
     * Starts polling for playback status updates.
     */
    private startPolling(): void {
        if (this.pollingInterval) clearInterval(this.pollingInterval);
        this.pollingInterval = setInterval(async () => {
            try {
                const status = await this.getStatus();
                this.emit('stateChanged', status);
                this.emit('progressChanged', status.position);
            } catch {
            }
        }, 1000);
    }

    /**
     * Builds basic DIDL-Lite metadata for the media item (required for images and videos in DLNA)
     * @param mediaInfo - Media info
     * @returns DIDL XML string
     */
    private buildDIDLMetadata(mediaInfo: MediaInfo): string {
        let upnpClass = 'object.item';
        let protocolInfo = 'http-get:*:*:'; // Fallback
        let mimeType = mediaInfo.contentType || '*';
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
                const h = Math.floor(durationSeconds / 3600);
                const m = Math.floor((durationSeconds % 3600) / 60);
                const s = durationSeconds % 60;
                const durationStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                protocolInfo += `;DLNA.ORG_FLAGS=01500000000000000000000000000000`; // Streaming flags
                return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="media-${Date.now()}" parentID="0" restricted="true"><dc:title>${mediaInfo.metadata?.title || mediaInfo.contentUrl.split('/').pop() || 'Media'}</dc:title><upnp:class>${upnpClass}</upnp:class><res protocolInfo="${protocolInfo}" duration="${durationStr}">${mediaInfo.contentUrl}</res></item></DIDL-Lite>`;
            }
        }

        // Use metadata.title if available, fallback to filename from contentUrl
        const title = mediaInfo.metadata?.title || mediaInfo.contentUrl.split('/').pop() || 'Media';

        return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="media-${Date.now()}" parentID="0" restricted="true"><dc:title>${title}</dc:title><upnp:class>${upnpClass}</upnp:class><res protocolInfo="${protocolInfo}">${mediaInfo.contentUrl}</res></item></DIDL-Lite>`;
    }
}