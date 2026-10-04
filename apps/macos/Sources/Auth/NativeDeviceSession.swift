import Foundation

struct NativeDeviceSession: Decodable, Identifiable, Equatable {
    let id: String
    let displayName: String
    let clientType: String?
    let browser: String?
    let os: String?
    let createdAt: String?
    let lastActiveAt: String?
    let isCurrent: Bool
}
