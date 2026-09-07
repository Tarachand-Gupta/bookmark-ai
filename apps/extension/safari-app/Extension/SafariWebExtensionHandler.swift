//
//  SafariWebExtensionHandler.swift
//  Bookmark AI Extension
//
//  The native half of the Safari web extension. Bookmark AI's JS never calls
//  `browser.runtime.sendNativeMessage` — every API call goes straight from the
//  background service worker to bookmark-ai.cloud — so this handler only has to
//  exist (Safari requires an NSExtensionPrincipalClass) and answer politely.
//  It echoes whatever it receives, like Apple's template, so a future native
//  bridge has a known starting point.
//

import SafariServices
import os.log

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
        let message = request?.userInfo?[SFExtensionMessageKey]

        os_log(
            .default,
            "Bookmark AI: native message %@ (profile %@)",
            String(describing: message),
            profile?.uuidString ?? "none"
        )

        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: ["echo": message as Any]]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
