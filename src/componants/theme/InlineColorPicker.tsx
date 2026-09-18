import React, {useEffect} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {Button, Dialog, Portal, Text, TextInput} from 'react-native-paper';
import ColorPicker from 'react-native-wheel-color-picker';
import {useHexColorField} from '../../hooks/useHexColorField';

interface InlineColorPickerProps {
    visible: boolean;
    initialColor: string;
    colorKey: string;
    onSave: (color: string) => void;
    onDismiss: () => void;
}

/**
 * Inline Color Picker Dialog
 * A simpler alternative that can be used directly in dialogs or modals
 * without needing a full screen navigation
 */
const InlineColorPicker: React.FC<InlineColorPickerProps> = ({
                                                                 visible,
                                                                 initialColor,
                                                                 colorKey,
                                                                 onSave,
                                                                 onDismiss
                                                             }) => {
    const {
        color: selectedColor,
        hexText,
        reset,
        commit,
        onWheelChange,
        onWheelTouch,
        onHexChange,
        onHexBlur
    } = useHexColorField(initialColor);

    useEffect(() => {
        if (visible) reset(initialColor);
    }, [visible, initialColor, reset]);

    const handleSave = () => {
        onSave(commit());
    };

    return (
        <Portal>
            <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
                <Dialog.Title>Select {colorKey}</Dialog.Title>
                <Dialog.ScrollArea style={styles.scrollArea}>
                    <ScrollView>
                        <View style={styles.pickerContainer} onTouchStart={onWheelTouch}>
                            <ColorPicker
                                color={selectedColor}
                                onColorChange={onWheelChange}
                                onColorChangeComplete={onWheelChange}
                                thumbSize={30}
                                sliderSize={30}
                                noSnap={true}
                                row={false}
                            />
                        </View>
                        <TextInput
                            label="Hex Color"
                            value={hexText}
                            onChangeText={onHexChange}
                            onBlur={onHexBlur}
                            autoCapitalize="none"
                            autoCorrect={false}
                            mode="outlined"
                            style={styles.input}
                        />
                        <View style={[styles.preview, {backgroundColor: selectedColor}]}>
                            <Text style={styles.previewText}>Preview</Text>
                        </View>
                    </ScrollView>
                </Dialog.ScrollArea>
                <Dialog.Actions>
                    <Button onPress={onDismiss}>Cancel</Button>
                    <Button onPress={handleSave}>Save</Button>
                </Dialog.Actions>
            </Dialog>
        </Portal>
    );
};

const styles = StyleSheet.create({
    dialog: {
        maxHeight: '80%',
    },
    scrollArea: {
        paddingHorizontal: 0,
    },
    pickerContainer: {
        height: 300,
        padding: 20,
    },
    input: {
        marginHorizontal: 20,
        marginTop: 10,
    },
    preview: {
        height: 60,
        margin: 20,
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

export default InlineColorPicker;