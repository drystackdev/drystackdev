- hiện tại hệ thống vei handle dựa trên data-dry, data-dry-kind, data-dry-value
- vấn đề xảy ra khi build đưa lên production cấu trúc hệ thống bị lộ hoàn toàn
- cơ chế json mapping {
    "d:hash": {
        dry: "...",
        kind: "...",
        value: "..."
    }
}
+ khi build thẻ không ghi tường minh mà sẽ ghi dạng sẽ có dạng data-dry-id="d:hash"
+ khi đăng nhạp github, local sẽ dựa trên json mapping và data-dry-id để tìm ra object để handle đảm bảo mật và giúp html sạch hơn

Muốn hỏi: có cơ chế nào tốt hơn không? có giúp an toàn hệ thống trên production không?

