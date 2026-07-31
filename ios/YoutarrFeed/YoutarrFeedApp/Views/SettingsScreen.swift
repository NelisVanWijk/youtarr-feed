import SwiftUI

struct SettingsScreen: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var offlineLibrary: OfflineLibrary

    @State private var draftURL = ""

    var body: some View {
        Form {
            Section("Server") {
                TextField("http://server-ip:3090", text: $draftURL)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()

                Button("Save and refresh") {
                    model.serverURL = draftURL
                    Task { await model.refreshAll() }
                }

                if let status = model.status {
                    LabeledContent("Status", value: status.connected ? "Connected" : "Not connected")
                    if let server = status.server {
                        LabeledContent("Backend", value: server)
                    }
                    LabeledContent("Mode", value: status.mode.rawValue)
                }
            }

            Section("Storage") {
                LabeledContent("Offline videos", value: "\(offlineLibrary.videos.count)")
                Button("Reload server") {
                    Task { await model.refreshAll() }
                }
            }

            Section("Using iPhone") {
                Text("Use the IP address or domain of your Unraid/server here. `localhost` only works in the simulator on your Mac.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Settings")
        .onAppear {
            draftURL = model.serverURL
        }
    }
}
