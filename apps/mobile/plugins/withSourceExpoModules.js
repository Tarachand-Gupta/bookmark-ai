/**
 * Build Expo's iOS modules from source instead of embedding their precompiled
 * XCFrameworks. The precompiled ExpoImageManipulator artifact repackages
 * SDWebImage without SDWebImage's required PrivacyInfo.xcprivacy; the CocoaPods
 * source dependency includes the upstream manifest and is signed in our build.
 */
const { withPodfileProperties } = require("expo/config-plugins");

module.exports = function withSourceExpoModules(config) {
  return withPodfileProperties(config, (config) => {
    config.modResults.EXPO_USE_PRECOMPILED_MODULES = "false";
    return config;
  });
};
