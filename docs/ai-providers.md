# Kết nối AI ("Magic write")

Hướng dẫn cấu hình nhà cung cấp AI cho tính năng **Magic write** trong trang admin.

---

## 1. Bật tính năng trong config

Trong `drystack.config.ts`:

```ts
export default config({
  storage: { ... },
  ai: {
    lang: "vi-VN",
    for: {
      blog: "bài viết chi tiết về SEO, giọng chuyên gia, có ví dụ thực tế",
      services: "trang giới thiệu một dịch vụ SEO của agency",
    },
  },
  collections: { ... },
});
```

- **Không có khối `ai`** ⇒ tính năng tắt hoàn toàn: không nút, không banner, route AI trả 404.
- **`for`**: chỉ những collection/singleton có key ở đây mới hiện nút Magic write.
  Giá trị string được nhét thẳng vào prompt, nên hãy viết cho **AI đọc**
  ("bài viết chi tiết về SEO, giọng chuyên gia"), đừng viết như nhãn UI ("Blog").
- Gõ sai key ⇒ **lỗi TypeScript ngay tại config**, không phải lỗi lúc chạy.

---

## 2. Biến môi trường

| Biến              | Bắt buộc                | Ý nghĩa                                                    |
| ----------------- | ----------------------- | ---------------------------------------------------------- |
| `DRY_AI_PROVIDER` | ✅                      | `anthropic` \| `openai` \| `google` \| `openai-compatible` |
| `DRY_AI_KEY`      | ✅                      | API key                                                    |
| `DRY_AI_MODEL`    | tuỳ                     | Model ưu tiên. Bỏ trống sẽ tự chọn (xem bên dưới)          |
| `DRY_AI_BASE_URL` | chỉ `openai-compatible` | Endpoint tuỳ chỉnh                                         |

> 🔒 **Key không bao giờ xuống browser.** Route `/api/drystack/ai/generate` chạy
> server-side và giữ key ở đó. Route `/api/drystack/ai/status` chỉ trả
> `{configured: true, provider, model}` - **không bao giờ trả key**.

### Model được chọn thế nào

`DRY_AI_MODEL` là **ưu tiên chứ không phải quyết định**: nó có thể trỏ tới một
model mà key không gọi được, hoặc model đã bị nhà cung cấp gỡ. Nên mỗi request
sẽ tự chốt lại tên model, đối chiếu với danh sách mà chính key đó liệt kê được
(`/api/drystack/ai/models`, cache 5 phút). Thứ tự ưu tiên:

1. Model người dùng chọn trong dropdown ở dialog AI - chỉ khi key gọi được nó.
2. `DRY_AI_MODEL` - cũng chỉ khi key gọi được nó.
3. Model mặc định của provider (bảng dưới) - cũng vậy.
4. Model đầu tiên trong danh sách của key.

Nếu không lấy được danh sách (endpoint sập, hoặc không có `/models`), hệ thống
vẫn chạy bằng `DRY_AI_MODEL` / model mặc định. Riêng lựa chọn từ dropdown sẽ bị
bỏ qua trong trường hợp này: không có gì để đối chiếu thì không tin client.

### Model chết tự rụng khỏi danh sách

Danh sách model là **catalogue của nhà cung cấp, không phải quyền của key**.
Google vẫn liệt kê những model trả 404 `no longer available to new users` khi
gọi thật, và **không có cách nào biết trước**: metadata của model chết giống
byte-for-byte model chạy được (cùng `supportedGenerationMethods`, cùng
`inputTokenLimit`...), `countTokens` nhận cả hai, endpoint `v1` cũng không lọc.

Nên hệ thống học từ thất bại thay vì đoán trước, ở hai chỗ:

1. **Khi chọn model trong dropdown** - gọi `POST /api/drystack/ai/models/verify`
   `{model}`, thử model đó bằng **đúng đường mà generate đi** (`stream` với
   `maxTokens: 1`, tốn 1 token, bỏ luôn kết quả). Trả `{ok:true}` /
   `{ok:false, reason:'gone'|'unavailable', message}`. Model nào đã xác nhận thì
   không hỏi lại.
2. **Khi generate/rewrite** - request nào trả 404 kèm thông báo nhắc tới model
   thì model đó bị đánh dấu chết và request **tự thử lại** với model kế tiếp
   trong chuỗi ưu tiên (tối đa 3 lần), nên lần chọn nhầm vẫn ra nội dung.

Model bị đánh dấu chết sẽ **rụng khỏi dropdown** và không được chọn lại.

> ⚠️ Probe **phải** đi qua `stream`, đừng thay bằng endpoint rẻ hơn.
> `countTokens` của Google trả 200 cho cả model mà `generateContent` từ chối
> bằng 404 - probe đường khác sẽ xác nhận nhầm một model không viết nổi chữ nào.

Đánh dấu này sống theo isolate (mất sau khi deploy/recycle, học lại 1 lần).
Chỉ 404 mới bị coi là chết - **429 (hết quota) và 5xx là tạm thời**, không loại.

> Muốn kiểm tra: `curl localhost:4567/api/drystack/ai/models` trước và sau khi
> generate bằng một model chết, số lượng sẽ giảm đúng 1.

### Model mặc định

| Provider            | Model mặc định                        | Endpoint                                   |
| ------------------- | ------------------------------------- | ------------------------------------------ |
| `anthropic`         | `claude-sonnet-5`                     | `api.anthropic.com/v1/messages`            |
| `openai`            | `gpt-5`                               | `api.openai.com/v1/chat/completions`       |
| `google`            | `gemini-2.5-pro`                      | `generativelanguage.googleapis.com/v1beta` |
| `openai-compatible` | _(không có - lấy model đầu danh sách)_ | `DRY_AI_BASE_URL`                          |

---

## 3. Cấu hình theo từng nhà cung cấp

### 3.1 Google Gemini

```bash
DRY_AI_PROVIDER=google
DRY_AI_KEY=AIza...      # hoặc AQ.… - cả hai đều dùng được
DRY_AI_MODEL=gemini-2.5-pro     # optional
```

Lấy key tại <https://aistudio.google.com/apikey>.

Adapter gửi key qua header `x-goog-api-key`. Cả key dạng `AIza…` (AI Studio) lẫn
`AQ.…` (key gắn với project Google Cloud) đều xác thực được qua header này -
**không** cần `Authorization: Bearer`.

Model gợi ý: `gemini-2.5-pro` (chất lượng cao), `gemini-2.5-flash` (nhanh, rẻ).

> ⚠️ **Xác thực được ≠ dùng được.** Key có thể qua auth nhưng project đằng sau
> không có quota. Dấu hiệu là **HTTP 429** kèm `limit: 0`:
>
> ```
> Quota exceeded for metric:
>   generativelanguage.googleapis.com/generate_content_free_tier_input_token_count,
>   limit: 0, model: gemini-2.5-pro
> ```
>
> `limit: 0` nghĩa là project **không được cấp free-tier**, không phải bạn xài quá
> nhiều. Cách xử lý:
>
> 1. Bật **billing** cho project tại <https://console.cloud.google.com/billing>, hoặc
> 2. Tạo key mới từ <https://aistudio.google.com/apikey> trong một project **có**
>    free tier.
>
> Kiểm tra nhanh key trước khi cắm vào CMS:
>
> ```bash
> curl -s -X POST \
>   'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent' \
>   -H "x-goog-api-key: $DRY_AI_KEY" -H 'content-type: application/json' \
>   -d '{"contents":[{"parts":[{"text":"say ok"}]}]}'
> ```
>
> | Kết quả                                  | Nghĩa là                                             |
> | ---------------------------------------- | ---------------------------------------------------- |
> | `200` + text                             | ✅ dùng được                                         |
> | `429` + `limit: 0`                       | Key đúng, **project không có quota** → bật billing   |
> | `404` "no longer available to new users" | Model đó project bạn không truy cập được → đổi model |
> | `401` / `403`                            | Key sai                                              |
>
> Một số model (VD `gemini-2.5-flash`) trả **404 "no longer available to new
> users"** với project mới, dù `GET /v1beta/models` vẫn liệt kê chúng - danh sách
> model **không** phản ánh quyền truy cập thật. Luôn thử `generateContent` thật.

### 3.2 Anthropic Claude

```bash
DRY_AI_PROVIDER=anthropic
DRY_AI_KEY=sk-ant-...
DRY_AI_MODEL=claude-sonnet-5    # optional
```

Lấy key tại <https://console.anthropic.com/settings/keys>.

### 3.3 OpenAI

```bash
DRY_AI_PROVIDER=openai
DRY_AI_KEY=sk-...
DRY_AI_MODEL=gpt-5              # optional
```

Lấy key tại <https://platform.openai.com/api-keys>.

### 3.4 OpenAI-compatible (Groq, DeepSeek, OpenRouter, Ollama…)

Dùng chung giao thức `/chat/completions` của OpenAI, chỉ khác `baseUrl` + model.

```bash
# Groq
DRY_AI_PROVIDER=openai-compatible
DRY_AI_KEY=gsk_...
DRY_AI_BASE_URL=https://api.groq.com/openai/v1
DRY_AI_MODEL=llama-3.3-70b-versatile

# DeepSeek
DRY_AI_PROVIDER=openai-compatible
DRY_AI_KEY=sk-...
DRY_AI_BASE_URL=https://api.deepseek.com/v1
DRY_AI_MODEL=deepseek-chat

# OpenRouter
DRY_AI_PROVIDER=openai-compatible
DRY_AI_KEY=sk-or-...
DRY_AI_BASE_URL=https://openrouter.ai/api/v1
DRY_AI_MODEL=anthropic/claude-sonnet-5

# Ollama (chạy local, không cần key thật)
DRY_AI_PROVIDER=openai-compatible
DRY_AI_KEY=ollama
DRY_AI_BASE_URL=http://localhost:11434/v1
DRY_AI_MODEL=llama3.3
```

> Gemini cũng có endpoint OpenAI-compatible nếu bạn muốn dùng qua đường này:
> `DRY_AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`

---

## 4. Đặt biến ở đâu

### Local (dev)

Thêm vào `.env` ở gốc repo:

```bash
DRY_AI_PROVIDER=google
DRY_AI_KEY=AIza...
```

`.env` đã nằm trong `.gitignore` nên không bị commit.

> ⚠️ Repo này có cơ chế **tự đồng bộ `.env` → Cloudflare Worker secrets** và
> redeploy. Nghĩa là key bạn viết vào `.env` có thể được đẩy thẳng lên
> production. Đó thường là điều bạn muốn - nhưng hãy biết là nó sẽ xảy ra.

### Production (Cloudflare)

Đặt trong **Workers & Pages → Settings → Variables and Secrets**, kiểu **Secret**:

```
DRY_AI_PROVIDER
DRY_AI_KEY
DRY_AI_MODEL      (nếu cần)
DRY_AI_BASE_URL   (nếu cần)
```

Cả 4 biến chỉ được đọc **lúc runtime** trong route handler, nên Secret hoạt động
bình thường - không cần bản plaintext build-time như `DRYSTACK_SECRET`.

---

## 5. Kiểm tra đã cấu hình đúng chưa

```bash
curl -s http://localhost:4567/api/drystack/ai/status
```

Đúng:

```json
{ "configured": true, "provider": "google", "model": "gemini-2.5-pro" }
```

Sai:

```json
{
  "configured": false,
  "reason": "missing-key",
  "message": "DRY_AI_KEY chưa được cấu hình."
}
```

Khi `configured: false`, trang admin hiện banner vàng ở đầu trang và nút
"Magic write" bị disable kèm tooltip giải thích.

| `reason`           | Cách sửa                                            |
| ------------------ | --------------------------------------------------- |
| `missing-provider` | Đặt `DRY_AI_PROVIDER`                               |
| `unknown-provider` | Chỉ nhận 4 giá trị ở bảng §2                        |
| `missing-key`      | Đặt `DRY_AI_KEY`                                    |
| `missing-model`    | Không lấy được danh sách model **và** `DRY_AI_MODEL` trống. Đặt `DRY_AI_MODEL` |
| `missing-base-url` | `openai-compatible` bắt buộc khai `DRY_AI_BASE_URL` |

Thử sinh nội dung thật (thay `blog` bằng key của bạn):

```bash
curl -N -X POST http://localhost:4567/api/drystack/ai/generate \
  -H 'content-type: application/json' \
  -d '{
    "entry": {"kind":"collection","key":"blog"},
    "targets": ["excerpt","keywords"],
    "context": {"title":"Hướng dẫn SEO onpage 2026"},
    "description": "Viết cho doanh nghiệp vừa",
    "size": "medium"
  }'
```

Chữ phải **chảy dần** ra màn hình. Nếu nó đứng im rồi đổ ụp một lần ⇒ stream
đang bị buffer ở đâu đó.

---

## 6. Lỗi thường gặp

| Triệu chứng                                  | Nguyên nhân                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `401` / `403` từ provider                    | Key sai hoặc hết hạn (xem cảnh báo token `AQ.` ở §3.1)                                                   |
| `429`                                        | Chạm rate limit - thử lại sau, hoặc đổi model rẻ hơn                                                     |
| Route trả `401 "Chưa đăng nhập"`             | Đang ở github mode mà chưa đăng nhập GitHub - đúng như thiết kế, để route không thành proxy AI công cộng |
| `403 "chưa được bật AI trong config.ai.for"` | Thiếu key đó trong `ai.for`                                                                              |
| Nút Magic write không hiện                   | Collection/singleton không có trong `ai.for`                                                             |
| Nút bị disable                               | Xem banner đầu trang + `curl ai/status`                                                                  |

---

## 7. Giới hạn đã biết

- **Ảnh/tệp không được sinh**: AI không tạo được bytes, nên `fields.image`,
  `fields.file`, `relationship`, `pathReference` **không xuất hiện** ở cả hai cột
  trong dialog.
- **`fields.timestamp`** (`createdAt`/`updatedAt`) do hệ thống tự đóng dấu lúc
  Save, AI không đụng vào.
- **Slug**: AI chỉ viết phần tiêu đề (`name`); phần `slug` do drystack tự sinh
  bằng đúng hàm dùng khi bạn gõ tay.
- **Thẻ HTML**: danh sách thẻ cho phép suy ra từ `options` của `fields.content`.
  VD `options: { heading: [2,3,4,5,6] }` ⇒ AI được dùng `h2`–`h6`, **không có `h1`**.
  `<table>`/grid cố ý không đưa vào prompt (markup cấu trúc, AI hay làm hỏng).
- **AI ghi vào form, không ghi đĩa**: phải bấm **Save/Create** mới lưu.
