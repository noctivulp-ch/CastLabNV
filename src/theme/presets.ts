/**
 * Preset Themes System
 * Provides pre-made color schemes that users can select and customize
 */

export interface PresetTheme {
    id: string;
    name: string;
    description: string;
    colors: {
        primary: string;
        onPrimary: string;
        primaryContainer: string;
        onPrimaryContainer: string;
        secondary: string;
        onSecondary: string;
        secondaryContainer: string;
        onSecondaryContainer: string;
        background: string;
        onBackground: string;
        surface: string;
        onSurface: string;
        surfaceVariant: string;
        onSurfaceVariant: string;
        error: string;
        onError: string;
        errorContainer: string;
        onErrorContainer: string;
        outline: string;
        outlineVariant: string;
        shadow: string;
        scrim: string;
        inverseSurface: string;
        inverseOnSurface: string;
        inversePrimary: string;
    };
}

/**
 * Pre-made theme presets
 */
export const THEME_PRESETS: PresetTheme[] = [
    {
        id: 'ocean',
        name: 'Ocean Blue',
        description: 'Cool and calming ocean-inspired colors',
        colors: {
            primary: 'rgb(0, 122, 204)',
            onPrimary: 'rgb(255, 255, 255)',
            primaryContainer: 'rgb(204, 229, 255)',
            onPrimaryContainer: 'rgb(0, 30, 51)',
            secondary: 'rgb(82, 169, 187)',
            onSecondary: 'rgb(255, 255, 255)',
            secondaryContainer: 'rgb(204, 239, 255)',
            onSecondaryContainer: 'rgb(0, 50, 60)',
            background: 'rgb(248, 252, 255)',
            onBackground: 'rgb(25, 28, 30)',
            surface: 'rgb(248, 252, 255)',
            onSurface: 'rgb(25, 28, 30)',
            surfaceVariant: 'rgb(220, 228, 235)',
            onSurfaceVariant: 'rgb(64, 71, 77)',
            error: 'rgb(186, 26, 26)',
            onError: 'rgb(255, 255, 255)',
            errorContainer: 'rgb(255, 218, 214)',
            onErrorContainer: 'rgb(65, 0, 2)',
            outline: 'rgb(112, 119, 126)',
            outlineVariant: 'rgb(192, 199, 206)',
            shadow: 'rgb(0, 0, 0)',
            scrim: 'rgb(0, 0, 0)',
            inverseSurface: 'rgb(46, 49, 51)',
            inverseOnSurface: 'rgb(240, 240, 244)',
            inversePrimary: 'rgb(153, 204, 255)',
        },
    },
    {
        id: 'forest',
        name: 'Forest Green',
        description: 'Natural and earthy forest tones',
        colors: {
            primary: 'rgb(56, 142, 60)',
            onPrimary: 'rgb(255, 255, 255)',
            primaryContainer: 'rgb(200, 230, 201)',
            onPrimaryContainer: 'rgb(10, 40, 12)',
            secondary: 'rgb(102, 187, 106)',
            onSecondary: 'rgb(255, 255, 255)',
            secondaryContainer: 'rgb(220, 237, 220)',
            onSecondaryContainer: 'rgb(20, 50, 22)',
            background: 'rgb(252, 254, 252)',
            onBackground: 'rgb(26, 28, 26)',
            surface: 'rgb(252, 254, 252)',
            onSurface: 'rgb(26, 28, 26)',
            surfaceVariant: 'rgb(222, 229, 223)',
            onSurfaceVariant: 'rgb(66, 73, 67)',
            error: 'rgb(186, 26, 26)',
            onError: 'rgb(255, 255, 255)',
            errorContainer: 'rgb(255, 218, 214)',
            onErrorContainer: 'rgb(65, 0, 2)',
            outline: 'rgb(114, 121, 115)',
            outlineVariant: 'rgb(194, 201, 195)',
            shadow: 'rgb(0, 0, 0)',
            scrim: 'rgb(0, 0, 0)',
            inverseSurface: 'rgb(47, 49, 47)',
            inverseOnSurface: 'rgb(241, 241, 241)',
            inversePrimary: 'rgb(165, 214, 167)',
        },
    },
    {
        id: 'sunset',
        name: 'Sunset Orange',
        description: 'Warm and vibrant sunset colors',
        colors: {
            primary: 'rgb(255, 111, 0)',
            onPrimary: 'rgb(255, 255, 255)',
            primaryContainer: 'rgb(255, 224, 204)',
            onPrimaryContainer: 'rgb(51, 22, 0)',
            secondary: 'rgb(255, 167, 38)',
            onSecondary: 'rgb(255, 255, 255)',
            secondaryContainer: 'rgb(255, 236, 204)',
            onSecondaryContainer: 'rgb(51, 33, 0)',
            background: 'rgb(255, 253, 251)',
            onBackground: 'rgb(30, 27, 25)',
            surface: 'rgb(255, 253, 251)',
            onSurface: 'rgb(30, 27, 25)',
            surfaceVariant: 'rgb(235, 224, 218)',
            onSurfaceVariant: 'rgb(77, 70, 66)',
            error: 'rgb(186, 26, 26)',
            onError: 'rgb(255, 255, 255)',
            errorContainer: 'rgb(255, 218, 214)',
            onErrorContainer: 'rgb(65, 0, 2)',
            outline: 'rgb(125, 116, 110)',
            outlineVariant: 'rgb(207, 196, 190)',
            shadow: 'rgb(0, 0, 0)',
            scrim: 'rgb(0, 0, 0)',
            inverseSurface: 'rgb(51, 48, 46)',
            inverseOnSurface: 'rgb(244, 239, 237)',
            inversePrimary: 'rgb(255, 183, 128)',
        },
    },
    {
        id: 'midnight',
        name: 'Midnight Purple',
        description: 'Deep and mysterious midnight tones',
        colors: {
            primary: 'rgb(156, 39, 176)',
            onPrimary: 'rgb(255, 255, 255)',
            primaryContainer: 'rgb(234, 221, 255)',
            onPrimaryContainer: 'rgb(40, 0, 55)',
            secondary: 'rgb(186, 104, 200)',
            onSecondary: 'rgb(255, 255, 255)',
            secondaryContainer: 'rgb(243, 229, 245)',
            onSecondaryContainer: 'rgb(46, 20, 50)',
            background: 'rgb(20, 18, 24)',
            onBackground: 'rgb(230, 225, 234)',
            surface: 'rgb(20, 18, 24)',
            onSurface: 'rgb(230, 225, 234)',
            surfaceVariant: 'rgb(73, 69, 79)',
            onSurfaceVariant: 'rgb(204, 196, 206)',
            error: 'rgb(255, 180, 171)',
            onError: 'rgb(105, 0, 5)',
            errorContainer: 'rgb(147, 0, 10)',
            onErrorContainer: 'rgb(255, 218, 214)',
            outline: 'rgb(147, 143, 153)',
            outlineVariant: 'rgb(73, 69, 79)',
            shadow: 'rgb(0, 0, 0)',
            scrim: 'rgb(0, 0, 0)',
            inverseSurface: 'rgb(230, 225, 234)',
            inverseOnSurface: 'rgb(50, 47, 53)',
            inversePrimary: 'rgb(156, 39, 176)',
        },
    },
    {
        id: 'cherry',
        name: 'Cherry Red',
        description: 'Bold and energetic red tones',
        colors: {
            primary: 'rgb(211, 47, 47)',
            onPrimary: 'rgb(255, 255, 255)',
            primaryContainer: 'rgb(255, 205, 210)',
            onPrimaryContainer: 'rgb(53, 0, 0)',
            secondary: 'rgb(239, 83, 80)',
            onSecondary: 'rgb(255, 255, 255)',
            secondaryContainer: 'rgb(255, 235, 238)',
            onSecondaryContainer: 'rgb(60, 17, 20)',
            background: 'rgb(255, 251, 254)',
            onBackground: 'rgb(29, 27, 28)',
            surface: 'rgb(255, 251, 254)',
            onSurface: 'rgb(29, 27, 28)',
            surfaceVariant: 'rgb(233, 223, 225)',
            onSurfaceVariant: 'rgb(76, 69, 70)',
            error: 'rgb(186, 26, 26)',
            onError: 'rgb(255, 255, 255)',
            errorContainer: 'rgb(255, 218, 214)',
            onErrorContainer: 'rgb(65, 0, 2)',
            outline: 'rgb(124, 117, 118)',
            outlineVariant: 'rgb(205, 195, 197)',
            shadow: 'rgb(0, 0, 0)',
            scrim: 'rgb(0, 0, 0)',
            inverseSurface: 'rgb(50, 47, 48)',
            inverseOnSurface: 'rgb(245, 239, 240)',
            inversePrimary: 'rgb(255, 179, 186)',
        },
    },
];

/**
 * Get preset theme by ID
 */
export const getPresetTheme = (id: string): PresetTheme | undefined => {
    return THEME_PRESETS.find(preset => preset.id === id);
};
