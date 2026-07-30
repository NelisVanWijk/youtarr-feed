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

                Button("Opslaan en verversen") {
                    model.serverURL = draftURL
                    Task { await model.refreshAll() }
                }

                if let status = model.status {
                    LabeledContent("Status", value: status.connected ? "Verbonden" : "Niet verbonden")
                    if let server = status.server {
                        LabeledContent("Backend", value: server)
                    }
                    LabeledContent("Modus", value: status.mode.rawValue)
                }
            }

            Section("Opslag") {
                LabeledContent("Offline video's", value: "\(offlineLibrary.videos.count)")
                Button("Server opnieuw laden") {
                    Task { await model.refreshAll() }
                }
            }

            Section("Gebruik op iPhone") {
                Text("Gebruik hier het IP-adres of domein van je Unraid/server. `localhost` werkt alleen in de simulator op je Mac.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Instellingen")
        .onAppear {
            draftURL = model.serverURL
        }
    }
}
