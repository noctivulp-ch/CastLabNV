import {useCallback, useRef, useState} from 'react';

/**
 * Null while the typed value is still incomplete
 */
export const normalizeHex = (value: string): string | null => {
    const raw = value.trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(raw)) return '#' + raw.replace(/./g, digit => digit + digit);
    if (/^[0-9a-f]{6}$/.test(raw)) return '#' + raw;
    return null;
};

/**
 * Null when the format is unknown
 */
export const toHexColor = (value: string): string | null => {
    const hex = normalizeHex(value);
    if (hex) return hex;

    const rgb = value.match(/^\s*rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!rgb) return null;

    const channels = rgb.slice(1, 4).map(Number);
    if (channels.some(channel => channel > 255)) return null;
    return '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('');
};

/**
 * Neither the hex field nor the color wheel overwrites the other
 */
export const useHexColorField = (initialColor: string) => {
    const initialHex = toHexColor(initialColor) ?? initialColor;
    const [color, setColor] = useState(initialHex);
    const [hexText, setHexText] = useState(initialHex);
    const wheelTouched = useRef(false);

    const reset = useCallback((value: string) => {
        wheelTouched.current = false;
        // Theme colors are stored as rgb strings
        const hex = toHexColor(value) ?? value;
        setColor(hex);
        setHexText(hex);
    }, []);

    /**
     * The wheel replays through HSV and would corrupt an exact value
     */
    const onWheelChange = useCallback((value: string) => {
        if (!wheelTouched.current) return;
        setColor(value);
        setHexText(value);
    }, []);

    const onWheelTouch = useCallback(() => {
        wheelTouched.current = true;
    }, []);

    /**
     * A pasted rgb string is converted instead of being stripped
     */
    const onHexChange = useCallback((value: string) => {
        wheelTouched.current = false;
        const source = value.includes('(') ? toHexColor(value) ?? '' : value;
        const digits = source.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toLowerCase();
        setHexText('#' + digits);
        // Shorthand waits for blur so the preview does not jump
        if (digits.length === 6) setColor('#' + digits);
    }, []);

    /**
     * Leaving an incomplete entry restores the last color that parsed
     */
    const onHexBlur = useCallback(() => {
        setHexText(normalizeHex(hexText) ?? color);
    }, [hexText, color]);

    return {color, hexText, reset, onWheelChange, onWheelTouch, onHexChange, onHexBlur};
};
