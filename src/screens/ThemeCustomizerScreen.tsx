import React, {useContext, useEffect, useMemo, useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {Button, Dialog, Divider, Portal, SegmentedButtons, Surface, Text, TextInput} from 'react-native-paper';
import {isColorDark, ThemeContext} from '../contexts/theme-context';
import ColorPicker from 'react-native-wheel-color-picker';
import {PresetTheme, THEME_PRESETS} from '../theme/presets';
import {initTranslate} from '../localization/translate';
import lightColors from '../theme/light.json';
import darkColors from '../theme/dark.json';

interface ColorItemProps {
    label: string;
    colorKey: string;
    value: string;
    onPress: () => void;
}

/**
 * Color selection item component
 */
const ColorItem: React.FC<ColorItemProps> = ({label, colorKey, value, onPress}) => {
    const {theme} = useContext(ThemeContext);

    return (
        <Surface style={styles.colorItem} elevation={1}>
            <View style={styles.colorInfo}>
                <Text variant="bodyLarge">{label}</Text>
                <Text variant="bodySmall" style={{color: theme.colors.onSurfaceVariant}}>
                    {colorKey}
                </Text>
            </View>
            <Button
                mode="contained"
                onPress={onPress}
                style={[styles.colorButton, {backgroundColor: value}]}
                labelStyle={styles.colorButtonLabel}
            >
                {value}
            </Button>
        </Surface>
    );
};

/**
 * Enhanced Theme customizer screen with presets
 * Allows users to select from preset themes or create custom color themes
 */
const ThemeCustomizerScreen: React.FC<any> = () => {
    const i18n = useMemo(() => initTranslate(), []);
    const {theme, customColors, applyCustomTheme: applyThemeFromContext, type} = useContext(ThemeContext);
    const [pickerVisible, setPickerVisible] = useState(false);
    const [currentColorKey, setCurrentColorKey] = useState<string | null>(null);
    const [currentColor, setCurrentColor] = useState('#000000');
    const [resetDialogVisible, setResetDialogVisible] = useState(false);
    const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
    const [baseTheme, setBaseTheme] = useState<'light' | 'dark'>('light');

    // Initialize with current custom colors or theme defaults
    const [colors, setColors] = useState<ThemeColors>(() => {
        if (customColors) return customColors;
        // Extract only color strings from theme
        const baseColors: any = {};
        Object.keys(theme.colors).forEach(key => {
            const value = theme.colors[key as keyof typeof theme.colors];
            if (typeof value === 'string') {
                baseColors[key] = value;
            }
        });
        return baseColors;
    });

    useEffect(() => {
        if (customColors) {
            setColors(customColors);
        }
    }, [customColors]);

    /**
     * Open color picker for a specific color key
     */
    const openColorPicker = (colorKey: string, currentValue: string) => {
        setCurrentColorKey(colorKey);
        setCurrentColor(currentValue);
        setPickerVisible(true);
        setSelectedPreset(null); // Clear preset selection when manually editing
    };

    /**
     * Save selected color
     */
    const saveColor = () => {
        if (currentColorKey) {
            const newColors = {
                ...colors,
                [currentColorKey]: currentColor,
            };
            setColors(newColors);
        }
        setPickerVisible(false);
    };

    /**
     * Apply a preset theme
     */
    const applyPreset = (preset: PresetTheme) => {
        setColors(preset.colors as any);
        setSelectedPreset(preset.id);
        // Detect if preset is dark or light based on background
        const bgColor = preset.colors.background;
        const isDark = isColorDark(bgColor);
        setBaseTheme(isDark ? 'dark' : 'light');
    };

    /**
     * Apply custom theme
     */
    const applyCustomTheme = async () => {
        try {
            // Apply theme directly with current colors
            await applyThemeFromContext(colors);
        } catch (error) {
            console.error('Failed to apply custom theme:', error);
        }
    };

    /**
     * Load colors from light or dark base theme
     */
    const loadBaseTheme = (base: 'light' | 'dark') => {
        setBaseTheme(base);
        const sourceColors = base === 'dark' ? darkColors.colors : lightColors.colors;
        const baseColors: any = {};
        Object.keys(sourceColors).forEach(key => {
            const value = sourceColors[key as keyof typeof sourceColors];
            if (typeof value === 'string') {
                baseColors[key] = value;
            }
        });
        setColors(baseColors);
        setSelectedPreset(null);
    };

    /**
     * Reset to default theme colors
     */
    const resetToDefaults = () => {
        loadBaseTheme(baseTheme);
        setResetDialogVisible(false);
    };

    // Define main colors to customize
    const mainColorKeys: Array<{ key: string; label: string }> = [
        {key: 'primary', label: 'Primary'},
        {key: 'onPrimary', label: 'On Primary'},
        {key: 'primaryContainer', label: 'Primary Container'},
        {key: 'secondary', label: 'Secondary'},
        {key: 'onSecondary', label: 'On Secondary'},
        {key: 'secondaryContainer', label: 'Secondary Container'},
        {key: 'background', label: 'Background'},
        {key: 'onBackground', label: 'On Background'},
        {key: 'surface', label: 'Surface'},
        {key: 'onSurface', label: 'On Surface'},
        {key: 'surfaceVariant', label: 'Surface Variant'},
        {key: 'error', label: 'Error'},
        {key: 'onError', label: 'On Error'},
    ];

    return (
        <View style={styles.container}>
            <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
                {/* Info Card */}
                <Surface style={styles.infoCard} elevation={2}>
                    <Text variant="titleMedium" style={styles.infoTitle}>
                        {i18n.t('custom_theme_editor')}
                    </Text>
                    <Text variant="bodyMedium" style={styles.infoText}>
                        {i18n.t('choose_preset_or_customize')}
                    </Text>
                    {type === 'custom' && (
                        <Text variant="bodySmall"
                              style={[styles.infoText, {fontStyle: 'italic', color: theme.colors.primary}]}>
                            ✓ {i18n.t('custom_theme_active')}
                        </Text>
                    )}
                </Surface>

                {/* Base Theme Selector */}
                <View style={styles.section}>
                    <Text variant="titleSmall" style={styles.sectionTitle}>
                        Base Theme
                    </Text>
                    <Text variant="bodySmall" style={styles.sectionHint}>
                        Start with light or dark colors
                    </Text>
                    <SegmentedButtons
                        value={baseTheme}
                        onValueChange={(value) => loadBaseTheme(value as 'light' | 'dark')}
                        buttons={[
                            {
                                value: 'light',
                                label: 'Light Base',
                                icon: 'white-balance-sunny',
                            },
                            {
                                value: 'dark',
                                label: 'Dark Base',
                                icon: 'weather-night',
                            },
                        ]}
                        style={styles.segmentedButtons}
                    />
                </View>

                {/* Preset Themes */}
                <View style={styles.section}>
                    <Text variant="titleSmall" style={styles.sectionTitle}>
                        {i18n.t('theme_presets')}
                    </Text>
                    <Text variant="bodySmall" style={styles.sectionHint}>
                        {i18n.t('quick_start_preset')}
                    </Text>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.presetsScroll}
                    >
                        {THEME_PRESETS.map(preset => (
                            <Surface
                                key={preset.id}
                                style={[
                                    styles.presetCard,
                                    selectedPreset === preset.id && styles.presetCardSelected
                                ]}
                                elevation={selectedPreset === preset.id ? 4 : 1}
                            >
                                <View
                                    style={[
                                        styles.presetColorPreview,
                                        {backgroundColor: preset.colors.primary}
                                    ]}
                                />
                                <View style={styles.presetInfo}>
                                    <Text variant="labelLarge" style={styles.presetName}>
                                        {preset.name}
                                    </Text>
                                    <Text variant="bodySmall" style={styles.presetDescription}>
                                        {preset.description}
                                    </Text>
                                    <Button
                                        mode={selectedPreset === preset.id ? "contained" : "outlined"}
                                        onPress={() => applyPreset(preset)}
                                        style={styles.presetButton}
                                        compact
                                    >
                                        {selectedPreset === preset.id ? i18n.t('selected') : i18n.t('use')}
                                    </Button>
                                </View>
                            </Surface>
                        ))}
                    </ScrollView>
                </View>

                <Divider style={styles.divider}/>

                {/* Custom Colors */}
                <View style={styles.section}>
                    <Text variant="titleSmall" style={styles.sectionTitle}>
                        {i18n.t('customize_colors')}
                    </Text>
                    <Text variant="bodySmall" style={styles.sectionHint}>
                        {i18n.t('tap_color_to_customize')}
                    </Text>
                    {mainColorKeys.map(({key, label}) => (
                        <ColorItem
                            key={key}
                            label={label}
                            colorKey={key}
                            value={colors[key] as string}
                            onPress={() => openColorPicker(key, colors[key] as string)}
                        />
                    ))}
                </View>

                {/* Actions */}
                <View style={styles.actions}>
                    <Button
                        mode="contained"
                        onPress={applyCustomTheme}
                        style={styles.actionButton}
                        icon="check"
                    >
                        {i18n.t('apply_custom_theme')}
                    </Button>
                    <Button
                        mode="outlined"
                        onPress={() => setResetDialogVisible(true)}
                        style={styles.actionButton}
                        icon="restore"
                    >
                        {i18n.t('reset_to_defaults')}
                    </Button>
                </View>
            </ScrollView>

            {/* Color Picker Dialog */}
            <Portal>
                <Dialog visible={pickerVisible} onDismiss={() => setPickerVisible(false)}>
                    <Dialog.Title>
                        {i18n.t('select_color_for')} {currentColorKey}
                    </Dialog.Title>
                    <Dialog.Content>
                        <View style={styles.pickerContainer}>
                            <ColorPicker
                                color={currentColor}
                                onColorChange={setCurrentColor}
                                onColorChangeComplete={setCurrentColor}
                                thumbSize={30}
                                sliderSize={30}
                                noSnap={true}
                                row={false}
                            />
                        </View>
                        <TextInput
                            label={i18n.t('hex_color')}
                            value={currentColor}
                            onChangeText={setCurrentColor}
                            mode="outlined"
                            style={styles.hexInput}
                        />
                        <View style={[styles.colorPreview, {backgroundColor: currentColor}]}>
                            <Text style={styles.previewText}>{i18n.t('preview')}</Text>
                        </View>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setPickerVisible(false)}>{i18n.t('cancel')}</Button>
                        <Button onPress={saveColor}>{i18n.t('save')}</Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>

            {/* Reset Confirmation Dialog */}
            <Portal>
                <Dialog visible={resetDialogVisible} onDismiss={() => setResetDialogVisible(false)}>
                    <Dialog.Title>{i18n.t('reset_colors_question')}</Dialog.Title>
                    <Dialog.Content>
                        <Text variant="bodyMedium">
                            {i18n.t('reset_colors_warning')}
                        </Text>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setResetDialogVisible(false)}>{i18n.t('cancel')}</Button>
                        <Button onPress={resetToDefaults}>{i18n.t('reset')}</Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    content: {
        padding: 16,
    },
    infoCard: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 24,
    },
    infoTitle: {
        marginBottom: 8,
        fontWeight: 'bold',
    },
    infoText: {
        marginBottom: 4,
        opacity: 0.8,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        marginBottom: 4,
        fontWeight: 'bold',
    },
    sectionHint: {
        marginBottom: 12,
        opacity: 0.6,
    },
    divider: {
        marginVertical: 16,
    },
    segmentedButtons: {
        marginBottom: 8,
    },
    presetsScroll: {
        marginHorizontal: -16,
        paddingHorizontal: 16,
    },
    presetCard: {
        width: 200,
        marginRight: 12,
        borderRadius: 12,
        overflow: 'hidden',
    },
    presetCardSelected: {
        borderWidth: 2,
        borderColor: 'rgb(0, 95, 175)',
    },
    presetColorPreview: {
        height: 80,
    },
    presetInfo: {
        padding: 12,
    },
    presetName: {
        marginBottom: 4,
        fontWeight: 'bold',
    },
    presetDescription: {
        marginBottom: 8,
        opacity: 0.7,
        minHeight: 32,
    },
    presetButton: {
        marginTop: 4,
    },
    colorItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 12,
        marginBottom: 8,
        borderRadius: 8,
    },
    colorInfo: {
        flex: 1,
    },
    colorButton: {
        minWidth: 120,
    },
    colorButtonLabel: {
        fontSize: 11,
    },
    actions: {
        gap: 12,
        marginBottom: 32,
    },
    actionButton: {
        marginBottom: 8,
    },
    pickerContainer: {
        height: 300,
        marginBottom: 16,
    },
    hexInput: {
        marginTop: 8,
    },
    colorPreview: {
        height: 60,
        marginTop: 16,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    previewText: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#fff',
        textShadowColor: '#000',
        textShadowOffset: {width: 1, height: 1},
        textShadowRadius: 2,
    },
});

export type ThemeColors = {
    primary: string;
    onPrimary: string;
    primaryContainer: string;
    onPrimaryContainer: string;
    secondary: string;
    onSecondary: string;
    secondaryContainer: string;
    onSecondaryContainer: string;
    tertiary?: string;
    onTertiary?: string;
    tertiaryContainer?: string;
    onTertiaryContainer?: string;
    background: string;
    onBackground: string;
    surface: string;
    onSurface: string;
    surfaceVariant: string;
    onSurfaceVariant: string;
    surfaceDisabled?: string;
    onSurfaceDisabled?: string;
    error: string;
    onError: string;
    errorContainer: string;
    onErrorContainer: string;
    outline?: string;
    outlineVariant?: string;
    shadow?: string;
    scrim?: string;
    inverseSurface?: string;
    inverseOnSurface?: string;
    inversePrimary?: string;
    elevation?: {
        level0: string;
        level1: string;
        level2: string;
        level3: string;
        level4: string;
        level5: string;
    };
    [key: string]: any;
};

export default ThemeCustomizerScreen;