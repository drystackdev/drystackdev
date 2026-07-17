# AI - Tạo nội dung ("Magic write")

> Chức năng **chỉ dùng trong trang admin**. Không xuất hiện trên site công khai,
> không tích hợp vào VEI (Visual Editing Inline).

---

## ✅ Trạng thái: ĐÃ XONG (2026-07-17)

Toàn bộ 4 giai đoạn đã triển khai và verify. Hướng dẫn cấu hình:
[docs/ai-providers.md](../docs/ai-providers.md).

**Đã verify**

- Local mode: stream thật (không buffer), UI điền dần, khoá/mở khoá theo từng field.
- GitHub mode (`wrangler dev` trên workerd): route sống, **401 khi chưa đăng nhập**,
  **403 với key ngoài `ai.for`**, stream chạy qua Worker.
- 36 unit test cho codec + parser + phát hiện field trống, tất cả pass.
- Không bấm Save ⇒ `git diff` sạch (AI chỉ ghi vào form state).

**Khác với bản kế hoạch ban đầu**

| Điểm                    | Thực tế                                                                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phạm vi trang           | Nối cả **`create-item.tsx`** (trang tạo mới) - bản kế hoạch quên, mà đây là chỗ dùng AI nhiều nhất                                                                                 |
| `aiMeta`                | Field không lộ `description`/`multiline`/`options` ra ngoài ⇒ phải thêm `AiFieldMeta` vào `form/api.tsx` và gắn cho từng field                                                     |
| Nhận diện slug          | **Không** dùng `defaultValue()` như dự tính: gọi nó ở server-side ném lỗi react-server ⇒ slug field sẽ bị nhầm thành text. Đổi sang kiểm tra `typeof field.slugify === 'function'` |
| Thứ tự check ở route    | Kiểm tra **đăng nhập trước** lỗi cấu hình - không để người lạ biết trạng thái cấu hình AI                                                                                          |
| Checkbox/số ở dialog    | Boolean và number **không bao giờ** tính là "trống" ⇒ `publish` mặc định vào cột ngữ cảnh, AI không tự quyết định xuất bản                                                         |
| Bảng/grid trong content | Cố ý **không** đưa vào prompt (markup cấu trúc, AI hay làm hỏng) dù editor có bật                                                                                                  |

**Bug bị test bắt trong lúc làm**

- Parser emit _chỉ dòng dở_ thay vì toàn bộ text tích luỹ ⇒ chữ đã hiện bị nuốt mất
  giữa chừng. Đã có test `progress never shrinks` khoá lại.

---

## 1. Quyết định đã chốt

| Chủ đề              | Quyết định                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Provider            | `anthropic`, `openai`, `google`, `openai-compatible` (Groq/DeepSeek/OpenRouter/Ollama qua `DRY_AI_BASE_URL`)                |
| Field được ĐIỀN     | text-like + content + select/checkbox/date + `array<object>` lồng sâu. **Không** đụng image/file/relationship/pathReference |
| Slug field          | AI điền `name`, phần `slug` để drystack tự slugify                                                                          |
| Cách áp kết quả     | **Stream thẳng vào form**; field đang stream = readonly, xong mới cho sửa                                                   |
| Đơn vị "xong"       | Scalar: xong khi field đó kết thúc. Object/array: xong khi **cả khối** hoàn thành, không mở khoá theo từng item             |
| Format AI xuất ra   | **YAML** (xem §4 - vì sao không phải CSV)                                                                                   |
| Vị trí nút          | Toolbar entry (cạnh Save) + nút nhỏ trên từng field được hỗ trợ                                                             |
| Kích thước bài viết | 4 mức có số từ: Ngắn ~500 / Vừa ~1000 / Dài ~2000 / Rất dài ~3000+                                                          |
| Gating              | Key không có trong `ai.for` ⇒ **không có nút**                                                                              |

---

## 2. Cấu hình

### 2.1 `drystack.config.ts`

```ts
export default config({
  storage: { ... },
  ai: {
    lang: "vi-VN",          // ngôn ngữ đầu ra, mặc định theo `locale` nếu bỏ trống
    for: {
      blog: "bài viết chi tiết về SEO, giọng chuyên gia, có ví dụ thực tế",
      services: "trang giới thiệu một dịch vụ SEO",
    },
  },
  collections: { ... },
});
```

- `ai` là **optional**. Không có ⇒ tính năng tắt hoàn toàn, không import chunk AI.
- `for` là map `collectionKey | singletonKey` → mô tả ngữ cảnh (string), nhét thẳng
  vào system prompt. Key không liệt kê ⇒ trang đó không có nút Magic write.
- Type mới thêm vào [`packages/drystack/src/config.tsx`](packages/drystack/src/config.tsx),
  trong `CommonConfig<Collections, Singletons>` để cả local lẫn github config đều có:

```ts
type AiConfig<Collections, Singletons> = {
  lang?: string;
  for?: Partial<
    Record<(keyof Collections & string) | (keyof Singletons & string), string>
  >;
};
```

Dùng `keyof` để gõ sai key là lỗi TypeScript ngay tại config.

### 2.2 Biến môi trường

```bash
DRY_AI_PROVIDER=anthropic       # anthropic | openai | google | openai-compatible
DRY_AI_KEY=sk-ant-...           # bắt buộc nếu có config `ai`
DRY_AI_MODEL=claude-sonnet-5    # optional - có default riêng cho mỗi provider
DRY_AI_BASE_URL=...             # chỉ dùng (và bắt buộc) với openai-compatible
```

Default model theo provider:

| Provider            | Default model                               | Endpoint                                          |
| ------------------- | ------------------------------------------- | ------------------------------------------------- |
| `anthropic`         | `claude-sonnet-5`                           | `https://api.anthropic.com/v1/messages`           |
| `openai`            | `gpt-5`                                     | `https://api.openai.com/v1/chat/completions`      |
| `google`            | `gemini-2.5-pro`                            | `.../v1beta/models/{model}:streamGenerateContent` |
| `openai-compatible` | _(không có - bắt buộc khai `DRY_AI_MODEL`)_ | `DRY_AI_BASE_URL` + `/chat/completions`           |

> ⚠️ **Key không bao giờ được xuống browser.** Mọi lời gọi đi qua route proxy ở §5.

**Đọc env ở đâu:** theo đúng pattern đã có trong
[`packages/astro/src/api.tsx`](packages/astro/src/api.tsx) - thử
`cloudflare:workers` env trước (prod Worker), fallback `import.meta.env.*`
(dev/Node). Thêm 4 key trên vào `APIRouteConfig`.

> 📌 Xem memory _"CF secrets are runtime-only"_: Cloudflare Pages Secrets
> **vô hình với `astro build`**. `DRY_AI_KEY` chỉ được đọc lúc runtime trong
> route handler nên **không** cần bản plaintext build-time - nhưng phải bảo đảm
> không có code nào chạm `DRY_AI_KEY` ở tầng build/prerender.

### 2.3 Alert khi thiếu key

Có `config.ai` mà route báo chưa cấu hình key ⇒ hiện banner ở **top mọi trang admin**.

- Vị trí: shell layout, cùng chỗ các banner hiện có
  ([`packages/drystack/src/app/shell/`](packages/drystack/src/app/shell/)).
- Nguồn dữ liệu: route `GET /api/drystack/ai/status` → `{ configured: boolean, provider?: string, reason?: string }`.
  Route này **không bao giờ trả key**, chỉ trả boolean + lý do
  (`missing-key` | `missing-model` | `missing-base-url` | `unknown-provider`).
- Fetch một lần khi app mount, cache trong context. Dùng `<Notice tone="caution">` của `@keystar/ui/notice`.
- Nút Magic write vẫn hiện nhưng `isDisabled` + tooltip giải thích, để người dùng
  hiểu tại sao nó không bấm được (thay vì nút biến mất bí ẩn).

---

## 3. Kiến trúc tổng thể

```
[Admin UI]  ItemPage / SingletonPage
    │  1. bấm ✦ Magic write  →  dialog
    │  2. chọn field "lấy thông tin" / "điền thông tin", mô tả, kích thước
    │  3. build payload
    ▼
POST /api/drystack/ai/generate        (fetch, stream: true)
    │
    ├─ dev  + local  mode → Vite Node middleware (index.ts:344)
    ├─ dev  + github mode → workerd route
    └─ prod (mọi mode)    → Cloudflare Worker
    │
    │  4. build system prompt + user prompt + YAML skeleton
    ▼
[Provider adapter] → SSE upstream
    │  5. bóc token text ra khỏi SSE riêng của từng hãng
    ▼
ReadableStream (text/event-stream, chỉ chứa YAML thô)
    │
    ▼
[Admin UI] streaming YAML parser → theo từng top-level key
    │  6. scalar → gõ dần vào ô (readonly)
    │     object/array → buffer, parse trọn khối, áp 1 lần
    ▼
setState({ state, localTreeKey })     ← form state, chưa ghi đĩa
    │
    ▼
người dùng review → bấm Save (đường ghi hiện có, không đổi)
```

**Điểm mấu chốt:** AI **chỉ ghi vào form state trong bộ nhớ**. Nó không đụng
`useUpsertItem`, không đụng `useCommitFileChanges`, không ghi đĩa. Muốn lưu vẫn
phải bấm Save như bình thường.

> ⚠️ Xem memory _"Editor autosave on browser test"_: khi test bằng Playwright,
> tương tác với editor có thể âm thầm ghi xuống đĩa. Sau mỗi lần test browser,
> chạy `git diff` và revert.

### 3.1 Tính tương thích local ↔ github (bắt buộc theo CLAUDE.md)

Route AI **không đọc/ghi repo**, nên bản thân nó storage-agnostic. Nhưng có
**một cái bẫy thật sự**:

> [`generic.ts:116`](packages/drystack/src/api/generic.ts#L116) - khi
> `storage.kind === 'local'`, handler **short-circuit** vào `localModeApiHandler`,
> và [`api-node.ts:85`](packages/drystack/src/api/api-node.ts#L85) trả **404 cho
> mọi path lạ**. Nếu để nguyên, route AI sẽ 404 sạch trong local mode.

⇒ **Phải hoist nhánh AI lên TRƯỚC kiểm tra `storage.kind === 'local'`**, và cũng
trước nhánh `if (!clientId || !clientSecret || !secret)` (vì local mode / dự án
chưa nối GitHub App không có mấy biến đó, nhưng vẫn phải dùng được AI).

Vị trí đúng: ngay sau khi tính `getParams`, trước cả hai nhánh trên.

```ts
// Trong makeGenericAPIRouteHandler, trước nhánh local mode
const aiHandler = makeAiRouteHandler(_config2); // undefined nếu không có config.ai
// ...
const joined = params.join("/");
if (joined.startsWith("ai/")) {
  return aiHandler?.(req, params) ?? { status: 404, body: "Not Found" };
}
```

Vì nhánh local trả về sớm một closure khác, cần refactor nhẹ: tách phần
`getParams` + dispatch AI ra một wrapper bọc ngoài cả 3 nhánh hiện có.

---

## 4. Format trên dây: YAML

### 4.1 Vì sao YAML, không phải CSV

CSV **không dùng được** cho ca này:

- `fields.content` xuất HTML nhiều dòng, có dấu `,` và `"` dày đặc ⇒ quoting CSV
  trở thành ác mộng và AI rất hay làm sai.
- Schema có `array<object>` lồng nhau (`services.process[]`,
  `gioiThieu.timeline.items[]`) - CSV phẳng, không biểu diễn được.

YAML thắng vì:

- Block scalar `|` giữ nguyên HTML nhiều dòng, **không cần escape gì cả** - đây là
  lý do lớn nhất.
- Tiết kiệm token hơn JSON (không ngoặc kép, không dấu phẩy, không `{}`).
- Cấu trúc theo dòng + thụt lề ⇒ **stream-parse được** bằng cách bám top-level key
  (§4.3), việc mà JSON không làm được nếu chưa đóng ngoặc.
- `js-yaml` đã có sẵn trong cả hai package (`packages/drystack`, `packages/astro`) -
  không thêm dependency.

### 4.2 Ví dụ đầu ra (collection `blog`)

```yaml
title: Hướng dẫn SEO onpage 2026
excerpt: |
  Bài viết chi tiết về cách tối ưu SEO onpage năm 2026, tập trung vào
  Core Web Vitals và search intent.
keywords: seo onpage, tối ưu onpage, core web vitals
body: |
  <h2>SEO onpage là gì?</h2>
  <p>SEO onpage là tập hợp các kỹ thuật tối ưu <strong>ngay trên trang</strong>...</p>
  <h3>1. Tối ưu thẻ tiêu đề</h3>
  <p>Thẻ title vẫn là...</p>
```

Ví dụ có `array<object>` (collection `services`):

```yaml
title: Dịch vụ SEO tổng thể
price: Từ 15.000.000đ/tháng
tags:
  - seo tổng thể
  - seo bền vững
process:
  - step: Khảo sát & audit
    desc: |
      Phân tích toàn bộ hiện trạng website, đối thủ và từ khoá.
  - step: Lập kế hoạch
    desc: |
      Xây dựng lộ trình 6 tháng với KPI rõ ràng.
```

### 4.3 Giao kèo bắt buộc với AI (nằm trong system prompt)

1. Xuất **chỉ YAML thô**. Không ` ```yaml `, không lời dẫn, không giải thích.
2. Chỉ xuất **đúng những key được yêu cầu điền**, theo **đúng thứ tự** đã liệt kê
   trong skeleton - thứ tự chính là thứ mà parser bám vào để biết field trước đã xong.
3. Mọi string nhiều dòng **phải** dùng block scalar `|`.
4. Không bịa key mới. Không xuất key thuộc nhóm "lấy thông tin".
5. `select`/`multiselect`: chỉ chọn trong danh sách `options` được cho.
6. `checkbox`: `true`/`false`. `date`: `YYYY-MM-DD`. `integer`: số trần.
7. Field content: xuất **HTML fragment**, chỉ dùng các thẻ được cho phép
   (danh sách sinh từ `options` của field - xem §6.2). Không `<html>`, `<body>`,
   không `<img>` (AI không sinh được bytes ảnh).

---

## 5. Backend

### 5.1 File mới

```
packages/drystack/src/api/ai/
  index.ts          - makeAiRouteHandler: dispatch ai/status, ai/generate
  env.ts            - đọc + validate DRY_AI_*, trả AiRuntimeConfig | AiConfigError
  providers/
    types.ts        - interface AiProvider
    anthropic.ts
    openai.ts       - dùng chung cho `openai` và `openai-compatible`
    google.ts
  prompt.ts         - build system prompt + user prompt + skeleton
  schema-to-yaml.ts - schema → skeleton + mô tả field (dùng chung với client)
```

Export qua `package.json` `exports` (thêm `"./api/ai"`), theo đúng pattern
`"./api/generic"` đã có.

### 5.2 Interface adapter

```ts
export type AiProvider = {
  name: string;
  // Trả stream text thô đã bóc khỏi SSE riêng của hãng.
  stream(args: {
    apiKey: string;
    model: string;
    baseUrl?: string;
    system: string;
    user: string;
    maxTokens: number;
    signal: AbortSignal;
  }): Promise<ReadableStream<string>>;
};
```

Cả 3 adapter dùng `fetch` thuần + `TextDecoderStream` - **không dùng SDK chính
thức** của hãng (SDK kéo theo node builtins, dễ vỡ trên workerd). `fetch`,
`ReadableStream`, `TextDecoderStream` đều có sẵn cả ở Node 18+ lẫn workerd.

Khác biệt cần chuẩn hoá giữa 3 hãng:

- **anthropic**: `POST /v1/messages`, header `x-api-key` + `anthropic-version: 2023-06-01`,
  `stream: true`, `system` là param riêng. Token nằm ở event `content_block_delta` → `delta.text`.
- **openai**: `POST /chat/completions`, header `Authorization: Bearer`, `stream: true`,
  system là message đầu (`role: "system"`). Token ở `choices[0].delta.content`.
  Kết thúc bằng `data: [DONE]`.
- **google**: `POST .../{model}:streamGenerateContent?alt=sse`, key ở query hoặc
  header `x-goog-api-key`, system ở `systemInstruction`. Token ở
  `candidates[0].content.parts[0].text`.

`maxTokens` suy từ mức kích thước: Ngắn 2000 / Vừa 4000 / Dài 8000 / Rất dài 16000.

### 5.3 Route `POST /api/drystack/ai/generate`

Request body:

```ts
type AiGenerateRequest = {
  entry: { kind: "collection" | "singleton"; key: string };
  // Giá trị hiện có của các field "lấy thông tin", đã phẳng hoá thành text.
  context: Record<string, string>;
  // Skeleton mô tả các field cần điền - client sinh, server validate lại.
  targets: AiFieldSpec[];
  description: string;
  size: "short" | "medium" | "long" | "xlong";
};
```

Response: `text/event-stream`, body là YAML thô cắt thành chunk.

Server phải **validate lại `entry.key` có trong `config.ai.for`** - client gửi gì
cũng không tin, tránh biến route thành proxy AI công cộng miễn phí.

**Bảo vệ route:** github mode đã có cookie `drystack-gh-access-token`; local mode
chỉ chạy trên máy dev nên không cần. ⇒ Ở github mode, **bắt buộc kiểm tra cookie
token hợp lệ** trước khi gọi AI, nếu không ai cũng đốt được quota của bạn.
Đây là điểm dễ quên nhất trong cả plan này.

### 5.4 Cho phép body là stream (2 chỗ phải sửa)

Hiện `DrystackResponse` **không nhận** `ReadableStream`:

1. [`internal-utils.ts:8`](packages/drystack/src/api/internal-utils.ts#L8) -
   nới type:

   ```ts
   export type DrystackResponse = ResponseInit & {
     body: Uint8Array | string | ReadableStream<Uint8Array> | null;
   };
   ```

   `api.tsx` đã làm `new Response(body, ...)` nên tự động chạy được, không cần sửa.

2. [`packages/astro/src/index.ts:121-123`](packages/astro/src/index.ts#L121-L123) -
   dev bridge đang `res.end(responseBody)` (buffer trọn gói). Thêm nhánh pipe:
   ```ts
   else if (responseBody instanceof ReadableStream) {
     const { Readable } = await import('node:stream');
     Readable.fromWeb(responseBody as any).pipe(res);
   }
   ```
   Không sửa chỗ này thì **local dev sẽ không stream** - nó sẽ đứng im rồi đổ ụp
   toàn bộ kết quả một lần, và bug này rất dễ bị chẩn đoán nhầm thành lỗi provider.

Nhớ set `headers: [['content-type','text/event-stream'], ['cache-control','no-cache'], ['x-accel-buffering','no']]`.

---

## 6. Codec schema ↔ YAML

File dùng chung client+server: `packages/drystack/src/api/ai/schema-to-yaml.ts`.

### 6.1 Phân loại field

```ts
type AiFieldKind =
  | "text"
  | "content"
  | "select"
  | "multiselect"
  | "checkbox"
  | "date"
  | "integer"
  | "url"
  | "array"
  | "object";

// Field AI không đụng tới ⇒ không hiện ở CẢ HAI cột trong dialog.
const UNSUPPORTED = [
  "image",
  "file",
  "images",
  "files",
  "relationship",
  "multiRelationship",
  "pathReference",
];
```

Nhận diện: `fields.content` dùng
[`isContentEditorField()`](packages/drystack/src/form/fields/content/is-content-field.ts)
đã có sẵn (`formKind === 'assets' && htmlContentEditor === true`) - **không** đoán
theo tên field.

`fields.slug` ⇒ AI chỉ điền `name`; client tự slugify phần `slug` bằng cơ chế có sẵn.

`timestamp` (`createdAt`/`updatedAt`) ⇒ **loại khỏi cả hai cột**: theo memory
_"fields.timestamp() field"_, việc đóng dấu do `useUpsertItem` lo, AI chạm vào là sai.

### 6.2 Sinh skeleton

Đi đệ quy qua schema, mỗi field xuất một dòng mô tả cho AI:

```
title (văn bản ngắn, bắt buộc): Tiêu đề
excerpt (văn bản nhiều dòng, bắt buộc): Mô tả ngắn
keywords (văn bản ngắn): Từ khóa SEO - Cách nhau bởi dấu phẩy, VD: từ khoá 1, từ khoá 2
body (HTML, thẻ cho phép: p, h2, h3, h4, h5, h6, ul, ol, li, strong, em, a, blockquote): Nội dung
process (danh sách các mục, mỗi mục gồm):
  step (văn bản ngắn, bắt buộc): Bước
  desc (văn bản nhiều dòng, bắt buộc): Mô tả
```

Nguồn của mỗi phần:

- `label` → tên người-đọc-được của field.
- `description` → nhét thẳng vào; **đây là kênh hướng dẫn AI mạnh nhất mà không
  cần đụng config** (VD `headingFieldDescription` dạy AI quy ước ngoặc vuông
  `Nguyễn Phương Quang - [chuyên gia SEO]` - thứ AI không đời nào tự đoán ra).
- `validation.isRequired` → "bắt buộc".
- `select.options` → liệt kê `value` hợp lệ.
- Field `content`: danh sách thẻ suy từ `options` của field
  (VD `options: { heading: [2,3,4,5,6] }` ⇒ cho phép `h2`–`h6`, không có `h1`).

### 6.3 YAML → form value

Mỗi kind một hàm áp giá trị:

| Kind       | Cách áp                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| `text`     | gán thẳng string                                                                                      |
| `slug`     | `{ name: value, slug: slugify(value) }`                                                               |
| `content`  | **`field.parse(undefined, { content: textEncoder.encode(html), other: new Map() })`** → `EditorState` |
| `select`   | validate ∈ options, sai ⇒ bỏ qua field đó                                                             |
| `checkbox` | ép boolean                                                                                            |
| `date`     | validate `YYYY-MM-DD`                                                                                 |
| `array`    | dựng lại mảng qua preview props (`onChange`), không mutate                                            |
| `object`   | áp từng key con                                                                                       |

> ⚠️ **Điểm dễ sai nhất của cả tính năng:** giá trị form của `fields.content`
> là một **ProseMirror `EditorState`**, không phải string
> ([content/index.tsx:78-82](packages/drystack/src/form/fields/content/index.tsx#L78-L82)).
> Không thể nối chuỗi vào nó. Muốn stream thì phải **parse lại toàn bộ HTML tích
> luỹ** sau mỗi chunk (throttle ~120ms). HTML dở dang kiểu `<h2>Mở đ` vẫn parse
> được vì `DOMParser` tự đóng thẻ, nên cách này chạy - nhưng phải throttle, không
> thì mỗi token là một lần re-parse cả document.

---

## 7. Frontend

### 7.1 Icon + nút

Icon (đúng SVG trong spec gốc) → thêm vào
[`packages/drystack/src/app/icons/`](packages/drystack/src/app/icons/) theo pattern
các icon sẵn có:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
  <path d="M0 0h24v24H0z" fill="none" />
  <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
        stroke-width="1.5" d="M7 3v18M17 3v18m4-14H3m18 10H3" />
</svg>
```

Hai vị trí:

1. **Toolbar entry** - trong `HeaderActions`
   ([ItemPage.tsx:630](packages/drystack/src/app/ItemPage.tsx#L630)) và chỗ tương
   ứng ở [SingletonPage.tsx](packages/drystack/src/app/SingletonPage.tsx). Mở dialog đầy đủ.
2. **Từng field** - nút icon nhỏ cạnh label, chỉ ở field kind được hỗ trợ. Bấm ⇒
   generate **riêng field đó**, lấy toàn bộ field khác đang có giá trị làm ngữ
   cảnh, bỏ qua bước chọn cột (dialog rút gọn: chỉ mô tả + kích thước).

Cả hai chỉ render khi `config.ai?.for?.[entryKey]` tồn tại.

### 7.2 Dialog

```
┌─ ✦ Magic write - Bài viết ────────────────────────────────┐
│                                                            │
│  Lấy thông tin                 Điền thông tin              │
│  ┌──────────────────────┐      ┌──────────────────────┐   │
│  │ ☑ Tiêu đề            │      │ ☐ Tiêu đề            │   │
│  │ ☐ Mô tả ngắn         │      │ ☑ Mô tả ngắn         │   │
│  │ ☐ Từ khóa SEO        │      │ ☑ Từ khóa SEO        │   │
│  │ ☐ Nội dung           │      │ ☑ Nội dung           │   │
│  └──────────────────────┘      └──────────────────────┘   │
│                                                            │
│  Mô tả                                                     │
│  ┌────────────────────────────────────────────────────┐   │
│  │ Viết về SEO onpage 2026, nhắm doanh nghiệp vừa...  │   │
│  └────────────────────────────────────────────────────┘   │
│                                                            │
│  Kích thước   ( ) Ngắn ~500   (•) Vừa ~1000                │
│               ( ) Dài ~2000   ( ) Rất dài ~3000+           │
│                                                            │
│                                    [Huỷ]  [✦ Tạo]          │
└────────────────────────────────────────────────────────────┘
```

Quy tắc:

- Hai cột liệt kê **cùng một danh sách field** (đã lọc bỏ unsupported + timestamp).
- **Loại trừ lẫn nhau**: tick bên trái ⇒ tự bỏ tick bên phải và ngược lại. Một
  field có thể **không được tick ở cả hai** (bỏ qua hoàn toàn).
- **Mặc định**: field **có** dữ liệu ⇒ tick "Lấy thông tin". Field **trống** ⇒ tick
  "Điền thông tin". Field trống được đo bằng so sánh với
  `getInitialPropsValue(field)` - không phải `!value` (`false` của checkbox và `0`
  của integer là giá trị hợp lệ, không phải "trống").
- Kích thước chỉ ảnh hưởng field `content` + `maxTokens`; nếu không tick field
  content nào thì ẩn hẳn nhóm này.
- Nút Tạo `isDisabled` khi cột "điền thông tin" rỗng.

### 7.3 Trạng thái streaming

State machine:

```
idle → requesting → streaming → done
                             ↘ error
                             ↘ aborted
```

- Dialog **đóng ngay** khi bắt đầu stream, để người dùng nhìn chữ chạy vào form thật.
- Header đổi thành pill `✦ Đang tạo… [Dừng]` (`AbortController`).
- **Readonly khi đang stream**, theo memory _"VEI content useLayoutEffect wipe"_ -
  cẩn thận với cleanup effect ghi đè dữ liệu.
- Field đã xong ⇒ mở khoá ngay, không đợi cả stream kết thúc.
- Object/array ⇒ khoá **cả khối** cho tới khi khối hoàn thành, đúng yêu cầu
  "không tính theo item".
- Rời trang giữa chừng ⇒ abort + cảnh báo unsaved.

### 7.4 Streaming YAML parser (client)

Không dùng `js-yaml` để parse dở dang. Thuật toán riêng, bám cột 0:

```
Buffer từng dòng.
Gặp dòng khớp /^([a-zA-Z0-9_]+):/ (không thụt lề):
  → key trước đó ĐÃ XONG:
      - scalar  ⇒ đã stream dần rồi, chỉ cần mở khoá
      - array/object ⇒ js-yaml.load(khối đã buffer) → áp trọn → mở khoá
  → bắt đầu key mới.
Trong lòng một key:
  - scalar thường          ⇒ append vào ô, giữ readonly
  - block scalar `|`       ⇒ append (content: re-parse HTML, throttle 120ms)
  - dòng thụt lề (array/object) ⇒ chỉ buffer, KHÔNG hiển thị gì
Hết stream ⇒ chốt key cuối cùng.
```

Đây là lý do §4.3 bắt AI xuất **đúng thứ tự skeleton**: parser biết field trước đã
xong chỉ nhờ nhìn thấy field kế tiếp bắt đầu.

### 7.5 Nối dây readonly (đã xác minh - phải tự làm)

Không có sẵn đường readonly nào cho content editor. Hai tầng phải xử lý khác nhau:

**Field thường** (text, select, checkbox, date, integer, url): keystar `TextField`
/ `Picker` / `Checkbox` đều có `isReadOnly`. Nhưng `FormFieldInputProps` không mang
prop đó ⇒ thêm `isReadOnly` vào từng `Input()` là **rất invasive** (chạm mọi field).
⇒ Dùng **overlay**: bọc field đang stream trong div `pointer-events: none` +
`aria-busy="true"` + spinner mờ. Một chỗ sửa, áp dụng đồng loạt.

**Field content**: overlay chặn được chuột nhưng **không chặn bàn phím** khi caret
đã nằm trong editor. ProseMirror có sẵn cơ chế đúng - nối `editable` vào
`useEditorView`:

```ts
// editor-view.tsx - thêm tham số isEditable
const view = new EditorView({ mount }, {
  state,
  ...{ config },
  editable: () => isEditableRef.current,   // ProseMirror gọi lại mỗi lần updateState
  dispatchTransaction(tr) { ... },
});
```

Dùng **ref chứ không phải giá trị**: `editable` được đánh giá lại ở mỗi
`updateState`, nên đọc qua ref thì bật/tắt readonly **không phải dựng lại
`EditorView`** (dựng lại = mất caret, mất undo history, và chạy lại đúng cái
`useLayoutEffect` đã từng gây bug ở memory _"VEI content useLayoutEffect wipe"_).

Tin tốt: `useLayoutEffect(() => viewRef.current?.updateState(state), [state])`
([editor-view.tsx:114-116](packages/drystack/src/form/fields/markdoc/editor/editor-view.tsx#L114-L116))
đã là sẵn đường để đẩy `EditorState` mới vào mỗi lần re-parse ⇒ cơ chế stream ở
§6.3 **chạy được mà không cần sửa gì thêm** ở tầng này.

**Chống lỗi:** AI vẫn có thể lỡ bọc ` ```yaml ` - strip fence ở đầu/cuối
trước khi parse. Key lạ không có trong `targets` ⇒ bỏ qua, không throw.

---

## 8. Chia giai đoạn

### Giai đoạn 1 - nền móng (không UI)

1. Type `ai` trong `config.tsx` + đọc env trong `api.tsx`.
2. `api/ai/env.ts` + route `ai/status`.
3. Hoist dispatch AI lên trước nhánh local trong `generic.ts` (§3.1).
4. Nới `DrystackResponse.body` + pipe stream ở dev bridge (§5.4).
5. Adapter `anthropic` + route `ai/generate` trả stream.
6. ✅ Verify: `curl -N` vào route, **cả local mode lẫn github mode**, thấy chữ chảy dần.

### Giai đoạn 2 - codec

7. `schema-to-yaml.ts`: phân loại field, sinh skeleton, danh sách thẻ HTML.
8. YAML → form value cho mọi kind (§6.3), kể cả `array<object>` lồng sâu.
9. Unit test cho codec - chạy trên schema thật trong `drystack.config.ts`
   (`blog`, `services.process[]`, `gioiThieu.timeline.items[]`, `demo.sections[]`).

### Giai đoạn 3 - UI

10. Icon + nút toolbar (ItemPage + SingletonPage), gate theo `ai.for`.
11. Dialog: 2 cột loại trừ, mô tả, kích thước, mặc định tick.
12. Streaming parser + apply vào form state.
13. Readonly khi stream, mở khoá theo key.
14. Banner thiếu key.

### Giai đoạn 4 - mở rộng

15. Adapter `openai` + `openai-compatible` + `google`.
16. Nút Magic write từng field.
17. Xử lý lỗi: rate limit, hết quota, key sai, network drop giữa stream.

---

## 9. Rủi ro & điểm cần xác minh

| #   | Rủi ro                                                                                                                                                                                                                                                                                                                                                                                                                      | Xử lý                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | ✅ **ĐÃ XÁC MINH - `DocumentFieldInput` KHÔNG có prop readonly.** Nó chỉ nhận `FormFieldInputProps<EditorState>` = `{value, onChange}` ([markdoc/ui.tsx:128](packages/drystack/src/form/fields/markdoc/ui.tsx#L128)), và `useEditorView(state, onChange, externalMount)` dựng `EditorView` **không** truyền `editable` ([editor-view.tsx:80-99](packages/drystack/src/form/fields/markdoc/editor/editor-view.tsx#L80-L99)). | Xem §7.5 - phải tự nối dây.                                                                                                |
| 2   | Re-parse cả `EditorState` mỗi chunk ⇒ giật với bài dài                                                                                                                                                                                                                                                                                                                                                                      | Throttle 120ms; đo với bài "Rất dài" (~3000 từ). Nếu vẫn giật: chỉ re-parse mỗi khi gặp thẻ block đóng (`</p>`, `</h2>`…). |
| 3   | AI xuất YAML sai cú pháp                                                                                                                                                                                                                                                                                                                                                                                                    | Fence-strip + try/catch từng khối; khối lỗi thì bỏ qua field đó, toast cảnh báo, **không** vứt cả kết quả.                 |
| 4   | Route thành proxy AI công cộng                                                                                                                                                                                                                                                                                                                                                                                              | Bắt buộc check cookie ở github mode (§5.3) + validate `entry.key` ∈ `ai.for`.                                              |
| 5   | Cloudflare Worker giới hạn thời gian chạy                                                                                                                                                                                                                                                                                                                                                                                   | Stream giữ kết nối sống. Bài "Rất dài" cần đo thực tế. Nếu chạm trần: hạ `maxTokens` mức xlong.                            |
| 6   | Dev bridge buffer hết stream                                                                                                                                                                                                                                                                                                                                                                                                | Đã có cách sửa cụ thể ở §5.4 - dễ bị chẩn đoán nhầm thành lỗi provider.                                                    |
| 7   | Memory _"astro dev --background stale dist"_                                                                                                                                                                                                                                                                                                                                                                                | Sửa `packages/drystack/src` xong phải **build lại** `@drystack/core`, không thì dev server phục vụ `dist/` cũ.             |
| 8   | Cấu trúc `config.ai` chưa từng qua `config()` transform                                                                                                                                                                                                                                                                                                                                                                     | `config()` hiện chỉ nhét `__redirects`; `ai` đi thẳng qua spread - cần test là nó thật sự tới được client bundle.          |

---

## 10. Checklist nghiệm thu

> Theo luật bất di bất dịch trong CLAUDE.md: **phải verify cả `local` lẫn `github`**.

**Local mode** (`astro dev --background`)

- [ ] Không có `config.ai` ⇒ không nút, không banner, không request nào.
- [ ] Có `config.ai`, thiếu `DRY_AI_KEY` ⇒ banner top, nút disabled + tooltip.
- [ ] `blog` (có trong `ai.for`) ⇒ có nút. `services`/`homepage` (không có) ⇒ không nút.
- [ ] Tick mặc định đúng trên entry trống và entry đã có dữ liệu.
- [ ] Stream chảy dần thật (không đổ ụp một lần) - **đây là bài test bắt §5.4**.
- [ ] Field đang stream không gõ được; xong thì gõ được.
- [ ] `services.process[]` (array<object>) khoá cả khối, áp trọn một lần.
- [ ] Nút Dừng abort thật, giữ nguyên phần đã điền.
- [ ] Không bấm Save ⇒ `git diff` sạch. **Kiểm tra bằng `git diff`, không đoán.**
- [ ] Bấm Save ⇒ `body.html` + `index.yaml` đúng như gõ tay.

**GitHub mode** (build + deploy Cloudflare, `storage.kind === 'github'`)

- [ ] Route `ai/generate` không 404 (bài test bắt §3.1).
- [ ] `DRY_AI_KEY` đọc được từ Worker secret lúc runtime.
- [ ] Stream sống qua Worker.
- [ ] Chưa đăng nhập ⇒ route từ chối (bài test bắt §5.3).
- [ ] Save ⇒ commit lên branch đúng qua `useCommitFileChanges`.

**Cross-provider**

- [ ] anthropic / openai / google / openai-compatible (Groq hoặc Ollama) - mỗi cái một lần.

---

## 11. Ghi chú còn treo

- **Ảnh**: AI không sinh được bytes ⇒ mọi field image/file nằm ngoài phạm vi. Nếu
  sau này muốn AI gợi ý alt text thì đó là tính năng riêng.
- **Field `content` có `<img>`**: theo memory _"VEI content image src format"_,
  src phải là `/<entryDir>/assets/<name>` và save phải merge pending blobs. AI
  **không được** xuất `<img>` (§4.3 điều 7) - nếu lỡ xuất, strip khi parse.
- **VEI**: ngoài phạm vi, đúng như spec gốc ("chỉ dùng cho trang admin").
- **`__redirects`**: không bao giờ có nút, kể cả nếu ai đó nhét nó vào `ai.for`
  - hard-code chặn.
