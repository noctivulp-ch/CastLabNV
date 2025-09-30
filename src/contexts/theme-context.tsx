import React, {createContext, useState} from 'react'
import {adaptNavigationTheme, MD3DarkTheme, MD3LightTheme} from "react-native-paper";
import {DarkTheme as NavigationDarkTheme, DefaultTheme as NavigationDefaultTheme} from "@react-navigation/native";
import merge from "deepmerge";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {SETTINGS_CUSTOM_COLORS, SETTINGS_THEME} from "../constants/AsyncStorage";
import {Appearance} from "react-native";
import lightColors from "../theme/light.json";
import darkColors from "../theme/dark.json";

const {LightTheme, DarkTheme} = adaptNavigationTheme({
    reactNavigationLight: NavigationDefaultTheme,
    reactNavigationDark: NavigationDarkTheme,
});

const CombinedDefaultTheme = merge({...MD3LightTheme, colors: lightColors.colors}, {
    ...LightTheme, colors: {
        ...lightColors.colors,
        card: lightColors.colors.surfaceVariant,
        text: lightColors.colors.onBackground,
        notification: lightColors.colors.primary,
        border: lightColors.colors.secondary,
    }
});

const CombinedDarkTheme = merge({...MD3DarkTheme, colors: darkColors.colors}, {
    ...DarkTheme, colors: {
        ...darkColors.colors,
        card: darkColors.colors.surfaceVariant,
        text: darkColors.colors.onBackground,
        notification: darkColors.colors.primary,
        border: darkColors.colors.secondary,
    }
});

/**
 * Create custom theme from user-defined colors
 * Automatically detects if it should be a dark or light theme based on background color
 */
const createCustomTheme = (customColors: any) => {
    // Ensure elevation properties exist
    const elevation = {
        level0: 'transparent',
        level1: customColors.surface || 'rgb(255, 255, 255)',
        level2: customColors.surfaceVariant || 'rgb(242, 242, 242)',
        level3: customColors.surfaceVariant || 'rgb(238, 238, 238)',
        level4: customColors.surfaceVariant || 'rgb(234, 234, 234)',
        level5: customColors.surfaceVariant || 'rgb(230, 230, 230)',
    };

    const mergedColors = {
        ...customColors,
        elevation,
    };

    // Determine if we should use dark or light base theme
    const isDark = customColors.background ? isColorDark(customColors.background) : false;
    const baseTheme = isDark ? MD3DarkTheme : MD3LightTheme;
    const baseNavTheme = isDark ? DarkTheme : LightTheme;

    return merge({...baseTheme, colors: mergedColors}, {
        ...baseNavTheme, colors: {
            ...mergedColors,
            card: customColors.surfaceVariant,
            text: customColors.onBackground,
            notification: customColors.primary,
            border: customColors.secondary,
        }
    });
};

export const ThemeContext = createContext({
    theme: CombinedDefaultTheme,
    statusBarTheme: NavigationDefaultTheme,
    type: "auto",
    customColors: null as any,
    setTheme: (themeType: string) => {
    },
    setCustomColors: async (colors: any) => {
    },
    applyCustomTheme: async (colors: any) => {
    },
});

function ThemeContextProvider({children}: any) {
    const [theme, themeApply] = useState(CombinedDefaultTheme);
    const [statusBarTheme, setStatusBarTheme] = useState(NavigationDefaultTheme);
    const [type, setType] = useState("auto");
    const [customColors, setCustomColorsState] = useState<any>(null);
    const colorScheme = Appearance.getColorScheme();

    /**
     * Load custom colors from AsyncStorage
     */
    const loadCustomColors = async () => {
        try {
            const stored = await AsyncStorage.getItem(SETTINGS_CUSTOM_COLORS);
            if (stored) {
                const colors = JSON.parse(stored);
                setCustomColorsState(colors);
                return colors;
            }
        } catch (error) {
            console.error('Failed to load custom colors:', error);
        }
        return null;
    };

    /**
     * Save custom colors to AsyncStorage and state
     */
    const setCustomColors = async (colors: any) => {
        try {
            await AsyncStorage.setItem(SETTINGS_CUSTOM_COLORS, JSON.stringify(colors));
            setCustomColorsState(colors);
        } catch (error) {
            console.error('Failed to save custom colors:', error);
        }
    };

    /**
     * Apply custom theme directly with colors (no reload needed)
     */
    const applyCustomTheme = async (colors: any) => {
        try {
            // Save to AsyncStorage
            await AsyncStorage.setItem(SETTINGS_CUSTOM_COLORS, JSON.stringify(colors));
            // Update state
            setCustomColorsState(colors);
            // Create and apply theme immediately
            const customTheme = createCustomTheme(colors);
            themeApply(customTheme);
            // Set status bar based on background brightness
            const isDark = isColorDark(colors.background);
            setStatusBarTheme(isDark ? NavigationDarkTheme : NavigationDefaultTheme);
            // Set type to custom
            setType('custom');
            await AsyncStorage.setItem(SETTINGS_THEME, 'custom');
        } catch (error) {
            console.error('Failed to apply custom theme:', error);
        }
    };

    /**
     * Apply theme based on type
     */
    async function setTheme(themeType: string) {
        setType(themeType);

        if (themeType === "light") {
            themeApply(CombinedDefaultTheme);
            setStatusBarTheme(NavigationDefaultTheme);
        } else if (themeType === "dark") {
            themeApply(CombinedDarkTheme);
            setStatusBarTheme(NavigationDarkTheme);
        } else if (themeType === "custom") {
            // Load custom colors if not already loaded
            let colors = customColors;
            if (!colors) {
                colors = await loadCustomColors();
            }

            if (colors) {
                const customTheme = createCustomTheme(colors);
                themeApply(customTheme);
                // Use light or dark status bar based on background brightness
                const isDark = isColorDark(colors.background);
                setStatusBarTheme(isDark ? NavigationDarkTheme : NavigationDefaultTheme);
            } else {
                // Fallback to light theme if no custom colors available
                themeApply(CombinedDefaultTheme);
                setStatusBarTheme(NavigationDefaultTheme);
            }
        } else { // Auto
            if (colorScheme === "light") {
                themeApply(CombinedDefaultTheme);
                setStatusBarTheme(NavigationDefaultTheme);
            } else {
                themeApply(CombinedDarkTheme);
                setStatusBarTheme(NavigationDarkTheme);
            }
        }

        await AsyncStorage.setItem(SETTINGS_THEME, themeType);
    }

    return (
        <ThemeContext.Provider value={{
            theme,
            statusBarTheme,
            type,
            customColors,
            setTheme,
            setCustomColors,
            applyCustomTheme
        }}>
            {children}
        </ThemeContext.Provider>
    );
}

/**
 * Determine if a color is dark based on luminance
 */
export function isColorDark(color: string): boolean {
    // Parse rgb color string
    const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!match) return false;

    const [, r, g, b] = match.map(Number);

    // Calculate relative luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    return luminance < 0.5;
}

export default ThemeContextProvider;