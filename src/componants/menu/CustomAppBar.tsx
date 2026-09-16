import * as React from 'react';
import {useContext, useEffect, useState} from 'react';
import {Appbar, Menu} from 'react-native-paper';
import {Platform, StyleSheet} from "react-native";
import {initTranslate} from "../../localization/translate";
import {getHeaderTitle} from '@react-navigation/elements';
import {NativeStackHeaderProps,} from "@react-navigation/native-stack";
import {ThemeContext} from "../../contexts/theme-context";
import {CastManager} from "../../DLNACast/CastManager";
import {CastUtils} from "../../DLNACast/utils/CastUtils";
import {useCastManager} from "../../contexts/castManager-context";

interface CustomAppBarProps {
    castManager: CastManager;
    onButtonCastPressed?: () => Promise<void>;
    onScreenSharePressed?: () => void;
    isScreenSharing?: boolean;
    onAudioSharePressed?: () => void;
    isAudioSharing?: boolean;
    themePressed: () => void;
    onPlaylistsPressed?: () => void;
    onVideoExtractorPressed?: () => void;
    onThemeCustomizerPressed?: () => void;
    onOpenFilePressed?: () => void;
    onCastUrlPressed?: () => void;
}

const CustomAppBar: React.FC<NativeStackHeaderProps & CustomAppBarProps> = ({
                                                                                castManager,
                                                                                navigation,
                                                                                route,
                                                                                options,
                                                                                themePressed,
                                                                                onButtonCastPressed,
                                                                                onScreenSharePressed,
                                                                                isScreenSharing,
                                                                                onAudioSharePressed,
                                                                                isAudioSharing,
                                                                                onPlaylistsPressed,
                                                                                onVideoExtractorPressed,
                                                                                onThemeCustomizerPressed,
                                                                                onOpenFilePressed,
                                                                                onCastUrlPressed
                                                                            }) => {
    const i18n = initTranslate();
    const [menuVisible, setMenuVisible] = useState(false);
    const {theme} = useContext(ThemeContext);
    const [castIcon, setCastIcon] = useState<string | null>(castManager?.isConnected() ? "cast-connected" : "cast");

    // Get title from options or route
    let title = getHeaderTitle(options, route.name);

    // Custom title logic for specific routes
    const params = route.params as Record<string, any> | undefined;
    if (route.name === "Album" && params?.album) {
        title = params.album.title;
    } else if (route.name === "PlaylistEdit" && params?.playlistName) {
        title = `${i18n.t('edit')} "${params.playlistName}"`;
    } else if (route.name === "MediaSelector") {
        if (params?.playlistName) {
            title = i18n.t('add_media_to_named_playlist', {playlistName: params.playlistName});
        } else {
            title = i18n.t('select_media_title');
        }
    } else if (route.name === "ThemeCustomizer") {
        title = i18n.t('theme_customizer');
    }

    const {isConnected, connectedDevice} = useCastManager();

    // A renderer that accepts no video cannot display a shared screen
    const screenShareSupported = CastUtils.mediaSupportOf(connectedDevice).video;
    const audioShareSupported = CastUtils.mediaSupportOf(connectedDevice).audio;

    // Determine if we should hide cast and menu buttons
    const hideCastAndMenu = [
        'PlaylistEdit',
        'MediaSelector',
        'ThemeCustomizer'
    ].includes(route.name);

    // Determine if we should hide only the playlists menu item
    const hidePlaylistsMenuItem = [
        'Playlists',
        'PlaylistEdit',
        'MediaSelector',
        'ThemeCustomizer'
    ].includes(route.name);

    // Determine if we should hide the video extractor menu item
    const hideVideoExtractorMenuItem = [
        'VideoExtractor',
        'PlaylistEdit',
        'MediaSelector',
        'ThemeCustomizer'
    ].includes(route.name);

    // Determine if we should hide the theme customizer menu item
    const hideThemeCustomizerMenuItem = [
        'ThemeCustomizer',
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

    const openVideoExtractor = () => {
        setMenuVisible(false);
        if (onVideoExtractorPressed) {
            onVideoExtractorPressed();
        }
    }

    const openThemeCustomizer = () => {
        setMenuVisible(false);
        if (onThemeCustomizerPressed) {
            onThemeCustomizerPressed();
        }
    }

    const openFile = () => {
        setMenuVisible(false);
        if (onOpenFilePressed) {
            onOpenFilePressed();
        }
    }

    const castUrl = () => {
        setMenuVisible(false);
        if (onCastUrlPressed) {
            onCastUrlPressed();
        }
    }

    const openAbout = () => {
        setMenuVisible(false);
        navigation.navigate('About');
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

            {/* Screen share button — visible on Android, grayed out when not connected */}
            {!hideCastAndMenu && Platform.OS === 'android' && screenShareSupported && (
                <Appbar.Action
                    icon={isScreenSharing ? 'monitor-share' : 'monitor'}
                    onPress={onScreenSharePressed}
                    disabled={!isConnected}
                    color={isScreenSharing ? theme.colors.primary : undefined}
                />
            )}

            {/* Audio share button, the counterpart for renderers without a display */}
            {!hideCastAndMenu && Platform.OS === 'android' && audioShareSupported && (
                <Appbar.Action
                    icon={isAudioSharing ? 'volume-high' : 'volume-medium'}
                    onPress={onAudioSharePressed}
                    disabled={!isConnected}
                    color={isAudioSharing ? theme.colors.primary : undefined}
                />
            )}

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

                    {/* Theme customizer menu item */}
                    {!hideThemeCustomizerMenuItem && (
                        <Menu.Item onPress={openThemeCustomizer} title={i18n.t('customize_theme')}
                                   leadingIcon={"palette"}
                                   accessibilityLabel={i18n.t('customize_theme')}/>
                    )}

                    {/* Open file picker */}
                    <Menu.Item onPress={openFile} title={i18n.t('open_file')} leadingIcon={"file-document-outline"}
                               accessibilityLabel={i18n.t('open_file')}/>

                    {/* Hand a stream URL straight to the renderer */}
                    {isConnected && (
                        <Menu.Item onPress={castUrl} title={i18n.t('cast_url')} leadingIcon={"link-variant"}
                                   accessibilityLabel={i18n.t('cast_url')}/>
                    )}

                    {/* Only show playlists menu item if not in playlists-related screens */}
                    {!hidePlaylistsMenuItem && (
                        <Menu.Item onPress={openPlaylists} title={i18n.t('playlists')} leadingIcon={"playlist-music"}
                                   accessibilityLabel={i18n.t('playlists')}/>
                    )}

                    {/* Only show video extractor menu item if not in video extractor screen */}
                    {!hideVideoExtractorMenuItem && (
                        <Menu.Item onPress={openVideoExtractor} title={i18n.t('video_extractor')}
                                   leadingIcon={"web"}
                                   accessibilityLabel={i18n.t('video_extractor')}/>
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