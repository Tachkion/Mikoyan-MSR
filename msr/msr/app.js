/**
 * Mikoyan MSR Tool — Client Web App (GitHub Static / Direct Web)
 * Tự động đồng bộ trạng thái cày điểm và cảnh báo khởi động lại Modem.
 * Hỗ trợ cả mạng nội bộ Wi-Fi và phát sóng Cloud Relay API để xem từ xa qua 4G.
 */

const DEFAULT_RELAY_TOPIC = "mikoyan_msr_live_1Yk7Rb";
const DEFAULT_CMD_TOPIC = "mikoyan_msr_cmds_1Yk7Rb";
let lastWaitingState = false;
let isPolling = false;
let eventSource = null;
let lastHeartbeatTime = 0; // Thời điểm nhận được bản tin gần nhất từ PC (giây)

// Lấy Base API URL
function getApiBaseUrl() {
    const customUrl = localStorage.getItem("msr_bridge_url");
    if (customUrl && customUrl.trim()) {
        return customUrl.trim().replace(/\/+$/, "");
    }
    // Nếu chạy cục bộ trên máy tính hoặc cùng Wi-Fi
    const host = window.location.hostname;
    const isLocal = host === "localhost" ||
                    host === "127.0.0.1" ||
                    host.startsWith("192.168.") ||
                    host.startsWith("10.") ||
                    host.startsWith("172.");
    if (isLocal) {
        return window.location.pathname.startsWith("/msr") ? "/msr" : "";
    }
    return null; // Chạy trên GitHub Pages hoặc domain ngoài -> dùng Cloud Relay API tự động
}

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

// Khởi chạy lắng nghe qua Cloud Relay API (để xem từ xa qua 4G/Internet)
function initCloudRelay() {
    const topic = localStorage.getItem("msr_relay_topic") || DEFAULT_RELAY_TOPIC;

    // 1. Mở kết nối SSE thời gian thực (Server-Sent Events)
    if (eventSource) {
        eventSource.close();
    }
    try {
        eventSource = new EventSource(`https://ntfy.sh/${topic}/sse`);
        eventSource.onopen = () => {
            document.getElementById("latencyText").textContent = "Cloud Live (Đang dò tín hiệu PC...)";
        };
        eventSource.onmessage = (e) => {
            try {
                const ev = JSON.parse(e.data);
                if (ev.event === "message" && ev.message) {
                    const data = JSON.parse(ev.message);
                    renderUI(data);
                }
            } catch (err) {}
        };
        eventSource.onerror = () => {
            handleConnectionError();
        };
    } catch (err) {
        console.warn("EventSource error:", err);
    }

    // 2. Poll kiểm tra dữ liệu hiện tại
    pollLatestCloudMessage();
}

function setPcOfflineUI(reason) {
    const pcPill = document.getElementById("pcStatusPill");
    const pcText = document.getElementById("pcStatusText");
    const badge = document.getElementById("statusBadge");

    if (pcPill) pcPill.className = "pc-pill offline";
    if (pcText) pcText.textContent = "PC Chưa Bật";
    if (badge) {
        badge.className = "status-badge done";
        badge.textContent = "CHƯA BẬT TOOL";
    }
    const heroTitle = document.getElementById("heroTitle");
    const heroSubtitle = document.getElementById("heroSubtitle");
    if (heroTitle) heroTitle.textContent = "Tool trên máy tính chưa mở";
    if (heroSubtitle) heroSubtitle.textContent = reason || "Vui lòng mở START_TOOL.bat trên máy tính để kết nối";
    const currentIp = document.getElementById("currentIpText");
    if (currentIp) currentIp.textContent = "Chờ bật tool...";
    const latency = document.getElementById("latencyText");
    if (latency) latency.textContent = "Chờ kết nối...";
    const ipAlert = document.getElementById("ipAlertBox");
    if (ipAlert) ipAlert.style.display = "none";
    const banner = document.getElementById("heroBanner");
    if (banner) banner.className = "hero-banner";
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    if (startBtn) startBtn.style.display = "flex";
    if (stopBtn) stopBtn.style.display = "none";
}

function pollLatestCloudMessage() {
    const topic = localStorage.getItem("msr_relay_topic") || DEFAULT_RELAY_TOPIC;
    fetch(`https://ntfy.sh/${topic}/json?poll=1&limit=5`)
        .then(res => res.text())
        .then(text => {
            const lines = text.trim().split("\n").filter(l => l.trim());
            let latestData = null;
            for (const line of lines) {
                try {
                    const ev = JSON.parse(line);
                    if (ev.event === "message" && ev.message) {
                        const data = JSON.parse(ev.message);
                        if (!latestData || (data.timestamp && data.timestamp > (latestData.timestamp || 0))) {
                            latestData = data;
                        }
                    }
                } catch (e) {}
            }
            if (latestData) {
                renderUI(latestData);
            } else if (lastHeartbeatTime === 0) {
                setPcOfflineUI();
            }
        })
        .catch(() => {
            if (lastHeartbeatTime === 0) setPcOfflineUI();
        });
}

// Lấy trạng thái thời gian thực từ Backend nội bộ
async function fetchStatusLocal() {
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

// Xử lý khi mất kết nối tới Backend (ví dụ khi modem đang reboot hoặc PC tắt)
function handleConnectionError() {
    if (lastWaitingState) {
        const pcPill = document.getElementById("pcStatusPill");
        const pcText = document.getElementById("pcStatusText");
        const latencyText = document.getElementById("latencyText");
        if (pcPill) pcPill.className = "pc-pill rebooting";
        if (pcText) pcText.textContent = "Modem rebooting...";
        if (latencyText) latencyText.textContent = "Đang khởi động lại modem...";
    } else {
        setPcOfflineUI();
    }
}

// Hiển thị dữ liệu lên giao diện
function renderUI(data) {
    if (!data) return;

    const nowSec = Date.now() / 1000;
    // Kiểm tra tính mới của dữ liệu: Phải có timestamp và trong vòng 15 giây
    const hasFreshTimestamp = data.timestamp && (Math.abs(nowSec - data.timestamp) < 15);
    const isLocal = getApiBaseUrl() !== null;
    const isOnline = isLocal ? Boolean(data.pc_connected || true) : hasFreshTimestamp;

    const pcPill = document.getElementById("pcStatusPill");
    const pcText = document.getElementById("pcStatusText");
    const banner = document.getElementById("heroBanner");
    const badge = document.getElementById("statusBadge");

    if (isOnline) {
        lastHeartbeatTime = nowSec;
        pcPill.className = "pc-pill online";
        pcText.textContent = "PC Online";
    } else {
        setPcOfflineUI("Dữ liệu cũ đã hết hạn. Chờ máy tính phát tín hiệu mới...");
        return;
    }

    // 2. IP & Tiêu đề
    document.getElementById("currentIpText").textContent = data.current_ip || "Không có IP";
    document.getElementById("timerBadge").textContent = data.elapsed_time || "00:00";
    document.getElementById("heroTitle").textContent = data.status_title || "Hệ thống sẵn sàng";
    document.getElementById("heroSubtitle").textContent = data.status_subtitle || "";

    // 3. Khối Banner Hero & Hộp Cảnh Báo Khởi Động Lại Modem
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
            } else if (acc.status === "Ready") {
                badgeClass = "badge-ready";
                stText = "Sẵn sàng";
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

// Kiểm tra nhịp tim định kỳ: Nếu quá 15 giây không có dữ liệu mới thì tự động về Offline
setInterval(() => {
    if (getApiBaseUrl() === null) {
        const nowSec = Date.now() / 1000;
        if (lastHeartbeatTime > 0 && (nowSec - lastHeartbeatTime > 15)) {
            setPcOfflineUI("Mất kết nối với máy tính (quá 15 giây không có tín hiệu).");
        }
    }
}, 2500);

// Gửi hành động điều khiển về Backend (hỗ trợ cả Local Wi-Fi lẫn Cloud Relay từ xa)
async function postAction(actionName) {
    const baseUrl = getApiBaseUrl();
    if (baseUrl) {
        const endpoint = (baseUrl ? baseUrl : "") + "/api/action";
        try {
            await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: actionName })
            });
            fetchStatusLocal();
        } catch (err) {
            console.error("Lỗi gửi action local:", err);
        }
    } else {
        // Gửi lệnh qua Cloud Relay topic tới PC
        const cmdTopic = localStorage.getItem("msr_cmd_topic") || DEFAULT_CMD_TOPIC;
        try {
            const res = await fetch(`https://ntfy.sh/${cmdTopic}`, {
                method: "POST",
                headers: { "Title": "Mikoyan Remote Cmd" },
                body: JSON.stringify({
                    action: actionName,
                    timestamp: Date.now() / 1000
                })
            });
            console.log("Đã phát lệnh từ xa:", actionName, res.status);
            if (navigator.vibrate) navigator.vibrate(60);
        } catch (err) {
            console.error("Lỗi gửi action cloud:", err);
        }
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
    startSync();
}

function resetSettings() {
    localStorage.removeItem("msr_bridge_url");
    document.getElementById("bridgeUrlInput").value = "";
    closeSettingsModal();
    startSync();
}

// Bắt đầu luồng đồng bộ thông minh
function startSync() {
    const baseUrl = getApiBaseUrl();
    if (baseUrl !== null) {
        // Có địa chỉ nội bộ Wi-Fi hoặc bridge tùy chỉnh
        fetchStatusLocal();
        setInterval(fetchStatusLocal, 1500);
    } else {
        // Tự động kết nối Cloud Relay API
        initCloudRelay();
        // Polling dự phòng mỗi 4 giây
        setInterval(pollLatestCloudMessage, 4000);
    }
}

startSync();
