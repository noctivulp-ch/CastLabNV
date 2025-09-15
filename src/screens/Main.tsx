import {PaperProvider} from "react-native-paper";
import {NavigationContainer} from "@react-navigation/native";
import React, {useCallback, useContext, useEffect, useState} from "react";
import {ThemeContext} from "../contexts/theme-context";
import AlbumsScreen from "./AlbumsScreen";
import {combineReducers} from "@reduxjs/toolkit";
import {Appearance, GestureResponderEvent, Platform} from "react-native";
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
import Alert from "../componants/alert/Alert";
import {SERVER_PORT} from "../constants/Values";
import StaticServer, {getActiveServer, resolveAssetsPath} from "@dr.pogodin/react-native-static-server";
import * as Network from "expo-network";
import {copyFile, exists, mkdir} from "@dr.pogodin/react-native-fs";
import {useMigrations} from "drizzle-orm/expo-sqlite/migrator";
import migrations from "../../drizzle/migrations";
import * as SQLite from "expo-sqlite";
import {drizzle} from "drizzle-orm/expo-sqlite";
import PlayerController from "../componants/player/PlayerController";
import {useCastManager} from "../contexts/castManager-context";
import {Directory, Paths} from "expo-file-system";

const rootReducer = combineReducers({})
export type IRootState = ReturnType<typeof rootReducer>

//Declare roots for navigation
export type RootStackParamList = {
    Albums: any;
    Album: { album: Album, videoOnly: boolean };
    PictureAlbums: any;
    VideoAlbums: any;
}
const isIOS = Platform.OS === 'ios';


const Main: React.FC = () => {
    const {setTheme, theme, statusBarTheme} = useContext(ThemeContext);
    const Stack = createNativeStackNavigator<RootStackParamList>();
    const i18n = initTranslate();
    const [alertVisible, setAlertVisible] = useState<boolean>(false);
    const [playerVisible, setPlayerVisible] = useState<boolean>(false);
    const [alertTitle, setAlertTitle] = useState<string>("");
    const [alertMessage, setAlertMessage] = useState<string>("");
    const [castDialogVisible, setCastDialogVisible] = useState(false);
    const cast = useSelector((state: IRootState) => state.cast);
    const expo = SQLite.openDatabaseSync('db.db');
    const db = drizzle(expo);
    const {success} = useMigrations(db, migrations);

    const {castManager, devices, error, connectedDevice, isConnected} = useCastManager();

    AsyncStorage.getItem(SETTINGS_THEME).then((value) => {
        setTheme(value ? value : "auto");
    })


    useEffect(() => {
        if (error) {
            setAlertMessage(error);
            setAlertVisible(true);
        }
    }, [error]);

    useEffect(() => {
        setPlayerVisible(connectedDevice != null);
    }, [connectedDevice]);

    //Change when pressing media in AlbumScreen
    useEffect(() => {
        (async () => {
            if (cast?.currentAsset) {
                let uri;
                const asset: Asset = cast.currentAsset;
                const album_id = asset?.albumId?.replace("\"", "").replace("'", "");
                //We include album ID if a file as the same name in a different album
                const serverFileName = encodeURIComponent((album_id ? album_id + "_" : "") + asset.filename.replace("\"", "").replace("'", ""));
                const fileDir = resolveAssetsPath("webroot");
                //We check the file was not previously copied to fileDir
                if (!await exists(fileDir + "/" + serverFileName)) {
                    try {
                        await copyFile(asset.uri, fileDir + "/" + serverFileName);
                    } catch (error) {
                        console.error(error);
                    }
                }
                //Get the internal network ip address of the device
                const ip: string = await Network.getIpAddressAsync();
                uri = `http://${ip}:${SERVER_PORT}/${serverFileName}`;
                if (uri) {
                    //Start casting the new media
                    await castManager.castMedia(
                        {
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


    const devicePressedHandler = useCallback(async (event: GestureResponderEvent, device: Device) => {
        await castManager.connect(device);
        setCastDialogVisible(false);
    }, [castManager]);

    const buttonCastPressed = async () => {

        if (castManager.isConnected()) {
            await castManager.disconnect();
        } else {
            setCastDialogVisible(true);
        }
    };

    /**
     * Delete files from local server
     */
    const deleteFiles = () => {
        const dir = new Directory(Paths.document, "webroot");
        const contents = dir.list();
        for (const item of contents) {
            item.delete();
        }
    }

    useEffect(() => {
        const currentServer = getActiveServer();
        if (connectedDevice == null && currentServer) {
            (async () => {
                await currentServer?.stop();
            })();
            return;
        }
        const extraConfig = `server.modules += ("mod_setenv")
              setenv.add-response-header = (
                "transferMode.dlna.org" => "Streaming",
                "contentFeatures.dlna.org" => "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=017000 00000000000000000000000000",
                "Access-Control-Allow-Origin" => "*",
                "Access-Control-Allow-Methods" => "GET, POST, PUT, DELETE, OPTIONS, HEAD",
                "Accept-Ranges" => "bytes"
              )
        `;
        const fileDir = resolveAssetsPath("webroot");
        let server = new StaticServer({
            fileDir,
            extraConfig: extraConfig,
            port: SERVER_PORT,
            nonLocal: true,
            stopInBackground: false,
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

        (async () => {
            await currentServer?.stop();
            if (!await exists(fileDir)) {
                await mkdir(fileDir);
            }
            server?.addStateListener((newState, details, error) => {
                /* console.log(
                     `Server #${serverId}.\n`,
                     `Origin: ${server?.origin}`,
                     `New state: "${STATES[newState]}".\n`,
                     `Details: "${details}".`,
                 );*/
                if (error) console.error(error);
            });
            const res = await server?.start();
            console.log(`Server started: ${res}`);
        })();
        return () => {
            server?.stop();
        }
    }, [connectedDevice]);

    useEffect(() => {
        deleteFiles();
        //Start discovering
        if (!isIOS) { //iOS will request a permission when starting the app, bette is to give this permission when tapping on the cast button
            castManager.startSearch();
        }
        const themeListener = Appearance.addChangeListener(scheme => {
            setTheme(scheme.colorScheme === "dark" ? "dark" : "light");
        });

        return () => {
            themeListener.remove();
            deleteFiles();
        }

    }, []);

    return (
        <PaperProvider theme={theme}>
            <NavigationContainer theme={statusBarTheme}>
                <Stack.Navigator initialRouteName="Albums" screenOptions={{
                    headerShown: true,
                    gestureEnabled: true,
                    title: i18n.t('albums'),
                    header: (props) => <CustomAppBar {...props} onButtonCastPressed={buttonCastPressed}
                                                     castManager={castManager}/>,
                }}>
                    <Stack.Screen name="Albums" component={AlbumsScreen}
                                  options={{headerShown: true}}/>
                    <Stack.Screen name="Album" component={AlbumScreen}
                                  options={{headerShown: true}}/>
                </Stack.Navigator>
            </NavigationContainer>
            <StatusBar style={theme.dark ? "light" : "dark"}/>
            <CastDevicesPopup devices={devices}
                              devicePressed={devicePressedHandler}
                              visible={castDialogVisible}
                              hide={() => {
                                  setCastDialogVisible(false)
                              }}/>

            <Alert title={alertTitle} message={alertMessage} visible={alertVisible}
                   hideDialog={() => setAlertVisible(false)}/>
            <PlayerController visible={playerVisible}/>
        </PaperProvider>
    );
}

export default Main;