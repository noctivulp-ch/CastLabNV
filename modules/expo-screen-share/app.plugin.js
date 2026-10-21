const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withScreenShare(config) {
    return withAndroidManifest(config, (config) => {
        const manifest = config.modResults.manifest;

        // Add permissions
        const permissions = manifest['uses-permission'] || [];
        const addPermission = (name) => {
            if (!permissions.some((p) => p.$?.['android:name'] === name)) {
                permissions.push({ $: { 'android:name': name } });
            }
        };
        addPermission('android.permission.FOREGROUND_SERVICE');
        addPermission('android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION');
        // Playback capture (Android 10+) rides on the same MediaProjection
        // token, but still needs RECORD_AUDIO granted at runtime.
        addPermission('android.permission.RECORD_AUDIO');
        manifest['uses-permission'] = permissions;

        // Add service declaration
        const application = manifest.application?.[0];
        if (application) {
            const services = application.service || [];
            const serviceClass = 'app.fedilab.castlab.screenshare.ScreenCaptureService';
            if (!services.some((s) => s.$?.['android:name'] === serviceClass)) {
                services.push({
                    $: {
                        'android:name': serviceClass,
                        'android:foregroundServiceType': 'mediaProjection',
                        'android:exported': 'false',
                    },
                });
            }
            application.service = services;
        }

        return config;
    });
};
