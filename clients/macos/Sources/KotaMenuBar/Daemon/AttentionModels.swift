import Foundation

// Mirror of the daemon's `GET /api/attention` envelope (see
// `src/modules/autonomy/workflows/attention-digest/attention-route.ts`):
// `{ data: { items: AttentionItem[] }, text: string }`. Strict decode
// so a payload drift fails loudly instead of silently rendering an
// empty section.

struct AttentionResponse: Codable {
    let data: AttentionData
    let text: String
}

struct AttentionData: Codable {
    let items: [AttentionItem]
}

struct AttentionItem: Codable {
    let label: String
    let detail: String
}
