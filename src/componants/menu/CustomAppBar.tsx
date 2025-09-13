import * as React from 'react';
import {useContext, useEffect} from 'react';
import {ActivityIndicator, Appbar} from 'react-native-paper';
import {StyleSheet} from "react-native";
import {initTranslate} from "../../localization/translate";
import {getHeaderTitle} from '@react-navigation/elements';
import {NativeStackHeaderProps,} from "@react-navigation/native-stack";
import {ThemeContext} from "../../contexts/theme-context";
import {CastManager} from "../../DLNACast/CastManager";
import {useCastManager} from "../../contexts/castManager-context";


interface CustomAppBarProps {
    castManager: CastManager;
    onButtonCastPressed?: () => Promise<void>;
}

const CustomAppBar: React.FC<NativeStackHeaderProps & CustomAppBarProps> = ({
                                                                                castManager,
                                                                                navigation,
                                                                                route,
                                                                                options,
                                                                                onButtonCastPressed
                                                                            }) => {
    const i18n = initTranslate();
    const [menuVisible, setMenuVisible] = React.useState(false);
    const {theme} = useContext(ThemeContext);
    const [castIcon, setCastIcon] = React.useState<string | null>(castManager?.isConnected() ? "cast-connected" : "cast");
    let title = getHeaderTitle(options, route.name);
    if (route.name === "Album" && route?.params?.album) {
        title = route.params.album.title;
    }
    const {isConnected} = useCastManager();

    useEffect(() => {
        if (isConnected) {
            setCastIcon("cast-connected");
        } else {
            setCastIcon("cast");
        }
    }, [isConnected]);


    const showMenu = () => {
        setMenuVisible(true);
    }
    const hideMenu = () => {
        setMenuVisible(false);
    }
    const displayBack = navigation.canGoBack();
    return (
        <Appbar.Header>
            {displayBack && <Appbar.BackAction onPress={() => {
                navigation.goBack();
            }}/>}
            <Appbar.Content title={title}/>
            {castIcon && <Appbar.Action icon={castIcon} onPress={onButtonCastPressed}/>}
            {!castIcon && <ActivityIndicator animating={true} color={theme.colors.text} size={"small"}
                                             style={{marginEnd: 10}}/>}
        </Appbar.Header>
    );
}
export default CustomAppBar;

const styles = StyleSheet.create({});