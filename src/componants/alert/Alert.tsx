import * as React from 'react';
import {Button, Dialog, Portal, Text} from 'react-native-paper';
import {initTranslate} from "../../localization/translate";


interface AlertProps {
    title: string,
    message: string,
    visible: boolean,
    hideDialog?: () => void
}

const Alert: React.FC<AlertProps> = ({title, message, visible, hideDialog}) => {
    const i18n = initTranslate();

    return (
        <Portal>
            <Dialog visible={visible} onDismiss={hideDialog}>
                <Dialog.Title>{title}</Dialog.Title>
                <Dialog.Content>
                    <Text variant="bodyMedium">{message}</Text>
                </Dialog.Content>
                <Dialog.Actions>
                    <Button onPress={hideDialog}>{i18n.t('close')}</Button>
                </Dialog.Actions>
            </Dialog>
        </Portal>
    );
};

export default Alert;