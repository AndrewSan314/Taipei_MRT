# Phân chia task cho 6 người

## 1. Mục tiêu chung của sprint/demo

- Hoàn thiện phần trình bày để cả nhóm nói cùng một câu chuyện về project.
- Khóa narrative cho 3 màn hình:
  - Route Studio,
  - Calibration Tool,
  - Graph Builder.
- Đảm bảo tài liệu, demo flow và test backend khớp với repo hiện tại.
- Chia việc theo ownership để 3 cặp có thể làm song song, ít đụng nhau.

## 2. Nguyên tắc chia nhóm

- Chia theo **module ownership**, không chia theo cảm tính.
- Mỗi nhóm 2 người phụ trách một vùng chức năng rõ ràng.
- Mỗi nhóm phải tự chịu trách nhiệm 4 thứ:
  - hiểu phần mình sở hữu,
  - viết tóm tắt dễ trình bày,
  - xác minh phần mình chạy ổn,
  - handoff ngắn gọn cho team lead.
- Mỗi cặp nên tự phân vai:
  - **Người 1:** implementation / xác minh kỹ thuật,
  - **Người 2:** tài liệu / QA / review chéo.

## 3. Bảng 3 cặp làm việc

### Nhóm 1 — Core Backend & API

**Mục tiêu**

- Chịu trách nhiệm phần “tính đúng” của hệ thống.
- Khóa logic route, nguồn dữ liệu JSON và API contract cho frontend.

**Files ownership**

- `app/api/routes.py`
- `app/services/runtime.py`
- `app/services/route_engine.py`
- `app/services/subway_loader.py`
- `tests/test_api.py`
- `tests/test_route_engine.py`

**Deliverables**

- Bảng mô tả endpoint ngắn gọn để chèn vào tài liệu structure.
- Checklist edge cases của route.
- Danh sách input/output mà frontend cần bám theo.
- Xác nhận test backend luôn xanh.

**Dependency**

- Phụ thuộc vào network hiện tại trong `app/data`.
- Cần phối hợp với Nhóm 2 khi chốt payload route hiển thị trên UI.
- Cần phối hợp với Nhóm 3 khi builder/calibration làm thay đổi data.

**Definition of Done**

- Bộ test backend hiện có pass.
- Mỗi endpoint chính được mô tả ngắn gọn request/response.
- Có câu trả lời rõ cho 3 câu hỏi demo:
  - hệ thống chọn ga thế nào,
  - tìm đường thế nào,
  - dữ liệu lấy từ đâu.

### Nhóm 2 — Main Frontend & Demo Experience

**Mục tiêu**

- Chịu trách nhiệm phần “người xem thấy gì”.
- Làm chủ luồng demo chính: chọn điểm, tìm route, đọc kết quả, highlight trên sơ đồ.

**Files ownership**

- `app/static/route-studio/index.html`
- `app/static/shared/app-shell.css`
- `app/static/route-studio/app.js`
- `map/geography/taipei-vector-map-2022.svg`
- `map/diagram/taipei_mrt_interactive.svg`
- Các asset hiển thị liên quan đến route demo trong `map/geography` và `map/diagram`

**Deliverables**

- Mô tả 1 slide cho Route Studio.
- Checklist demo flow chính.
- Danh sách điểm UX cần sửa nếu còn thời gian.
- Ảnh/chụp màn hình cho báo cáo nếu cần.

**Dependency**

- Phụ thuộc vào payload từ Nhóm 1.
- Phụ thuộc vào độ đúng của station position và network do Nhóm 3 quản lý.

**Definition of Done**

- Demo `/` trơn tru từ đầu đến cuối.
- Người ngoài nhóm nhìn vào biết:
  - bấm ở đâu,
  - route xuất hiện ở đâu,
  - start/end station được chọn ra sao.
- Có 1 kịch bản demo chính và 1 kịch bản fallback.

### Nhóm 3 — Data Tools, Calibration, Builder, QA & Docs

**Mục tiêu**

- Chịu trách nhiệm phần “dữ liệu đúng + công cụ nội bộ + tài liệu trình bày”.
- Đây là nhóm phù hợp nhất để rewrite tài liệu vì họ nắm builder/calibrate/data flow.

**Files ownership**

- `app/static/calibration/*`
- `app/static/builder/*`
- `app/data/*`
- `scripts/map/*`
- `map/geography/taipei-metro-geographical-map.svg`
- `map/diagram/metromapmaker-8S4w6aZ4.svg`
- `docs/architecture/current-project-structure.md`
- `docs/planning/team-task-allocation.md`

**Deliverables**

- Bản mới của `docs/architecture/current-project-structure.md`.
- File `docs/planning/team-task-allocation.md`.
- Bảng phân biệt rõ:
  - Builder chỉnh topology/diagram,
  - Calibration chỉnh tọa độ trên real map.
- Checklist QA tay cho `/calibrate` và `/builder`.

**Dependency**

- Phụ thuộc vào asset map/SVG và dữ liệu network hiện tại.
- Cần phối hợp với Nhóm 1 khi save builder/calibration làm đổi runtime data.
- Cần phối hợp với Nhóm 2 để đảm bảo dữ liệu hiển thị trên demo là nhất quán.

**Definition of Done**

- Tài liệu đọc không lỗi mã hóa.
- Người mới vào repo hiểu được 3 màn hình và 2 luồng dữ liệu.
- Có checklist kiểm tra save/reload cho builder và calibrate.

## 4. Timeline 5 mốc

### Mốc 1 — Freeze kiến thức chung

- Team lead + Nhóm 3 chốt draft tài liệu structure.
- Nhóm 1 xác nhận phần backend trong tài liệu.
- Nhóm 2 xác nhận phần UI trong tài liệu.

### Mốc 2 — Làm song song theo ownership

- Nhóm 1 khóa backend/API summary.
- Nhóm 2 khóa demo flow và phần trình bày Route Studio.
- Nhóm 3 khóa docs + calibration/builder summary.

### Mốc 3 — Tích hợp tài liệu

- Gộp toàn bộ vào 2 file docs.
- Xóa trùng lặp ngôn ngữ.
- Đồng bộ thuật ngữ để cả nhóm nói giống nhau.

### Mốc 4 — QA demo

- Chạy lại test backend.
- Test tay 3 màn hình `/`, `/calibrate`, `/builder`.
- Soát xem nội dung doc có khớp code thật.

### Mốc 5 — Rehearsal

- Mỗi nhóm trình bày đúng phần mình sở hữu.
- Team lead dùng `docs/architecture/current-project-structure.md` làm xương sống cho buổi thuyết trình.

## 5. Quy tắc handoff giữa nhóm

- Mỗi nhóm chỉ handoff bằng 3 thứ:
  - phần mình đang sở hữu,
  - trạng thái hiện tại,
  - blocker nếu có.
- Không gửi handoff dài dòng; tối đa 5 bullet mỗi lần cập nhật.
- Mọi thay đổi ảnh hưởng liên nhóm phải báo ngay:
  - đổi payload API,
  - đổi station positions,
  - đổi network JSON,
  - đổi logic route.
- Team lead là điểm chốt cuối cùng để hợp nhất nội dung trình bày.

## 6. Rủi ro chính và người chịu trách nhiệm

| Rủi ro | Ảnh hưởng | Người chịu trách nhiệm chính |
| --- | --- | --- |
| Tài liệu lệch với code hiện tại | Báo cáo sai, demo giải thích không khớp | Nhóm 3 + Team lead |
| Route hoạt động nhưng khó giải thích | Demo thiếu thuyết phục | Nhóm 1 |
| UI chạy được nhưng người xem khó theo dõi | Demo nhìn rối | Nhóm 2 |
| Builder và calibrate bị nói nhầm vai trò | Người nghe hiểu sai kiến trúc dữ liệu | Nhóm 3 |
| Data đổi sát giờ demo làm route khác đi | Dễ phát sinh lỗi tích hợp | Nhóm 1 + Nhóm 3 |

## 7. Checklist QA ngắn cho cả nhóm

### Route Studio

- Chọn được 2 điểm trên bản đồ.
- Gọi route thành công.
- Có start station, end station và phần tóm tắt kết quả.

### Calibration Tool

- Chọn được ga.
- Đặt lại tọa độ được.
- Save không lỗi.

### Graph Builder

- Load được network hiện tại.
- Sửa line/station được.
- Save xong reload vẫn nhất quán.

## 8. Kết luận ngắn

- Cách chia này phù hợp vì backend, main UI và data tools là 3 vùng tương đối độc lập.
- Mỗi cặp có ownership rõ nên ít chồng chéo.
- Team lead chỉ cần bám theo 2 file docs này để điều phối và thuyết trình.
