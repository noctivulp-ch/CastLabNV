import React, {useCallback, useContext, useEffect, useState} from 'react';
import {Linking, ScrollView, Share, StyleSheet, TouchableOpacity, View} from 'react-native';
import {Divider, Icon, IconButton, List, Text} from 'react-native-paper';
import {ThemeContext} from '../contexts/theme-context';
import {initTranslate} from '../localization/translate';
import {SvgXml} from 'react-native-svg';
import {Asset} from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import app from '../../app.json';
import {LogService} from '../services/LogService';

const AboutScreen: React.FC = () => {
    const {theme} = useContext(ThemeContext);
    const i18n = initTranslate();
    const [paypalSvg, setPaypalSvg] = useState<string>('');
    const [liberapaySvg, setLiberapaySvg] = useState<string>('');

    /**
     * Load SVG assets on component mount
     */
    useEffect(() => {
        const loadSvgs = async () => {
            try {
                // Load PayPal SVG
                const paypalAsset = Asset.fromModule(require('../../assets/paypal.svg'));
                await paypalAsset.downloadAsync();
                const paypalContent = await FileSystem.readAsStringAsync(paypalAsset.localUri || '');
                setPaypalSvg(paypalContent);

                // Load Liberapay SVG
                const liberapayAsset = Asset.fromModule(require('../../assets/liberapay.svg'));
                await liberapayAsset.downloadAsync();
                const liberapayContent = await FileSystem.readAsStringAsync(liberapayAsset.localUri || '');
                setLiberapaySvg(liberapayContent);
            } catch (error) {
                console.error('AboutScreen: Error loading SVG assets:', error);
            }
        };

        loadSvgs();
    }, []);

    const openURL = (url: string) => {
        Linking.openURL(url);
    };

    /**
     * Export application logs via the system share dialog
     */
    const handleExportLogs = useCallback(async () => {
        const logContent = LogService.export();
        try {
            await Share.share({
                message: logContent,
                title: 'CastLab Logs',
            });
        } catch (error) {
            console.error('Failed to share logs:', error);
        }
    }, []);

    return (
        <ScrollView style={[styles.container, {backgroundColor: theme.colors.background}]}>
            {/* App Header */}
            <View style={styles.header}>
                <Text variant="displaySmall" style={styles.appTitle}>CastLab</Text>
                <Text variant="labelLarge" style={styles.version}>
                    {i18n.t('version', {version: app.expo.version})}
                </Text>
            </View>

            {/* App Description */}
            <View style={styles.section}>
                <Text variant="bodyLarge" style={styles.description}>
                    {i18n.t('app_description')}
                </Text>
            </View>

            <Divider/>

            {/* Source Code Section */}
            <List.Item
                title={i18n.t('source_code')}
                description="https://codeberg.org/tom79/CastLab"
                left={props => <List.Icon {...props} icon="code-tags"/>}
                onPress={() => openURL('https://codeberg.org/tom79/CastLab')}
                titleStyle={styles.listTitle}
            />

            <Divider/>

            {/* Bug Reports Section */}
            <List.Item
                title={i18n.t('report_bugs')}
                description="https://codeberg.org/tom79/CastLab/issues"
                left={props => <List.Icon {...props} icon="bug"/>}
                onPress={() => openURL('https://codeberg.org/tom79/CastLab/issues')}
                titleStyle={styles.listTitle}
            />

            <Divider/>

            {/* Export Logs Section */}
            <List.Item
                title={i18n.t('export_logs')}
                description={i18n.t('export_logs_description')}
                left={props => <List.Icon {...props} icon="file-document-outline"/>}
                onPress={handleExportLogs}
                titleStyle={styles.listTitle}
            />

            <Divider/>

            {/* Donations Section */}
            <View style={styles.donationsSection}>
                <List.Item
                    title={i18n.t('donations')}
                    left={props => <List.Icon {...props} icon="heart"/>}
                    titleStyle={styles.listTitle}
                />
                <View style={styles.donationButtons}>
                    {/* PayPal Button with SVG */}
                    <TouchableOpacity
                        onPress={() => openURL('https://www.paypal.me/Mastalab')}
                        style={[styles.donationButton, {backgroundColor: theme.colors.primary}]}
                        accessibilityLabel="Donate via PayPal"
                    >
                        {paypalSvg ? (
                            <SvgXml
                                xml={paypalSvg}
                                width={32}
                                height={32}
                                color={theme.colors.onPrimary}
                            />
                        ) : (
                            <IconButton icon="loading" size={24} iconColor={theme.colors.primary}/>
                        )}
                    </TouchableOpacity>

                    {/* Liberapay Button with SVG */}
                    <TouchableOpacity
                        onPress={() => openURL('https://liberapay.com/tom79/donate')}
                        style={[styles.donationButton, {backgroundColor: theme.colors.primary}]}
                        accessibilityLabel="Donate via Liberapay"
                    >
                        {liberapaySvg ? (
                            <SvgXml
                                xml={liberapaySvg}
                                width={32}
                                height={32}
                                color={theme.colors.onPrimary}
                            />
                        ) : (
                            <IconButton icon="loading" size={24} iconColor={theme.colors.primary}/>
                        )}
                    </TouchableOpacity>

                    {/* Ko-fi Button */}
                    <TouchableOpacity
                        onPress={() => openURL('https://ko-fi.com/tom79')}
                        style={[styles.donationButton, {backgroundColor: theme.colors.primary}]}
                        accessibilityLabel="Donate via Ko-fi"
                    >
                        <Icon source="coffee" size={32} color={theme.colors.onPrimary}/>
                    </TouchableOpacity>
                </View>
            </View>

        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        alignItems: 'center',
        paddingVertical: 32,
        paddingHorizontal: 16,
    },
    appTitle: {
        fontWeight: 'bold',
    },
    version: {
        marginTop: 8,
        opacity: 0.7,
    },
    section: {
        paddingHorizontal: 16,
        paddingVertical: 20,
    },
    description: {
        textAlign: 'center',
        lineHeight: 24,
    },
    listTitle: {
        fontWeight: '600',
    },
    donationsSection: {
        paddingVertical: 8,
    },
    donationButtons: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 16,
        gap: 16,
    },
    donationButton: {
        width: 56,
        height: 56,
        borderRadius: 28,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    donationIcon: {
        margin: 0,
    },
    featureHighlight: {
        textAlign: 'center',
        fontStyle: 'italic',
        opacity: 0.8,
        lineHeight: 22,
    },
});

export default AboutScreen;