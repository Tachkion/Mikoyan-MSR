# 🌐 HƯỚNG DẪN TẢI THƯ MỤC LÊN GITHUB ĐỂ LÊN WEB TỰ ĐỘNG

Thư mục **`msr_web`** này đã được viết sẵn toàn bộ mã nguồn tĩnh (**HTML + CSS + JS**).  
Bạn **chỉ cần tải các file trong thư mục này lên GitHub** là trang web sẽ tự động hoạt động!

---

## 🚀 CÁCH 1: Tải vào Website có sẵn (`https://mikoyan.dpdns.org/msr`)
> Dành cho bạn nếu bạn đã có repository GitHub đang chạy trang `mikoyan.dpdns.org`.

1. Mở Repository GitHub của trang `mikoyan.dpdns.org`.
2. Tạo 1 thư mục mới tên là **`msr`** trong repository đó (hoặc bấm **Add file** ➔ **Upload files**).
3. Tải toàn bộ các file trong thư mục này vào:
   * `index.html`
   * `styles.css`
   * `app.js`
   * `_config.yml`
4. Bấm **Commit changes**.
5. **Xong!** Truy cập ngay tại:  
   👉 **`https://mikoyan.dpdns.org/msr`**

---

## 🌟 CÁCH 2: Tạo Repository GitHub Pages mới (Hoàn toàn độc lập)
> Dành cho bạn nếu muốn có 1 link web riêng biệt (ví dụ: `https://ten-ban.github.io/msr`).

1. Đăng nhập vào GitHub, bấm **New Repository** (Tạo repo mới, đặt tên ví dụ: `msr`).
2. Chọn chế độ **Public**.
3. Bấm vào nút **uploading an existing file** (Tải file có sẵn lên).
4. Kéo thả tất cả các file trong thư mục `msr_web` này vào:
   * `index.html`
   * `styles.css`
   * `app.js`
   * `_config.yml`
5. Bấm **Commit changes**.
6. Vào mục **Settings** của repository ➔ Chọn tab **Pages** (bên menu trái):
   * Tại mục **Build and deployment** ➔ **Branch**: Chọn `main` (hoặc `master`), thư mục `/ (root)`.
   * Bấm **Save**.
7. Chờ 30 giây, GitHub sẽ cấp cho bạn đường link web miễn phí vĩnh viễn!

---

## 📱 CÁCH TRANG WEB HOẠT ĐỘNG VÀ ĐỒNG BỘ:
1. **Tự động nhận diện:**
   * Nếu mở tại `https://mikoyan.dpdns.org/msr`, web tự động kết nối qua endpoint `/msr/api/status`.
2. **Cài đặt kết nối Bridge khi cần (Dành cho GitHub Pages):**
   * Dưới chân trang có nút **`⚙️ Cài đặt kết nối Bridge`**.
   * Bạn có thể dán link Cloudflare Tunnel (`https://*.trycloudflare.com`) của máy tính vào để điện thoại xem log và bấm nút điều khiển từ bất kỳ mạng nào (4G/5G).
3. **Cảnh báo đổi IP:**
   * Khi tool cày xong 1 tài khoản và chờ bạn khởi động lại modem, trang web sẽ **tự động rung máy** và **phát chuông báo** hai âm thanh (sine chime), đồng thời hiện nút **"Kiểm tra IP ngay"** và **"Bỏ qua đổi IP"**.
