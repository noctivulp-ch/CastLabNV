const { withAndroidManifest } = require('expo/config-plugins');

const SEND_ACTIONS = ['android.intent.action.SEND', 'android.intent.action.SEND_MULTIPLE'];
const MIME_TYPES = ['image/*', 'video/*', 'audio/*'];

module.exports = function withShareIntent(config) {
    return withAndroidManifest(config, (config) => {
        const application = config.modResults.manifest.application?.[0];
        const activity = application?.activity?.find(
            (a) => a.$?.['android:name'] === '.MainActivity'
        );
        if (!activity) return config;

        const filters = activity['intent-filter'] || [];
        const alreadyAdded = filters.some((filter) =>
            filter.action?.some((a) => SEND_ACTIONS.includes(a.$?.['android:name']))
        );

        if (!alreadyAdded) {
            SEND_ACTIONS.forEach((action) => {
                filters.push({
                    action: [{ $: { 'android:name': action } }],
                    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
                    data: MIME_TYPES.map((mimeType) => ({ $: { 'android:mimeType': mimeType } })),
                });
            });
        }

        activity['intent-filter'] = filters;
        return config;
    });
};
