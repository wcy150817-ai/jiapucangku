(() => {
  let cfgCache = null;
  let lastText = "";

  async function getCfg() {
    if (cfgCache) return cfgCache;
    try {
      const r = await fetch("../site-config.json?t=" + Date.now());
      cfgCache = await r.json();
    } catch {
      cfgCache = { default_price: 9.9, wechat: { mode: "both", wechat_id: "请配置微信号", qr_image: "../assets/wechat-qr.svg" } };
    }
    return cfgCache;
  }

  async function copyStr(str) {
    try {
      await navigator.clipboard.writeText(str);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = str;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  function ensureModalDom() {
    if (document.getElementById("subWxBackdrop")) return;
    const div = document.createElement("div");
    div.id = "subWxBackdrop";
    div.className = "wx-backdrop";
    div.innerHTML = `
      <div class="wx-modal">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <h3 style="font-size:17px;">💬 联系微信极速调阅发货</h3>
          <button id="subCloseWx" class="ghost-btn" style="padding:3px 9px;">✕</button>
        </div>
        <div id="subWxBanner" class="wx-copied-tip">
          ✅ 已自动复制家谱编号与书名！打开微信直接「粘贴」发送给掌柜即可秒发原档。
        </div>
        <div id="subWxPreview" class="wx-order-box"></div>
        <a id="subKfBtn" href="#" target="_blank" rel="noopener" class="wx-big-btn green" style="display:none;">
          🚀 一键跳转微信在线客服窗口
        </a>
        <div id="subPersonalBox">
          <div class="wx-qr-wrap">
            <img id="subQrImg" src="../assets/wechat-qr.svg" alt="微信二维码" />
            <div style="font-size:12px;color:var(--ink-light);">手机微信内长按识别 · 电脑端请用微信扫一扫</div>
          </div>
          <div style="text-align:center;font-size:13.5px;margin-bottom:10px;">
            掌柜微信号：<strong id="subWxId" style="color:var(--cinnabar);font-size:15px;">--</strong>
          </div>
          <button id="subWakeWx" class="wx-big-btn green">📲 复制微信号并唤醒打开微信 App</button>
        </div>
        <button id="subRecopy" class="wx-big-btn dark">📋 重新复制所选家谱书名信息</button>
      </div>
    `;
    document.body.appendChild(div);

    document.getElementById("subCloseWx").onclick = () => div.classList.remove("open");
    div.onclick = (e) => { if (e.target === div) div.classList.remove("open"); };
    document.getElementById("subWakeWx").onclick = async () => {
      const cfg = await getCfg();
      const wid = cfg?.wechat?.wechat_id || "";
      await copyStr(wid);
      document.getElementById("subWxBanner").textContent = `✅ 已复制微信号「${wid}」，正在唤起微信 App…`;
      window.location.href = "weixin://";
    };
    document.getElementById("subRecopy").onclick = async () => {
      await copyStr(lastText);
      document.getElementById("subWxBanner").textContent = "✅ 已重新复制查谱信息！去微信粘贴发送即可";
    };
  }

  window.openSubpageWechat = async function (msg) {
    ensureModalDom();
    lastText = msg;
    await copyStr(msg);
    const cfg = await getCfg();
    const wx = cfg.wechat || {};
    const mode = wx.mode || "both";
    const kfUrl = (wx.kf_url || "").trim();
    const qrRaw = wx.qr_image || "./assets/wechat-qr.svg";
    const qrUrl = qrRaw.startsWith("./") ? "." + qrRaw : qrRaw;

    document.getElementById("subWxPreview").textContent = msg;
    document.getElementById("subWxId").textContent = wx.wechat_id || "未设置";
    document.getElementById("subQrImg").src = qrUrl;

    const kfBtn = document.getElementById("subKfBtn");
    const pBox = document.getElementById("subPersonalBox");
    if (kfUrl && (mode === "both" || mode === "kf")) {
      kfBtn.style.display = "flex";
      kfBtn.href = kfUrl;
      kfBtn.textContent = wx.kf_button_text || "🚀 一键跳转微信在线客服窗口";
    } else {
      kfBtn.style.display = "none";
    }
    pBox.style.display = mode === "kf" && kfUrl ? "none" : "block";
    document.getElementById("subWxBackdrop").classList.add("open");
  };

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-wx-msg]");
    if (btn) {
      e.preventDefault();
      window.openSubpageWechat(btn.dataset.wxMsg);
    }
  });
})();
