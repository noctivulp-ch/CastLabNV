const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Tiles want a single flat shape rather than the launcher icon
const TILE_ICON = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"
    android:tint="?android:attr/colorControlNormal">
  <path android:fillColor="@android:color/white" android:pathData="M1,18v3h3C4,19.34 2.66,18 1,18zM1,14v2c2.76,0 5,2.24 5,5h2C8,17.13 4.87,14 1,14zM1,10v2c4.97,0 9,4.03 9,9h2C12,14.92 7.07,10 1,10zM21,3H3c-1.1,0 -2,0.9 -2,2v3h2V5h18v14h-7v2h7c1.1,0 2,-0.9 2,-2V5c0,-1.1 -0.9,-2 -2,-2z"/>
</vector>
`;

const withTileIcon = (config) =>
    withDangerousMod(config, ['android', (config) => {
        const dir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/drawable');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'ic_cast_tile.xml'), TILE_ICON);
        return config;
    }]);

module.exports = function withScreenShare(config) {
    config = withTileIcon(config);
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
            const tileClass = 'app.fedilab.castlab.screenshare.ScreenShareTileService';
            if (!services.some((s) => s.$?.['android:name'] === tileClass)) {
                services.push({
                    $: {
                        'android:name': tileClass,
                        'android:label': 'Cast screen',
                        'android:icon': '@drawable/ic_cast_tile',
                        'android:permission': 'android.permission.BIND_QUICK_SETTINGS_TILE',
                        'android:exported': 'true',
                    },
                    'intent-filter': [{
                        action: [{ $: { 'android:name': 'android.service.quicksettings.action.QS_TILE' } }],
                    }],
                });
            }

            application.service = services;
        }

        return config;
    });
};
