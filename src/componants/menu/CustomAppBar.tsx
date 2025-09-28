import * as React from 'react';
import {useContext, useEffect, useState} from 'react';
import {Appbar, Menu} from 'react-native-paper';
import {Platform, StyleSheet} from "react-native";
import {initTranslate} from "../../localization/translate";
import {getHeaderTitle} from '@react-navigation/elements';
import {NativeStackHeaderProps,} from "@react-navigation/native-stack";
import {ThemeContext} from "../../contexts/theme-context";
import {CastManager} from "../../DLNACast/CastManager";
import {useCastManager} from "../../contexts/castManager-context";

interface CustomAppBarProps {
    castManager: CastManager;
    onButtonCastPressed?: () => Promise<void>;
    infoPress: () => void;
    themePressed: () => void;
    onPlaylistsPressed?: () => void;
}

const CustomAppBar: React.FC<NativeStackHeaderProps & CustomAppBarProps> = ({
                                                                                castManager,
                                                                                navigation,
                                                                                route,
                                                                                options,
                                                                                infoPress,
                                                                                themePressed,
                                                                                onButtonCastPressed,
                                                                                onPlaylistsPressed
                                                                            }) => {
    const i18n = initTranslate();
    const [menuVisible, setMenuVisible] = useState(false);
    const {theme} = useContext(ThemeContext);
    const [castIcon, setCastIcon] = useState<string | null>(castManager?.isConnected() ? "cast-connected" : "cast");
    let title = getHeaderTitle(options, route.name);
    if (route.name === "Album" && route?.params?.album) {
        title = route.params.album.title;
    }
    const {isConnected} = useCastManager();

    // Determine if we should hide cast and menu buttons
    const hideCastAndMenu = [
        'PlaylistEdit',
        'MediaSelector'
    ].includes(route.name);

    // Determine if we should hide only the playlists menu item
    const hidePlaylistsMenuItem = [
        'Playlists',
        'PlaylistEdit',
        'MediaSelector'
    ].includes(route.name);

    useEffect(() => {
        if (isConnected) {
            setCastIcon("cast-connected");
        } else {
            setCastIcon("cast");
        }
    }, [isConnected]);

    const changeTheme = () => {
        setMenuVisible(false);
        themePressed();
    }

    const openPlaylists = () => {
        setMenuVisible(false);
        if (onPlaylistsPressed) {
            onPlaylistsPressed();
        }
    }

    const openAbout = () => {
        setMenuVisible(false);
        infoPress();
    }

    const showMenu = () => {
        setMenuVisible(true);
    }

    const hideMenu = () => {
        setMenuVisible(false);
    }

    const MORE_ICON = Platform.OS === 'ios' ? 'dots-horizontal' : 'dots-vertical';
    const displayBack = navigation.canGoBack();

    return (
        <Appbar.Header>
            {displayBack && <Appbar.BackAction onPress={() => {
                navigation.goBack();
            }}/>}
            <Appbar.Content title={title}/>

            {/* Only show cast button if not in hidden screens */}
            {!hideCastAndMenu && castIcon && (
                <Appbar.Action icon={castIcon} onPress={onButtonCastPressed}/>
            )}

            {/* Only show menu if not in hidden screens */}
            {!hideCastAndMenu && (
                <Menu
                    visible={menuVisible}
                    onDismiss={hideMenu}
                    anchorPosition={"bottom"}
                    anchor={<Appbar.Action icon={MORE_ICON} onPress={showMenu}
                                           accessibilityLabel={i18n.t('contextual_menu')}/>}>
                    <Menu.Item onPress={changeTheme} title={i18n.t('change_theme')} leadingIcon={"theme-light-dark"}
                               accessibilityLabel={i18n.t('change_theme')}/>

                    {/* Only show playlists menu item if not in playlists-related screens */}
                    {!hidePlaylistsMenuItem && (
                        <Menu.Item onPress={openPlaylists} title={i18n.t('playlists')} leadingIcon={"playlist-music"}
                                   accessibilityLabel={i18n.t('playlists')}/>
                    )}

                    <Menu.Item onPress={openAbout} title={i18n.t('about')}
                               leadingIcon={"comment-question-outline"}
                               accessibilityLabel={i18n.t('about')}/>
                </Menu>
            )}
        </Appbar.Header>
    );
}

export default CustomAppBar;

const styles = StyleSheet.create({});