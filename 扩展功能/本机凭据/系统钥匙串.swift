import Foundation
import Security
import LocalAuthentication

// 这是Web本机后端的受限命令行助手，不是桌面应用；不会枚举或修改旧工作台条目。
// 在触及Keychain前完成参数校验；拒绝弹框，系统锁定/权限拒绝由启动器报告。
func stop() -> Never { exit(1) }
guard CommandLine.arguments.count == 1 else { stop() }
let input = FileHandle.standardInput.readData(ofLength: 1025)
guard input.count <= 1024,
      let request = try? JSONSerialization.jsonObject(with: input) as? [String: String],
      Set(request.keys) == Set(["protocol", "operation", "workspaceId"]),
      request["protocol"] == "guan-keychain-master.v1",
      let operation = request["operation"], ["read", "create"].contains(operation),
      let workspace = request["workspaceId"],
      workspace.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", options: .regularExpression) != nil
else { stop() }

let context = LAContext()
context.interactionNotAllowed = true
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.guan.workbench.sqlite.master.v1",
    kSecAttrAccount as String: workspace,
    kSecAttrSynchronizable as String: false,
    kSecUseAuthenticationContext as String: context,
    kSecMatchLimit as String: kSecMatchLimitOne,
    kSecReturnData as String: true,
]
var item: CFTypeRef?
let status = SecItemCopyMatching(query as CFDictionary, &item)
var material: Data
if status == errSecSuccess, let existing = item as? Data, existing.count == 32 {
    material = existing
} else if status == errSecItemNotFound && operation == "create" {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { stop() }
    material = Data(bytes)
    _ = bytes.withUnsafeMutableBytes { $0.initializeMemory(as: UInt8.self, repeating: 0) }
    let addition: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.guan.workbench.sqlite.master.v1",
        kSecAttrAccount as String: workspace,
        kSecAttrSynchronizable as String: false,
        kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        kSecValueData as String: material,
        kSecUseAuthenticationContext as String: context,
    ]
    // 竞争、权限或系统错误均失败，不覆盖已经存在的密钥。
    guard SecItemAdd(addition as CFDictionary, nil) == errSecSuccess else { stop() }
} else { stop() }
guard let output = try? JSONSerialization.data(withJSONObject: [
    "protocol": "guan-keychain-master.v1", "workspaceId": workspace, "material": material.base64EncodedString(),
], options: [.sortedKeys]) else { stop() }
FileHandle.standardOutput.write(output)
material.resetBytes(in: 0..<material.count)
