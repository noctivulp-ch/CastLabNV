const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// The CastLab mark, monochrome as tiles expect
const TILE_ICON = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"
    android:tint="?android:attr/colorControlNormal">
  <path android:fillColor="#00000000" android:strokeColor="@android:color/white"
      android:strokeWidth="2" android:strokeLineCap="round" android:strokeLineJoin="round"
      android:pathData="M3,9 V6 a2,2 0 0 1 2,-2 h14 a2,2 0 0 1 2,2 v12 a2,2 0 0 1 -2,2 h-5"/>
  <path android:fillColor="#00000000" android:strokeColor="@android:color/white"
      android:strokeWidth="2" android:strokeLineCap="round" android:strokeLineJoin="round"
      android:pathData="M3,12 a8,8 0 0 1 8,8 h-6 a2,2 0 0 1 -2,-2 z"/>
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
                        'android:label': '@string/screen_share_tile_label',
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
