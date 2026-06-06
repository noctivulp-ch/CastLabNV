import React, {useState, useEffect} from 'react';
import {KeyboardAvoidingView, Keyboard, Platform, StyleSheet} from 'react-native';
import {Dialog} from 'react-native-paper';

type DialogProps = React.ComponentProps<typeof Dialog>;

export default function KeyboardAwareDialog({children, style, ...props}: DialogProps) {
    const [keyboardHeight, setKeyboardHeight] = useState(0);

    useEffect(() => {
        if (Platform.OS !== 'android') return;

        const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
            setKeyboardHeight(e.endCoordinates.height);
        });
        const hideSub = Keyboard.addListener('keyboardDidHide', () => {
            setKeyboardHeight(0);
        });

        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, []);

    if (Platform.OS === 'ios') {
        return (
            <KeyboardAvoidingView
                behavior="padding"
                style={styles.container}
                pointerEvents="box-none"
            >
                <Dialog style={style} {...props}>{children}</Dialog>
            </KeyboardAvoidingView>
        );
    }

    return (
        <Dialog
            style={[style, keyboardHeight > 0 && {marginBottom: keyboardHeight}]}
            {...props}
        >
            {children}
        </Dialog>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
    },
});
