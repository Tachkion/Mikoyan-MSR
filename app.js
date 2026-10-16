/**
 * Mikoyan MSR Tool — Client Web App (GitHub Static / Direct Web)
 * Tự động đồng bộ trạng thái cày điểm và cảnh báo khởi động lại Modem.
 * Hỗ trợ song song cả mạng nội bộ Wi-Fi/Tunnel lẫn Cloud Relay API (ntfy) để xem từ xa tức thì qua 4G.
 */

const DEFAULT_RELAY_TOPIC = "mikoyan_msr_live_1Yk7Rb";
const DEFAULT_CMD_TOPIC = "mikoyan_msr_cmds_1Yk7Rb";
let lastWaitingState = false;
let isPolling = false;
let eventSource = null;
let lastHeartbeatTime = 0; // Thời điểm nhận được bản tin gần nhất từ PC (giây timestamp client)
let localFailCount = 0;
let localPollingTimer = null;

// Tự động nhận diện và cập nhật Bridge URL mới nhất trực tiếp từ GitHub API (0 giây cache)
async function autoFetchBridgeFromGitHub() {
    try {
        const ghApi = "https://api.github.com/repos/Tachkion/Mikoyan-MSR/contents/msr/bridge.json?t=" + Date.now();
        const res = await fetch(ghApi, { cache: "no-store" });
        if (res.ok) {
            const data = await res.json();
            if (data.content) {
                const decoded = JSON.parse(atob(data.content.replace(/\s/g, "")));
                if (decoded.online === false || decoded.bridge_url === "") {
                    console.log("[Auto-Bridge] GitHub xác nhận Tool đang tắt (Offline).");
                    localStorage.removeItem("msr_bridge_url");
                    setPcOfflineUI("Tool trên PC đã tắt.");
                    return null;
                }
                if (decoded.bridge_url && decoded.bridge_url.startsWith("https://")) {
                    const currentSaved = localStorage.getItem("msr_bridge_url");
                    if (currentSaved !== decoded.bridge_url) {
                        console.log("[Auto-Bridge GitHub API] ✔ Nhận diện Bridge mới nhất:", decoded.bridge_url);
                        localStorage.setItem("msr_bridge_url", decoded.bridge_url);
                        localFailCount = 0;
                    }
                    return decoded.bridge_url;
                }
            }
        }
    } catch (e) {
        console.warn("[Auto-Bridge] Lỗi đọc GitHub API:", e);
    }

    try {
        const rawUrl = "https://raw.githubusercontent.com/Tachkion/Mikoyan-MSR/main/msr/bridge.json?t=" + Date.now();
        const r2 = await fetch(rawUrl, { cache: "no-store" });
        if (r2.ok) {
            const d2 = await r2.json();
            if (d2.bridge_url && d2.bridge_url.startsWith("https://")) {
                localStorage.setItem("msr_bridge_url", d2.bridge_url);
                return d2.bridge_url;
            }
        }
    } catch (e) {}

    try {
        const localPath = (window.location.pathname.startsWith("/msr") ? "/msr" : "") + "/bridge.json?t=" + Date.now();
        const r3 = await fetch(localPath, { cache: "no-store" });
        if (r3.ok) {
            const d3 = await r3.json();
            if (d3.bridge_url && d3.bridge_url.startsWith("https://")) {
                localStorage.setItem("msr_bridge_url", d3.bridge_url);
                return d3.bridge_url;
            }
        }
    } catch (e) {}

    return null;
}

// Lấy Base API URL (Tự động nạp từ URL param, localStorage hoặc bridge.js)
function getApiBaseUrl() {
    // 1. Tự động kiểm tra và nạp Bridge từ URL (?bridge=... hoặc #bridge=... hoặc ?tunnel=...)
    try {
        const urlParams = new URLSearchParams(window.location.search);
        let paramBridge = urlParams.get("bridge") || urlParams.get("tunnel");
        if (!paramBridge && window.location.hash) {
            const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, "?"));
            paramBridge = hashParams.get("bridge") || hashParams.get("tunnel");
        }
        if (paramBridge && paramBridge.trim()) {
            paramBridge = paramBridge.trim().replace(/\/+$/, "");
            if ((paramBridge.startsWith("http://") || paramBridge.startsWith("https://")) && !paramBridge.includes("example.trycloudflare.com")) {
                localStorage.setItem("msr_bridge_url", paramBridge);
                localFailCount = 0;
                try {
                    window.history.replaceState({}, document.title, window.location.pathname);
                } catch (e) {}
                console.log("[Bridge Auto] ✔ Đã tự động kết nối và lưu Bridge từ URL:", paramBridge);
                showAutoBridgeToast(paramBridge);
                return paramBridge;
            }
        }
    } catch (e) {}

    // 2. Kiểm tra Bridge đã lưu trong bộ nhớ máy (localStorage)
    const customUrl = localStorage.getItem("msr_bridge_url");
    if (customUrl && customUrl.trim() && !customUrl.includes("example.trycloudflare.com")) {
        return customUrl.trim().replace(/\/+$/, "");
    }

    // 3. Kiểm tra Bridge mặc định từ bridge.js (nếu được xuất bản cùng web)
    if (window.MSR_DEFAULT_BRIDGE_URL && window.MSR_DEFAULT_BRIDGE_URL.trim() && !window.MSR_DEFAULT_BRIDGE_URL.includes("example.trycloudflare.com")) {
        const defaultUrl = window.MSR_DEFAULT_BRIDGE_URL.trim().replace(/\/+$/, "");
        if (defaultUrl.startsWith("http://") || defaultUrl.startsWith("https://")) {
            return defaultUrl;
        }
    }

    // 4. Nếu chạy cục bộ trên máy tính, cùng Wi-Fi hoặc qua Cloudflare Tunnel trực tiếp
    const host = window.location.hostname;
    const isDirect = host === "localhost" ||
                    host === "127.0.0.1" ||
                    host.startsWith("192.168.") ||
                    host.startsWith("10.") ||
                    host.startsWith("172.") ||
                    host.endsWith("trycloudflare.com") ||
                    host.endsWith("cfargotunnel.com");
    if (isDirect) {
        return window.location.pathname.startsWith("/msr") ? "/msr" : "";
    }
    return null;
}

// Thông báo Toast nhỏ khi Bridge được tự động cấu hình
function showAutoBridgeToast(bridgeUrl) {
    try {
        const toast = document.createElement("div");
        toast.style.position = "fixed";
        toast.style.top = "16px";
        toast.style.left = "50%";
        toast.style.transform = "translateX(-50%)";
        toast.style.background = "#15803d";
        toast.style.color = "#ffffff";
        toast.style.padding = "8px 16px";
        toast.style.borderRadius = "20px";
        toast.style.fontSize = "12px";
        toast.style.fontWeight = "600";
        toast.style.zIndex = "9999";
        toast.style.boxShadow = "0 4px 14px rgba(0,0,0,0.4)";
        toast.style.textAlign = "center";
        toast.innerHTML = "✔ Đã tự động kết nối Bridge với Tool PC!";
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.transition = "opacity 0.6s";
            toast.style.opacity = "0";
            setTimeout(() => toast.remove(), 600);
        }, 3000);
    } catch (e) {}
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

    // 1. Mở kết nối SSE thời gian thực với ?since=now để KHÔNG replay tin cũ từ quá khứ
    if (eventSource) {
        try { eventSource.close(); } catch (e) {}
    }
    try {
        eventSource = new EventSource(`https://ntfy.sh/${topic}/sse?since=now`);
        eventSource.onopen = () => {
            console.log("[Cloud Relay] Đã mở luồng SSE thời gian thực:", topic);
            const latency = document.getElementById("latencyText");
            if (latency) latency.textContent = "Cloud Live";
        };
        eventSource.onmessage = (e) => {
            try {
                const ev = JSON.parse(e.data);
                if (ev.event === "message" && ev.message) {
                    const data = JSON.parse(ev.message);
                    const nowSec = Date.now() / 1000;
                    const ageSec = nowSec - (Number(data.timestamp) || 0);
                    if (data.status_mode === "offline" || data.is_online === false) {
                        setPcOfflineUI("Tool trên PC đã tắt.");
                        return;
                    }
                    if (ageSec <= 10 && ageSec >= -15) {
                        renderUI(data, "sse");
                    }
                }
            } catch (err) {}
        };
        eventSource.onerror = () => {
            console.warn("[Cloud Relay] SSE mất tín hiệu, đang chờ tự động kết nối lại...");
        };
    } catch (err) {
        console.warn("EventSource error:", err);
    }

    // 2. Poll kiểm tra dữ liệu hiện tại ngay khi vừa vào trang
    pollLatestCloudMessage();
}

function setPcOfflineUI(reason) {
    lastHeartbeatTime = 0;
    const pcPill = document.getElementById("pcStatusPill");
    const pcText = document.getElementById("pcStatusText");
    const badge = document.getElementById("statusBadge");

    if (pcPill) pcPill.className = "pc-pill offline";
    if (pcText) pcText.textContent = "Chưa kết nối PC";
    if (badge) {
        badge.className = "status-badge done";
        badge.textContent = "CHỜ KẾT NỐI";
    }
    const heroTitle = document.getElementById("heroTitle");
    const heroSubtitle = document.getElementById("heroSubtitle");
    if (heroTitle) heroTitle.textContent = "Chưa nhận được dữ liệu từ Tool PC";
    if (heroSubtitle) {
        const isExternal = !getApiBaseUrl();
        if (isExternal) {
            heroSubtitle.innerHTML = "Website đang mở ngoài mạng PC. Hãy mở START_TOOL.bat trên máy tính để tự động phát sóng trực tiếp, hoặc nhấn <a href='javascript:void(0)' onclick='openSettingsModal()' style='color:#38bdf8;text-decoration:underline;'>⚙️ Cài đặt Bridge</a> để kiểm tra.";
        } else {
            heroSubtitle.textContent = reason || "Vui lòng mở START_TOOL.bat trên máy tính để kết nối";
        }
    }
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
    fetch(`https://ntfy.sh/${topic}/json?poll=1&limit=3`)
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
            const nowSec = Date.now() / 1000;
            if (latestData && latestData.timestamp) {
                const ageSec = nowSec - Number(latestData.timestamp);
                if (latestData.status_mode === "offline" || latestData.is_online === false) {
                    setPcOfflineUI("Tool trên PC đã tắt.");
                    return;
                }
                // Chỉ nhận dữ liệu ntfy nếu phát trong vòng 10 giây trở lại
                if (ageSec <= 10 && ageSec >= -15) {
                    renderUI(latestData, "cloud_poll");
                    return;
                }
            }
            // Nếu dữ liệu ntfy đã cũ hơn 10s hoặc không có, và kết nối trực tiếp thất bại -> Đưa về Offline ngay
            if (localFailCount > 0 || lastHeartbeatTime === 0 || (nowSec - lastHeartbeatTime > 8)) {
                setPcOfflineUI("Chưa kết nối PC");
            }
        })
        .catch(() => {
            if (localFailCount > 0 || lastHeartbeatTime === 0) setPcOfflineUI();
        });
}

// Lấy trạng thái thời gian thực từ Backend nội bộ
async function fetchStatusLocal() {
    if (isPolling) return;
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return;

    isPolling = true;
    const startTime = performance.now();
    const endpoint = baseUrl + "/api/status";

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(endpoint, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) {
            handleConnectionError();
            return;
        }
        const data = await res.json();
        localFailCount = 0;
        const latency = Math.round(performance.now() - startTime);
        const latencyEl = document.getElementById("latencyText");
        if (latencyEl) latencyEl.textContent = `Độ trễ: ${latency} ms`;
        renderUI(data, "local");
    } catch (err) {
        handleConnectionError();
    } finally {
        isPolling = false;
    }
}

// Xử lý khi mất kết nối tới Backend (ví dụ khi modem đang reboot hoặc PC tắt)
function handleConnectionError() {
    localFailCount++;
    const nowSec = Date.now() / 1000;
    if (lastWaitingState) {
        const pcPill = document.getElementById("pcStatusPill");
        const pcText = document.getElementById("pcStatusText");
        const latencyText = document.getElementById("latencyText");
        if (pcPill) pcPill.className = "pc-pill rebooting";
        if (pcText) pcText.textContent = "Modem rebooting...";
        if (latencyText) latencyText.textContent = "Đang khởi động lại modem...";
    } else {
        // Nếu kết nối trực tiếp thất bại và quá 6 giây không có heartbeat tươi -> Offline ngay!
        if (lastHeartbeatTime === 0 || (nowSec - lastHeartbeatTime > 6)) {
            setPcOfflineUI("Không thể kết nối tới PC (Tool đã tắt).");
        }

        // Tự động kiểm tra lại GitHub API xem Tool có cập nhật URL mới không
        if (localFailCount >= 3) {
            autoFetchBridgeFromGitHub().then(newUrl => {
                if (newUrl) {
                    localFailCount = 0;
                    if (!localPollingTimer) {
                        localPollingTimer = setInterval(fetchStatusLocal, 1500);
                    }
                }
            });
        }
        // Nếu địa chỉ Bridge tùy chỉnh thất bại liên tiếp 4 lần, tự xóa để quét lại
        if (localFailCount >= 4) {
            const savedBridge = localStorage.getItem("msr_bridge_url");
            if (savedBridge) {
                console.warn("[Bridge] Bridge tùy chỉnh không phản hồi 4 lần. Tự động gỡ bỏ:", savedBridge);
                localStorage.removeItem("msr_bridge_url");
            }
        }
    }
}

// Hiển thị dữ liệu lên giao diện
function renderUI(data, source = "cloud") {
    if (!data) return;

    const nowSec = Date.now() / 1000;
    const msgTs = Number(data.timestamp) || 0;
    const ageSec = nowSec - msgTs;

    // Nếu Tool phát tín hiệu offline -> lập tức báo Offline
    if (data.status_mode === "offline" || data.is_online === false) {
        setPcOfflineUI("Tool trên PC đã tắt.");
        return;
    }

    let isFresh = true;
    if (source !== "local" && msgTs > 0) {
        // Dữ liệu từ ntfy hoặc sse chỉ hợp lệ nếu gửi trong vòng 10 giây
        if (ageSec > 10 || ageSec < -15) {
            isFresh = false;
        }
    }

    const pcPill = document.getElementById("pcStatusPill");
    const pcText = document.getElementById("pcStatusText");
    const banner = document.getElementById("heroBanner");
    const badge = document.getElementById("statusBadge");

    if (isFresh) {
        lastHeartbeatTime = nowSec;
        if (pcPill) pcPill.className = "pc-pill online";
        if (pcText) pcText.textContent = "PC Online";
    } else {
        setPcOfflineUI("Dữ liệu cũ đã hết hạn (Tool PC không phản hồi).");
        return;
    }

    // 2. IP & Tiêu đề
    const curIpEl = document.getElementById("currentIpText");
    if (curIpEl) curIpEl.textContent = data.current_ip || "Không có IP";

    const timerBadge = document.getElementById("timerBadge");
    if (timerBadge) timerBadge.textContent = data.elapsed_time || "00:00";

    const heroTitle = document.getElementById("heroTitle");
    if (heroTitle) heroTitle.textContent = data.status_title || "Hệ thống sẵn sàng";

    const heroSub = document.getElementById("heroSubtitle");
    if (heroSub) heroSub.textContent = data.status_subtitle || "";

    // 3. Khối Banner Hero & Hộp Cảnh Báo Khởi Động Lại Modem
    const fill = document.getElementById("progressBarFill");
    const ipAlert = document.getElementById("ipAlertBox");
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");

    if (data.is_running) {
        if (startBtn) startBtn.style.display = "none";
        if (stopBtn) stopBtn.style.display = "flex";
    } else {
        if (startBtn) startBtn.style.display = "flex";
        if (stopBtn) stopBtn.style.display = "none";
    }

    if (data.waiting_ip_change) {
        if (banner) banner.className = "hero-banner waiting-ip";
        if (badge) {
            badge.className = "status-badge waiting";
            badge.textContent = "CHỜ ĐỔI IP";
        }
        if (fill) fill.className = "progress-bar-fill farming";
        if (ipAlert) ipAlert.classList.add("active");
        const alertOld = document.getElementById("alertOldIp");
        if (alertOld) alertOld.textContent = data.old_ip || "--";
        const alertCur = document.getElementById("alertCurrentIp");
        if (alertCur) alertCur.textContent = data.current_ip || "Đang kiểm tra...";

        // Chuông báo & Rung điện thoại lần đầu khi chuyển trạng thái
        if (!lastWaitingState) {
            playChime();
            if (navigator.vibrate) {
                navigator.vibrate([200, 100, 200]);
            }
        }
    } else {
        if (banner) banner.className = "hero-banner";
        if (ipAlert) ipAlert.classList.remove("active");

        if (badge) {
            if (data.status_mode === "farming") {
                badge.className = "status-badge farming";
                badge.textContent = "ĐANG CÀY";
                if (fill) fill.className = "progress-bar-fill farming";
            } else if (data.status_mode === "done") {
                badge.className = "status-badge done";
                badge.textContent = "HOÀN TẤT";
                if (fill) fill.className = "progress-bar-fill";
            } else {
                badge.className = "status-badge ready";
                badge.textContent = "SẴN SÀNG";
                if (fill) fill.className = "progress-bar-fill";
            }
        }
    }
    lastWaitingState = data.waiting_ip_change;

    // 4. Thanh tiến độ
    const pPct = Math.round((data.progress || 0) * 100);
    if (fill) fill.style.width = pPct + "%";
    const progTxt = document.getElementById("progressText");
    if (progTxt) progTxt.textContent = data.progress_text || "0%";
    const progPct = document.getElementById("progressPercent");
    if (progPct) progPct.textContent = pPct + "%";

    // 5. Danh sách tài khoản (Hiển thị đầy đủ Điểm, Hôm nay, Streak, Hạng & Hạn mức)
    const accList = document.getElementById("accountsList");
    if (accList && data.accounts && Array.isArray(data.accounts) && data.accounts.length > 0) {
        const accCountHeader = document.getElementById("accCountHeader");
        if (accCountHeader) accCountHeader.textContent = `${data.accounts.length} tài khoản`;
        let html = "";
        data.accounts.forEach(acc => {
            const isFarming = String(acc.profile_id) === String(data.current_profile_id);
            const isDolphinOpen = (data.dolphin_running_ids && data.dolphin_running_ids.indexOf(String(acc.profile_id)) !== -1);
            let badgeClass = "badge-ready";
            let stText = acc.status || "Ready";
            let rowClass = "";
            if (isFarming) {
                badgeClass = "badge-running";
                stText = "Đang cày";
                rowClass = "running";
            } else if (isDolphinOpen) {
                badgeClass = "badge-dolphin";
                stText = "Đang mở";
                rowClass = "dolphin-open";
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

            const pts = (Number(acc.current_points) || 0).toLocaleString();
            const gained = (acc.gained_today !== undefined && acc.gained_today !== null) ? acc.gained_today : 0;
            const streakStr = acc.streak ? ` • Chuỗi: ${acc.streak}d` : "";
            const noteStr = acc.note ? ` • ${acc.note}` : "";

            html += `
                <div class="account-item ${rowClass}">
                    <div class="acc-info">
                        <div class="acc-name">${acc.profile_name || 'Profile'}</div>
                        <div class="acc-meta">Điểm: ${pts} pts • Hôm nay: +${gained}${streakStr}${noteStr}</div>
                    </div>
                    <span class="badge-pill ${badgeClass}">${stText}</span>
                </div>
            `;
        });
        accList.innerHTML = html;
    }

    // 6. Console Log terminal
    const logBox = document.getElementById("logsTerminal");
    if (logBox && data.logs) {
        const wasBottom = (logBox.scrollHeight - logBox.clientHeight) <= (logBox.scrollTop + 50);
        logBox.textContent = data.logs;
        if (wasBottom) {
            logBox.scrollTop = logBox.scrollHeight;
        }
    }
}

// Kiểm tra nhịp tim định kỳ: Nếu quá 8 giây không có tín hiệu mới từ PC -> Chuyển về Offline ngay lập tức
setInterval(() => {
    const nowSec = Date.now() / 1000;
    if (lastHeartbeatTime > 0 && (nowSec - lastHeartbeatTime > 8)) {
        setPcOfflineUI("Đã mất kết nối (Tool trên PC đã tắt).");
    }
}, 2000);

// Gửi hành động điều khiển về Backend (hỗ trợ cả Local Wi-Fi lẫn Cloud Relay từ xa)
async function postAction(actionName) {
    const baseUrl = getApiBaseUrl();
    let localSuccess = false;
    if (baseUrl) {
        const endpoint = baseUrl + "/api/action";
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: actionName }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                localSuccess = true;
                fetchStatusLocal();
            }
        } catch (err) {
            console.warn("Lỗi gửi action local, chuyển sang cloud fallback:", err);
        }
    }

    if (!localSuccess) {
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
            console.log("Đã phát lệnh từ xa qua Cloud:", actionName, res.status);
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
    if (input) input.value = localStorage.getItem("msr_bridge_url") || "";
    if (modal) modal.classList.add("open");
}

function closeSettingsModal() {
    const modal = document.getElementById("settingsModal");
    if (modal) modal.classList.remove("open");
}

function saveSettings() {
    const val = document.getElementById("bridgeUrlInput").value.trim();
    if (val && !val.includes("example.trycloudflare.com")) {
        localStorage.setItem("msr_bridge_url", val);
    } else {
        localStorage.removeItem("msr_bridge_url");
    }
    closeSettingsModal();
    startSync();
}

function resetSettings() {
    localStorage.removeItem("msr_bridge_url");
    const input = document.getElementById("bridgeUrlInput");
    if (input) input.value = "";
    closeSettingsModal();
    startSync();
}

// Bắt đầu luồng đồng bộ: Auto-Bridge GitHub + Local Polling + Cloud Relay
async function startSync() {
    // 1. Tự động tìm và cập nhật Bridge mới nhất từ GitHub API
    await autoFetchBridgeFromGitHub();

    // 2. Kích hoạt Cloud Relay thời gian thực (SSE) dự phòng
    initCloudRelay();
    setInterval(pollLatestCloudMessage, 4000);

    // 3. Kích hoạt Local Polling nếu có cấu hình mạng nội bộ / Bridge khả dụng
    if (localPollingTimer) {
        clearInterval(localPollingTimer);
        localPollingTimer = null;
    }
    const baseUrl = getApiBaseUrl();
    if (baseUrl !== null) {
        fetchStatusLocal();
        localPollingTimer = setInterval(fetchStatusLocal, 1500);
    } else {
        // Nếu chưa tìm thấy Bridge, thử dò lại sau 3s
        setTimeout(async () => {
            const retryUrl = await autoFetchBridgeFromGitHub();
            if (retryUrl && !localPollingTimer) {
                fetchStatusLocal();
                localPollingTimer = setInterval(fetchStatusLocal, 1500);
            }
        }, 3000);
    }
}

startSync();
