export interface MediaMetadata {
    type?: 'movie' | 'tvShow' | 'musicTrack' | 'photo'; // Metadata type
    title?: string; // Media title
    subtitle?: string; // Optional subtitle
    images?: Array<{ url: string; width?: number; height?: number }>; // Optional images
}

export interface MediaInfo {
    contentUrl: string; // Media URL
    contentType?: string; // MIME type, e.g., 'video/mp4'
    metadata?: MediaMetadata; // Optional metadata
    streamDuration?: number; // Optional duration for videos
}