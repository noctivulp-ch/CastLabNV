import {Button, Dialog, PaperProvider, Portal, RadioButton, Text} from "react-native-paper";
import {NavigationContainer} from "@react-navigation/native";
import React, {useCallback, useContext, useEffect, useRef, useState} from "react";
import {ThemeContext} from "../contexts/theme-context";
import AlbumsScreen from "./AlbumsScreen";
import {combineReducers} from "@reduxjs/toolkit";
import {Appearance, GestureResponderEvent, Linking, Platform} from "react-native";
import {SETTINGS_THEME} from "../constants/AsyncStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {StatusBar} from "expo-status-bar";
import {createNativeStackNavigator} from "@react-navigation/native-stack";
import CustomAppBar from "../componants/menu/CustomAppBar";
import {initTranslate} from "../localization/translate";
import {Album, Asset} from "expo-media-library";
import AlbumScreen from "./AlbumScreen";
import {Device} from '../DLNACast/types/Device';
import {useSelector} from "react-redux";
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
import app from "../../app.json";
import * as FileSystem from 'expo-file-system';
import {Asset as ExpoAsset} from 'expo-asset';
import {useBackgroundNotification} from '../hooks/useBackgroundNotification';
import {activateKeepAwakeAsync, deactivateKeepAwake} from "expo-keep-awake";

const rootReducer = combineReducers({})
export type IRootState = ReturnType<typeof rootReducer>

// Navigation parameter types
export type RootStackParamList = {
    Albums: { playerHeight?: number };
    Album: { album: Album, videoOnly: boolean, playerHeight?: number };
    PictureAlbums: any;
    VideoAlbums: any;
}

const isIOS = Platform.OS === 'ios';

const Main: React.FC = () => {
    const {setTheme, theme, statusBarTheme, type: themeType} = useContext(ThemeContext);
    const Stack = createNativeStackNavigator<RootStackParamList>();
    const i18n = initTranslate();

    // UI state management
    const [alertVisible, setAlertVisible] = useState<boolean>(false);
    const [toastVisible, setToastVisible] = useState<boolean>(false);
    const [playerVisible, setPlayerVisible] = useState<boolean>(false);
    const [alertTitle, setAlertTitle] = useState<string>("");
    const [alertMessage, setAlertMessage] = useState<string>("");
    const [toastText1, setToastText1] = useState<string>("");
    const [toastText2, setToastText2] = useState<string>("");
    const [castDialogVisible, setCastDialogVisible] = useState(false);
    const [aboutDialogVisible, setAboutDialogVisible] = useState(false);
    const [themeDialogVisible, setThemeDialogVisible] = useState(false);
    const [playerCompactMode, setPlayerCompactMode] = useState<boolean>(false);

    // Player height management - tracks the actual height of the PlayerController
    const [playerHeight, setPlayerHeight] = useState<number>(0);

    // Redux and database setup
    const cast = useSelector((state: IRootState) => state.cast);
    const expo = SQLite.openDatabaseSync('db.db');
    const db = drizzle(expo);
    const {success} = useMigrations(db, migrations);

    // Cast management
    const {castManager, devices, error, connectedDevice, isConnected} = useCastManager();
    const prevConnectedDevice = useRef(connectedDevice);

    // Server management
    const serverRef = useRef<StaticServer | null>(null);

    // Initialize background notifications
    useBackgroundNotification();

    // Load theme preference from storage
    AsyncStorage.getItem(SETTINGS_THEME).then((value) => {
        setTheme(value ? value : "auto");
    })

    // Handle cast manager errors
    useEffect(() => {
        if (error) {
            setToastText1(error);
            console.error(error);
            setToastText2("");
            setToastVisible(true);
        }
    }, [error]);

    // Update player visibility based on connected device
    useEffect(() => {
        setPlayerVisible(connectedDevice != null);
    }, [connectedDevice]);

    // Handle media casting when asset changes
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
                        console.error(error);
                    }
                }

                // Get the internal network IP address of the device
                const ip: string = await Network.getIpAddressAsync();
                uri = `http://${ip}:${SERVER_PORT}/${serverFileName}`;

                if (uri) {
                    // Start casting the new media
                    await castManager.castMedia({
                        contentUrl: uri,
                        metadata: {
                            title: asset.filename,
                            images: [{url: uri, width: asset.width, height: asset.height}],
                        },
                        streamDuration: asset.duration,
                    });
                }
            }
        })();
    }, [cast.currentAsset]);

    /**
     * Callback to handle scroll direction changes from screens
     * This is called when user scrolls up/down in the media lists
     * @param isScrollingDown - True when scrolling down, false when scrolling up
     */
    const handleScrollDirectionChange = useCallback((isScrollingDown: boolean) => {
        setPlayerCompactMode(isScrollingDown);
    }, []);

    /**
     * Callback to handle player height changes from PlayerController
     * This is called whenever the PlayerController's height changes
     */
    const handlePlayerHeightChange = useCallback((height: number) => {
        setPlayerHeight(height);
    }, []);

    /**
     * Handle device selection from cast popup
     */
    const devicePressedHandler = useCallback(async (event: GestureResponderEvent, device: Device) => {
        await castManager.connect(device);
        setCastDialogVisible(false);
    }, [castManager]);

    /**
     * Handle cast button press - connect/disconnect or show device list
     */
    const buttonCastPressed = async () => {
        if (castManager.isConnected()) {
            await castManager.disconnect();
        } else {
            if (castManager.isSearching()) {
                await castManager.stopSearch();
            }
            castManager.startSearch();
            setCastDialogVisible(true);
        }
    };

    /**
     * Delete all files from the server directory
     */
    const deleteFiles = async () => {
        const SERVER_FILE_DIRECTORY = `${FileSystem.documentDirectory}webroot/`;
        try {
            await FileSystem.deleteAsync(SERVER_FILE_DIRECTORY, {idempotent: true});
            await FileSystem.makeDirectoryAsync(SERVER_FILE_DIRECTORY, {intermediates: true});
        } catch (error) {
            console.error('Error in deleteFiles:', error);
        }
    };

    /**
     * Show app information dialog
     */
    const displayAppInfo = () => {
        setAboutDialogVisible(true);
    }

    /**
     * Show theme picker dialog
     */
    const displayThemePicker = () => {
        setThemeDialogVisible(true);
    }

    
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

            // Stop servers if connectedDevice is null
            if (!connectedDevice) {
                try {
                    if (currentServer) {
                        await currentServer.stop();
                    }
                    serverRef.current = null;
                } catch (err) {
                    console.error('Error stopping servers:', (err as Error).message);
                }
                return;
            }

            try {
                const ip = await Network.getIpAddressAsync();
                const fileDir = resolveAssetsPath('webroot');

                // DLNA server configuration
                const extraConfig = `server.modules += ("mod_setenv")
                    setenv.add-response-header = (
                        "transferMode.dlna.org" => "Streaming",
                        "contentFeatures.dlna.org" => "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=017000 00000000000000000000000000000000",
                        "Access-Control-Allow-Origin" => "*",
                        "Access-Control-Allow-Methods" => "GET, POST, PUT, DELETE, OPTIONS, HEAD",
                        "Accept-Ranges" => "bytes"
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
                    console.error('Error when loading favicon:', (err as Error).message);
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
                        if (error) console.error('StaticServer error:', error);
                        console.log('StaticServer state:', details);
                    });
                }
            } catch (err) {
                console.error('Error starting servers:', (err as Error).message);
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
                        serverRef.current.stop().catch((err: Error) => console.error('Error stopping StaticServer:', err.message))
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
                    screenOptions={{
                        headerShown: true,
                        gestureEnabled: true,
                        title: i18n.t('albums'),
                        header: (props) => <CustomAppBar
                            {...props}
                            onButtonCastPressed={buttonCastPressed}
                            castManager={castManager}
                            infoPress={displayAppInfo}
                            themePressed={displayThemePicker}
                        />,
                    }}
                >
                    {/* Albums screen with player height prop */}
                    <Stack.Screen
                        name="Albums"
                        options={{headerShown: true}}
                    >
                        {(props) => <AlbumsScreen {...props} playerHeight={playerHeight}
                                                  onScrollDirectionChange={handleScrollDirectionChange}/>}
                    </Stack.Screen>

                    {/* Album screen with player height prop */}
                    <Stack.Screen
                        name="Album"
                        options={{headerShown: true}}
                    >
                        {(props) => <AlbumScreen {...props} playerHeight={playerHeight}
                                                 onScrollDirectionChange={handleScrollDirectionChange}/>}
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
            />

            {/* Toast notifications */}
            <Toast
                type={"info"}
                text1={toastText1}
                text2={toastText2}
                visible={toastVisible}
                onToastHide={() => setToastVisible(false)}
            />

            {/* Player controller with height change callback */}
            <PlayerController
                visible={playerVisible}
                connectedDevice={connectedDevice}
                onHeightChange={handlePlayerHeightChange}
                compactMode={playerCompactMode}
            />

            {/* About dialog */}
            <Portal>
                <Dialog visible={aboutDialogVisible} onDismiss={() => setAboutDialogVisible(false)}>
                    <Dialog.Content style={{alignItems: "center"}}>
                        <Text variant="titleLarge">CastLab</Text>
                        <Text variant="labelLarge" style={{marginTop: 10}}>
                            {i18n.t('version', {version: app.expo.version})}
                        </Text>
                        <Text variant="bodyLarge" style={{marginTop: 20}}>
                            {i18n.t('source_code')}
                        </Text>
                        <Text
                            onPress={() => Linking.openURL('https://codeberg.org/tom79/CastLab')}
                            style={{marginTop: 10, color: theme.colors.primary}}
                        >
                            https://codeberg.org/tom79/CastLab
                        </Text>
                        <Text variant="bodyLarge" style={{marginTop: 20}}>
                            {i18n.t('report_bugs')}
                        </Text>
                        <Text
                            onPress={() => Linking.openURL('https://codeberg.org/tom79/CastLab/issues')}
                            style={{marginTop: 10, color: theme.colors.primary}}
                        >
                            https://codeberg.org/tom79/CastLab/issues
                        </Text>
                        <Text variant="bodyLarge" style={{marginTop: 20}}>
                            {i18n.t('donations')}
                        </Text>
                        <Text
                            onPress={() => Linking.openURL('https://fedilab.app/page/donations/')}
                            style={{marginTop: 10, color: theme.colors.primary}}
                        >
                            https://fedilab.app/page/donations/
                        </Text>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setAboutDialogVisible(false)}>
                            {i18n.t('close')}
                        </Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>

            {/* Theme selection dialog */}
            <Portal>
                <Dialog visible={themeDialogVisible} onDismiss={() => setThemeDialogVisible(false)}>
                    <Dialog.Title>{i18n.t('change_theme')}</Dialog.Title>
                    <Dialog.Content>
                        <RadioButton.Group onValueChange={value => setTheme(value)} value={themeType}>
                            <RadioButton.Item label={i18n.t('theme_type.light')} value="light"/>
                            <RadioButton.Item label={i18n.t('theme_type.dark')} value="dark"/>
                            <RadioButton.Item label={i18n.t('theme_type.day_night')} value="auto"/>
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
}

export default Main;