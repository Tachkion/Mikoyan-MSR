/**
 * Mikoyan MSR Tool — Client Web App (GitHub Static / Direct Web)
 * Tự động đồng bộ trạng thái cày điểm và cảnh báo khởi động lại Modem.
 */

// Lấy Base API URL (Hỗ trợ cấu hình tùy chỉnh qua localStorage)
function getApiBaseUrl() {
    const customUrl = localStorage.getItem("msr_bridge_url");
    if (customUrl && customUrl.trim()) {
        return customUrl.trim().replace(/\/+$/, "");
    }
    // Nếu trang đang chạy tại subpath /msr (ví dụ: https://mikoyan.dpdns.org/msr)
    if (window.location.pathname.startsWith("/msr")) {
        return "/msr";
    }
    return "";
}

let lastWaitingState = false;
let isPolling = false;

// Âm thanh chuông báo khi cần đổi IP (Web Audio API)
function playChime() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.35, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.85);
    } catch (e) {
        console.warn("AudioContext failed:", e);
    }
}

// Lấy trạng thái thời gian thực từ Backend
async function fetchStatus() {
    if (isPolling) return;
    isPolling = true;

    const startTime = performance.now();
    const baseUrl = getApiBaseUrl();
    const endpoint = (baseUrl ? baseUrl : "") + "/api/status";

    try {
        const res = await fetch(endpoint);
        if (!res.ok) {
            handleConnectionError();
            return;
        }
        const data = await res.json();
        const latency = Math.round(performance.now() - startTime);
        document.getElementById("latencyText").textContent = `Độ trễ: ${latency} ms`;
        renderUI(data);
    } catch (err) {
        handleConnectionError();
    } finally {
        isPolling = false;
    }
}

// Xử lý khi mất kết nối tới Backend (ví dụ khi modem đang reboot)
function handleConnectionError() {
    const pcPill = document.getElementById("pcStatusPill");
    const pcText = document.getElementById("pcStatusText");
    const latencyText = document.getElementById("latencyText");

    if (lastWaitingState) {
        pcPill.className = "pc-pill rebooting";
        pcText.textContent = "Modem rebooting...";
    } else {
        pcPill.className = "pc-pill offline";
        pcText.textContent = "Mất kết nối PC";
    }
    latencyText.textContent = "Mất kết nối";
}

// Hiển thị dữ liệu lên giao diện
function renderUI(data) {
    // 1. Trạng thái kết nối PC
    const pcPill = document.getElementById("pcStatusPill");
    const pcText = document.getElementById("pcStatusText");
    if (data.pc_connected) {
        pcPill.className = "pc-pill online";
        pcText.textContent = "PC Online";
    } else if (data.waiting_ip_change) {
        pcPill.className = "pc-pill rebooting";
        pcText.textContent = "Modem rebooting...";
    } else {
        pcPill.className = "pc-pill offline";
        pcText.textContent = `PC Offline (${data.last_ping_seconds || "?"}s)`;
    }

    // 2. IP & Tiêu đề
    document.getElementById("currentIpText").textContent = data.current_ip || "Không có IP";
    document.getElementById("timerBadge").textContent = data.elapsed_time || "00:00";
    document.getElementById("heroTitle").textContent = data.status_title || "Hệ thống sẵn sàng";
    document.getElementById("heroSubtitle").textContent = data.status_subtitle || "";

    // 3. Khối Banner Hero & Hộp Cảnh Báo Khởi Động Lại Modem
    const banner = document.getElementById("heroBanner");
    const badge = document.getElementById("statusBadge");
    const fill = document.getElementById("progressBarFill");
    const ipAlert = document.getElementById("ipAlertBox");
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");

    if (data.is_running) {
        startBtn.style.display = "none";
        stopBtn.style.display = "flex";
    } else {
        startBtn.style.display = "flex";
        stopBtn.style.display = "none";
    }

    if (data.waiting_ip_change) {
        banner.className = "hero-banner waiting-ip";
        badge.className = "status-badge waiting";
        badge.textContent = "CHỜ ĐỔI IP";
        fill.className = "progress-bar-fill farming";
        ipAlert.classList.add("active");
        document.getElementById("alertOldIp").textContent = data.old_ip || "--";
        document.getElementById("alertCurrentIp").textContent = data.current_ip || "Đang kiểm tra...";

        // Chuông báo & Rung điện thoại lần đầu khi chuyển trạng thái
        if (!lastWaitingState) {
            playChime();
            if (navigator.vibrate) {
                navigator.vibrate([200, 100, 200]);
            }
        }
    } else {
        banner.className = "hero-banner";
        ipAlert.classList.remove("active");

        if (data.status_mode === "farming") {
            badge.className = "status-badge farming";
            badge.textContent = "ĐANG CÀY";
            fill.className = "progress-bar-fill farming";
        } else if (data.status_mode === "done") {
            badge.className = "status-badge done";
            badge.textContent = "HOÀN TẤT";
            fill.className = "progress-bar-fill";
        } else {
            badge.className = "status-badge ready";
            badge.textContent = "SẴN SÀNG";
            fill.className = "progress-bar-fill";
        }
    }
    lastWaitingState = data.waiting_ip_change;

    // 4. Thanh tiến độ
    const pPct = Math.round((data.progress || 0) * 100);
    fill.style.width = pPct + "%";
    document.getElementById("progressText").textContent = data.progress_text || "0%";
    document.getElementById("progressPercent").textContent = pPct + "%";

    // 5. Danh sách tài khoản
    const accList = document.getElementById("accountsList");
    if (data.accounts && Array.isArray(data.accounts) && data.accounts.length > 0) {
        document.getElementById("accCountHeader").textContent = `${data.accounts.length} tài khoản`;
        let html = "";
        data.accounts.forEach(acc => {
            const isFarming = String(acc.profile_id) === String(data.current_profile_id);
            let badgeClass = "badge-ready";
            let stText = acc.status || "Ready";
            if (isFarming) {
                badgeClass = "badge-running";
                stText = "Đang cày";
            } else if (acc.status === "Done") {
                badgeClass = "badge-done";
                stText = "Xong";
            } else if (acc.status === "Banned") {
                badgeClass = "badge-banned";
                stText = "Khóa";
            }
            html += `
                <div class="account-item ${isFarming ? 'running' : ''}">
                    <div class="acc-info">
                        <div class="acc-name">${acc.profile_name || 'Profile'}</div>
                        <div class="acc-meta">Điểm: ${(Number(acc.current_points)||0).toLocaleString()} pts • Hôm nay: +${acc.gained_today||0}</div>
                    </div>
                    <span class="badge-pill ${badgeClass}">${stText}</span>
                </div>
            `;
        });
        accList.innerHTML = html;
    }

    // 6. Console Log terminal
    const logBox = document.getElementById("logsTerminal");
    if (data.logs) {
        const wasBottom = (logBox.scrollHeight - logBox.clientHeight) <= (logBox.scrollTop + 50);
        logBox.textContent = data.logs;
        if (wasBottom) {
            logBox.scrollTop = logBox.scrollHeight;
        }
    }
}

// Gửi hành động điều khiển về Backend
async function postAction(actionName) {
    const baseUrl = getApiBaseUrl();
    const endpoint = (baseUrl ? baseUrl : "") + "/api/action";

    try {
        await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: actionName })
        });
        fetchStatus();
    } catch (err) {
        console.error("Lỗi gửi action:", err);
    }
}

// Cài đặt Endpoint Modal
function openSettingsModal() {
    const modal = document.getElementById("settingsModal");
    const input = document.getElementById("bridgeUrlInput");
    input.value = localStorage.getItem("msr_bridge_url") || "";
    modal.classList.add("open");
}

function closeSettingsModal() {
    document.getElementById("settingsModal").classList.remove("open");
}

function saveSettings() {
    const val = document.getElementById("bridgeUrlInput").value.trim();
    if (val) {
        localStorage.setItem("msr_bridge_url", val);
    } else {
        localStorage.removeItem("msr_bridge_url");
    }
    closeSettingsModal();
    fetchStatus();
}

function resetSettings() {
    localStorage.removeItem("msr_bridge_url");
    document.getElementById("bridgeUrlInput").value = "";
    closeSettingsModal();
    fetchStatus();
}

// Khởi chạy vòng lặp cập nhật mỗi 1.5 giây
fetchStatus();
setInterval(fetchStatus, 1500);
