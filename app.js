(() => {
  const VARIANT_GROUPS = [
    ["萧", "肖"],
    ["邱", "丘"],
    ["傅", "付"],
    ["阎", "闫"],
    ["廖", "缪"],
    ["钟", "锺"],
    ["于", "於"],
  ];
  const VARIANT_MAP = {};
  VARIANT_GROUPS.forEach((g) => g.forEach((c) => (VARIANT_MAP[c] = g)));

  const GENRE_DEFS = [
    { id: "zongpu", label: "宗谱", test: (r) => r[1].includes("宗谱") },
    { id: "zupu", label: "族谱", test: (r) => r[1].includes("族谱") },
    { id: "jiapu", label: "家谱", test: (r) => r[1].includes("家谱") },
    { id: "zhipu", label: "支谱/房谱", test: (r) => /[支房派门]谱/.test(r[1]) },
    { id: "jiacheng", label: "家乘/世谱", test: (r) => /(家乘|世谱|世系|谱牒|墨牒)/.test(r[1]) },
    { id: "tongpu", label: "通谱/总谱", test: (r) => /(通谱|总谱|合谱|联谱|统谱)/.test(r[1]) },
    { id: "chongxiu", label: "重修/续修", test: (r) => /(重修|续修|增修|新修|重刊)/.test(r[1]) },
    { id: "duoxiu", label: "三修以上老谱", test: (r) => /[三四五六七八九十百\d]+修/.test(r[1]) },
    { id: "mingqing", label: "明清刻本", test: (r) => /(明|清|顺治|康熙|雍正|乾隆|嘉庆|道光|咸丰|同治|光绪|宣统)/.test(r[5] + " " + r[1]) },
    { id: "minguo", label: "民国刊本", test: (r) => /民国/.test(r[5] + " " + r[1]) },
  ];
  const GENRE_MAP = Object.fromEntries(GENRE_DEFS.map((d) => [d.id, d]));

  const state = {
    cfg: null,
    meta: null,
    lore: null,
    tradDict: {},
    shardCache: new Map(),
    allPool: null,
    allPoolPromise: null,
    surname: "",
    provIdx: -1,
    region: "",
    hall: "", // "" | "RAW:xxx" | "LORE:xxx"
    genre: "",
    q: "",
    sortBy: "default",
    activeAz: "C",
    filtered: [],
    hallFallbackUsed: false,
    hallMatchedCount: 0,
    page: 1,
    pageSize: 24,
    bag: new Map(),
    lastInquiryText: "",
  };

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toSimp(str) {
    if (!str) return "";
    let out = "";
    for (const ch of str) out += state.tradDict[ch] || ch;
    return out;
  }

  function normalizeSurnameInput(raw) {
    let s = toSimp(String(raw || "").trim()).replace(/\s+/g, "");
    if (s.length >= 2 && (s.endsWith("氏") || s.endsWith("姓") || s.endsWith("家"))) {
      s = s.slice(0, -1);
    }
    return s;
  }

  function clearSurnameWarn() {
    $("proSearchConsole")?.classList.remove("req-warn");
    if ($("surnameReqTip")) $("surnameReqTip").style.display = "none";
  }

  function showSurnameWarn() {
    $("proSearchConsole")?.classList.add("req-warn");
    if ($("surnameReqTip")) $("surnameReqTip").style.display = "block";
    $("surnameInput")?.focus();
  }

  async function copyClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    }
  }

  function decodeRec(r) {
    const sku = `GP-${String(r[0]).padStart(6, "0")}`;
    const prov = state.meta.provinces[r[3]]?.name || "未详";
    const fmt = state.meta.formats[r[6]]?.name || "电子版";
    const defPrice = Number(state.cfg?.default_price ?? 9.9);
    const price = r[9] > 0 ? r[9] : defPrice;
    return {
      skuNum: r[0],
      sku,
      title: r[1],
      surname: r[2],
      prov,
      region: r[4],
      metaTag: r[5],
      fmt,
      fileCount: r[7],
      sizeStr: r[8],
      price,
      hallName: r[10] || "",
    };
  }

  async function fetchShard(shardKey) {
    if (state.shardCache.has(shardKey)) return state.shardCache.get(shardKey);
    const res = await fetch(`./data/shards/${shardKey}.json`);
    const arr = await res.json();
    state.shardCache.set(shardKey, arr);
    return arr;
  }

  async function fetchAllPool(silent = false) {
    if (state.allPool) return state.allPool;
    if (state.allPoolPromise) return state.allPoolPromise;
    if (!silent && $("resultStatus")) {
      $("resultStatus").textContent = "正在加载全馆书目索引…";
    }
    state.allPoolPromise = fetch(`./data/all_compact.json`)
      .then((res) => res.json())
      .then((arr) => {
        state.allPool = arr;
        return arr;
      });
    return state.allPoolPromise;
  }

  function resolveSurnameVariants(surname) {
    if (!surname) return null;
    return VARIANT_MAP[surname] || [surname];
  }

  function getSurnameTotalCount(surname) {
    if (!surname || !state.meta?.surname_counts) return 0;
    const vars = resolveSurnameVariants(surname);
    let sum = 0;
    for (const v of vars) sum += state.meta.surname_counts[v] || 0;
    return sum;
  }

  function updateSurnameBadge() {
    const badge = $("surnameHitBadge");
    if (!badge) return;
    if (!state.surname) {
      badge.style.display = "none";
      return;
    }
    const cnt = getSurnameTotalCount(state.surname);
    badge.textContent = cnt > 0 ? `${cnt}部` : "全库查";
    badge.style.display = "inline-block";
  }

  async function getBasePoolForSurname() {
    if (state.surname) {
      const map = state.meta.surname_to_shard || {};
      const vars = resolveSurnameVariants(state.surname);
      const shardKeys = new Set();
      for (const v of vars) {
        if (map[v]) shardKeys.add(map[v]);
      }
      if (shardKeys.size > 0) {
        if (state.allPool) return state.allPool.filter((r) => vars.includes(r[2]));
        const lists = await Promise.all(Array.from(shardKeys).map((k) => fetchShard(k)));
        return lists.flat().filter((r) => vars.includes(r[2]));
      }
      const all = await fetchAllPool();
      return all.filter((r) => r[2] === state.surname || r[1].includes(state.surname));
    }
    return state.allPool || null;
  }

  function getLoreEntry(surname) {
    if (!surname || !state.lore?.surnames) return null;
    if (state.lore.surnames[surname]) return { key: surname, info: state.lore.surnames[surname] };
    const vars = VARIANT_MAP[surname] || [];
    for (const v of vars) {
      if (state.lore.surnames[v]) return { key: v, info: state.lore.surnames[v] };
    }
    return null;
  }

  // 顶部仅联动【省份】与【地区】两个可选下拉框，并计算下方可直接点击的【堂号/谱类】标签数据
  function rebuildCascadingControls(surnamePool) {
    const provCounts = new Map();
    if (surnamePool) {
      for (let i = 0; i < surnamePool.length; i++) {
        const pIdx = surnamePool[i][3];
        provCounts.set(pIdx, (provCounts.get(pIdx) || 0) + 1);
      }
      if (state.provIdx >= 0 && !provCounts.has(state.provIdx)) {
        state.provIdx = -1;
      }
    } else {
      state.meta.provinces.forEach((p, idx) => provCounts.set(idx, p.count));
    }

    const provEntries = Array.from(provCounts.entries()).sort((a, b) => {
      const nameA = state.meta.provinces[a[0]]?.name || "";
      const nameB = state.meta.provinces[b[0]]?.name || "";
      if (nameA === "未详") return 1;
      if (nameB === "未详") return -1;
      return b[1] - a[1];
    });

    $("selProv").innerHTML =
      `<option value="">不限省份</option>` +
      provEntries
        .map(([idx, cnt]) => {
          const pName = state.meta.provinces[idx]?.name || "未详";
          const disp = pName === "未详" ? "未标省份" : pName;
          const cntTxt = state.surname ? ` (${cnt})` : "";
          return `<option value="${idx}" ${state.provIdx === idx ? "selected" : ""}>${esc(disp)}${cntTxt}</option>`;
        })
        .join("");

    // 二级联动：地区/市县
    const afterProv = surnamePool
      ? (state.provIdx >= 0 ? surnamePool.filter((r) => r[3] === state.provIdx) : surnamePool)
      : null;

    const regCounts = new Map();
    if (afterProv) {
      for (let i = 0; i < afterProv.length; i++) {
        const reg = afterProv[i][4];
        if (reg) regCounts.set(reg, (regCounts.get(reg) || 0) + 1);
      }
      if (state.region && !regCounts.has(state.region)) {
        state.region = "";
      }
    }

    const regEntries = Array.from(regCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100);

    $("selRegion").innerHTML =
      `<option value="">不限地区</option>` +
      regEntries
        .map(([reg, cnt]) => `<option value="${esc(reg)}" ${state.region === reg ? "selected" : ""}>${esc(reg)} (${cnt})</option>`)
        .join("");

    // 计算下方直接可点击的【堂号】与【谱类】标签
    const afterReg = afterProv
      ? (state.region ? afterProv.filter((r) => r[4] === state.region) : afterProv)
      : null;

    const rawHallCounts = new Map();
    if (afterReg) {
      for (let i = 0; i < afterReg.length; i++) {
        const h = afterReg[i][10];
        if (h) rawHallCounts.set(h, (rawHallCounts.get(h) || 0) + 1);
      }
    }

    const rawHallEntries = Array.from(rawHallCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14);

    const loreMatch = getLoreEntry(state.surname);
    const loreHalls = loreMatch?.info?.halls
      ? loreMatch.info.halls.split(/[、,，\s]+/).filter((x) => x && (x.endsWith("堂") || x.endsWith("祠") || x.includes("义门")))
      : [];

    if (state.hall.startsWith("RAW:")) {
      const targetH = state.hall.slice(4);
      if (afterReg && !rawHallCounts.has(targetH)) state.hall = "";
    } else if (state.hall.startsWith("LORE:")) {
      const targetH = state.hall.slice(5);
      if (!loreHalls.includes(targetH)) state.hall = "";
    }

    return { rawHallEntries, loreHalls, afterReg };
  }

  function matchHallRecord(r, hallFilter) {
    if (!hallFilter) return true;
    if (hallFilter.startsWith("RAW:")) {
      const target = hallFilter.slice(4);
      return r[10] === target || r[1].includes(target);
    }
    if (hallFilter.startsWith("LORE:")) {
      const target = hallFilter.slice(5);
      const core = target.replace(/(堂|祠)$/, "");
      if (r[10] === target || r[1].includes(target)) return true;
      if (core.length >= 2 && (r[1].includes(core) || r[4].includes(core))) return true;
      return false;
    }
    return true;
  }

  async function executeFilter() {
    updateSurnameBadge();
    const qSimp = toSimp(state.q.trim());
    const tokens = qSimp.split(/[\s,，、·/]+/).filter(Boolean);

    const hasAnyCondition =
      Boolean(state.surname) ||
      state.provIdx >= 0 ||
      Boolean(state.region) ||
      Boolean(state.hall) ||
      Boolean(state.genre) ||
      tokens.length > 0;

    if ($("resetConsoleBtn")) {
      $("resetConsoleBtn").style.display = hasAnyCondition ? "inline-block" : "none";
    }

    if (!hasAnyCondition) {
      rebuildCascadingControls(state.allPool);
      state.filtered = state.meta.featured || [];
      state.hallFallbackUsed = false;
      $("resultStatus").innerHTML =
        `馆藏共 <strong>${state.meta.total_works.toLocaleString()}</strong> 部 · 请先在上方输入<strong>姓氏</strong>（或点击常见姓氏）查询`;
      renderSurnameLoreCard();
      renderFacetPanel(null);
      renderHallAdvisor();
      updateSeoAndUrl();
      renderBooks();
      return;
    }

    let basePool = await getBasePoolForSurname();
    if (!basePool) {
      basePool = await fetchAllPool();
    }

    const facetData = rebuildCascadingControls(state.surname ? basePool : state.allPool);

    const preHallMatched = [];
    const genreDef = state.genre ? GENRE_MAP[state.genre] : null;

    for (let i = 0; i < basePool.length; i++) {
      const r = basePool[i];
      if (state.provIdx >= 0 && r[3] !== state.provIdx) continue;
      if (state.region && r[4] !== state.region) continue;
      if (genreDef && !genreDef.test(r)) continue;

      if (tokens.length > 0) {
        const provName = state.meta.provinces[r[3]]?.name || "";
        const skuStr = `gp-${String(r[0]).padStart(6, "0")}`;
        const hay = `${r[1]} ${r[2]}氏 ${provName} ${r[4]} ${r[5]} ${r[10] || ""} ${skuStr}`.toLowerCase();
        let ok = true;
        for (const tk of tokens) {
          const cleanTk = tk.length === 2 && tk.endsWith("氏") ? tk[0] : tk;
          const tkVars = VARIANT_MAP[cleanTk];
          if (tkVars) {
            if (!tkVars.some((v) => r[2] === v || hay.includes(v))) {
              ok = false;
              break;
            }
          } else if (!hay.includes(tk.toLowerCase())) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
      }
      preHallMatched.push(r);
    }

    state.hallFallbackUsed = false;
    state.hallMatchedCount = 0;
    let finalMatched = preHallMatched;

    if (state.hall) {
      const strictHall = preHallMatched.filter((r) => matchHallRecord(r, state.hall));
      state.hallMatchedCount = strictHall.length;
      if (strictHall.length > 0) {
        finalMatched = strictHall;
      } else if (state.hall.startsWith("LORE:") && preHallMatched.length > 0) {
        state.hallFallbackUsed = true;
        finalMatched = preHallMatched;
      } else {
        finalMatched = strictHall;
      }
    }

    if (state.sortBy === "files_desc") {
      finalMatched = [...finalMatched].sort((a, b) => (b[7] || 0) - (a[7] || 0));
    } else if (state.sortBy === "title_asc") {
      finalMatched = [...finalMatched].sort((a, b) => a[1].localeCompare(b[1], "zh-CN"));
    }

    state.filtered = finalMatched;

    const labelParts = [];
    if (state.surname) labelParts.push(`${state.surname}氏`);
    if (state.provIdx >= 0) labelParts.push(state.meta.provinces[state.provIdx].name);
    if (state.region) labelParts.push(state.region);
    if (state.hall) labelParts.push(state.hall.slice(state.hall.indexOf(":") + 1));
    if (state.genre && GENRE_MAP[state.genre]) labelParts.push(GENRE_MAP[state.genre].label);
    if (state.q.trim()) labelParts.push(`“${esc(state.q.trim())}”`);

    $("resultStatus").innerHTML =
      `<strong>${labelParts.join(" · ")}</strong>：共 <strong style="color:var(--cinnabar);">${finalMatched.length.toLocaleString()}</strong> 部`;

    renderSurnameLoreCard();
    renderFacetPanel(facetData);
    renderHallAdvisor();
    updateSeoAndUrl();
    renderBooks();
  }

  function renderHallAdvisor() {
    const banner = $("hallAdvisorBanner");
    if (!banner) return;
    if (!state.hall) {
      banner.style.display = "none";
      return;
    }
    const hName = state.hall.slice(state.hall.indexOf(":") + 1);
    const sLabel = state.surname ? `${state.surname}氏` : "本姓";

    if (state.hallFallbackUsed) {
      banner.style.display = "flex";
      banner.innerHTML = `
        <div style="flex:1;">
          古谱多将「<strong>${esc(hName)}</strong>」印于卷首内页而非封面书名。以下保留 ${esc(sLabel)} 书目共 <strong>${state.filtered.length}</strong> 部，建议按省县筛选或同县多部打包带回自行翻阅。
        </div>
        <button type="button" class="btn-wx" id="askHallBundleBtn" style="padding:5px 12px;font-size:12px;">咨询同县打包</button>
      `;
    } else if (state.hall.startsWith("LORE:")) {
      banner.style.display = "flex";
      banner.innerHTML = `
        <div style="flex:1;">
          已筛出含「<strong>${esc(hName)}</strong>」及对应郡望书目 ${state.hallMatchedCount} 部（另有部分老谱仅在卷首内页标堂号）。
        </div>
        <button type="button" class="ghost-btn" id="clearHallOnlyBtn" style="padding:3px 10px;font-size:12px;">显示全部${esc(sLabel)}谱</button>
      `;
    } else {
      banner.style.display = "none";
      return;
    }

    if ($("askHallBundleBtn")) {
      $("askHallBundleBtn").onclick = () => {
        const loc = state.provIdx >= 0 ? state.meta.provinces[state.provIdx].name + state.region : "不限地区";
        openWechatModal(`您好！我想咨询【${sLabel} · ${loc}】同地区家谱电子书打包价格。`);
      };
    }
    if ($("clearHallOnlyBtn")) {
      $("clearHallOnlyBtn").onclick = () => {
        state.hall = "";
        state.page = 1;
        executeFilter();
      };
    }
  }

  // 把剩下的分类（堂号、谱书体例/年代）渲染为干净的直接可点标签
  function renderFacetPanel(facetData) {
    const panel = $("facetPanel");
    if (!panel) return;
    if (!facetData) {
      panel.style.display = "none";
      return;
    }

    const { rawHallEntries, loreHalls, afterReg } = facetData;

    const hallPills = [];
    const seenH = new Set();
    for (const lh of loreHalls) {
      const rawHit = rawHallEntries.find(([h]) => h === lh);
      seenH.add(lh);
      const val = rawHit ? `RAW:${lh}` : `LORE:${lh}`;
      const cntBadge = rawHit ? `<small>${rawHit[1]}</small>` : "";
      hallPills.push(
        `<button type="button" class="f-chip ${state.hall === val ? "active" : ""}" data-f-hall="${esc(val)}">${esc(lh)}${cntBadge}</button>`
      );
    }
    for (const [h, cnt] of rawHallEntries) {
      if (seenH.has(h)) continue;
      const val = `RAW:${h}`;
      hallPills.push(
        `<button type="button" class="f-chip ${state.hall === val ? "active" : ""}" data-f-hall="${esc(val)}">${esc(h)}<small>${cnt}</small></button>`
      );
    }

    const genrePills = [];
    if (afterReg) {
      for (const g of GENRE_DEFS) {
        let cnt = 0;
        for (let i = 0; i < afterReg.length; i++) if (g.test(afterReg[i])) cnt++;
        if (cnt > 0 || state.genre === g.id) {
          genrePills.push(
            `<button type="button" class="f-chip ${state.genre === g.id ? "active" : ""}" data-f-genre="${g.id}">${esc(g.label)}<small>${cnt}</small></button>`
          );
        }
      }
    }

    if (!hallPills.length && !genrePills.length) {
      panel.style.display = "none";
      return;
    }

    const hallRowHtml = hallPills.length
      ? `<div class="facet-row">
          <div class="facet-key">堂号：</div>
          <div class="facet-vals">
            <button type="button" class="f-chip ${!state.hall ? "active" : ""}" data-f-hall="">全部</button>
            ${hallPills.join("")}
          </div>
        </div>`
      : "";

    const genreRowHtml = genrePills.length
      ? `<div class="facet-row">
          <div class="facet-key">谱类：</div>
          <div class="facet-vals">
            <button type="button" class="f-chip ${!state.genre ? "active" : ""}" data-f-genre="">全部</button>
            ${genrePills.join("")}
          </div>
        </div>`
      : "";

    panel.style.display = "block";
    panel.innerHTML = `${hallRowHtml}${genreRowHtml}`;
  }

  function renderSurnameLoreCard() {
    const box = $("surnameLoreBox");
    if (!box || !state.lore) return;
    const found = getLoreEntry(state.surname);
    if (!found) {
      box.style.display = "none";
      return;
    }
    const { key, info } = found;
    const totalCnt = getSurnameTotalCount(state.surname) || info.count || 0;
    const slugHtml = info.slug
      ? `<a href="${esc(info.slug)}" style="font-size:12px;color:var(--cinnabar);text-decoration:none;">${esc(key)}氏专页 →</a>`
      : "";

    box.style.display = "block";
    box.innerHTML = `
      <div class="lore-badge-row" style="margin-bottom:8px;">
        <div class="lore-big-seal">${esc(state.surname || key)}</div>
        <div style="flex:1;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <strong style="font-size:15px;">${esc(state.surname || key)}氏源流与堂号参考（馆藏 ${totalCnt.toLocaleString()} 部）</strong>
            ${slugHtml}
          </div>
          <p style="font-size:12.5px;color:var(--ink-mid);margin-top:2px;">${esc(info.origin)}</p>
        </div>
      </div>
      <div class="lore-meta-grid" style="padding-top:8px;font-size:12.5px;">
        <div><strong>始祖：</strong>${esc(info.ancestor)}</div>
        <div><strong>郡望：</strong>${esc(info.junwang)}</div>
        <div><strong>堂号：</strong>${esc(info.halls)}</div>
        <div><strong>字辈参考：</strong>${esc(info.zibei)}</div>
      </div>
    `;
  }

  function updateSeoAndUrl() {
    const params = new URLSearchParams();
    if (state.surname) params.set("surname", state.surname);
    if (state.provIdx >= 0) params.set("prov", state.meta.provinces[state.provIdx].name);
    if (state.region) params.set("region", state.region);
    if (state.hall) params.set("hall", state.hall);
    if (state.genre) params.set("genre", state.genre);
    if (state.q.trim()) params.set("q", state.q.trim());

    const qs = params.toString();
    const newUrl = qs ? `${location.pathname}?${qs}` : location.pathname;
    window.history.replaceState(null, "", newUrl);

    const baseTitle = state.cfg?.site_title || "古籍家谱电子书目录";
    if (state.surname) {
      const locStr = state.provIdx >= 0 ? state.meta.provinces[state.provIdx].name + state.region : state.region;
      document.title = `${locStr}${state.surname}氏家谱目录（${state.filtered.length}部） - ${baseTitle}`;
    } else {
      document.title = baseTitle;
    }

    const hasAny = Boolean(state.surname || state.provIdx >= 0 || state.region || state.hall || state.genre || state.q.trim());
    if ($("clearFilterBtn")) $("clearFilterBtn").style.display = hasAny ? "inline-block" : "none";
  }

  function renderSurnames() {
    $("topSurnameList").innerHTML = state.meta.top_surnames
      .map((it) => {
        const cls = state.surname === it.s ? "active" : "";
        return `<button class="pill-btn ${cls}" data-s="${esc(it.s)}"><strong>${esc(it.s)}</strong><small>${it.c}</small></button>`;
      })
      .join("");

    const azGroups = state.meta.alpha_surnames || {};
    const letters = Object.keys(azGroups);
    if (!letters.includes(state.activeAz) && letters.length) state.activeAz = letters[0];

    $("azTabs").innerHTML = letters
      .map((l) => `<button class="az-tab ${state.activeAz === l ? "active" : ""}" data-az="${esc(l)}">${esc(l)}</button>`)
      .join("");

    const sub = azGroups[state.activeAz] || [];
    $("azSurnameList").innerHTML = sub
      .map((it) => {
        const cls = state.surname === it.s ? "active" : "";
        return `<button class="pill-btn ${cls}" data-s="${esc(it.s)}"><strong>${esc(it.s)}</strong><small>${it.c}</small></button>`;
      })
      .join("");
  }

  function renderBooks() {
    const grid = $("bookGrid");
    const total = state.filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;

    if (!total) {
      grid.innerHTML = `<div class="box-card" style="grid-column:1/-1;text-align:center;padding:36px 20px;">
        <div style="font-size:16px;font-weight:700;margin-bottom:6px;">当前细分条件下暂无对应书目</div>
        <p style="font-size:13px;color:var(--ink-mid);margin-bottom:14px;">
          古谱常按古县名或支派命名，建议放宽地区或分类限制查看本姓全部家谱（支持多本打包优惠）。
        </p>
        <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
          ${state.surname ? `<button class="ghost-btn" id="keepSurnameOnlyBtn" style="padding:8px 14px;">查看全部${esc(state.surname)}氏家谱</button>` : ""}
          <button class="btn-wx" id="emptyAskWxBtn" style="padding:8px 16px;font-size:13.5px;">微信咨询打包</button>
        </div>
      </div>`;
      $("pageLabel").textContent = "0 / 0";
      $("prevBtn").disabled = true;
      $("nextBtn").disabled = true;
      if ($("keepSurnameOnlyBtn")) {
        $("keepSurnameOnlyBtn").onclick = () => {
          state.provIdx = -1;
          state.region = "";
          state.hall = "";
          state.genre = "";
          state.q = "";
          if ($("qInput")) $("qInput").value = "";
          state.page = 1;
          executeFilter();
        };
      }
      if ($("emptyAskWxBtn")) {
        $("emptyAskWxBtn").onclick = () =>
          openWechatModal(`您好！我想咨询【${state.surname || ""}氏】家谱电子书及同地区打包优惠。`);
      }
      return;
    }

    const start = (state.page - 1) * state.pageSize;
    const slice = state.filtered.slice(start, start + state.pageSize);
    const showPrice = state.cfg?.show_price !== false;

    grid.innerHTML = slice
      .map((raw) => {
        const b = decodeRec(raw);
        const loc = b.region ? `${b.prov} · ${b.region}` : b.prov;
        const inBag = state.bag.has(b.skuNum);
        const badges = [];
        if (loc && loc !== "未详") badges.push(`<span class="b-tag loc">${esc(loc)}</span>`);
        if (b.hallName) badges.push(`<span class="b-tag" style="background:#fdf3e1;color:#8a5612;border-color:#ebd2a4;">${esc(b.hallName)}</span>`);
        if (b.metaTag && b.metaTag !== b.hallName) badges.push(`<span class="b-tag">${esc(b.metaTag)}</span>`);
        badges.push(`<span class="b-tag">${esc(b.fmt)} · ${b.fileCount}册 (${esc(b.sizeStr)})</span>`);

        return `<article class="book-card">
          <div class="card-top">
            <div class="clan-stamp">${esc(b.surname || "谱")}</div>
            <div class="book-main">
              <div class="book-sku">编号 ${esc(b.sku)}</div>
              <h2 class="book-name">${esc(b.title)}</h2>
              <div class="book-badges">${badges.join("")}</div>
            </div>
          </div>
          <div class="card-foot">
            <div class="price-wrap">
              ${showPrice ? `<span class="price-now">¥${b.price}</span>` : `<span style="font-size:13px;color:var(--ink-mid);">电子版</span>`}
            </div>
            <div class="card-btns">
              <button class="btn-pick ${inBag ? "picked" : ""}" data-pick="${b.skuNum}">
                ${inBag ? "✓ 已选" : "+ 选书"}
              </button>
              <button class="btn-wx" data-buy="${b.skuNum}">微信获取</button>
            </div>
          </div>
        </article>`;
      })
      .join("");

    $("pageLabel").textContent = `${state.page} / ${totalPages.toLocaleString()} 页`;
    $("prevBtn").disabled = state.page <= 1;
    $("nextBtn").disabled = state.page >= totalPages;
  }

  function calcBagTotal() {
    const items = Array.from(state.bag.values());
    const defPrice = Number(state.cfg?.default_price ?? 9.9);
    let stdCnt = 0;
    let customSum = 0;
    for (const b of items) {
      if (Math.abs(b.price - defPrice) < 0.01 && Math.abs(defPrice - 9.9) < 0.01) {
        stdCnt++;
      } else {
        customSum += b.price;
      }
    }
    const bundles = Math.floor(stdCnt / 3);
    const rem = stdCnt % 3;
    return customSum + bundles * 25 + rem * defPrice;
  }

  function updateBagUI() {
    const cnt = state.bag.size;
    const bar = $("bagBar");
    if (!cnt) {
      bar.classList.remove("show");
      return;
    }
    bar.classList.add("show");
    const total = calcBagTotal();
    $("bagCount").textContent = String(cnt);
    $("bagPrice").textContent = `¥${total.toFixed(1).replace(/\.0$/, "")}${cnt >= 3 ? " (已享打包价)" : ""}`;
  }

  function findBookInCurrentOrPool(skuNum) {
    const raw = state.filtered.find((r) => r[0] === skuNum) || (state.allPool && state.allPool.find((r) => r[0] === skuNum));
    return raw ? decodeRec(raw) : state.bag.get(skuNum);
  }

  async function openWechatModal(inquiryText) {
    state.lastInquiryText = inquiryText;
    await copyClipboard(inquiryText);

    const wx = state.cfg?.wechat || {};
    const mode = wx.mode || "both";
    const kfUrl = (wx.kf_url || "").trim();
    const wxId = (wx.wechat_id || "未设置").trim();

    $("wxOrderPreview").textContent = inquiryText;
    $("wxIdText").textContent = wxId;
    $("wxQrImg").src = wx.qr_image || "./assets/wechat-qr.svg";
    $("wxQrImg").parentElement.style.display = (!wx.qr_image || /wechat-qr\.svg/.test(wx.qr_image)) ? "none" : "";
    $("wxWorkTime").textContent = wx.work_time || "";

    const kfBtn = $("wxKfDirectBtn");
    const personalBlock = $("wxPersonalBlock");

    if (kfUrl && (mode === "both" || mode === "kf")) {
      kfBtn.style.display = "flex";
      kfBtn.href = kfUrl;
      kfBtn.textContent = wx.kf_button_text || "跳转微信在线客服";
    } else {
      kfBtn.style.display = "none";
    }

    personalBlock.style.display = mode === "kf" && kfUrl ? "none" : "block";
    $("wxBackdrop").classList.add("open");
  }

  function resetAllFilters() {
    clearSurnameWarn();
    state.surname = "";
    state.provIdx = -1;
    state.region = "";
    state.hall = "";
    state.genre = "";
    state.q = "";
    state.page = 1;
    $("surnameInput").value = "";
    if ($("qInput")) $("qInput").value = "";
    renderSurnames();
    executeFilter();
  }

  function setSurnameAndSync(newSurname) {
    clearSurnameWarn();
    state.surname = normalizeSurnameInput(newSurname);
    $("surnameInput").value = state.surname;
    state.hall = "";
    state.genre = "";
    state.page = 1;
    renderSurnames();
    executeFilter();
  }

  function bindEvents() {
    let surnameTimer = null;
    $("surnameInput").addEventListener("input", (e) => {
      clearSurnameWarn();
      clearTimeout(surnameTimer);
      surnameTimer = setTimeout(() => {
        const nextS = normalizeSurnameInput(e.target.value);
        if (nextS !== state.surname) {
          state.surname = nextS;
          state.hall = "";
          state.genre = "";
          state.page = 1;
          renderSurnames();
          executeFilter();
        }
      }, 160);
    });

    const triggerPrimarySearch = () => {
      clearTimeout(surnameTimer);
      const nextS = normalizeSurnameInput($("surnameInput").value);
      if (!nextS) {
        showSurnameWarn();
        return;
      }
      clearSurnameWarn();
      state.surname = nextS;
      if ($("qInput")) state.q = $("qInput").value;
      state.page = 1;
      renderSurnames();
      executeFilter();
    };

    $("surnameInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") triggerPrimarySearch();
    });

    $("qBtn").onclick = triggerPrimarySearch;

    $("selProv").onchange = (e) => {
      state.provIdx = e.target.value === "" ? -1 : Number(e.target.value);
      state.region = "";
      state.page = 1;
      if (!state.surname) {
        // 还没输必填姓氏时，先更新地区下拉框并轻提示输入姓氏
        if (state.allPool) rebuildCascadingControls(state.allPool);
        showSurnameWarn();
        return;
      }
      executeFilter();
    };

    $("selRegion").onchange = (e) => {
      state.region = e.target.value;
      state.page = 1;
      if (!state.surname) {
        showSurnameWarn();
        return;
      }
      executeFilter();
    };

    if ($("qInput")) {
      let qTimer = null;
      $("qInput").addEventListener("input", (e) => {
        clearTimeout(qTimer);
        qTimer = setTimeout(() => {
          state.q = e.target.value;
          state.page = 1;
          executeFilter();
        }, 200);
      });
    }

    if ($("sortSelect")) {
      $("sortSelect").onchange = (e) => {
        state.sortBy = e.target.value;
        state.page = 1;
        executeFilter();
      };
    }

    $("resetConsoleBtn").onclick = resetAllFilters;
    $("clearFilterBtn").onclick = resetAllFilters;

    document.body.addEventListener("click", (e) => {
      const sBtn = e.target.closest("[data-s]");
      if (sBtn) {
        const s = sBtn.dataset.s;
        setSurnameAndSync(state.surname === s ? "" : s);
        return;
      }

      const azBtn = e.target.closest("[data-az]");
      if (azBtn) {
        state.activeAz = azBtn.dataset.az;
        renderSurnames();
        return;
      }

      // 下方直接点击的【堂号】与【谱类】标签
      const fHall = e.target.closest("[data-f-hall]");
      if (fHall) {
        const nextVal = fHall.dataset.fHall;
        state.hall = state.hall === nextVal ? "" : nextVal;
        state.page = 1;
        executeFilter();
        return;
      }

      const fGenre = e.target.closest("[data-f-genre]");
      if (fGenre) {
        const nextVal = fGenre.dataset.fGenre;
        state.genre = state.genre === nextVal ? "" : nextVal;
        state.page = 1;
        executeFilter();
        return;
      }

      const pickBtn = e.target.closest("[data-pick]");
      if (pickBtn) {
        const num = Number(pickBtn.dataset.pick);
        if (state.bag.has(num)) {
          state.bag.delete(num);
        } else {
          const b = findBookInCurrentOrPool(num);
          if (b) state.bag.set(num, b);
        }
        renderBooks();
        updateBagUI();
        return;
      }

      const buyBtn = e.target.closest("[data-buy]");
      if (buyBtn) {
        const num = Number(buyBtn.dataset.buy);
        const b = findBookInCurrentOrPool(num);
        if (b) {
          const loc = b.region ? `${b.prov}${b.region}` : b.prov;
          const priceStr = state.cfg?.show_price !== false ? `（¥${b.price}）` : "";
          const msg =
            `您好！我想获取这部家谱电子书${priceStr}：\n` +
            `【${b.sku}】《${b.title}》\n` +
            `谱籍：${loc} ｜ 规格：${b.fmt}（${b.fileCount}册，${b.sizeStr}）`;
          openWechatModal(msg);
        }
      }
    });

    $("toggleAzBtn").onclick = () => {
      const box = $("azDrawer");
      const open = box.style.display === "none";
      box.style.display = open ? "block" : "none";
      $("toggleAzBtn").textContent = open ? "收起姓氏表" : `全部 ${state.meta.total_surnames} 姓 (A-Z)`;
    };

    $("shareLinkBtn").onclick = async () => {
      await copyClipboard(window.location.href);
      $("shareLinkBtn").textContent = "已复制链接";
      setTimeout(() => ($("shareLinkBtn").textContent = "复制书目链接"), 2000);
    };

    $("prevBtn").onclick = () => {
      if (state.page > 1) {
        state.page--;
        renderBooks();
        window.scrollTo({ top: 220, behavior: "smooth" });
      }
    };
    $("nextBtn").onclick = () => {
      state.page++;
      renderBooks();
      window.scrollTo({ top: 220, behavior: "smooth" });
    };

    $("fabWechatBtn").onclick = () => {
      const hint = state.surname ? `（想查 ${state.surname}氏 家谱）` : "";
      openWechatModal(`您好！我想咨询家谱电子书${hint}。`);
    };

    $("clearBagBtn").onclick = () => {
      state.bag.clear();
      renderBooks();
      updateBagUI();
    };

    $("checkoutBagBtn").onclick = () => {
      const items = Array.from(state.bag.values());
      const sum = calcBagTotal();
      const lines = items.map((b, i) => `${i + 1}. 【${b.sku}】《${b.title}》`);
      const bundleTag = items.length >= 3 ? "（已按满3部¥25打包优惠计价）" : "";
      const msg =
        `您好！我选好了以下 ${items.length} 部家谱电子书，合计 ¥${sum.toFixed(1).replace(/\.0$/, "")}${bundleTag}：\n` +
        lines.join("\n") +
        `\n麻烦发一下收款码与网盘链接。`;
      openWechatModal(msg);
    };

    $("closeWxModalBtn").onclick = () => $("wxBackdrop").classList.remove("open");
    $("wxBackdrop").onclick = (e) => {
      if (e.target === $("wxBackdrop")) $("wxBackdrop").classList.remove("open");
    };

    $("copyWxIdOnlyBtn").onclick = async () => {
      const wxId = state.cfg?.wechat?.wechat_id || "";
      await copyClipboard(wxId);
      $("wxCopiedBanner").textContent = `已复制微信号「${wxId}」，请去微信添加`;
    };

    $("openWeixinAppBtn").onclick = async () => {
      const wxId = state.cfg?.wechat?.wechat_id || "";
      await copyClipboard(wxId);
      $("wxCopiedBanner").textContent = `已复制微信号「${wxId}」，正在拉起微信…`;
      window.location.href = "weixin://";
    };

    $("copyInquiryAgainBtn").onclick = async () => {
      await copyClipboard(state.lastInquiryText);
      $("wxCopiedBanner").textContent = "已重新复制书名与编号，去微信粘贴即可";
    };

    if ($("bundleAskBtn")) {
      $("bundleAskBtn").onclick = () => {
        const parts = [];
        if (state.surname) parts.push(`${state.surname}氏`);
        if (state.provIdx >= 0) parts.push(state.meta.provinces[state.provIdx].name);
        if (state.region) parts.push(state.region);
        const scope = parts.length ? `【${parts.join(" · ")}】` : "同县/同姓多部";
        openWechatModal(`您好！我想咨询${scope}家谱电子书的打包优惠价格。`);
      };
    }
  }

  async function init() {
    const [cfgRes, metaRes, loreRes] = await Promise.all([
      fetch("./site-config.json?t=" + Date.now()),
      fetch("./data/meta.json?t=" + Date.now()),
      fetch("./data/lore.json?t=" + Date.now()).catch(() => null),
    ]);
    state.cfg = await cfgRes.json();
    state.meta = await metaRes.json();
    state.lore = loreRes && loreRes.ok ? await loreRes.json() : { surnames: {}, prov_links: {}, articles: [] };

    const [tStr, sStr] = state.meta.trad_map || ["", ""];
    for (let i = 0; i < tStr.length; i++) state.tradDict[tStr[i]] = sStr[i];

    if ($("homeArticlesGrid") && state.lore.articles?.length) {
      $("homeArticlesGrid").innerHTML = state.lore.articles
        .map(
          (a) => `<a class="topic-card" href="${esc(a.slug)}">
            <div>
              <span class="b-tag loc">${esc(a.tag)}</span>
              <h3>${esc(a.title)}</h3>
              <p>${esc(a.summary)}</p>
            </div>
            <div style="margin-top:10px;font-size:12px;color:var(--cinnabar);">阅读全文 →</div>
          </a>`
        )
        .join("");
    }

    if ($("footerProvLinks") && state.lore.prov_links) {
      $("footerProvLinks").innerHTML = state.meta.provinces
        .filter((p) => state.lore.prov_links[p.name])
        .map(
          (p) => `<a class="pill-btn" style="text-decoration:none;font-size:12px;" href="${esc(state.lore.prov_links[p.name])}">${esc(p.name)} <small>${p.count}</small></a>`
        )
        .join("");
    }

    if (state.cfg.site_title) {
      $("siteTitle").textContent = state.cfg.site_title;
      if ($("navBrandText")) $("navBrandText").textContent = state.cfg.site_title;
    }
    if (state.cfg.site_subtitle) $("siteSubtitle").textContent = state.cfg.site_subtitle;
    if (state.cfg.bundle_tip && $("footerBundleTip")) $("footerBundleTip").textContent = state.cfg.bundle_tip;

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("surname")) {
      state.surname = normalizeSurnameInput(urlParams.get("surname"));
      $("surnameInput").value = state.surname;
    }
    if (urlParams.get("prov")) {
      const pv = urlParams.get("prov");
      const idx = state.meta.provinces.findIndex((x) => x.name === pv);
      if (idx >= 0) state.provIdx = idx;
    }
    if (urlParams.get("region")) state.region = urlParams.get("region");
    if (urlParams.get("hall")) state.hall = urlParams.get("hall");
    if (urlParams.get("genre")) state.genre = urlParams.get("genre");
    if (urlParams.get("q") && $("qInput")) {
      state.q = urlParams.get("q");
      $("qInput").value = state.q;
    }

    bindEvents();
    renderSurnames();
    await executeFilter();

    setTimeout(() => {
      fetchAllPool(true).then(() => {
        if (!state.surname && state.provIdx < 0) {
          rebuildCascadingControls(state.allPool);
        }
      });
    }, 500);
  }

  init();
})();
