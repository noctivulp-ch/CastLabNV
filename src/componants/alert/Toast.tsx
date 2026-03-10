import * as React from 'react';
import {useContext, useEffect} from 'react';
import Toast, {BaseToast, ErrorToast, ToastType} from "react-native-toast-message";
import {ThemeContext} from "../../contexts/theme-context";


interface SnackbarProps {
    type?: ToastType, //success, error, info
    time?: number, //duration in ms
    text1?: string, //Title
    text2?: string, //Bottom text
    visible: boolean, //Visible
    onToastHide?: () => void, //When hide is triggered after time
    bottomOffset?: number, //Offset from bottom to avoid overlapping player
}

const ToastMessage: React.FC<SnackbarProps> = ({type, time = 2000, text1, text2, visible, onToastHide, bottomOffset}) => {
    const {theme} = useContext(ThemeContext);
    useEffect(() => {
        if (visible) {
            Toast.show({
                type: type,
                text1: text1,
                text2: text2,
            })
        } else {
            Toast.hide();
        }
    }, [visible]);
    const toastConfig = {
        info: (props: any) => (
            <BaseToast
                text1NumberOfLines={2}
                text2NumberOfLines={5}
                {...props}
                style={{
                    backgroundColor: theme.colors.background,
                    borderLeftColor: theme.colors.secondary,
                    marginBottom: 20
                }}
                text1Style={{
                    fontSize: 16,
                    color: theme.colors.onBackground,
                }}
                text2Style={{
                    color: theme.colors.onBackground,
                }}
            />
        ),
        error: (props: any) => (
            <ErrorToast
                {...props}
                text1NumberOfLines={2}
                text2NumberOfLines={5}
                style={{
                    backgroundColor: theme.colors.background,
                    borderLeftColor: theme.colors.error,
                    marginBottom: 20
                }}
                text1Style={{
                    fontSize: 16,
                    color: theme.colors.onBackground,
                }}
                text2Style={{
                    color: theme.colors.onBackground,
                }}
            />
        ),
    }

    return (
        <Toast config={toastConfig} position={"bottom"} bottomOffset={bottomOffset || 40} visibilityTime={time} autoHide={true} onHide={onToastHide}/>
    );
};
export default ToastMessage;