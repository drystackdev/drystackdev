Tại menu thêm group File management (File Managenent) - tận dụng api có sẵn chỉ làm giao diện thêm
[] - public (/asset), trang quản lý file 2 tab bài viết (hình ảnh, file theo cấu trúc bài viết - collection, sington tương tự nhau (chứ trong thư mục /assets nằm trong thư mục quản slug - khi xoá bài xoá luôn assets))
[] - Hiển thị tất cả hình ảnh file, khi click vào ảnh có chế độ preview zoom, scrop ảnh, giảm dung lượng ảnh, có nút xoá trên đây - responsive grid só lượng ảnh theo kích thước mà hình 
[] - có nút search, search theo name
[] - có nút upload (ngang hàng nút cancel - nằm bên trái), upload nhiều file lên thư mục tương ứng, ảnh bị trùng tên báo lỗi trong dialog confirm có 3 nút cancel (bỏ qua file đó và thực hiện các cái khác), replace (thay thế), upload (ghi thêm hash để tránh trùng tên) - xuất hiện checkbox để áp dụng chức năng cho tất cả Khi xử lý thành công mới post lên server 1 lần
[] - hiển thị dạng cây thư mục, file
[] - có thể chọn nhiều khi click vào footer của card (checkbox để chọn), có thể chọn cả thư mục - khi chọn nhiều có nút xoá
[] - trên mỗi card hình, thư mục đều có button float delete
[] - chức năng xoá có confirm, khi xoá chuyển qua thư mục .deleted/ tương ứng path, xây dụng tab restore ảnh lại, hoặc xoá hẳng ảnh field luôn
[] - viết để tận dụng thành dialog cho fields.image và chọn ảnh cho content (các file ko được chọn thì disabled nhưng vẫn hiện)