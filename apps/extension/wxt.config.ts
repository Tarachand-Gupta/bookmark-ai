import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ browser, manifestVersion }) => ({
    name: "Bookmark AI",
    description:
      "Save the current tab to Bookmark AI for automatic categorization and tagging.",
    permissions: ["activeTab", "tabs", "storage"],
    host_permissions: ["http://localhost:4545/*"],
    ...(browser === "firefox" && {
      browser_specific_settings: {
        gecko: {
          id: "bookmark-ai@purecode.ai",
          data_collection_permissions: { required: ["none"] },
        },
      },
    }),
    commands: {
      // MV2 (Firefox/Safari targets) uses the legacy browser_action command name.
      [manifestVersion === 2 ? "_execute_browser_action" : "_execute_action"]: {
        suggested_key: { default: "Alt+Shift+S" },
        description: "Open the Bookmark AI popup",
      },
    },
  }),
});
