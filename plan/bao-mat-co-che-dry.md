- hiện tại hệ thống vei handle dựa trên data-dry, data-dry-kind, data-dry-value
- vấn đề xảy ra khi build đưa lên production cấu trúc hệ thống bị lộ hoàn toàn
- cơ chế json mapping {
    "d:number": {
        "data-dry": "...",
        "data-dry-kind": "...",
        "data-dry-value": "..."
    }
} chỉ được tải khi đã đăng nhập github hoặc ở local
+ khi build thẻ không ghi tường minh mà sẽ ghi dạng sẽ có dạng data-dry-id="d:number"
+ khi đăng nhập github, local sẽ lấy tát cả các data-dry-id ra dựa trên d:number để lấy ra "data-dry": "...",
        "data-dry-kind": "...",
        "data-dry-value": "..." gắn ngược lại cho thẻ html


Muốn hỏi: có cơ chế nào tốt hơn không? có giúp an toàn hệ thống trên production không?
