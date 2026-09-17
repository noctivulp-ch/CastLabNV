import React, {useContext, useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {Button, Dialog, Portal, Text} from 'react-native-paper';
import {WebView} from 'react-native-webview';
import {initTranslate} from '../../localization/translate';
import {ThemeContext} from '../../contexts/theme-context';

interface WatchPageResolverProps {
    watchUrl?: string;
    onResolved: (sourceUrl: string) => void;
    onFailed: () => void;
}

// A page that checks the client on its own settles sooner
const REVEAL_DELAY_MS = 15000;

/**
 * Polls the rendered page until the player exposes a source
 */
const EXTRACT_SCRIPT = `
(function () {
    var post = function (payload) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    };
    var read = function () {
        var source = document.querySelector('video source[src*="latest_version"]');
        if (source) return source.getAttribute('src');
        var video = document.querySelector('video');
        return video && video.src && video.src.indexOf('latest_version') !== -1 ? video.src : null;
    };
    var attempts = 0;
    var timer = setInterval(function () {
        var url = read();
        if (url) {
            clearInterval(timer);
            post({url: url});
        } else if (attempts % 10 === 0) {
            post({waiting: document.title, video: !!document.querySelector('video')});
        }
        if (++attempts > 120) {
            clearInterval(timer);
            post({error: 'timeout'});
        }
    }, 500);
})();
true;
`;

/**
 * Stays out of sight until the page needs a reader
 */
const WatchPageResolver: React.FC<WatchPageResolverProps> = ({watchUrl, onResolved, onFailed}) => {
    const i18n = initTranslate();
    const {theme} = useContext(ThemeContext);
    const [revealed, setRevealed] = useState(false);

    useEffect(() => {
        if (!watchUrl) {
            setRevealed(false);
            return;
        }
        console.log(`[Resolver] loading out of sight: ${watchUrl}`);
        const timer = setTimeout(() => {
            console.log('[Resolver] nothing yet, showing the page');
            setRevealed(true);
        }, REVEAL_DELAY_MS);
        return () => clearTimeout(timer);
    }, [watchUrl]);

    if (!watchUrl) return null;

    const handleMessage = (event: {nativeEvent: {data: string}}) => {
        console.log(`[Resolver] message: ${event.nativeEvent.data.slice(0, 120)}`);
        try {
            const payload = JSON.parse(event.nativeEvent.data);
            if (payload.url) {
                onResolved(payload.url);
            } else if (payload.error) {
                onFailed();
            }
        } catch (_) {
        }
    };

    const webview = (
        <WebView
            source={{uri: watchUrl}}
            injectedJavaScript={EXTRACT_SCRIPT}
            onMessage={handleMessage}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            mediaPlaybackRequiresUserAction={true}
            onLoadEnd={() => console.log('[Resolver] page loaded')}
            onError={(e) => console.warn(`[Resolver] load error: ${e.nativeEvent.description}`)}
        />
    );

    // A stopped page never resolves
    if (!revealed) {
        return <View style={styles.offscreen} pointerEvents="none">{webview}</View>;
    }

    return (
        <Portal>
            <Dialog visible={true} onDismiss={onFailed} style={styles.dialog}>
                <Dialog.Title>{i18n.t('open_page_to_continue')}</Dialog.Title>
                <Dialog.Content style={styles.content}>
                    <Text variant="bodySmall" style={{color: theme.colors.onSurfaceVariant}}>
                        {i18n.t('open_page_to_continue_hint')}
                    </Text>
                    <View style={styles.webviewFrame}>{webview}</View>
                </Dialog.Content>
                <Dialog.Actions>
                    <Button onPress={onFailed}>{i18n.t('cancel')}</Button>
                </Dialog.Actions>
            </Dialog>
        </Portal>
    );
};

const styles = StyleSheet.create({
    offscreen: {
        position: 'absolute',
        width: 1,
        height: 1,
        opacity: 0,
    },
    dialog: {
        maxHeight: '85%',
    },
    content: {
        gap: 10,
    },
    webviewFrame: {
        height: 420,
        overflow: 'hidden',
        borderRadius: 8,
    },
});

export default WatchPageResolver;
