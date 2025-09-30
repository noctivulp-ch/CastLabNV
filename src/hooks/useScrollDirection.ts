import {useCallback, useRef} from 'react';
import {NativeScrollEvent, NativeSyntheticEvent} from 'react-native';

interface UseScrollDirectionProps {
    onScrollDirectionChange?: (isScrollingDown: boolean) => void;
    threshold?: number; // Minimum scroll distance to trigger direction change
}

interface UseScrollDirectionReturn {
    handleScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    resetScroll: () => void;
}

/**
 * Custom hook to detect scroll direction and notify when it changes
 * Centralizes scroll detection logic for reuse across multiple screens
 */
export const useScrollDirection = ({
                                       onScrollDirectionChange,
                                       threshold = 10
                                   }: UseScrollDirectionProps): UseScrollDirectionReturn => {
    const scrollY = useRef<number>(0);
    const lastScrollDirection = useRef<'up' | 'down'>('up');

    /**
     * Handle scroll events to detect scroll direction
     * Only triggers callback when direction changes and scroll exceeds threshold
     */
    const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const currentScrollY = event.nativeEvent.contentOffset.y;
        const scrollDelta = currentScrollY - scrollY.current;

        // Determine scroll direction based on delta
        const scrollDirection = scrollDelta > 0 ? 'down' : 'up';

        // Only trigger callback if direction changed and scroll distance exceeds threshold
        if (scrollDirection !== lastScrollDirection.current && Math.abs(scrollDelta) > threshold) {
            lastScrollDirection.current = scrollDirection;
            onScrollDirectionChange?.(scrollDirection === 'down');
        }

        scrollY.current = currentScrollY;
    }, [onScrollDirectionChange, threshold]);

    /**
     * Reset scroll tracking state
     * Useful when screen is refreshed or data changes
     */
    const resetScroll = useCallback(() => {
        scrollY.current = 0;
        lastScrollDirection.current = 'up';
    }, []);

    return {
        handleScroll,
        resetScroll
    };
};