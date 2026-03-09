export type DeviceProtocol = 'dlna' | 'fcast';

export interface Device {
    id: string;
    name: string;
    location: string;
    ip: string;
    port: number;
    services: Record<string, string>;
    manufacturer?: string;
    modelName?: string;
    capabilities?: string[];
    iconUrl?: string; // Single icon URL for display
    protocol: DeviceProtocol; // Protocol used by this device
}

export interface DeviceCapabilities {
    canPlay: boolean;
    canPause: boolean;
    canSeek: boolean;
    canSetVolume: boolean;
    canMute: boolean;
    supportedFormats: string[];
}

export enum DeviceConnectionState {
    DISCONNECTED = 'disconnected',
    CONNECTING = 'connecting',
    CONNECTED = 'connected',
    ERROR = 'error'
}

export enum DeviceType {
    MEDIA_RENDERER = 'MediaRenderer',
    MEDIA_SERVER = 'MediaServer',
    UNKNOWN = 'Unknown'
}