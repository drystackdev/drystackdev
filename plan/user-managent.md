# Hệ thống quản lý tài khoản và phân quyền 

- có các collection mặc định thuộc về hệ thống này ở chế độ {kind: 'r2'}
- hệ thống user phân quyền toàn bộ dựa trên D1 của cloudfare

# hệ thống phân quyền role, permission

các bảng gồm

user {
    id: int // primary
    email: string; // unique index
    name: string;
    password: hash string
    avatar?: string;
    phoneNumber?: string;
    emailVerifyAt?: datetime
    address?: string;
    active: bool = true;
    createdAt: datetime;
    updatedAt: datetime;
}

role {
    id: int //pk
    name: string; //unique index
    permissions: string[]
}

user_role {
    userId: int // ref
    roleId: int // ref
    pk: user_id, role_id
}

# UI
- ở menu System có 1 menu item tên "User managent" - các trang gồm:
    - trang user list: hiện tất cả user ra cùng 1 lần (<100user) UI dạng bảng, có sort theo cột - chi tiết các cột:
        - avatar: hiển thị hình tròn không có avatar thì hiện Icon user ở giữa hình tròn
        - email: string hiển thị email người dùng,
        - name: string hiển thị tên người dùng
        - phoneNumber?: string hiển thị số điện thoại người dùng
        - address?: string hiển thị 
        - verify?: chip hiện thời gian active, nếu null thì hiện nút resend
        - active?: check box cho người người dùng đăng nhập hay không
        - role: hiển chip role người dùng
        - created_at: text
        - updated_at: text // sort mặc định
        lưu ý: trang có chỗ config collumn ẩn hiện lưu vào indexDB, (mặc định avatar, email, name, active, verify) search offline qua fuzzy, hightline text search
        button add user
    -  trang add user: một trang cho phép thêm user thông tin bắt buộc là email, name các thông tin con lại có thể để tróng hoặc mặc định
    khi thêm vào db thì gửi email đến user nội dung email đẹp rõ ràng, 1 nút verify có token tồn tại 24h, khi bấm vào verify đi đến trang password setting
    - trang profile (menu ở trên nút đăng xuất) chức năng gồm - (viết thành component tái dùng):
        + upload avtar: 1 email đi kèm 1 avatar: khi click vào avatar thì cho chọn từ máy tính không thông qua file managenet
        + name: cập nhật tên
        + phoneNumber: cập nhật số điện thoại
        + address: cập nhật địa chỉ

        + old pass // nullabel
        + new pass  // nullabel khi old passowrd null
        + confirm pass // nullabel khi new passowrd null
        --- Update pass ---

- password setting là trang độc lập không có layout menu chỉ hiện ở giữa 2 cột password và password confirm
- ở menu system có 1 menu item tên: Role managent - các trang gồm:
    - trang list role
        - role name // dialog đổi tên role,
        - chip: số lượng user // dialog thêm, xoá user // có search
        - chip: số lượng permission // trang config permission,
        - deleted (user.length = 0 -> enabel) // dialog confirm deleted - cần xác thực nhập đúng tên role
    - trang config permision gồm một list block có dạng:
        - tilte: ghi tên dạng Collection: name collection hoặc singleton: name singletone
        - danh sách row gồm: [] view  [] created  [] updated  [] Magic writer  [] deleted // không bật view thì 3 nút còn lại vô giá trị (disabled những vẫn lưu trạng thái)

        Khi lưu có dạng [collection:name.view, singleton:demo.created, ...] cho permissions của role, lưu tự động không cần nút save (có debounce 1s)
    
- các Role có sẵn (không thể xoá): 
    - SuperAdmin user đâu tiên, có mọi quyền không thể bị xoá bởi bát kì ai (chỉ 1 duy nhất)
    - Admin do Superadmin chỉ định có mọi quyền trừ xoá user, cấp phát quyền admin
    + tạo sẫn Editer (không phân quyền)

- khi vào trang /login mà chưa có user nào thì đi qua trang /register-first (chỉ được vào khi user = 0)
    cho điền mọi thông tin như trang profile nhưng không có old pass, new + confirm pass phải require (tận dụng component)

- trang login gồm
[ logo drystack    ]
[    Sign in       ]
[  descrip...      ]
[ email            ]
[ pass             ]
[       forget pass]
[      Login       ]

*UI hepler*: password input có button eye dùng zunstand để đồng bộ giữa các password input khác nhau

**Đây là tài liệu ngắn gọn**: nếu có bất kì vấn đề gì về thiết kế hãy hỏi tôi bằng tiếng việt để tôi quyết định nhé