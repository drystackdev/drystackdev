Cập nhật
[ ] - entryLayout sẽ field.content cuối cùng làm layout content, nếu không có thì xử lý như form

Tinh chỉnh image edit inline
[] - popover toolbar của ảnh đang nằm ở 2 khu vực khác nhau gọi là top và bot
[] - 3 nút left, right, center phải nằm ở menu bottom bên trái nút edit và có divider phân cách, 
[] - menu bottom đang lỗi không đi theo ảnh tốt như menu top,
[] - menu top phần nhập số to width ra tận dụng text number có sẵn, nút khoá nằm bên phải chứ ko nằm giữa 2 input
[] - 8 chấm chưa nằm giữa line, 8 chấm này mong muốn có radius hoặc tròn
[] - outline khi ở chế độ center (display: block) outline phải nằm trong block mới đúng html chuẩn, hiện đang lỗi chỉ bao bọc ảnh
[] - khi bật aspect lên thì resize ảnh ngay ưu tiên theo chiều width

Tại menu thêm group File management (File Managenent) - tận dụng api có sẵn chỉ làm giao diện thêm
[] - hiển thị trang quản lý file, ảnh - tận dụng làm dialog
[] - public (/asset), trang quản lý file 2 tab bài viết (hình ảnh, file theo cấu trúc bài viết - collection, sington tương tự nhau (chứ trong thư mục /assets nằm trong thư mục quản slug - khi xoá bài xoá luôn assets))
[] - Hiển thị tất cả hình ảnh file, khi click vào ảnh có chế độ preview zoom, scrop ảnh, giảm dung lượng ảnh, có nút xoá trên đây - responsive grid só lượng ảnh theo kích thước mà hình 
[] - có nút input debound search, search theo name
[] - có nút upload (ngang hàng nút cancel - nằm bên trái), upload nhiều file lên thư mục tương ứng, ảnh bị trùng tên báo lỗi trong dialog confirm có 3 nút cancel (bỏ qua file đó và thực hiện các cái khác), replace (thay thế), upload (ghi thêm hash để tránh trùng tên) - xuất hiện checkbox để áp dụng chức năng cho tất cả Khi xử lý thành công mới post lên server 1 lần
[] - hiển thị dạng cây thư mục, file
[] - có thể chọn nhiều khi click vào footer của card (checkbox để chọn - label là tên và kích thước file - ở folder hiện số lượng item con trực tiếp), có thể chọn cả thư mục - khi chọn nhiều có nút xoá
[] - trên mỗi card hình, thư mục đều có button delete neo ở góc trên bên phải
[] - chức năng xoá có confirm, khi xoá chuyển qua thư mục .deleted/ tương ứng path, xây dụng tab restore ảnh lại, hoặc xoá hẳng ảnh field luôn
[] - viết để tận dụng thành dialog cho fields.image và chọn ảnh cho content (các file ko được chọn thì disabled nhưng vẫn hiện) - loại bỏ giúp tôi cơ chế dialog của image và field hiện tại chỉ dùng chung dialog này

Thêm fields.images, fields.files 
[] - cho phép chọn nhiều ảnh, nhiều file, 