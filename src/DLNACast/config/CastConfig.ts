/**
 * Configuration constants and settings for DLNA casting
 */

export const CastConfig = {
    // Network settings
    MULTICAST_ADDRESS: '239.255.255.250',
    SSDP_PORT: 1900,

    // Search settings
    DEFAULT_SEARCH_DURATION: 30000, // 30 seconds
    MAX_SEARCH_DURATION: 120000, // 2 minutes
    SEARCH_RETRY_INTERVAL: 5000, // 5 seconds

    // SSDP settings
    SEARCH_TARGET_ALL: 'ssdp:all',
    DLNA_RENDERER_ST: 'urn:schemas-upnp-org:device:MediaRenderer:1',
    DLNA_SERVER_ST: 'urn:schemas-upnp-org:device:MediaServer:1',

    // Request timeouts
    REQUEST_TIMEOUT: 10000, // 10 seconds
    DESCRIPTION_TIMEOUT: 5000, // 5 seconds
    CONNECTIVITY_CHECK_TIMEOUT: 10000, // 10 seconds

    // Retry settings
    MAX_RETRY_ATTEMPTS: 3,
    RETRY_DELAY_BASE: 1000, // 1 second base delay

    // Caching
    CACHE_TTL: 5000, // 5 seconds
    CACHE_CLEANUP_INTERVAL: 30000, // 30 seconds

    // Polling settings
    DEFAULT_POLL_INTERVAL: 1000,

    // Error handling
    ERROR_AUTO_DISMISS_DELAY: 5000, // 5 seconds
    MAX_ERROR_MESSAGE_LENGTH: 200,

    // UI settings
    DEVICE_LIST_UPDATE_DEBOUNCE: 300, // 300ms
    PROGRESS_UPDATE_THROTTLE: 200, // 200ms

    // Media validation
    MAX_MEDIA_URL_LENGTH: 2048,
    SUPPORTED_VIDEO_FORMATS: [
        'video/mp4',
        'video/x-msvideo', // avi
        'video/x-matroska', // mkv
        'video/quicktime', // mov
        'video/webm',
        'video/3gpp'
    ],
    SUPPORTED_AUDIO_FORMATS: [
        'audio/mpeg', // mp3
        'audio/mp4', // m4a
        'audio/aac',
        'audio/ogg',
        'audio/wav',
        'audio/flac'
    ],
    SUPPORTED_IMAGE_FORMATS: [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/bmp',
        'image/webp'
    ],

    // DLNA protocol info templates
    DLNA_PROTOCOL_INFO: {
        VIDEO_MP4: 'http-get:*:video/mp4:DLNA.ORG_PN=MPEG4_P2_MP4_ASP_AAC;DLNA.ORG_OP=01;DLNA.ORG_CI=0',
        AUDIO_MP3: 'http-get:*:audio/mpeg:DLNA.ORG_PN=MP3;DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01500000000000000000000000000000',
        IMAGE_JPEG: 'http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_SM;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=00D00000000000000000000000000000',
        IMAGE_PNG: 'http-get:*:image/png:DLNA.ORG_PN=PNG_LRG;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=00D00000000000000000000000000000',
        GENERIC: 'http-get:*:*:*'
    },

    // SOAP service types
    SOAP_SERVICES: {
        AV_TRANSPORT: 'urn:schemas-upnp-org:service:AVTransport:1',
        RENDERING_CONTROL: 'urn:schemas-upnp-org:service:RenderingControl:1',
        CONNECTION_MANAGER: 'urn:schemas-upnp-org:service:ConnectionManager:1'
    },

    // UPnP device types
    DEVICE_TYPES: {
        MEDIA_RENDERER: 'urn:schemas-upnp-org:device:MediaRenderer:1',
        MEDIA_SERVER: 'urn:schemas-upnp-org:device:MediaServer:1'
    },

    // Volume settings
    VOLUME: {
        MIN: 0,
        MAX: 100,
        DEFAULT: 50,
        STEP: 5
    },

    // Seek settings
    SEEK: {
        STEP_SMALL: 10, // 10 seconds
        STEP_MEDIUM: 30, // 30 seconds
        STEP_LARGE: 60 // 1 minute
    },

    // Transport states
    TRANSPORT_STATES: {
        STOPPED: 'STOPPED',
        PLAYING: 'PLAYING',
        PAUSED_PLAYBACK: 'PAUSED_PLAYBACK',
        TRANSITIONING: 'TRANSITIONING',
        NO_MEDIA_PRESENT: 'NO_MEDIA_PRESENT'
    }
};

/**
 * Development/Debug configuration
 */
export const DebugConfig = {
    ENABLE_LOGGING: __DEV__,
    ENABLE_VERBOSE_LOGGING: false,
    ENABLE_SOAP_LOGGING: false,
    ENABLE_NETWORK_LOGGING: false,

    // Mock settings for development
    ENABLE_MOCK_DEVICES: false,
    MOCK_DEVICE_COUNT: 3,
    MOCK_SEARCH_DELAY: 2000
};

/**
 * Feature flags for experimental features
 */
export const FeatureFlags = {
    ENABLE_DEVICE_CACHING: true,
    ENABLE_AUTO_RECONNECT: true,
    ENABLE_QUALITY_SELECTION: false,
    ENABLE_SUBTITLES: false,
    ENABLE_PLAYLIST: false,
    ENABLE_DEVICE_GROUPS: false
};