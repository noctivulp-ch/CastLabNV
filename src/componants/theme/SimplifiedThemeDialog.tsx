import React, {useContext, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {Button, Chip, Dialog, Portal, RadioButton, Text} from 'react-native-paper';
import {ThemeContext} from '../../contexts/theme-context';
import InlineColorPicker from './InlineColorPicker';

interface SimplifiedThemeDialogProps {
    visible: boolean;
    onDismiss: () => void;
    onNavigateToFullCustomizer?: () => void;
}

/**
 * Simplified Theme Dialog
 * Combines theme selection with quick color customization
 * Alternative to having a separate full-screen customizer
 */
const SimplifiedThemeDialog: React.FC<SimplifiedThemeDialogProps> = ({
                                                                         visible,
                                                                         onDismiss,
                                                                         onNavigateToFullCustomizer
                                                                     }) => {
    const {theme, type: themeType, setTheme, customColors, setCustomColors} = useContext(ThemeContext);
    const [pickerVisible, setPickerVisible] = useState(false);
    const [selectedColorKey, setSelectedColorKey] = useState('');
    const [selectedColor, setSelectedColor] = useState('');

    const handleOpenColorPicker = (colorKey: string, currentColor: string) => {
        setSelectedColorKey(colorKey);
        setSelectedColor(currentColor);
        setPickerVisible(true);
    };

    const handleSaveColor = async (color: string) => {
        // Update custom colors
        const newColors = {
            ...(customColors || theme.colors),
            [selectedColorKey]: color,
        };

        // Save colors and switch to custom theme
        await setCustomColors(newColors);
        await setTheme('custom');

        setPickerVisible(false);
    };

    const quickColors = [
        {key: 'primary', label: 'Primary', color: theme.colors.primary},
        {key: 'secondary', label: 'Secondary', color: theme.colors.secondary},
        {key: 'background', label: 'Background', color: theme.colors.background},
        {key: 'surface', label: 'Surface', color: theme.colors.surface},
    ];

    return (
        <>
            <Portal>
                <Dialog visible={visible} onDismiss={onDismiss}>
                    <Dialog.Title>Theme Settings</Dialog.Title>
                    <Dialog.ScrollArea>
                        <View style={styles.content}>
                            {/* Theme Type Selection */}
                            <Text variant="labelLarge" style={styles.sectionTitle}>
                                Theme Mode
                            </Text>
                            <RadioButton.Group
                                onValueChange={value => setTheme(value)}
                                value={themeType}
                            >
                                <RadioButton.Item label="Light" value="light"/>
                                <RadioButton.Item label="Dark" value="dark"/>
                                <RadioButton.Item label="Auto (Day/Night)" value="auto"/>
                                <RadioButton.Item label="Custom" value="custom"/>
                            </RadioButton.Group>

                            {/* Quick Color Customization */}
                            <Text variant="labelLarge" style={styles.sectionTitle}>
                                Quick Colors
                            </Text>
                            <Text variant="bodySmall" style={styles.hint}>
                                Tap a color to customize
                            </Text>

                            <View style={styles.colorChips}>
                                {quickColors.map(({key, label, color}) => (
                                    <Chip
                                        key={key}
                                        icon="palette"
                                        style={[styles.chip, {backgroundColor: color}]}
                                        textStyle={styles.chipText}
                                        onPress={() => handleOpenColorPicker(key, color)}
                                    >
                                        {label}
                                    </Chip>
                                ))}
                            </View>

                            {/* Advanced Customization Button */}
                            {onNavigateToFullCustomizer && (
                                <Button
                                    mode="outlined"
                                    icon="palette-advanced"
                                    onPress={() => {
                                        onDismiss();
                                        onNavigateToFullCustomizer();
                                    }}
                                    style={styles.advancedButton}
                                >
                                    Advanced Color Editor
                                </Button>
                            )}
                        </View>
                    </Dialog.ScrollArea>
                    <Dialog.Actions>
                        <Button onPress={onDismiss}>Close</Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>

            {/* Color Picker Dialog */}
            <InlineColorPicker
                visible={pickerVisible}
                initialColor={selectedColor}
                colorKey={selectedColorKey}
                onSave={handleSaveColor}
                onDismiss={() => setPickerVisible(false)}
            />
        </>
    );
};

const styles = StyleSheet.create({
    content: {
        paddingHorizontal: 24,
    },
    sectionTitle: {
        marginTop: 16,
        marginBottom: 8,
        fontWeight: 'bold',
    },
    hint: {
        marginBottom: 12,
        opacity: 0.7,
    },
    colorChips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 16,
    },
    chip: {
        marginRight: 8,
        marginBottom: 8,
    },
    chipText: {
        color: '#fff',
        fontWeight: 'bold',
        textShadowColor: '#000',
        textShadowOffset: {width: 1, height: 1},
        textShadowRadius: 2,
    },
    advancedButton: {
        marginTop: 8,
        marginBottom: 16,
    },
});

export default SimplifiedThemeDialog;