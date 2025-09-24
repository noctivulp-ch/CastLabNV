import {Device, DeviceCapabilities} from '../types/Device';
import {MediaInfo} from '../types/MediaInfo';
import {initTranslate} from "../../localization/translate";

/**
 * Utility functions for DLNA casting operations
 */

export class CastUtils {
    private static i18n = initTranslate();

    /**
     * Validates if a media URL is accessible
     * @param url - The media URL to validate
     * @returns Promise resolving to boolean indicating accessibility
     */
    static async validateMediaUrl(url: string): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(url, {
                method: 'HEAD',
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Determines the MIME type from a URL or file extension
     * @param url - The media URL
     * @returns The determined MIME type
     */
    static getMimeTypeFromUrl(url: string): string {
        const extension = url.split('.').pop()?.toLowerCase();

        const mimeTypes: Record<string, string> = {
            // Video formats
            'mp4': 'video/mp4',
            'm4v': 'video/mp4',
            'avi': 'video/x-msvideo',
            'mkv': 'video/x-matroska',
            'mov': 'video/quicktime',
            'wmv': 'video/x-ms-wmv',
            'flv': 'video/x-flv',
            'webm': 'video/webm',
            '3gp': 'video/3gpp',

            // Audio formats
            'mp3': 'audio/mpeg',
            'aac': 'audio/aac',
            'ogg': 'audio/ogg',
            'wav': 'audio/wav',
            'flac': 'audio/flac',
            'm4a': 'audio/mp4',
            'wma': 'audio/x-ms-wma',

            // Image formats
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'bmp': 'image/bmp',
            'webp': 'image/webp',
            'tiff': 'image/tiff',
        };

        return extension ? (mimeTypes[extension] || 'application/octet-stream') : 'application/octet-stream';
    }

    /**
     * Validates media info for casting compatibility
     * @param mediaInfo - The media information to validate
     * @returns Validation result with errors if any
     */
    static validateMediaInfo(mediaInfo: MediaInfo): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!mediaInfo.contentUrl) {
            errors.push('Content URL is required');
        } else {
            try {
                new URL(mediaInfo.contentUrl);
            } catch {
                errors.push('Invalid content URL format');
            }
        }

        if (!mediaInfo.contentType) {
            // Try to auto-detect
            mediaInfo.contentType = this.getMimeTypeFromUrl(mediaInfo.contentUrl);
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Checks if a device supports specific media type
     * @param device - The DLNA device
     * @param mediaType - The media MIME type
     * @returns Boolean indicating support
     */
    static deviceSupportsMediaType(device: Device, mediaType: string): boolean {
        const supportedTypes = [
            'video/mp4',
            'audio/mpeg',
            'image/jpeg',
            'image/png'
        ];

        return supportedTypes.includes(mediaType);
    }

    /**
     * Extracts device capabilities from services
     * @param device - The DLNA device
     * @returns Device capabilities object
     */
    static getDeviceCapabilities(device: Device): DeviceCapabilities {
        const hasAVTransport = Object.keys(device.services).some(service =>
            service.includes('AVTransport')
        );
        const hasRenderingControl = Object.keys(device.services).some(service =>
            service.includes('RenderingControl')
        );

        return {
            canPlay: hasAVTransport,
            canPause: hasAVTransport,
            canSeek: hasAVTransport,
            canSetVolume: hasRenderingControl,
            canMute: hasRenderingControl,
            supportedFormats: ['video/mp4', 'audio/mpeg', 'image/jpeg', 'image/png'],
            supportedProtocols: ['http-get:*:*:*', 'http-get:*:video/mp4:*'],
        };
    }

    /**
     * Formats device information for display
     * @param device - The DLNA device
     * @returns Formatted device info string
     */
    static formatDeviceInfo(device: Device): string {
        const parts = [];

        if (device.manufacturer) {
            parts.push(device.manufacturer);
        }

        if (device.modelName) {
            parts.push(device.modelName);
        }

        if (device.ip) {
            parts.push(`(${device.ip})`);
        }

        return parts.join(' ') || 'Unknown Device';
    }

    /**
     * Calculates network signal strength (simplified)
     * @param device - The DLNA device
     * @returns Signal strength as percentage (0-100)
     */
    static async calculateSignalStrength(device: Device): Promise<number> {
        try {
            const start = Date.now();
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            const response = await fetch(device.location, {
                method: 'HEAD',
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            const duration = Date.now() - start;

            if (!response.ok) return 0;

            // Simple calculation based on response time
            // < 100ms = 100%, 100-500ms = 80%, 500-1000ms = 60%, >1000ms = 40%
            if (duration < 100) return 100;
            if (duration < 500) return 80;
            if (duration < 1000) return 60;
            return 40;
        } catch {
            return 0;
        }
    }

    /**
     * Generates a user-friendly error message using translation system
     * @param error - The error object or message
     * @returns User-friendly error message
     */
    static formatErrorMessage(error: Error | string): string {
        const message = typeof error === 'string' ? error : error.message;

        // Map technical errors to translation keys
        if (message.toLowerCase().includes('network request failed')) {
            return this.i18n.t('error.noNetwork');
        }
        if (message.toLowerCase().includes('timeout')) {
            return this.i18n.t('error.networkTimeout');
        }
        if (message.includes('HTTP 404')) {
            return this.i18n.t('error.invalidMedia');
        }
        if (message.includes('HTTP 403')) {
            return this.i18n.t('error.invalidMedia');
        }
        if (message.includes('HTTP 500')) {
            return this.i18n.t('error.temporaryFailure');
        }
        if (message.toLowerCase().includes('connection refused')) {
            return this.i18n.t('error.deviceUnreachable');
        }
        if (message.toLowerCase().includes('invalid soap response')) {
            return this.i18n.t('error.temporaryFailure');
        }
        if (message.toLowerCase().includes('action failed') || message.includes('501')) {
            return this.i18n.t('error.deviceBusy');
        }
        if (message.includes('711')) {
            return this.i18n.t('error.seekPosition');
        }
        if (message.includes('714')) {
            return this.i18n.t('error.unsupportedFormat');
        }
        if (message.includes('718')) {
            return this.i18n.t('error.unsupportedFormat');
        }

        // Return original message if no mapping found
        return message || this.i18n.t('error.single');
    }

    /**
     * Debounce function for limiting rapid function calls
     * @param func - The function to debounce
     * @param wait - The number of milliseconds to delay
     * @returns Debounced function
     */
    static debounce<T extends (...args: any[]) => any>(
        func: T,
        wait: number
    ): (...args: Parameters<T>) => void {
        let timeout: NodeJS.Timeout | null = null;

        return (...args: Parameters<T>) => {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }

    /**
     * Throttle function for limiting function execution frequency
     * @param func - The function to throttle
     * @param limit - The number of milliseconds to limit execution
     * @returns Throttled function
     */
    static throttle<T extends (...args: any[]) => any>(
        func: T,
        limit: number
    ): (...args: Parameters<T>) => void {
        let inThrottle: boolean;

        return (...args: Parameters<T>) => {
            if (!inThrottle) {
                func(...args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    /**
     * Validates network connectivity without external calls
     * @returns Promise resolving to connectivity status
     */
    static async checkNetworkConnectivity(): Promise<boolean> {
        try {
            // Check if navigator.onLine is available (web/react-native-web)
            if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
                return navigator.onLine;
            }

            // For React Native, use NetInfo if available
            const NetInfo = require('@react-native-community/netinfo');
            if (NetInfo) {
                const state = await NetInfo.fetch();
                return state.isConnected;
            }

            // Fallback - assume connected
            return true;
        } catch {
            // If all checks fail, assume connected
            return true;
        }
    }

    /**
     * Generates a unique identifier
     * @returns Unique string identifier
     */
    static generateUniqueId(): string {
        return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Safely parses JSON with fallback
     * @param jsonString - The JSON string to parse
     * @param fallback - Fallback value if parsing fails
     * @returns Parsed object or fallback
     */
    static safeJsonParse<T>(jsonString: string, fallback: T): T {
        try {
            return JSON.parse(jsonString);
        } catch {
            return fallback;
        }
    }

    /**
     * Formats duration in seconds to readable string
     * @param seconds - Duration in seconds
     * @returns Formatted duration string (e.g., "1:23:45")
     */
    static formatDuration(seconds: number): string {
        if (isNaN(seconds) || seconds < 0) return '0:00';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
        }
    }

    /**
     * Converts percentage to volume value (0-1)
     * @param percentage - Volume percentage (0-100)
     * @returns Volume value (0-1)
     */
    static percentageToVolume(percentage: number): number {
        return Math.max(0, Math.min(1, percentage / 100));
    }

    /**
     * Converts volume value to percentage
     * @param volume - Volume value (0-1)
     * @returns Volume percentage (0-100)
     */
    static volumeToPercentage(volume: number): number {
        return Math.round(Math.max(0, Math.min(100, volume * 100)));
    }
}