/** Native generation always happens in an explicit frozen release snapshot. */
module.exports = ({ config }) => {
  if (process.env.BOOKMARK_BUILD_VARIANT === 'supabase-production') {
    if (!process.env.BOOKMARK_PRODUCTION_STAGE_ROOT) {
      throw new Error('Production native generation must use the production build wrapper');
    }
    return {
      ...config,
      ios: { ...config.ios, entitlements: { ...config.ios.entitlements,
        'com.apple.security.application-groups': ['group.ai.bookmarkai'] } },
      extra: { ...config.extra, buildVariant: 'supabase-production', authStorageNamespace: 'bookmark-ai:supabase-production' },
    };
  }
  if (process.env.BOOKMARK_BUILD_VARIANT !== 'supabase-qa') {
    throw new Error('Supabase migration mobile builds must use scripts/supabase-qa.mjs and the isolated supabase-qa variant');
  }
  if (!process.env.BOOKMARK_QA_STAGE_ROOT) {
    throw new Error('Supabase QA native generation must use scripts/supabase-qa.mjs');
  }
  return {
    ...config,
    name: 'Bookmark AI Supabase QA',
    slug: 'bookmark-ai-supabase-qa',
    scheme: 'bookmarkai-supabase-qa',
    ios: {
      ...config.ios,
      bundleIdentifier: 'ai.bookmarkai.supabaseqa',
      buildNumber: `9${config.ios.buildNumber}`,
      entitlements: {
        ...config.ios.entitlements,
        'com.apple.security.application-groups': ['group.ai.bookmarkai.supabaseqa'],
      },
    },
    android: {
      ...config.android,
      package: 'ai.bookmarkai.supabaseqa',
      versionCode: 9000 + (config.android.versionCode || 1),
    },
    plugins: config.plugins.map((plugin) => {
      if (Array.isArray(plugin) && plugin[0] === 'expo-share-intent') {
        return [plugin[0], { ...plugin[1], iosShareExtensionName: 'Save to Supabase QA',
          iosShareExtensionBundleIdentifier: 'ai.bookmarkai.supabaseqa.ShareExtension' }];
      }
      return plugin;
    }),
    extra: {
      ...config.extra,
      buildVariant: 'supabase-qa',
      authStorageNamespace: 'bookmark-ai:supabase-qa',
    },
  };
};
