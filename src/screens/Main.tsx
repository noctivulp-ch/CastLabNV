import {Button, Dialog, PaperProvider, Portal, RadioButton} from "react-native-paper";
import {NavigationContainer, NavigationProp} from "@react-navigation/native";
import React, {useCallback, useContext, useEffect, useMemo, useRef, useState} from "react";
import {ThemeContext} from "../contexts/theme-context";
import AlbumsScreen, {AlbumsScreenRef} from "./AlbumsScreen";
import {combineReducers, configureStore} from "@reduxjs/toolkit";
import {Appearance, GestureResponderEvent, Platform} from "react-native";
import {SETTINGS_THEME} from "../constants/AsyncStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {StatusBar} from "expo-status-bar";
import {createNativeStackNavigator} from "@react-navigation/native-stack";
import CustomAppBar from "../componants/menu/CustomAppBar";
import {initTranslate} from "../localization/translate";
import {Album, Asset} from "expo-media-library";
import AlbumScreen, {AlbumScreenRef} from "./AlbumScreen";
import {Device} from '../DLNACast/types/Device';
import {Provider as ReduxProvider, useDispatch, useSelector} from "react-redux";
import CastDevicesPopup from "../componants/popup/CastDevicesPopup";
import {SERVER_PORT} from "../constants/Values";
import StaticServer, {resolveAssetsPath} from "@dr.pogodin/react-native-static-server";
import * as Network from "expo-network";
import {copyFile, downloadFile, exists} from "@dr.pogodin/react-native-fs";
import {useMigrations} from "drizzle-orm/expo-sqlite/migrator";
import migrations from "../../drizzle/migrations";
import * as SQLite from "expo-sqlite";
import {drizzle} from "drizzle-orm/expo-sqlite";
import PlayerController from "../componants/player/PlayerController";
import {useCastManager} from "../contexts/castManager-context";
import Toast from "../componants/alert/Toast";
import * as FileSystem from 'expo-file-system/legacy';
import {Asset as ExpoAsset} from 'expo-asset';
import {useBackgroundNotification} from '../hooks/useBackgroundNotification';
import {activateKeepAwakeAsync, deactivateKeepAwake} from "expo-keep-awake";
import * as DocumentPicker from 'expo-document-picker';
import castReducer, {addToAssets, setCurrentAsset} from "../store/slice/castSlice";
import PlaylistsScreen, {PlaylistsScreenRef} from "../screens/PlaylistsScreen";
import PlaylistEditScreen from "../screens/PlaylistEditScreen";
import MediaSelectorScreen from "../screens/MediaSelectorScreen";
import VideoExtractorScreen from "./VideoExtractorScreen";
import AboutScreen from "./AboutScreen";
import ThemeCustomizerScreen from "./ThemeCustomizerScreen";
import {CastUtils} from "../DLNACast/utils/CastUtils";
import * as ScreenShare from '../../modules/expo-screen-share/src';
import {SCREEN_SHARE_PORT} from "../constants/Values";

const rootReducer = combineReducers({
    cast: castReducer,
});

// Configure the Redux store
const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: {
                // Ignore these action types for serializable check
                ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE'],
            },
        }),
});

export type IRootState = ReturnType<typeof rootReducer>;

// Navigation parameter types
export type RootStackParamList = {
    Albums: { playerHeight?: number };
    Album: { album: Album, videoOnly: boolean, playerHeight?: number, initialMediaType?: string };
    Playlists: { playerHeight?: number };
    PlaylistEdit: {
        playlistId: number;
        isNew?: boolean;
        playlistName?: string;
    };
    MediaSelector: {
        allowMultiple?: boolean;
        playlistId: number;
    };
    VideoExtractor: { playerHeight?: number };
    ThemeCustomizer: {};
    About: undefined;
}

const isIOS = Platform.OS === 'ios';
const expo = SQLite.openDatabaseSync('db.db');
const db = drizzle(expo);
const MainContent: React.FC = () => {
    const {setTheme, theme, statusBarTheme, type: themeType} = useContext(ThemeContext);
    const Stack = createNativeStackNavigator<RootStackParamList>();
    const i18n = useMemo(() => initTranslate(), []);

    // UI state management
    const [alertVisible, setAlertVisible] = useState<boolean>(false);
    const [toastVisible, setToastVisible] = useState<boolean>(false);
    const [playerVisible, setPlayerVisible] = useState<boolean>(false);
    const [alertTitle, setAlertTitle] = useState<string>("");
    const [alertMessage, setAlertMessage] = useState<string>("");
    const [toastText1, setToastText1] = useState<string>("");
    const [toastText2, setToastText2] = useState<string>("");
    const [toastType, setToastType] = useState<"info" | "error">("info");
    const [castDialogVisible, setCastDialogVisible] = useState(false);
    const [screenSharing, setScreenSharing] = useState(false);
    const [aboutDialogVisible, setAboutDialogVisible] = useState(false);
    const [themeDialogVisible, setThemeDialogVisible] = useState(false);
    const [playerCompactMode, setPlayerCompactMode] = useState<boolean>(false);
    const dispatch = useDispatch();
    // Player height management and manual compact mode state
    const [playerHeight, setPlayerHeight] = useState<number>(0);
    const [manualCompactMode, setManualCompactMode] = useState<boolean>(false);
    const loadMoreAssetsRef = useRef<(() => Promise<void>) | null>(null);

    // Playlist refresh management
    const [playlistsScreenRef, setPlaylistsScreenRef] = useState<PlaylistsScreenRef | null>(null);

    // Redux and database setup
    const cast = useSelector((state: IRootState) => state.cast);

    const {success} = useMigrations(db, migrations);

    // Cast management
    const {castManager, devices, error, connectedDevice, isConnected} = useCastManager();
    const prevConnectedDevice = useRef(connectedDevice);

    // Server management
    const serverRef = useRef<StaticServer | null>(null);

    // Toast helpers
    const showInfoToast = useCallback((text1: string, text2 = "") => {
        setToastType("info");
        setToastText1(text1);
        setToastText2(text2);
        setToastVisible(true);
    }, []);

    const showErrorToast = useCallback((text1: string, text2 = "") => {
        setToastType("error");
        setToastText1(text1);
        setToastText2(text2);
        setToastVisible(true);
    }, []);

    // Initialize background notifications
    useBackgroundNotification();

    // Load theme preference from storage on initialization
    useEffect(() => {
        AsyncStorage.getItem(SETTINGS_THEME).then((value) => {
            setTheme(value ? value : "auto");
        });
    }, []);

    // Handle cast manager errors with toast notifications
    useEffect(() => {
        if (error) {
            console.error(error);
            showErrorToast(error);
        }
    }, [error, showErrorToast]);

    // Update player visibility based on connected device
    useEffect(() => {
        setPlayerVisible(connectedDevice != null);
    }, [connectedDevice]);

    // Enhanced media casting handler with autoplay support
    useEffect(() => {
        (async () => {
            if (cast?.currentAsset) {
                let uri;
                const asset: Asset = cast.currentAsset;
                const album_id = asset?.albumId?.replace("\"", "").replace("'", "").replace("-", "");

                // Include album ID if a file has the same name in a different album
                const serverFileName = encodeURIComponent((album_id && album_id.length > 0 ? album_id + "_" : "") + asset.filename.replace("\"", "").replace("'", ""));
                const fileDir = resolveAssetsPath("webroot");

                // Check if the file was not previously copied to fileDir
                if (!await exists(fileDir + "/" + serverFileName)) {
                    try {
                        await copyFile(asset.uri, fileDir + "/" + serverFileName);
                    } catch (error) {
                        // Show error toast for file copy failures
                        showErrorToast(i18n.t('failed_to_prepare_media_file'), i18n.t('check_storage_permissions_and_try_again'));
                        return;
                    }
                }

                // Get the internal network IP address of the device
                const ip: string = await Network.getIpAddressAsync();
                uri = `http://${ip}:${SERVER_PORT}/${serverFileName}`;

                if (uri) {
                    try {
                        // Determine media type and build metadata
                        const isImage = asset.mediaType === 'photo' ||
                            (asset.filename && ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif']
                                .includes(asset.filename.split('.').pop()?.toLowerCase() || ''));

                        const metadata = {
                            title: asset.filename,
                            images: [{url: uri, width: asset.width, height: asset.height}],
                        };

                        // Start casting the new media
                        await castManager.castMedia({
                            contentUrl: uri,
                            contentType: CastUtils.getMimeTypeFromUrl(asset.filename),
                            metadata,
                            streamDuration: asset.duration || (isImage ? 0 : undefined),
                        });

                        // Show success toast for first media or when manually selecting
                        if (cast.assets.length === 1 || cast.currentIndex === 0) {
                            showInfoToast(i18n.t('now_casting', {filename: asset.filename}), connectedDevice?.name || "");
                        }

                    } catch (castError) {
                        console.error('Main: Failed to cast media:', castError);
                        // Clear the asset from Redux to prevent re-triggering
                        dispatch(setCurrentAsset(null));
                        // Show error toast for casting failures
                        const errorMessage = (castError as Error).message;
                        if (!errorMessage.includes('No device connected')) {
                            showErrorToast(i18n.t('failed_to_cast_media'), errorMessage || i18n.t('unknown_error'));
                        }
                    }
                }
            }
        })();
    }, [cast?.currentAsset, connectedDevice?.name, i18n]);

    /**
     * Callback for autoplay to load more assets from the current screen
     */
    const handleLoadMoreAssets = useCallback(async () => {
        if (loadMoreAssetsRef.current) {
            try {
                await loadMoreAssetsRef.current();
            } catch (error) {
                console.error('Main: Failed to load more assets:', error);
            }
        }
    }, []);

    /**
     * Handle theme customizer button press - navigate to theme customizer screen
     */
    const handleThemeCustomizerPressed = useCallback((navigation: NavigationProp<RootStackParamList>) => {
        navigation.navigate('ThemeCustomizer', {});
    }, []);

    /**
     * Callback to handle scroll direction changes from screens
     * Only applies automatic compact mode if not manually overridden
     */
    const handleScrollDirectionChange = useCallback((isScrollingDown: boolean) => {
        // Only auto-set compact mode if not manually controlled
        if (!manualCompactMode) {
            setPlayerCompactMode(isScrollingDown);
        }
    }, [manualCompactMode]);

    /**
     * Handle manual toggle of compact mode
     * Overrides automatic scroll-based compact mode behavior
     */
    const handleToggleCompactMode = useCallback(() => {
        setManualCompactMode(prev => {
            const newManualMode = !prev;
            // Reset to normal mode when disabling manual control
            if (!newManualMode) {
                setPlayerCompactMode(false);
            } else {
                // Enable compact mode when taking manual control
                setPlayerCompactMode(true);
            }
            return newManualMode;
        });
    }, []);

    /**
     * Reset manual compact mode state when player becomes invisible
     */
    useEffect(() => {
        if (!playerVisible) {
            setManualCompactMode(false);
            setPlayerCompactMode(false);
        }
    }, [playerVisible]);

    /**
     * Callback to handle player height changes from PlayerController
     */
    const handlePlayerHeightChange = useCallback((height: number) => {
        setPlayerHeight(height);
    }, []);

    /**
     * Handle device selection from cast popup
     */
    const devicePressedHandler = useCallback(async (event: GestureResponderEvent, device: Device) => {
        try {
            await castManager.connect(device);
            setCastDialogVisible(false);

            // Show connection success toast
            showInfoToast(i18n.t('connected_to_device', {deviceName: device.name}), i18n.t('ready_to_cast_media'));

        } catch (connectError) {
            console.error('Main: Failed to connect to device:', connectError);

            // Show connection error toast
            showErrorToast(i18n.t('failed_to_connect_to_device', {deviceName: device.name}), (connectError as Error).message || i18n.t('connection_failed'));
        }
    }, [castManager, i18n]);

    /**
     * Handle cast button press - connect/disconnect or show device list
     */
    const buttonCastPressed = async () => {
        if (castManager.isConnected()) {
            try {
                await castManager.disconnect();

                // Show disconnection toast
                showInfoToast(i18n.t('disconnected_from_cast_device'));

            } catch (disconnectError) {
                console.error('Main: Failed to disconnect:', disconnectError);
                showErrorToast(i18n.t('failed_to_disconnect'), (disconnectError as Error).message || i18n.t('disconnect_failed'));
            }
        } else {
            if (castManager.isSearching()) {
                await castManager.stopSearch();
            }
            castManager.startSearch();
            setCastDialogVisible(true);
        }
    };

    /**
     * Handle screen share button press
     */
    const handleScreenSharePressed = useCallback(async () => {
        if (Platform.OS !== 'android') return;

        if (screenSharing) {
            await ScreenShare.stopScreenShare();
            setScreenSharing(false);
            try {
                await castManager.stop();
            } catch (_) {}
            showInfoToast(i18n.t('screen_share_stopped'));
            return;
        }

        const startSub = ScreenShare.addScreenShareListener('onScreenShareStarted', async (payload) => {
            setScreenSharing(true);
            startSub.remove();
            try {
                const ip = await Network.getIpAddressAsync();
                const streamUrl = `http://${ip}:${SCREEN_SHARE_PORT}/stream`;
                await castManager.castMedia({
                    contentUrl: streamUrl,
                    contentType: 'video/mp2t',
                    metadata: {title: 'Screen Share', type: 'movie', images: []},
                });
                showInfoToast(i18n.t('screen_share_started'));
            } catch (e) {
                showErrorToast(i18n.t('screen_share_failed'), (e as Error).message);
                await ScreenShare.stopScreenShare();
                setScreenSharing(false);
            }
        });

        const errorSub = ScreenShare.addScreenShareListener('onScreenShareError', (payload) => {
            errorSub.remove();
            startSub.remove();
            showErrorToast(i18n.t('screen_share_failed'), payload.error);
        });

        try {
            await ScreenShare.requestScreenShare(SCREEN_SHARE_PORT);
        } catch (e) {
            startSub.remove();
            errorSub.remove();
            showErrorToast(i18n.t('screen_share_failed'), (e as Error).message);
        }
    }, [screenSharing, castManager, i18n]);

    /**
     * Handle adding a manual FCast device
     */
    const handleAddFCastDevice = useCallback((ip: string, port: number, name?: string) => {
        castManager.addFCastDevice(ip, port, name);
    }, [castManager]);

    /**
     * Handle playlists button press - navigate to playlists screen
     */
    const handlePlaylistsPressed = useCallback((navigation: NavigationProp<RootStackParamList>) => {
        navigation.navigate('Playlists', {});
    }, []);

    /**
     * Handle playlist saved callback - refresh playlists list
     */
    const handlePlaylistSaved = useCallback(() => {
        if (playlistsScreenRef) {
            playlistsScreenRef.refreshPlaylists();
        }
    }, [playlistsScreenRef]);


    /**
     * Handle video extractor button press - navigate to video extractor screen
     */
    const handleVideoExtractorPressed = useCallback((navigation: NavigationProp<RootStackParamList>) => {
        navigation.navigate('VideoExtractor', {});
    }, []);

    /**
     * Handle open file button press - pick files via native file picker and cast them
     */
    const handleOpenFile = useCallback(async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: ['video/*', 'audio/*', 'image/*'],
                multiple: true,
                copyToCacheDirectory: true,
            });

            if (result.canceled || !result.assets || result.assets.length === 0) {
                return;
            }

            const pickedAssets: Asset[] = result.assets.map((file) => {
                let mediaType: 'photo' | 'video' | 'audio' = 'video';
                if (file.mimeType?.startsWith('image/')) {
                    mediaType = 'photo';
                } else if (file.mimeType?.startsWith('audio/')) {
                    mediaType = 'audio';
                }

                return {
                    id: `file-${Date.now()}-${file.name}`,
                    filename: file.name,
                    uri: file.uri,
                    mediaType,
                    width: 0,
                    height: 0,
                    duration: 0,
                    creationTime: Date.now(),
                    modificationTime: Date.now(),
                    albumId: '',
                } as Asset;
            });

            if (pickedAssets.length > 0) {
                dispatch(addToAssets(pickedAssets));
                dispatch(setCurrentAsset(pickedAssets[0]));
            }
        } catch (error) {
            console.error('Main: File picker error:', error);
            showErrorToast(i18n.t('no_files_selected'));
        }
    }, [dispatch, i18n, showErrorToast]);


    /**
     * Delete all files from the server directory
     */
    const deleteFiles = async () => {
        const SERVER_FILE_DIRECTORY = `${FileSystem.documentDirectory}webroot/`;
        try {
            await FileSystem.deleteAsync(SERVER_FILE_DIRECTORY, {idempotent: true});
            await FileSystem.makeDirectoryAsync(SERVER_FILE_DIRECTORY, {intermediates: true});
        } catch (error) {
            console.error('Main: Error in deleteFiles:', error);
        }
    };


    /**
     * Show theme picker dialog
     */
    const displayThemePicker = () => {
        setThemeDialogVisible(true);
    }

    // Keep device awake when connected for autoplay functionality
    useEffect(() => {
        if (connectedDevice) {
            activateKeepAwakeAsync();
        } else {
            deactivateKeepAwake();
        }
    }, [connectedDevice]);

    // Server management effect - starts/stops server based on device connection
    useEffect(() => {
        let isMounted = true;

        const startServers = async () => {
            const currentServer = serverRef.current;

            // Stop servers if no device connected
            if (!connectedDevice) {
                try {
                    if (currentServer) {
                        await currentServer.stop();
                    }
                    serverRef.current = null;
                } catch (err) {
                    console.error('Main: Error stopping servers:', (err as Error).message);
                }
                return;
            }

            try {
                const ip = await Network.getIpAddressAsync();
                const fileDir = resolveAssetsPath('webroot');

                console.log(`Main: Starting media server on ${ip}:${SERVER_PORT}`);

                // DLNA server configuration with proper headers
                const extraConfig = `server.range-requests = "enable"
                    server.modules += ("mod_setenv")
                    setenv.add-response-header = (
                        "transferMode.dlna.org" => "Streaming",
                        "contentFeatures.dlna.org" => "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=017000 00000000000000000000000000000000",
                        "Access-Control-Allow-Origin" => "*",
                        "Access-Control-Allow-Methods" => "GET, POST, PUT, DELETE, OPTIONS, HEAD"
                    )
                    server.modules += ("mod_dirlisting")
                    dir-listing.activate="enable"`;

                // Copy favicon.png to webroot/icon.png
                const favicon = ExpoAsset.fromModule(require("../../assets/favicon.png"));
                const iconPath = `${fileDir}/icon.png`;
                try {
                    const faviconInfo = await FileSystem.getInfoAsync(iconPath);
                    if (!faviconInfo.exists) {
                        await downloadFile({fromUrl: favicon.uri, toFile: iconPath});
                    }
                } catch (err) {
                    console.error('Main: Error when loading favicon:', (err as Error).message);
                }

                if (isMounted) {
                    // Stop existing servers before starting new ones
                    if (currentServer) {
                        await currentServer.stop();
                    }

                    serverRef.current = new StaticServer({
                        fileDir,
                        extraConfig,
                        port: SERVER_PORT,
                        nonLocal: true,
                        stopInBackground: false,
                        hostname: ip,
                        errorLog: {
                            conditionHandling: true,
                            fileNotFound: true,
                            requestHandling: true,
                            requestHeader: true,
                            requestHeaderOnError: true,
                            responseHeader: true,
                            timeouts: true,
                        },
                    });

                    await serverRef.current.start();

                    serverRef.current.addStateListener((newState, details, error) => {
                        if (error) console.error('Main: StaticServer error:', error);
                    });
                }
            } catch (err) {
                console.error('Main: Error starting servers:', (err as Error).message);

                // Show server start error toast
                showErrorToast(i18n.t('failed_to_start_media_server'), i18n.t('media_casting_may_not_work_properly'));
            }
        };

        startServers();
        prevConnectedDevice.current = connectedDevice;

        return () => {
            isMounted = false;
            (async () => {
                const stopPromises = [];
                if (serverRef.current) {
                    stopPromises.push(
                        serverRef.current.stop().catch((err: Error) => console.error('Main: Error stopping StaticServer:', err.message))
                    );
                    serverRef.current = null;
                }
                await Promise.all(stopPromises);
            })();
        };
    }, [connectedDevice]);

    // App initialization effect
    useEffect(() => {
        deleteFiles();

        // Start device discovery (except on iOS where we wait for user action)
        if (!isIOS) {
            castManager.startSearch();
        }

        // Listen for system theme changes
        const themeListener = Appearance.addChangeListener(scheme => {
            setTheme(scheme.colorScheme === "dark" ? "dark" : "light");
        });

        return () => {
            themeListener.remove();
            deleteFiles();
        }
    }, [castManager]);

    return (
        <PaperProvider theme={theme}>
            <NavigationContainer theme={statusBarTheme}>
                <Stack.Navigator
                    initialRouteName="Albums"
                    screenOptions={({navigation}) => ({
                        headerShown: true,
                        gestureEnabled: true,
                        title: i18n.t('albums'),
                        header: (props) => <CustomAppBar
                            {...props}
                            onButtonCastPressed={buttonCastPressed}
                            onScreenSharePressed={handleScreenSharePressed}
                            isScreenSharing={screenSharing}
                            onPlaylistsPressed={() => handlePlaylistsPressed(navigation)}
                            onVideoExtractorPressed={() => handleVideoExtractorPressed(navigation)}
                            onThemeCustomizerPressed={() => handleThemeCustomizerPressed(navigation)}
                            onOpenFilePressed={handleOpenFile}
                            castManager={castManager}
                            themePressed={displayThemePicker}
                        />,
                    })}
                >
                    {/* Albums screen with player height prop */}
                    <Stack.Screen
                        name="Albums"
                        options={{headerShown: true, title: i18n.t('albums'),}}
                    >
                        {(props) => {
                            const albumsRef = useRef<AlbumsScreenRef>(null);

                            // Update the ref when screen mounts for autoplay support
                            useEffect(() => {
                                if (albumsRef.current?.loadMoreAssets) {
                                    loadMoreAssetsRef.current = albumsRef.current.loadMoreAssets;
                                }

                                // Clean up ref when unmounting
                                return () => {
                                    loadMoreAssetsRef.current = null;
                                };
                            }, []);

                            return (
                                <AlbumsScreen
                                    {...props}
                                    ref={albumsRef}
                                    playerHeight={playerHeight}
                                    onScrollDirectionChange={handleScrollDirectionChange}
                                />
                            );
                        }}
                    </Stack.Screen>

                    {/* Album screen with player height prop and autoplay support */}
                    <Stack.Screen
                        name="Album"
                        options={{headerShown: true}}
                    >
                        {(props) => {
                            const albumRef = useRef<AlbumScreenRef>(null);

                            // Update the ref when screen mounts for autoplay support
                            useEffect(() => {
                                if (albumRef.current?.loadMoreAssets) {
                                    loadMoreAssetsRef.current = albumRef.current.loadMoreAssets;
                                }

                                // Clean up ref when unmounting
                                return () => {
                                    loadMoreAssetsRef.current = null;
                                };
                            }, []);

                            return (
                                <AlbumScreen
                                    {...props}
                                    ref={albumRef}
                                    playerHeight={playerHeight}
                                    onScrollDirectionChange={handleScrollDirectionChange}
                                />
                            );
                        }}
                    </Stack.Screen>

                    {/* Playlists screen */}
                    <Stack.Screen
                        name="Playlists"
                        options={{
                            headerShown: true,
                            title: i18n.t('playlists'),
                            headerStyle: {
                                backgroundColor: theme.colors.surface,
                            },
                            headerTintColor: theme.colors.onSurface,
                            headerShadowVisible: false,
                        }}
                    >
                        {(props) => {
                            const playlistsRef = useRef<PlaylistsScreenRef>(null);

                            useEffect(() => {
                                if (playlistsRef.current?.refreshPlaylists) {
                                    loadMoreAssetsRef.current = playlistsRef.current.refreshPlaylists;
                                    setPlaylistsScreenRef(playlistsRef.current);
                                }
                                return () => {
                                    loadMoreAssetsRef.current = null;
                                    setPlaylistsScreenRef(null);
                                };
                            }, []);

                            return (
                                <PlaylistsScreen
                                    ref={playlistsRef}
                                    playerHeight={playerHeight}
                                    onScrollDirectionChange={handleScrollDirectionChange}
                                />
                            );
                        }}
                    </Stack.Screen>

                    {/* Playlist edit screen */}
                    <Stack.Screen
                        name="PlaylistEdit"
                        options={({route}) => ({
                            headerShown: true,
                            title: route.params?.playlistName || i18n.t('edit_playlist'),
                            headerStyle: {
                                backgroundColor: theme.colors.surface,
                            },
                            headerTintColor: theme.colors.onSurface,
                            headerShadowVisible: false,
                        })}
                    >
                        {(props) => (
                            <PlaylistEditScreen
                                {...props}
                                onPlaylistSaved={handlePlaylistSaved}
                            />
                        )}
                    </Stack.Screen>

                    {/* Media selector screen */}
                    <Stack.Screen
                        name="MediaSelector"
                        options={{
                            headerShown: true,
                            title: '',
                            headerStyle: {
                                backgroundColor: theme.colors.surface,
                            },
                            headerTintColor: theme.colors.onSurface,
                            headerShadowVisible: false,
                            presentation: 'modal',
                        }}
                    >{(props: any) => <MediaSelectorScreen {...props} />}</Stack.Screen>

                    {/* Video Extractor screen */}
                    <Stack.Screen
                        name="VideoExtractor"
                        options={{
                            headerShown: true,
                            title: i18n.t('video_extractor'),
                            headerStyle: {
                                backgroundColor: theme.colors.surface,
                            },
                            headerTintColor: theme.colors.onSurface,
                            headerShadowVisible: false,
                        }}
                    >
                        {(props) => (
                            <VideoExtractorScreen
                                {...props}
                                playerHeight={playerHeight}
                                onScrollDirectionChange={handleScrollDirectionChange}
                            />
                        )}
                    </Stack.Screen>
                    <Stack.Screen
                        name="About"
                        options={{
                            headerShown: true,
                            title: i18n.t('about'),
                            headerStyle: {
                                backgroundColor: theme.colors.surface,
                            },
                            headerTintColor: theme.colors.onSurface,
                            headerShadowVisible: false,
                        }}
                        component={AboutScreen}
                    />
                    <Stack.Screen
                        name="ThemeCustomizer"
                        options={{
                            headerShown: true,
                            title: i18n.t('theme_customizer'),
                            headerStyle: {
                                backgroundColor: theme.colors.surface,
                            },
                            headerTintColor: theme.colors.onSurface,
                            headerShadowVisible: false,
                        }}
                    >
                        {(props) => <ThemeCustomizerScreen {...props} />}
                    </Stack.Screen>
                </Stack.Navigator>
            </NavigationContainer>

            {/* Status bar configuration */}
            <StatusBar style={theme.dark ? "light" : "dark"}/>

            {/* Cast device selection popup */}
            <CastDevicesPopup
                devices={devices}
                devicePressed={devicePressedHandler}
                visible={castDialogVisible}
                hide={() => setCastDialogVisible(false)}
                onAddFCastDevice={handleAddFCastDevice}
            />

            {/* Toast notifications with enhanced messages */}
            <Toast
                type={toastType}
                text1={toastText1}
                text2={toastText2}
                visible={toastVisible}
                time={toastType === "error" ? 5000 : 2000}
                bottomOffset={playerVisible ? playerHeight + 20 : 40}
                onToastHide={() => setToastVisible(false)}
            />

            {/* Enhanced Player controller with toggle compact mode support */}
            <PlayerController
                visible={playerVisible}
                connectedDevice={connectedDevice}
                onHeightChange={handlePlayerHeightChange}
                compactMode={playerCompactMode}
                onLoadMoreAssets={handleLoadMoreAssets}
                onToggleCompactMode={handleToggleCompactMode}
            />
            {/* Theme selection dialog */}
            <Portal>
                <Dialog visible={themeDialogVisible} onDismiss={() => setThemeDialogVisible(false)}>
                    <Dialog.Title>{i18n.t('change_theme')}</Dialog.Title>
                    <Dialog.Content>
                        <RadioButton.Group onValueChange={value => setTheme(value)} value={themeType}>
                            <RadioButton.Item label={i18n.t('theme_type.light')} value="light"/>
                            <RadioButton.Item label={i18n.t('theme_type.dark')} value="dark"/>
                            <RadioButton.Item label={i18n.t('theme_type.day_night')} value="auto"/>
                            <RadioButton.Item label={i18n.t('theme_type.custom')} value="custom"/>
                        </RadioButton.Group>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setThemeDialogVisible(false)}>
                            {i18n.t('close')}
                        </Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>

        </PaperProvider>
    );
};

// Main component with Redux Provider
const Main: React.FC = () => {
    return (
        <ReduxProvider store={store}>
            <MainContent/>
        </ReduxProvider>
    );
}

export default Main;