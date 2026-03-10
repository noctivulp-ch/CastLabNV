import React, {useContext, useState} from "react";
import {FlatList, GestureResponderEvent, StyleSheet, View} from "react-native";
import {Button, Dialog, Divider, Icon, Portal, Text, TextInput} from "react-native-paper";
import {initTranslate} from "../../localization/translate";
import {ThemeContext} from "../../contexts/theme-context";
import DeviceItem from "../items/DeviceItem";
import {Device} from "../../DLNACast/types/Device";

export type CastDevicesPopupProps = {
    devicePressed: (event: GestureResponderEvent, device: Device) => void,
    visible: boolean;
    devices: Array<Device>;
    hide: () => void;
    onAddFCastDevice?: (ip: string, port: number, name?: string) => void;
};

const CastDevicesPopup: React.FC<CastDevicesPopupProps> = ({visible, devices, devicePressed, hide, onAddFCastDevice}) => {
    const i18n = initTranslate();
    const {theme} = useContext(ThemeContext);
    const [fcastIp, setFcastIp] = useState('');
    const [fcastPort, setFcastPort] = useState('46899');
    const [showFcastForm, setShowFcastForm] = useState(false);

    const handleAddFCast = () => {
        const ip = fcastIp.trim();
        if (!ip) return;
        const port = parseInt(fcastPort, 10) || 46899;
        if (onAddFCastDevice) {
            onAddFCastDevice(ip, port);
        }
        setFcastIp('');
        setFcastPort('46899');
        setShowFcastForm(false);
    };

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

                        <Divider style={styles.divider}/>

                        {!showFcastForm ? (
                            <Button
                                mode="text"
                                icon="plus"
                                onPress={() => setShowFcastForm(true)}
                                compact
                            >
                                {i18n.t('add_fcast_device')}
                            </Button>
                        ) : (
                            <View style={styles.fcast_form}>
                                <Text variant="labelLarge" style={styles.fcast_title}>FCast</Text>
                                <TextInput
                                    label={i18n.t('ip_address')}
                                    value={fcastIp}
                                    onChangeText={setFcastIp}
                                    mode="outlined"
                                    dense
                                    keyboardType="numeric"
                                    placeholder="192.168.1.100"
                                    style={styles.fcast_input}
                                />
                                <TextInput
                                    label={i18n.t('port')}
                                    value={fcastPort}
                                    onChangeText={setFcastPort}
                                    mode="outlined"
                                    dense
                                    keyboardType="numeric"
                                    style={styles.fcast_input}
                                />
                                <View style={styles.fcast_buttons}>
                                    <Button mode="text" onPress={() => setShowFcastForm(false)} compact>
                                        {i18n.t('cancel')}
                                    </Button>
                                    <Button mode="contained-tonal" onPress={handleAddFCast} compact disabled={!fcastIp.trim()}>
                                        {i18n.t('add')}
                                    </Button>
                                </View>
                            </View>
                        )}
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
    },
    divider: {
        marginVertical: 12,
    },
    fcast_form: {
        width: '100%',
    },
    fcast_title: {
        marginBottom: 8,
    },
    fcast_input: {
        marginBottom: 8,
    },
    fcast_buttons: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 8,
    },
});

export default CastDevicesPopup;