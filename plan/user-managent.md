Hiện tại hệ thống user managenet hiện tại đang có nhưng tôi muốn loại bỏ nó và thực hiện yêu cầu sao

- users là 1 collection có sẵn: 
    - email: string (regex: email),
    - passord: string (hash khi save)
    - name: text 
    - avatar: field.image (chọn file trực tiếp không đi qua dialog nữa)

- ở drystack.config.ts có thể config thêm ví dụ users: {
    phoneNumber: field.string({...})
}(có sẵn type của schema) ở top level khi tạo user colleciion thì merge thêm vào user collection

- cơ chế gửi email khi thêm mới,
- không cho phép chỉnh sửa user khi click vào user vẫn hiện thông tin nhưng disabeld toàn bộ, vẫn có nút deleted ở đây
