import {Device} from "../types/Device";
import {MediaInfo} from "../types/MediaInfo";
import {initTranslate} from "../../localization/translate";

/**
 * Map of file extensions to MIME types supported for casting (DLNA/FCast).
 * Used both for MIME detection and as a whitelist to filter real media.
 */
export const SUPPORTED_MEDIA_EXTENSIONS: Record<string, string> = {
    // Video formats
    'mp4': 'video/mp4',
    'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska',
    'mov': 'video/quicktime',
    'webm': 'video/webm',
    '3gp': 'video/3gpp',
    'm4v': 'video/mp4',
    'mts': 'video/mp2t',
    // Streaming formats
    'm3u8': 'application/vnd.apple.mpegurl',
    'm3u': 'audio/mpegurl',
    // Audio formats
    'mp3': 'audio/mpeg',
    'aac': 'audio/aac',
    'm4a': 'audio/mp4',
    'ogg': 'audio/ogg',
    'wav': 'audio/wav',
    'flac': 'audio/flac',
    'wma': 'audio/x-ms-wma',
    'opus': 'audio/opus',
    // Image formats
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'bmp': 'image/bmp',
    'webp': 'image/webp',
    'tiff': 'image/tiff',
    'tif': 'image/tiff',
};

export class CastUtils {
    private static i18n = initTranslate();

    static getMimeTypeFromUrl(url: string): string {
        const extension = url.split('.').pop()?.toLowerCase();
        return extension ? (SUPPORTED_MEDIA_EXTENSIONS[extension] || 'application/octet-stream') : 'application/octet-stream';
    }

    /**
     * Returns the first matching extension for a MIME type, or empty string.
     */
    static getExtensionFromMimeType(mimeType: string): string {
        const entry = Object.entries(SUPPORTED_MEDIA_EXTENSIONS).find(([, mime]) => mime === mimeType);
        return entry ? entry[0] : '';
    }

    /**
     * Checks if a file extension is a supported castable media format.
     */
    static isSupportedExtension(filename: string): boolean {
        const ext = filename?.split('.').pop()?.toLowerCase();
        return !!ext && ext in SUPPORTED_MEDIA_EXTENSIONS;
    }

    static validateMediaInfo(mediaInfo: MediaInfo): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];
        if (!mediaInfo.contentUrl) errors.push('Content URL is required');
        return {isValid: errors.length === 0, errors};
    }

    static deviceSupportsMediaType(device: Device, mediaType: string): boolean {
        return ['video/mp4', 'audio/mpeg', 'image/jpeg', 'image/png'].includes(mediaType);
    }

    static formatErrorMessage(error: Error | string): string {
        const message = typeof error === 'string' ? error : error.message;
        if (message.includes('501')) return this.i18n.t('error.deviceBusy');
        return message || this.i18n.t('error.single');
    }

    static formatDuration(seconds: number): string {
        if (isNaN(seconds) || seconds < 0) return '0:00';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return hours > 0 ?
            `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}` :
            `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    static volumeToPercentage(volume: number): number {
        return Math.round(Math.max(0, Math.min(100, volume * 100)));
    }

    static debounce<T extends (...args: any[]) => any>(func: T, wait: number) {
        let timeout: NodeJS.Timeout | null = null;
        return (...args: Parameters<T>) => {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }

    static generateUniqueId(): string {
        return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}