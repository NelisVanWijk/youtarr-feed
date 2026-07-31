import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var offlineLibrary: OfflineLibrary

    var body: some View {
        TabView {
            NavigationStack {
                FeedScreen()
            }
            .tabItem {
                Label("Feed", systemImage: "play.rectangle.stack")
            }

            NavigationStack {
                ContinueScreen()
            }
            .tabItem {
                Label("Continue", systemImage: "clock.arrow.circlepath")
            }

            NavigationStack {
                LocalVideosScreen()
            }
            .tabItem {
                Label("Local", systemImage: "externaldrive")
            }

            NavigationStack {
                OfflineScreen()
            }
            .tabItem {
                Label("Offline", systemImage: "iphone.and.arrow.down")
            }

            NavigationStack {
                ChannelsScreen()
            }
            .tabItem {
                Label("Channels", systemImage: "rectangle.stack")
            }
        }
        .task {
            await model.refreshAll()
        }
        .alert("Youtarr Feed", isPresented: Binding(
            get: { model.message != nil },
            set: { if !$0 { model.message = nil } }
        )) {
            Button("OK", role: .cancel) {
                model.message = nil
            }
        } message: {
            Text(model.message ?? "")
        }
    }
}
