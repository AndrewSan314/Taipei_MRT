---
title: "Cấu trúc project hiện tại"
description: "Tài liệu trình bày ngắn gọn, rõ ràng về cấu trúc hiện tại của IT3160-SubwayWeb để dùng khi demo và báo cáo."
---

# Cấu trúc project hiện tại

## 1. Project này giải quyết bài toán gì?

- `IT3160-SubwayWeb` là web app mô phỏng bài toán tìm đường trong hệ thống metro.
- Người dùng không chọn ga trực tiếp; thay vào đó họ click 2 điểm bất kỳ trên bản đồ thực.
- Hệ thống sẽ:
  - chọn ga vào và ga ra hợp lý nhất,
  - tính lộ trình metro tối ưu,
  - hiển thị kết quả trên sơ đồ MRT dễ nhìn hơn bản đồ địa lý.
- Project kết hợp 2 không gian hiển thị:
  - **Real map** để chọn điểm đầu/cuối,
  - **SVG diagram** để giải thích route rõ ràng khi thuyết trình.

## 2. Demo 1 câu

> Đây là web app cho phép người dùng click 2 điểm trên bản đồ thực, hệ thống tự chọn ga phù hợp, tính lộ trình metro tối ưu và hiển thị kết quả trên sơ đồ MRT.

## 3. 3 màn hình chính

### 3.1. Route Studio

- Đây là màn hình chính cho người dùng cuối.
- Người dùng chọn điểm bắt đầu và điểm kết thúc trên bản đồ thực.
- Backend tìm route tốt nhất và frontend hiển thị:
  - ga vào,
  - ga ra,
  - tổng thời gian,
  - các bước di chuyển,
  - phần route được highlight trên sơ đồ SVG.

### 3.2. Calibration Tool

- Đây là công cụ nội bộ để chỉnh tọa độ ga trên **real map**.
- Mục tiêu là làm cho thao tác click trên bản đồ thực khớp hơn với vị trí ga.
- Công cụ này chỉ xử lý **tọa độ hiển thị trên bản đồ thực**, không chỉnh topology tuyến.

### 3.3. Graph Builder

- Đây là công cụ nội bộ để dựng hoặc chỉnh lại network trên **sơ đồ MRT**.
- Builder dùng để quản lý:
  - line,
  - station,
  - thứ tự ga trên line,
  - tọa độ `diagram_x / diagram_y`,
  - segment và transfer sinh ra từ network.
- Công cụ này xử lý **topology + tọa độ trên diagram**, không xử lý vị trí trên real map.

## 4. Kiến trúc tổng thể 4 lớp

```text
Người dùng / Người vận hành
        |
        v
Frontend pages
        |
        v
FastAPI API
        |
        v
Services + Domain + Data files
```

**Diễn giải ngắn:**

- **Frontend pages** nhận thao tác từ người dùng và gọi API.
- **FastAPI API** là lớp trung gian giữa giao diện và logic xử lý.
- **Services + Domain** xử lý dữ liệu, chọn nguồn network, tính route và lưu thay đổi.
- **Data files** chứa network JSON, station positions, asset SVG và map.

## 5. Cây thư mục project, bản rút gọn

```text
IT3160-SubwayWeb/
├─ app/
│  ├─ api/                       # Endpoint FastAPI
│  ├─ data/                      # Network JSON, station positions, data phụ
│  ├─ domain/                    # Model dữ liệu lõi
│  ├─ services/                  # Loader, runtime cache, route engine, store
│  └─ static/
│     ├─ route-studio/           # Main demo UI
│     ├─ calibration/            # Calibration Tool UI
│     ├─ builder/                # Graph Builder UI
│     └─ shared/                 # Shared shell styles
├─ docs/
│  ├─ architecture/             # Tài liệu cấu trúc codebase
│  └─ planning/                 # Kế hoạch, phân việc
├─ map/
│  ├─ geography/                # Real-map assets
│  └─ diagram/                  # Semantic diagram assets
├─ scripts/
│  └─ map/                      # Script hỗ trợ xử lý dữ liệu map/SVG
├─ tests/           # Test backend
├─ README.md
├─ pyproject.toml
├─ start_web.ps1
└─ start_web.bat
```

## 6. Vai trò từng thư mục

| Thư mục | Vai trò chính |
| --- | --- |
| `app/static/route-studio` | Route Studio UI |
| `app/static/calibration` | Calibration Tool UI |
| `app/static/builder` | Graph Builder UI |
| `app/static/shared` | Shared UI shell styles |
| `docs/architecture` | Codebase structure docs |
| `docs/planning` | Planning and task-allocation docs |
| `scripts/map` | Map/SVG normalization scripts |
| `map/geography` | Real-map assets |
| `map/diagram` | Semantic diagram assets |
| `app/api` | Chứa endpoint để frontend và tool nội bộ gọi backend |
| `app/services` | Chứa logic xử lý chính: load network, build runtime, tính route, lưu dữ liệu |
| `app/domain` | Chứa model dữ liệu lõi như station, line, segment, route result |
| `app/data` | Chứa network JSON, station positions, file map phụ trợ |
| `tests` | Chứa test tự động cho backend, route engine và loader |

## 7. Luồng dữ liệu end-to-end

### 7.1. Luồng route chính

1. Người dùng click 2 điểm trên **real map**.
2. Frontend gọi `POST /api/route/points`.
3. Backend:
   - lấy network hiện hành,
   - chọn ga vào/ga ra phù hợp,
   - dùng route engine để tính route.
4. API trả về:
   - start/end station đã chọn,
   - thông tin route,
   - tổng thời gian và các bước đi.
5. Frontend hiển thị kết quả trên **SVG diagram**.

### 7.2. Luồng calibration

1. Người vận hành mở `/calibrate`.
2. Chọn ga và click vào bản đồ thực.
3. Tọa độ mới được lưu vào file station positions.
4. Runtime cache được refresh để route sau đó dùng vị trí mới.

### 7.3. Luồng builder

1. Người vận hành mở `/builder`.
2. Tạo hoặc chỉnh line, station và thứ tự ga.
3. Hệ thống sinh lại segment và transfer từ network mới.
4. Network JSON được lưu lại và runtime cache được refresh.

### 7.4. Điểm cần nhớ khi trình bày

- **Builder** và **Calibration** là 2 luồng dữ liệu khác nhau.
- **Builder** chỉnh topology + tọa độ trên sơ đồ.
- **Calibration** chỉnh tọa độ trên bản đồ thực.

## 8. Thành phần quan trọng nhất để hiểu project

### 8.1. App entry

- File: `app/main.py`
- Vai trò:
  - tạo app FastAPI,
  - mount static files,
  - expose 3 page chính: `/`, `/calibrate`, `/builder`.
- Đây là nơi cho thấy project là web app nhiều màn hình nhưng dùng chung một backend.

### 8.2. API layer

- File: `app/api/routes.py`
- Vai trò:
  - cung cấp network cho frontend,
  - nhận request tìm route,
  - nhận request lưu calibration,
  - nhận request load/save builder network.

**Các endpoint chính cần nhớ khi demo**

| Endpoint | Vai trò |
| --- | --- |
| `GET /health` | Kiểm tra app đang sống |
| `GET /api/network` | Cấp network cho Route Studio và Calibration Tool |
| `GET /api/builder/network` | Cấp network dạng raw cho Graph Builder |
| `POST /api/route` | Tìm route theo ga |
| `POST /api/route/points` | Tìm route theo 2 điểm click |
| `POST /api/calibration/stations` | Lưu vị trí ga trên real map |
| `POST /api/builder/network` | Lưu network do builder tạo/chỉnh |

### 8.3. Runtime cache

- File: `app/services/runtime.py`
- Vai trò:
  - load network từ file JSON chính,
  - cache network,
  - cache route engine,
  - refresh cache sau khi dữ liệu bị thay đổi.
- Đây là chỗ quan trọng để giải thích vì sao app luôn dùng một source of truth là network JSON hiện hành.

### 8.4. Route engine

- File: `app/services/route_engine.py`
- Vai trò:
  - build expanded graph theo trạng thái `station + line`,
  - thêm edge loại `ride`, `transfer`, `walk`,
  - chạy Dijkstra để chọn route phù hợp.
- Điểm đáng nói khi thuyết trình:
  - hệ thống không chỉ tối ưu thời gian,
  - mà còn cân nhắc walking time, transfer count và stop count.

### 8.5. Main UI

- File: `app/static/route-studio/app.js`
- Vai trò:
  - điều khiển màn hình Route Studio,
  - xử lý click trên real map,
  - gọi API route,
  - render kết quả và highlight trên sơ đồ.
- Đây là file lớn nhất phía frontend, nên là một vùng tech debt về sau.

### 8.6. Graph Builder

- File: `app/static/builder/builder.js`
- Vai trò:
  - quản lý line, station, order,
  - đặt vị trí station trên diagram,
  - lưu network mới về backend.
- Đây là công cụ quản trị dữ liệu, không phải giao diện cho người dùng cuối.

### 8.7. Calibration Tool

- File: `app/static/calibration/calibrate.js`
- Vai trò:
  - đặt vị trí ga trên real map,
  - nudge tọa độ,
  - overlay bản đồ phụ để căn chỉnh.
- Công cụ này hỗ trợ độ chính xác của route theo điểm click.

## 9. Project hiện đã có gì

- Có backend FastAPI chạy được.
- Có route engine hoạt động và đã có test.
- Có tìm route theo ga và theo 2 điểm trên bản đồ.
- Có 3 giao diện tách biệt:
  - Route Studio,
  - Calibration Tool,
  - Graph Builder.
- Có một nguồn dữ liệu chính là network JSON do builder/calibration cùng cập nhật.
- Có bộ test backend cơ bản và hiện đang pass.

## 10. Project còn thiếu gì để hoàn thiện demo/nộp

### 10.1. Thiếu để demo đẹp hơn

- Đồng bộ lại `README.md` với code và tài liệu hiện tại.
- Chuẩn hóa cách mô tả 3 màn hình để cả nhóm nói cùng một ý.
- Bổ sung checklist QA tay cho `/`, `/calibrate`, `/builder`.
- Chuẩn bị ảnh/chụp màn hình hoặc video ngắn cho phần báo cáo nếu cần.

### 10.2. Thiếu để nộp chắc hơn

- Soát lại toàn bộ tài liệu để khớp với code hiện tại.
- Ghi rõ builder và calibration là 2 luồng dữ liệu khác nhau.
- Có script trình bày thống nhất để tránh mỗi người nói một kiểu.
- Có checklist xác minh các route chính trước khi demo/nộp.

### 10.3. Tech debt để làm sau

- Chưa có frontend automated test.
- Chưa có CI để chạy test tự động mỗi lần sửa.
- `app/static/route-studio/app.js` đang khá lớn, nên nên tách module nếu dự án phát triển tiếp.
- `README.md` chưa phản ánh đầy đủ toàn bộ thay đổi mới nhất.

**Kết luận ngắn cho phần này**

- Những thiếu sót hiện tại chủ yếu là **tài liệu, QA tay và độ gọn của frontend**.
- Chúng **không phải blocker** cho demo nếu nhóm trình bày thống nhất và test lại đúng checklist.

## 11. Script trình bày 3–5 phút

### 11.1. Mở đầu

- “Project của nhóm em là web app hỗ trợ tìm đường metro bằng cách click trực tiếp lên bản đồ thực.”
- “Hệ thống sẽ tự chọn ga hợp lý, tính route và hiển thị kết quả trên sơ đồ MRT.”

### 11.2. Nói về 3 màn hình

- “Màn hình chính là Route Studio để người dùng tìm đường.”
- “Calibration Tool dùng để chỉnh vị trí ga trên bản đồ thực.”
- “Graph Builder dùng để dựng và quản lý network trên sơ đồ metro.”

### 11.3. Nói về kiến trúc

- “Frontend nhận thao tác, API làm cầu nối, services xử lý dữ liệu và route.”
- “Dữ liệu hiện dùng một source of truth là JSON network của project.”

### 11.4. Nói về điểm kỹ thuật đáng chú ý

- “Route engine dùng expanded graph và Dijkstra.”
- “Hệ thống không chỉ xét thời gian mà còn xét đi bộ và số lần chuyển tuyến.”

### 11.5. Chốt phần demo

- “Điểm mạnh của project là tách rõ bản đồ thực để chọn điểm và sơ đồ SVG để giải thích route.”
- “Các tool nội bộ giúp nhóm tự hiệu chỉnh dữ liệu thay vì hard-code toàn bộ từ đầu.”

## 12. Phụ lục file tham chiếu

- `app/main.py`
- `app/config.py`
- `app/api/routes.py`
- `app/domain/models.py`
- `app/services/runtime.py`
- `app/services/subway_loader.py`
- `app/services/route_engine.py`
- `app/services/calibration_store.py`
- `app/services/subway_network_store.py`
- `app/static/route-studio/index.html`
- `app/static/shared/app-shell.css`
- `app/static/route-studio/app.js`
- `app/static/calibration/index.html`
- `app/static/calibration/calibrate.js`
- `app/static/builder/index.html`
- `app/static/builder/builder.js`
- `tests/test_api.py`
- `tests/test_route_engine.py`
- `tests/test_calibration_store.py`
- `README.md`
- `pyproject.toml`
