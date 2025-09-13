import React, {useContext} from "react";
import {FlatList, GestureResponderEvent, StyleSheet, View} from "react-native";
import {Dialog, Icon, Portal, Text} from "react-native-paper";
import {initTranslate} from "../../localization/translate";
import {ThemeContext} from "../../contexts/theme-context";
import DeviceItem from "../items/DeviceItem";
import {Device} from "../../DLNACast/types/Device";

export type CastDevicesPopupProps = {
    devicePressed: (event: GestureResponderEvent, device: Device) => void,
    visible: boolean;
    devices: Array<Device>;
    hide: () => void;
};

const CastDevicesPopup: React.FC<CastDevicesPopupProps> = ({visible, devices, devicePressed, hide}) => {
    const i18n = initTranslate();
    const {theme} = useContext(ThemeContext);
    return (
        <Portal>
            <Dialog visible={visible} onDismiss={hide} style={styles.dialog}>
                <Dialog.Title>{i18n.t('cast_on')}</Dialog.Title>
                <Dialog.Content>
                    <View style={styles.container}>
                        <FlatList data={devices} style={styles.devices_list}
                                  renderItem={({item}) => (
                                      <DeviceItem device={item} onPressed={devicePressed}/>
                                  )}
                                  keyExtractor={(item) => item.id}
                        />
                        {devices.length === 0 &&
                            <View style={styles.text_container}>
                                <Icon size={24} source={"cast-off"}/>
                                <Text style={styles.no_devices}>No devices</Text>
                            </View>}
                    </View>
                </Dialog.Content>
            </Dialog>
        </Portal>
    );
}
const styles = StyleSheet.create({
    container: {
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
    },
    devices_list: {
        marginTop: 20,
        width: "100%",
    },
    dialog: {},
    text_container: {
        marginTop: 20,
        marginBottom: 20,
        flexDirection: "row",
        alignItems: "center",
    },
    no_devices: {
        marginStart: 20,
        fontSize: 20,
    }
});

export default CastDevicesPopup;