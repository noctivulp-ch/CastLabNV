/**
 * Service for extracting video URLs from web pages
 * Parses HTML to find direct video sources without executing JavaScript
 * Supports PeerTube and Invidious platforms via their APIs
 */

export interface ExtractedVideo {
    id: string;
    url: string;
    title: string;
    thumbnail?: string;
    format?: string;
    source: 'video-tag' | 'direct-link' | 'data-attribute' | 'm3u-playlist';
}

export interface ExtractionResult {
    success: boolean;
    videos: ExtractedVideo[];
    error?: string;
    pageTitle?: string;
}

export class VideoExtractorService {
    // Supported video extensions
    private static readonly VIDEO_EXTENSIONS = [
        'mp4', 'webm', 'm4v', 'mov', 'avi', 'mkv', 'flv', 'wmv', 'mpg', 'mpeg'
    ];

    // Common data attributes that may contain video URLs
    private static readonly VIDEO_DATA_ATTRIBUTES = [
        'data-src',
        'data-video-src',
        'data-video-url',
        'data-url',
        'data-file',
        'data-video',
    ];

    // M3U/M3U8 playlist file extensions
    private static readonly M3U_EXTENSIONS = ['m3u', 'm3u8'];

    // Default Invidious instance
    private static DEFAULT_INVIDIOUS_INSTANCE = 'https://yewtu.be';

    // Fallback Invidious instances (used when primary instance fails)
    private static FALLBACK_INVIDIOUS_INSTANCES = [
        'https://yewtu.be',
        'https://inv.tux.pizza',
        'https://invidious.fdn.fr',
        'https://iv.nboeck.de',
        'https://invidious.jing.rocks',
        'https://inv.us.projectsegfau.lt',
        'https://invidious.privacydev.net',
        'https://vid.puffyan.us',
        'https://inv.riverside.rocks',
        'https://invidious.flokinet.to',
        'https://yt.artemislena.eu',
        'https://invidious.projectsegfau.lt',
        'https://inv.bp.projectsegfau.lt',
        'https://invidious.io.lol',
        'https://iv.ggtyler.dev',
    ];

    // Cache for dynamically fetched instances
    private static cachedInvidiousInstances: string[] | null = null;
    private static instancesCacheTimestamp: number = 0;
    private static INSTANCES_CACHE_DURATION = 3600000; // 1 hour

    // User-defined Invidious instance
    private static customInvidiousInstance: string | null = null;

    /**
     * Set custom Invidious instance for YouTube URL conversion
     * @param instance - Custom Invidious instance URL (e.g., 'https://invidious.fdn.fr')
     */
    static setInvidiousInstance(instance: string | null) {
        if (instance) {
            // Normalize the instance URL
            const normalized = instance.trim().replace(/\/$/, ''); // Remove trailing slash
            if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
                this.customInvidiousInstance = normalized;
            } else {
                this.customInvidiousInstance = `https://${normalized}`;
            }
        } else {
            this.customInvidiousInstance = null;
        }
    }

    /**
     * Get current Invidious instance (custom or default)
     */
    static getInvidiousInstance(): string {
        return this.customInvidiousInstance || this.DEFAULT_INVIDIOUS_INSTANCE;
    }

    /**
     * Extract videos from a given URL
     * @param url - The webpage URL to extract videos from
     * @returns Promise with extraction results
     */
    static async extractFromUrl(url: string): Promise<ExtractionResult> {
        try {
            // Normalize URL (add https:// if missing)
            let normalizedUrl = this.normalizeUrl(url);

            // Validate normalized URL
            if (!this.isValidUrl(normalizedUrl)) {
                return {
                    success: false,
                    videos: [],
                    error: 'Invalid URL format',
                };
            }

            // Check if it's a YouTube URL BEFORE converting
            const isYouTube = this.isYouTubeUrl(normalizedUrl);

            // Convert YouTube URLs to Invidious
            if (isYouTube) {
                const invidiousUrl = this.convertYouTubeToInvidious(normalizedUrl);
                if (invidiousUrl) {
                    normalizedUrl = invidiousUrl;
                    // Force Invidious extraction for converted YouTube URLs
                    return await this.extractFromInvidious(normalizedUrl);
                }
            }

            // Check if URL points to an M3U/M3U8 playlist
            if (this.isM3uUrl(normalizedUrl)) {
                return await this.extractFromM3u(normalizedUrl);
            }

            // Try platform-specific extractors for non-YouTube URLs
            const platform = this.detectPlatform(normalizedUrl);
            if (platform !== 'unknown') {
                const platformResult = await this.extractFromPlatform(normalizedUrl, platform);
                if (platformResult.success) {
                    return platformResult;
                }
                // If platform extraction fails, fall back to HTML parsing
            }

            // Fallback: Fetch content and parse
            const html = await this.fetchHtml(normalizedUrl);

            // Check if content is actually an M3U playlist served without .m3u extension
            if (this.isM3uContent(html)) {
                return this.parseM3uPlaylist(html, normalizedUrl);
            }

            // Parse HTML and extract videos
            const videos = this.parseHtml(html, normalizedUrl);

            // Extract page title
            const pageTitle = this.extractPageTitle(html);

            return {
                success: true,
                videos,
                pageTitle,
            };
        } catch (error) {
            console.error('Video extraction error:', error);
            return {
                success: false,
                videos: [],
                error: (error as Error).message,
            };
        }
    }

    /**
     * Check if URL is a YouTube URL
     */
    private static isYouTubeUrl(url: string): boolean {
        const lowerUrl = url.toLowerCase();
        return lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be');
    }

    /**
     * Fetch list of working Invidious instances from the official API
     */
    private static async fetchInvidiousInstances(): Promise<string[]> {
        try {
            // Check cache first
            const now = Date.now();
            if (this.cachedInvidiousInstances &&
                (now - this.instancesCacheTimestamp) < this.INSTANCES_CACHE_DURATION) {
                return this.cachedInvidiousInstances;
            }

            // Create timeout controller - increased to 10s for slow API
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            try {
                // Fetch from official Invidious API
                const response = await fetch('https://api.invidious.io/instances.json', {
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`Failed to fetch instances: ${response.status}`);
                }

                const instances = await response.json();

                // Filter for working instances with API enabled
                const workingInstances: string[] = [];

                for (const [domain, info] of Object.entries(instances as Record<string, [number, any]>)) {
                    const instanceInfo = info[1];

                    // Check if instance is up, has API enabled, and uses HTTPS
                    if (instanceInfo?.api === true &&
                        instanceInfo?.type === 'https' &&
                        domain.startsWith('http')) {
                        workingInstances.push(domain);
                    }
                }

                // Cache the results
                this.cachedInvidiousInstances = workingInstances;
                this.instancesCacheTimestamp = now;

                console.log(`Fetched ${workingInstances.length} working Invidious instances`);
                return workingInstances;
            } catch (fetchError) {
                clearTimeout(timeoutId);
                throw fetchError;
            }

        } catch (error) {
            console.warn('Failed to fetch Invidious instances, using fallback list:', error);
            return this.FALLBACK_INVIDIOUS_INSTANCES;
        }
    }

    /**
     * Convert YouTube URL to Invidious URL
     * @param youtubeUrl - YouTube URL to convert
     * @returns Invidious URL or null if not a YouTube URL
     */
    private static convertYouTubeToInvidious(youtubeUrl: string): string | null {
        const lowerUrl = youtubeUrl.toLowerCase();

        // Check if it's a YouTube URL
        if (!this.isYouTubeUrl(youtubeUrl)) {
            return null;
        }

        try {
            const urlObj = new URL(youtubeUrl);
            let videoId: string | null = null;

            // Extract video ID from various YouTube URL formats
            if (urlObj.hostname.includes('youtu.be')) {
                // Short URL: https://youtu.be/VIDEO_ID
                videoId = urlObj.pathname.substring(1).split(/[?#]/)[0];
            } else if (urlObj.hostname.includes('youtube.com')) {
                // Standard URL: https://www.youtube.com/watch?v=VIDEO_ID
                videoId = urlObj.searchParams.get('v');

                // Embed URL: https://www.youtube.com/embed/VIDEO_ID
                if (!videoId && urlObj.pathname.includes('/embed/')) {
                    videoId = urlObj.pathname.split('/embed/')[1].split(/[?#]/)[0];
                }

                // Short URL variant: https://www.youtube.com/v/VIDEO_ID
                if (!videoId && urlObj.pathname.includes('/v/')) {
                    videoId = urlObj.pathname.split('/v/')[1].split(/[?#]/)[0];
                }
            }

            if (!videoId) {
                return null;
            }

            // Build Invidious URL
            const invidiousInstance = this.getInvidiousInstance();
            return `${invidiousInstance}/watch?v=${videoId}`;

        } catch {
            return null;
        }
    }

    /**
     * Normalize URL by adding protocol if missing
     * @param url - URL to normalize
     * @returns Normalized URL with protocol
     */
    private static normalizeUrl(url: string): string {
        const trimmed = url.trim();

        // Already has protocol
        if (/^https?:\/\//i.test(trimmed)) {
            return trimmed;
        }

        // Protocol-relative URL (//example.com)
        if (trimmed.startsWith('//')) {
            return `https:${trimmed}`;
        }

        // Add https:// by default
        return `https://${trimmed}`;
    }

    /**
     * Validate URL format
     * @param url - URL to validate (should already be normalized)
     * @returns True if valid
     */
    private static isValidUrl(url: string): boolean {
        try {
            const urlObj = new URL(url);
            return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
        } catch {
            return false;
        }
    }

    /**
     * Detect platform from URL
     */
    private static detectPlatform(url: string): 'peertube' | 'invidious' | 'unknown' {
        const lowerUrl = url.toLowerCase();

        // PeerTube detection: /w/ or /videos/watch/ pattern
        if (lowerUrl.includes('/w/') || lowerUrl.includes('/videos/watch/')) {
            return 'peertube';
        }

        // Invidious detection: Check against known patterns and custom instance
        const customInstance = this.customInvidiousInstance?.toLowerCase();
        const defaultInstance = this.DEFAULT_INVIDIOUS_INSTANCE.toLowerCase();

        // Check if URL matches custom or default instance
        if (customInstance && lowerUrl.includes(customInstance.replace('https://', '').replace('http://', ''))) {
            return 'invidious';
        }

        if (lowerUrl.includes(defaultInstance.replace('https://', '').replace('http://', ''))) {
            return 'invidious';
        }

        // Check common Invidious patterns
        if (lowerUrl.includes('invidious') || lowerUrl.includes('/watch?v=')) {
            // Additional check: must have video ID parameter
            try {
                const urlObj = new URL(url);
                if (urlObj.searchParams.has('v')) {
                    return 'invidious';
                }
            } catch {
            }
        }

        return 'unknown';
    }

    /**
     * Extract from platform-specific API
     */
    private static async extractFromPlatform(
        url: string,
        platform: 'peertube' | 'invidious'
    ): Promise<ExtractionResult> {
        switch (platform) {
            case 'peertube':
                return this.extractFromPeerTube(url);
            case 'invidious':
                return this.extractFromInvidious(url);
            default:
                return {success: false, videos: [], error: 'Unknown platform'};
        }
    }

    /**
     * Extract video from PeerTube using API
     */
    private static async extractFromPeerTube(url: string): Promise<ExtractionResult> {
        try {
            const urlObj = new URL(url);
            const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

            // First, try to get video info from HTML metadata (JSON-LD)
            try {
                const html = await this.fetchHtml(url);
                const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);

                if (jsonLdMatch) {
                    const jsonLd = JSON.parse(jsonLdMatch[1]);

                    if (jsonLd['@type'] === 'VideoObject' && jsonLd.url) {
                        // Extract shortUUID from the canonical URL
                        const videoUrl = jsonLd.url;
                        let shortUUID: string | null = null;

                        if (videoUrl.includes('/w/')) {
                            shortUUID = videoUrl.split('/w/')[1].split(/[?#]/)[0];
                        } else if (videoUrl.includes('/videos/watch/')) {
                            shortUUID = videoUrl.split('/videos/watch/')[1].split(/[?#]/)[0];
                        }

                        if (shortUUID) {
                            // Try API with shortUUID
                            const apiUrl = `${baseUrl}/api/v1/videos/${shortUUID}`;
                            const response = await fetch(apiUrl);

                            if (response.ok) {
                                const data = await response.json();
                                return this.buildPeerTubeResult(data, baseUrl, shortUUID);
                            }
                        }

                        // Fallback: Create video from JSON-LD metadata if API fails
                        if (jsonLd.embedUrl) {
                            const videos: ExtractedVideo[] = [{
                                id: `peertube_${Date.now()}`,
                                url: jsonLd.embedUrl,
                                title: jsonLd.name || 'PeerTube Video',
                                thumbnail: jsonLd.thumbnailUrl || jsonLd.image,
                                format: 'Embed',
                                source: 'video-tag'
                            }];

                            return {
                                success: true,
                                videos,
                                pageTitle: jsonLd.name
                            };
                        }
                    }
                }
            } catch (htmlError) {
                console.warn('Failed to extract from HTML metadata:', htmlError);
            }

            // Fallback: Try direct API call with URL-extracted ID
            let videoId: string | null = null;
            if (url.includes('/w/')) {
                videoId = url.split('/w/')[1].split(/[?#]/)[0];
            } else if (url.includes('/videos/watch/')) {
                videoId = url.split('/videos/watch/')[1].split(/[?#]/)[0];
            }

            if (!videoId) {
                throw new Error('Could not extract PeerTube video ID');
            }

            const apiUrl = `${baseUrl}/api/v1/videos/${videoId}`;
            const response = await fetch(apiUrl);

            if (!response.ok) {
                throw new Error(`PeerTube API returned ${response.status}`);
            }

            const data = await response.json();
            return this.buildPeerTubeResult(data, baseUrl, videoId);

        } catch (error) {
            console.error('PeerTube extraction error:', error);
            return {
                success: false,
                videos: [],
                error: `PeerTube: ${(error as Error).message}`
            };
        }
    }

    /**
     * Build PeerTube result from API data
     */
    private static buildPeerTubeResult(data: any, baseUrl: string, videoId: string): ExtractionResult {
        const videos: ExtractedVideo[] = [];

        // Extract video files
        if (data.files && Array.isArray(data.files)) {
            data.files.forEach((file: any) => {
                videos.push({
                    id: `peertube_${videoId}_${file.resolution.id}`,
                    url: file.fileUrl,
                    title: `${data.name} (${file.resolution.label})`,
                    thumbnail: data.thumbnailPath ? `${baseUrl}${data.thumbnailPath}` : undefined,
                    format: file.resolution.label,
                    source: 'video-tag'
                });
            });
        }

        // Add HLS streams if available
        if (data.streamingPlaylists && Array.isArray(data.streamingPlaylists)) {
            data.streamingPlaylists.forEach((playlist: any) => {
                if (playlist.playlistUrl) {
                    videos.push({
                        id: `peertube_${videoId}_hls`,
                        url: playlist.playlistUrl,
                        title: `${data.name} (HLS)`,
                        thumbnail: data.thumbnailPath ? `${baseUrl}${data.thumbnailPath}` : undefined,
                        format: 'HLS',
                        source: 'video-tag'
                    });
                }
            });
        }

        return {
            success: true,
            videos,
            pageTitle: data.name
        };
    }

    /**
     * Extract video from Invidious using API with fallback instances
     */
    private static async extractFromInvidious(url: string): Promise<ExtractionResult> {
        const urlObj = new URL(url);

        // Extract video ID
        let videoId: string | null = null;
        const urlParams = new URLSearchParams(urlObj.search);
        videoId = urlParams.get('v');

        if (!videoId && url.includes('/v/')) {
            videoId = url.split('/v/')[1].split(/[?#]/)[0];
        }

        if (!videoId) {
            return {
                success: false,
                videos: [],
                error: 'Could not extract video ID from URL',
            };
        }

        console.log(`Extracting video ID: ${videoId}`);

        // Build list of instances to try
        const instancesToTry: string[] = [];
        const seenInstances = new Set<string>();

        // Helper to add unique instance
        const addInstance = (instance: string) => {
            const normalized = instance.toLowerCase().replace(/\/$/, '');
            if (!seenInstances.has(normalized)) {
                seenInstances.add(normalized);
                instancesToTry.push(instance.replace(/\/$/, ''));
            }
        };

        // Add configured instance first (highest priority)
        const configuredInstance = this.getInvidiousInstance();
        addInstance(configuredInstance);

        // If current URL is from a different Invidious instance, try it too
        const currentInstance = `${urlObj.protocol}//${urlObj.host}`;
        if ((currentInstance.includes('invidious') || currentInstance.includes('inv.')) &&
            currentInstance !== configuredInstance) {
            addInstance(currentInstance);
        }

        // Fetch dynamic list of working instances
        console.log('Fetching dynamic Invidious instances...');
        const dynamicInstances = await this.fetchInvidiousInstances();
        console.log(`Received ${dynamicInstances.length} dynamic instances`);

        // Add dynamic instances (try to get up to 10 total)
        for (const instance of dynamicInstances) {
            if (instancesToTry.length >= 10) break; // Max 10 instances to try
            addInstance(instance);
        }

        // Add fallback instances if we still don't have enough
        if (instancesToTry.length < 5) {
            console.log('Adding fallback instances to reach minimum...');
            for (const instance of this.FALLBACK_INVIDIOUS_INSTANCES) {
                if (instancesToTry.length >= 10) break;
                addInstance(instance);
            }
        }

        console.log(`Will try ${instancesToTry.length} Invidious instances`);

        // Try each instance until one works
        let lastError: Error | null = null;

        for (let i = 0; i < instancesToTry.length; i++) {
            const baseUrl = instancesToTry[i];

            try {
                console.log(`Trying Invidious instance ${i + 1}/${instancesToTry.length}: ${baseUrl}`);

                const apiUrl = `${baseUrl}/api/v1/videos/${videoId}`;

                // Create timeout with AbortController
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

                try {
                    const response = await fetch(apiUrl, {
                        signal: controller.signal
                    });

                    clearTimeout(timeoutId);

                    if (!response.ok) {
                        // If rate limited or server error, try next instance
                        if (response.status === 429 || response.status >= 500) {
                            console.warn(`Instance ${baseUrl} returned ${response.status}, trying next...`);
                            lastError = new Error(`Instance returned ${response.status}`);
                            continue;
                        }
                        throw new Error(`Invidious API returned ${response.status}`);
                    }

                    const data = await response.json();
                    const videos: ExtractedVideo[] = [];

                    // Extract video formats
                    if (data.formatStreams && Array.isArray(data.formatStreams)) {
                        data.formatStreams.forEach((format: any) => {
                            videos.push({
                                id: `invidious_${videoId}_${format.itag}`,
                                url: format.url,
                                title: `${data.title} (${format.qualityLabel || format.quality})`,
                                thumbnail: data.videoThumbnails?.[0]?.url,
                                format: format.qualityLabel || format.quality,
                                source: 'video-tag'
                            });
                        });
                    }

                    console.log(`Successfully extracted ${videos.length} videos from ${baseUrl}`);

                    return {
                        success: true,
                        videos,
                        pageTitle: data.title
                    };
                } catch (fetchError) {
                    clearTimeout(timeoutId);

                    // Check if it's a timeout
                    if ((fetchError as Error).name === 'AbortError') {
                        console.warn(`Instance ${baseUrl} timed out, trying next...`);
                        lastError = new Error('Request timeout');
                        continue;
                    }

                    throw fetchError;
                }

            } catch (error) {
                console.warn(`Failed to extract from ${baseUrl}:`, (error as Error).message);
                lastError = error as Error;
                // Continue to next instance
            }
        }

        // All instances failed
        console.error(`All ${instancesToTry.length} Invidious instances failed`);
        return {
            success: false,
            videos: [],
            error: `Unable to extract video from Invidious. All ${instancesToTry.length} instances are currently unavailable. Invidious instances are often overloaded or blocked by YouTube. Please try again later or configure a different instance in settings.`
        };
    }

    /**
     * Fetch HTML content from URL
     * @param url - URL to fetch
     * @returns HTML content as string
     */
    private static async fetchHtml(url: string): Promise<string> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; VideoExtractor/1.0)',
                },
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.text();
        } catch (error) {
            clearTimeout(timeoutId);

            if ((error as Error).name === 'AbortError') {
                throw new Error('Request timeout - page took too long to load');
            }

            throw new Error(`Failed to fetch page: ${(error as Error).message}`);
        }
    }

    /**
     * Parse HTML and extract video information
     * @param html - HTML content
     * @param baseUrl - Base URL for resolving relative URLs
     * @returns Array of extracted videos
     */
    private static parseHtml(html: string, baseUrl: string): ExtractedVideo[] {
        const videos: ExtractedVideo[] = [];
        const foundUrls = new Set<string>(); // Avoid duplicates

        // Extract from <video> tags
        videos.push(...this.extractFromVideoTags(html, baseUrl, foundUrls));

        // Extract from direct links
        videos.push(...this.extractFromDirectLinks(html, baseUrl, foundUrls));

        // Extract from data attributes
        videos.push(...this.extractFromDataAttributes(html, baseUrl, foundUrls));

        return videos;
    }

    /**
     * Extract videos from <video> tags
     */
    private static extractFromVideoTags(
        html: string,
        baseUrl: string,
        foundUrls: Set<string>
    ): ExtractedVideo[] {
        const videos: ExtractedVideo[] = [];

        // Match <video> tags with their content
        const videoTagRegex = /<video[^>]*>([\s\S]*?)<\/video>/gi;
        const videoMatches = html.matchAll(videoTagRegex);

        for (const match of videoMatches) {
            const videoTag = match[0];
            const videoContent = match[1];

            // Extract src from video tag itself
            const srcMatch = videoTag.match(/src=["']([^"']+)["']/i);
            if (srcMatch) {
                const videoUrl = this.resolveUrl(srcMatch[1], baseUrl);
                if (videoUrl && !foundUrls.has(videoUrl)) {
                    foundUrls.add(videoUrl);
                    videos.push(this.createVideoObject(
                        videoUrl,
                        this.extractVideoTitle(videoTag, videoUrl),
                        this.extractPoster(videoTag, baseUrl),
                        'video-tag'
                    ));
                }
            }

            // Extract from <source> tags within <video>
            const sourceRegex = /<source[^>]+>/gi;
            const sourceMatches = videoContent.matchAll(sourceRegex);

            for (const sourceMatch of sourceMatches) {
                const sourceTag = sourceMatch[0];
                const sourceSrcMatch = sourceTag.match(/src=["']([^"']+)["']/i);

                if (sourceSrcMatch) {
                    const videoUrl = this.resolveUrl(sourceSrcMatch[1], baseUrl);
                    if (videoUrl && !foundUrls.has(videoUrl)) {
                        foundUrls.add(videoUrl);
                        videos.push(this.createVideoObject(
                            videoUrl,
                            this.extractVideoTitle(videoTag, videoUrl),
                            this.extractPoster(videoTag, baseUrl),
                            'video-tag'
                        ));
                    }
                }
            }
        }

        return videos;
    }

    /**
     * Extract direct links to video files
     */
    private static extractFromDirectLinks(
        html: string,
        baseUrl: string,
        foundUrls: Set<string>
    ): ExtractedVideo[] {
        const videos: ExtractedVideo[] = [];

        // Match <a> tags with href
        const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        const linkMatches = html.matchAll(linkRegex);

        for (const match of linkMatches) {
            const href = match[1];
            const linkText = match[2].replace(/<[^>]+>/g, '').trim(); // Remove HTML tags

            if (this.isVideoUrl(href)) {
                const videoUrl = this.resolveUrl(href, baseUrl);
                if (videoUrl && !foundUrls.has(videoUrl)) {
                    foundUrls.add(videoUrl);
                    videos.push(this.createVideoObject(
                        videoUrl,
                        linkText || this.extractFilename(videoUrl),
                        undefined,
                        'direct-link'
                    ));
                }
            }
        }

        return videos;
    }

    /**
     * Extract videos from data attributes
     */
    private static extractFromDataAttributes(
        html: string,
        baseUrl: string,
        foundUrls: Set<string>
    ): ExtractedVideo[] {
        const videos: ExtractedVideo[] = [];

        for (const attr of this.VIDEO_DATA_ATTRIBUTES) {
            const attrRegex = new RegExp(`${attr}=["']([^"']+)["']`, 'gi');
            const matches = html.matchAll(attrRegex);

            for (const match of matches) {
                const url = match[1];

                if (this.isVideoUrl(url)) {
                    const videoUrl = this.resolveUrl(url, baseUrl);
                    if (videoUrl && !foundUrls.has(videoUrl)) {
                        foundUrls.add(videoUrl);
                        videos.push(this.createVideoObject(
                            videoUrl,
                            this.extractFilename(videoUrl),
                            undefined,
                            'data-attribute'
                        ));
                    }
                }
            }
        }

        return videos;
    }

    /**
     * Check if URL points to an M3U/M3U8 playlist file
     * @param url - URL to check
     * @returns True if URL has an M3U or M3U8 extension
     */
    private static isM3uUrl(url: string): boolean {
        try {
            const pathname = new URL(url).pathname.toLowerCase();
            return this.M3U_EXTENSIONS.some(ext => pathname.endsWith(`.${ext}`));
        } catch {
            return false;
        }
    }

    /**
     * Check if text content is an M3U playlist by examining its header
     * @param content - Text content to check
     * @returns True if content starts with #EXTM3U
     */
    private static isM3uContent(content: string): boolean {
        return content.trimStart().startsWith('#EXTM3U');
    }

    /**
     * Parse M3U/M3U8 playlist content and extract stream entries.
     * Supports #EXTINF metadata with tvg-logo, tvg-name, group-title attributes.
     * @param content - Raw M3U playlist text content
     * @param sourceUrl - Original playlist URL for resolving relative URLs
     * @returns ExtractionResult with extracted streams
     */
    private static parseM3uPlaylist(content: string, sourceUrl: string): ExtractionResult {
        try {
            const lines = content.split(/\r?\n/);
            const videos: ExtractedVideo[] = [];

            let currentTitle: string | undefined;
            let currentLogo: string | undefined;
            let currentGroup: string | undefined;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();

                if (!line || line === '#EXTM3U') {
                    continue;
                }

                if (line.startsWith('#EXTINF:')) {
                    const extinf = line.substring(8);

                    const logoMatch = extinf.match(/tvg-logo="([^"]*)"/i);
                    currentLogo = logoMatch ? logoMatch[1] : undefined;

                    const groupMatch = extinf.match(/group-title="([^"]*)"/i);
                    currentGroup = groupMatch ? groupMatch[1] : undefined;

                    const nameMatch = extinf.match(/tvg-name="([^"]*)"/i);
                    if (nameMatch && nameMatch[1]) {
                        currentTitle = nameMatch[1];
                    } else {
                        const commaIndex = extinf.lastIndexOf(',');
                        currentTitle = commaIndex >= 0 ? extinf.substring(commaIndex + 1).trim() : undefined;
                    }

                    continue;
                }

                // Skip other directives
                if (line.startsWith('#')) {
                    continue;
                }

                // Stream URL line
                const streamUrl = this.resolveUrl(line, sourceUrl);
                if (streamUrl) {
                    videos.push({
                        id: this.generateId(streamUrl),
                        url: streamUrl,
                        title: currentTitle || this.extractFilename(streamUrl),
                        thumbnail: currentLogo || undefined,
                        format: currentGroup || 'STREAM',
                        source: 'm3u-playlist',
                    });
                }

                currentTitle = undefined;
                currentLogo = undefined;
                currentGroup = undefined;
            }

            return {
                success: true,
                videos,
                pageTitle: `M3U Playlist (${videos.length} streams)`,
            };
        } catch (error) {
            console.error('M3U parsing error:', error);
            return {
                success: false,
                videos: [],
                error: `M3U parsing failed: ${(error as Error).message}`,
            };
        }
    }

    /**
     * Extract streams from an M3U/M3U8 playlist URL
     * @param url - M3U playlist URL
     * @returns ExtractionResult with stream entries
     */
    private static async extractFromM3u(url: string): Promise<ExtractionResult> {
        try {
            const content = await this.fetchHtml(url);

            if (!this.isM3uContent(content)) {
                return {
                    success: false,
                    videos: [],
                    error: 'URL does not contain a valid M3U playlist',
                };
            }

            return this.parseM3uPlaylist(content, url);
        } catch (error) {
            console.error('M3U extraction error:', error);
            return {
                success: false,
                videos: [],
                error: `M3U extraction failed: ${(error as Error).message}`,
            };
        }
    }

    /**
     * Check if URL points to a video file
     */
    private static isVideoUrl(url: string): boolean {
        const lowerUrl = url.toLowerCase();
        return this.VIDEO_EXTENSIONS.some(ext => {
            return lowerUrl.includes(`.${ext}`) || lowerUrl.endsWith(ext);
        });
    }

    /**
     * Resolve relative URL to absolute
     */
    private static resolveUrl(url: string, baseUrl: string): string | null {
        try {
            // Already absolute
            if (url.startsWith('http://') || url.startsWith('https://')) {
                return url;
            }

            // Protocol-relative
            if (url.startsWith('//')) {
                const baseUrlObj = new URL(baseUrl);
                return `${baseUrlObj.protocol}${url}`;
            }

            // Relative URL
            return new URL(url, baseUrl).href;
        } catch {
            return null;
        }
    }

    /**
     * Extract video title from video tag attributes or URL
     */
    private static extractVideoTitle(videoTag: string, url: string): string {
        // Try title attribute
        const titleMatch = videoTag.match(/title=["']([^"']+)["']/i);
        if (titleMatch) {
            return titleMatch[1];
        }

        // Try alt attribute
        const altMatch = videoTag.match(/alt=["']([^"']+)["']/i);
        if (altMatch) {
            return altMatch[1];
        }

        // Fallback to filename
        return this.extractFilename(url);
    }

    /**
     * Extract poster/thumbnail from video tag
     */
    private static extractPoster(videoTag: string, baseUrl: string): string | undefined {
        const posterMatch = videoTag.match(/poster=["']([^"']+)["']/i);
        if (posterMatch) {
            const posterUrl = this.resolveUrl(posterMatch[1], baseUrl);
            return posterUrl || undefined;
        }
        return undefined;
    }

    /**
     * Extract filename from URL
     */
    private static extractFilename(url: string): string {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const filename = pathname.split('/').pop() || 'video';
            return decodeURIComponent(filename);
        } catch {
            return 'video';
        }
    }

    /**
     * Extract format/extension from URL
     */
    private static extractFormat(url: string): string | undefined {
        const match = url.match(/\.(\w+)(?:\?|$)/);
        return match ? match[1].toUpperCase() : undefined;
    }

    /**
     * Create video object
     */
    private static createVideoObject(
        url: string,
        title: string,
        thumbnail: string | undefined,
        source: ExtractedVideo['source']
    ): ExtractedVideo {
        return {
            id: this.generateId(url),
            url,
            title,
            thumbnail,
            format: this.extractFormat(url),
            source,
        };
    }

    /**
     * Generate unique ID for video
     */
    private static generateId(url: string): string {
        // Simple hash function
        let hash = 0;
        for (let i = 0; i < url.length; i++) {
            const char = url.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return `video_${Math.abs(hash)}_${Date.now()}`;
    }

    /**
     * Extract page title from HTML
     */
    private static extractPageTitle(html: string): string | undefined {
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch) {
            return titleMatch[1].trim().replace(/\s+/g, ' ');
        }
        return undefined;
    }
}