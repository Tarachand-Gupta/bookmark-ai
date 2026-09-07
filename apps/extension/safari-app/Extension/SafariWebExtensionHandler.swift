//
//  SafariWebExtensionHandler.swift
//  Bookmark AI Extension
//
//  The native half of the Safari web extension. Safari requires an
//  NSExtensionPrincipalClass; ours does exactly one job: receive the background
//  worker's `authState` reports (`browser.runtime.sendNativeMessage`, Safari
//  target only — apps/extension/lib/native-auth-report.ts) and persist them into
//  the App Group suite (`AuthStateStore`) so the companion app can show the real
//  sign-in state. Anything else is echoed, like Apple's template, so a future
//  native bridge has a known starting point. No network, no files, no tokens.
//

import SafariServices
import os.log

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey]

        let response = NSExtensionItem()
        if let auth = AuthStateStore.parse(message) {
            AuthStateStore.write(signedIn: auth.signedIn, email: auth.email, name: auth.name, at: auth.at)
            // Domain-redacted on purpose — the local part of the address never reaches the log.
            os_log(
                .default,
                "Bookmark AI: auth state → signedIn=%{public}@ email=%{public}@",
                auth.signedIn ? "true" : "false",
                AuthStateStore.redactedEmail(auth.email)
            )
            response.userInfo = [SFExtensionMessageKey: ["ok": true]]
        } else {
            os_log(.default, "Bookmark AI: native message (echoed): %{private}@", String(describing: message))
            response.userInfo = [SFExtensionMessageKey: ["echo": message as Any]]
        }
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
