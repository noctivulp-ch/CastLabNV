import {useCallback, useEffect, useRef} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {Asset} from 'expo-media-library';
import {IRootState} from '../screens/Main';
import {nextAsset} from '../store/slice/castSlice';
import {useCastManager} from '../contexts/castManager-context';

export interface UseAutoplayProps {
    /**
     * Called when autoplay attempts to load more assets (e.g., when reaching end of current page)
     */
    onLoadMoreAssets?: () => Promise<void>;

    /**
     * Called when autoplay is about to play the next asset
     */
    onNextAsset?: (asset: Asset) => void;
}

export const useAutoplay = ({onLoadMoreAssets, onNextAsset}: UseAutoplayProps = {}) => {
    const dispatch = useDispatch();
    const cast = useSelector((state: IRootState) => state.cast);
    const {playbackState} = useCastManager();

    // Refs to store timer and prevent stale closures
    const autoplayTimerRef = useRef<NodeJS.Timeout | null>(null);
    const isAdvancingRef = useRef(false);
    const lastProgressRef = useRef(0);
    const mediaEndDetectedRef = useRef(false);

    /**
     * Clear the current autoplay timer
     */
    const clearAutoplayTimer = useCallback(() => {
        if (autoplayTimerRef.current) {
            clearTimeout(autoplayTimerRef.current);
            autoplayTimerRef.current = null;
        }
    }, []);

    /**
     * Check if current media is an image (should use timer-based autoplay)
     */
    const isImageMedia = useCallback((asset: Asset | null) => {
        if (!asset) return false;
        if (asset.mediaType === 'photo') return true;

        // Check file extension as fallback
        if (asset.filename) {
            const ext = asset.filename.split('.').pop()?.toLowerCase();
            return ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif'].includes(ext || '');
        }
        return false;
    }, []);

    /**
     * Check if current media supports duration-based autoplay (video/audio)
     */
    const isTimedMedia = useCallback((asset: Asset | null) => {
        return asset?.mediaType === 'video' || asset?.mediaType === 'audio';
    }, []);

    /**
     * Advance to the next asset in the playlist
     */
    const advanceToNext = useCallback(async () => {
        if (isAdvancingRef.current || !cast.autoplay.enabled) {
            return;
        }

        isAdvancingRef.current = true;

        try {
            // Check if we're at the end of the current asset list
            const isAtEnd = cast.currentIndex >= cast.assets.length - 1;

            if (isAtEnd && onLoadMoreAssets) {
                try {
                    await onLoadMoreAssets();
                    // Wait a bit for the assets to be loaded
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (error) {
                    console.error('Autoplay: Failed to load more assets:', error);
                    return;
                }
            }

            // Check if we have a next asset
            const hasNext = cast.currentIndex < cast.assets.length - 1;

            if (hasNext) {
                const nextAssetIndex = cast.currentIndex + 1;
                const nextAssetItem = cast.assets[nextAssetIndex];


                // Notify parent component
                onNextAsset?.(nextAssetItem);

                // Update Redux state - this will trigger the casting in Main.tsx
                dispatch(nextAsset());

            }
        } finally {
            isAdvancingRef.current = false;
            mediaEndDetectedRef.current = false;
        }
    }, [cast, dispatch, onLoadMoreAssets, onNextAsset]);

    /**
     * Start timer-based autoplay for images
     */
    const startImageAutoplay = useCallback(() => {
        if (!cast.autoplay.enabled || !cast.currentAsset || !isImageMedia(cast.currentAsset)) {
            return;
        }

        clearAutoplayTimer();


        autoplayTimerRef.current = setTimeout(() => {
            advanceToNext();
        }, cast.autoplay.delaySeconds * 1000);
    }, [cast.autoplay.enabled, cast.autoplay.delaySeconds, cast.currentAsset, clearAutoplayTimer, advanceToNext, isImageMedia]);

    /**
     * Handle media end detection for video/audio
     */
    const checkMediaEnd = useCallback(() => {
        if (!cast.autoplay.enabled ||
            !cast.autoplay.onMediaEnd ||
            !cast.currentAsset ||
            !isTimedMedia(cast.currentAsset) ||
            !playbackState) {
            return;
        }

        // Use position from playbackState (your interface uses 'position' not 'progress')
        const currentPosition = playbackState.position || 0;
        const duration = playbackState.duration || 0;
        const isPlaying = playbackState.isPlaying || false;

        // Detect if media has ended (position hasn't changed and we're near the end)
        const isNearEnd = duration > 0 && currentPosition >= duration - 2; // 2 seconds before end
        const positionStuck = currentPosition === lastProgressRef.current && currentPosition > 0;
        const mediaEnded = isNearEnd && (positionStuck || !isPlaying);

        if (mediaEnded && !mediaEndDetectedRef.current) {
            mediaEndDetectedRef.current = true;

            // Add a small delay to ensure the media has fully ended
            setTimeout(() => {
                advanceToNext();
            }, 1000);
        }

        lastProgressRef.current = currentPosition;
    }, [cast.autoplay.enabled, cast.autoplay.onMediaEnd, cast.currentAsset, playbackState, advanceToNext, isTimedMedia]);

    /**
     * Reset autoplay state when asset changes
     */
    useEffect(() => {
        clearAutoplayTimer();
        isAdvancingRef.current = false;
        mediaEndDetectedRef.current = false;
        lastProgressRef.current = 0;

        if (cast.autoplay.enabled && cast.currentAsset) {
            if (isImageMedia(cast.currentAsset)) {
                // Start timer for images
                startImageAutoplay();
            }
        }
    }, [cast.currentAsset, cast.autoplay.enabled, clearAutoplayTimer, startImageAutoplay, isImageMedia]);

    /**
     * Monitor playback progress for media end detection
     */
    useEffect(() => {
        if (cast.autoplay.enabled && cast.currentAsset && isTimedMedia(cast.currentAsset)) {
            checkMediaEnd();
        }
    }, [playbackState?.position, playbackState?.isPlaying, checkMediaEnd, cast.autoplay.enabled, cast.currentAsset, isTimedMedia]);

    /**
     * Update timer when autoplay delay changes
     */
    useEffect(() => {
        if (cast.currentAsset && isImageMedia(cast.currentAsset) && autoplayTimerRef.current) {
            startImageAutoplay();
        }
    }, [cast.autoplay.delaySeconds, cast.currentAsset, startImageAutoplay, isImageMedia]);

    /**
     * Cleanup on unmount
     */
    useEffect(() => {
        return () => {
            clearAutoplayTimer();
        };
    }, [clearAutoplayTimer]);

    return {
        /**
         * Manually advance to next asset
         */
        advanceToNext,

        /**
         * Check if autoplay is currently active
         */
        isAutoplayActive: cast.autoplay.enabled,

        /**
         * Check if there's a next asset available
         */
        hasNextAsset: cast.currentIndex < cast.assets.length - 1,

        /**
         * Get remaining time for current image (if applicable)
         */
        getRemainingTime: () => {
            return isImageMedia(cast.currentAsset) ? cast.autoplay.delaySeconds : 0;
        },

        /**
         * Clear the current autoplay timer (useful for pausing autoplay temporarily)
         */
        clearTimer: clearAutoplayTimer,
    };
};