/* X Timeline — a Twitter/X style timeline for SillyTavern.
 * Loads as a plain third-party extension script: no imports, only the
 * SillyTavern context object, so it also runs in the visual test harness.
 */
'use strict';

const MODULE_NAME = 'x_timeline';
const ROOT_ID = 'xt-root';
const META_KEY = MODULE_NAME;
const VERSION = '0.2.0';
const MAX_POST_LEN = 280;
const MAX_POSTS = 300;

const DEFAULT_SETTINGS = Object.freeze({
    autoSync: true,
    syncEvery: 2,
    maxPosts: 3,
    autoImage: false,
    imageChance: 45,
    imageStyle: 'anime illustration, cinematic lighting, detailed, no text, no watermark',
    imageWidth: 832,
    imageHeight: 1216,
    fakeMetrics: true,
    contextMessages: 4,
    customPrompt: '',
    autoRefresh: true,
    refreshInterval: 60,
    useCustomApi: false,
    apiBaseUrl: '',
    apiKey: '',
    apiModel: '',
    apiTemperature: 0.9,
    apiMaxTokens: 900,
    imageProvider: 'auto',
    saveToBaiBaiGallery: false,
    dmAutoReply: true,
});

const X_LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';

const VERIFIED = '<svg class="xt-verified" viewBox="0 0 24 24" aria-label="已认证"><path fill="#1d9bf0" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81C14.67 2.63 13.43 1.75 12 1.75s-2.67.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/></svg>';

const el = {};
let state = null;
let memoryState = newState();
let settings = null;
let toastTimer = 0;

const ui = {
    open: false,
    view: 'home',
    tab: 'for-you',
    threadId: null,
    profileKey: null,
    search: '',
    returnTo: null,
    syncing: false,
    syncError: '',
    genReplies: false,
    sheetPostId: null,
    bootstrapped: false,
    composer: { open: false, replyTo: null, accountKey: null },
    editKey: null,
    editAvatar: '',
    dmKey: null,
    dmTyping: false,
};

const imageQueue = [];
let imageRunning = false;

/* ------------------------------------------------------------------ */
/* Utilities                                                          */
/* ------------------------------------------------------------------ */

function ctx() {
    return SillyTavern.getContext();
}

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}

function escAttr(value) {
    return esc(value);
}

function uid() {
    try {
        if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    } catch { /* ignore */ }
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randf(min, max) {
    return Math.random() * (max - min) + min;
}

function hashHue(text) {
    let hash = 0;
    const str = String(text || '');
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) % 360;
    return hash;
}

function firstChar(name) {
    const chars = Array.from(String(name || '?').trim());
    return chars[0] || '?';
}

function fmtCount(n) {
    const num = Number(n) || 0;
    if (num >= 1e8) return `${(num / 1e8).toFixed(1).replace(/\.0$/, '')}亿`;
    if (num >= 1e4) return `${(num / 1e4).toFixed(1).replace(/\.0$/, '')}万`;
    return String(Math.round(num)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function timeAgo(ts) {
    const diff = Date.now() - Number(ts || 0);
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}天`;
    const date = new Date(Number(ts));
    if (date.getFullYear() === new Date().getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function fullDate(ts) {
    const date = new Date(Number(ts) || Date.now());
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${hh}:${mm}`;
}

function stripHtml(value) {
    return String(value || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function cleanModelText(raw) {
    return String(raw || '')
        .replace(/<think[\s\S]*?<\/think>/gi, '')
        .replace(/```(?:json)?/gi, '')
        .replace(/```/g, '')
        .trim();
}

function extractJson(raw) {
    const text = cleanModelText(raw);
    const start = text.indexOf('{');
    if (start < 0) throw new Error('模型没有返回 JSON');
    const candidate = scanBalancedJson(text, start);
    if (!candidate) throw new Error('模型返回的 JSON 不完整');
    try {
        return JSON.parse(candidate);
    } catch {
        throw new Error('无法解析模型返回的 JSON');
    }
}

function scanBalancedJson(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return '';
}

function cleanPostText(raw) {
    let text = String(raw || '').replace(/\r\n?/g, '\n').trim();
    text = text.replace(/^["“「『]+|["”」』]+$/g, '').trim();
    text = text.replace(/^推文[:：]\s*/, '');
    if (Array.from(text).length > MAX_POST_LEN) {
        text = Array.from(text).slice(0, MAX_POST_LEN - 1).join('') + '…';
    }
    return text;
}

function cleanHandle(value) {
    return String(value || '')
        .replace(/^@+/, '')
        .replace(/[^A-Za-z0-9_]/g, '')
        .slice(0, 15);
}

function handleFromFile(file) {
    const base = String(file || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    return cleanHandle(base);
}

function sanitizeImagePrompt(value) {
    return String(value || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/[|{}"]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1200);
}

function icon(name) {
    const paths = {
        home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
        users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.14.38.4.7.73.94.33.23.72.36 1.12.36H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"/>',
        close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
        back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
        sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M3 21v-5h5"/><path d="M21 3v5h-5"/>',
        sparkle: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/>',
        reply: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-3.8-.8L3 21l1.9-4.7A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z"/>',
        repost: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
        heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8Z"/>',
        bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
        share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
        more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
        image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
        compose: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
        check: '<path d="M20 6 9 17l-5-5"/>',
        calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
        copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
        trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/>',
        pin: '<path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
        views: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/>',
        alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
        mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
        send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    };
    return `<svg class="xt-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.home}</svg>`;
}

/* ------------------------------------------------------------------ */
/* Settings & state                                                   */
/* ------------------------------------------------------------------ */

function loadSettings() {
    const c = ctx();
    c.extensionSettings[MODULE_NAME] = c.extensionSettings[MODULE_NAME] || {};
    const store = c.extensionSettings[MODULE_NAME];
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (store[key] === undefined) store[key] = value;
    }
    return store;
}

function saveSettings() {
    try { ctx().saveSettingsDebounced(); } catch { /* ignore */ }
}

function customApiReady() {
    return Boolean(settings?.useCustomApi && String(settings.apiBaseUrl || '').trim() && String(settings.apiModel || '').trim());
}

function chatEndpoint() {
    const base = String(settings.apiBaseUrl || '').trim().replace(/\/+$/, '');
    return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
}

async function callModel(prompt, { responseLength = 600 } = {}) {
    if (customApiReady()) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 75000);
        try {
            const response = await fetch(chatEndpoint(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(String(settings.apiKey || '').trim() ? { Authorization: `Bearer ${String(settings.apiKey).trim()}` } : {}),
                },
                body: JSON.stringify({
                    model: String(settings.apiModel).trim(),
                    messages: [{ role: 'user', content: prompt }],
                    temperature: Math.min(2, Math.max(0, Number(settings.apiTemperature) || 0.9)),
                    max_tokens: Math.max(64, Number(settings.apiMaxTokens) || responseLength || 600),
                }),
                signal: controller.signal,
            });
            const text = await response.text();
            if (!response.ok) {
                let detail = text.slice(0, 180);
                try { detail = JSON.parse(text)?.error?.message || detail; } catch { /* keep raw */ }
                throw new Error(`独立 API ${response.status}：${detail}`);
            }
            const data = JSON.parse(text);
            const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';
            if (!String(content).trim()) throw new Error('独立 API 返回了空内容');
            return String(content);
        } catch (error) {
            if (error?.name === 'AbortError') throw new Error('独立 API 请求超时');
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }
    return ctx().generateQuietPrompt({ quietPrompt: prompt, responseLength, quietToLoud: false });
}

async function testModelApi() {
    toast(customApiReady() ? '正在测试独立 API…' : '正在测试酒馆主 API…');
    try {
        const raw = await callModel('只回复 OK 两个字母，不要标点或解释。', { responseLength: 32 });
        toast(`API 可用：${String(raw).trim().slice(0, 24)}`);
    } catch (error) {
        toast(`API 测试失败：${String(error?.message || error).slice(0, 100)}`, true);
    }
}

function baiBaiApi() {
    const api = globalThis.STBaiBaiImage;
    return api && Number(api.apiVersion) === 1 ? api : null;
}

function baiBaiStatus() {
    const api = baiBaiApi();
    if (!api) return null;
    try { return api.getBackendStatus(); } catch { return null; }
}

function baiBaiLabel() {
    const status = baiBaiStatus();
    if (!status) return '未检测到柏宝绘';
    if (!status.configured) return `柏宝绘未配置${status.reason ? `（${status.reason}）` : ''}`;
    return `柏宝绘 · ${status.backend === 'nai' ? 'NovelAI' : status.backend === 'comfyui' ? 'ComfyUI' : status.backend}${status.model ? ` · ${status.model}` : ''}`;
}

function baiBaiErrorText(error) {
    const code = String(error?.code || '');
    if (code === 'not_configured') return '柏宝绘尚未配置生图后端';
    if (code === 'rate_limited') return '柏宝绘正在限流，请稍后重试';
    if (code === 'backend_error') return '柏宝绘后端生成失败';
    if (code === 'invalid_args') return '柏宝绘提示词无效';
    if (code === 'aborted') return '生成已取消';
    return String(error?.message || error || '柏宝绘生成失败').slice(0, 140);
}

function newState() {
    return {
        version: 2, accounts: {}, posts: [], lastMesId: -1, unread: 0, createdAt: Date.now(),
        dms: {}, trends: [], trendLocation: '',
    };
}

function persist() {
    try { ctx().saveMetadataDebounced(); } catch { /* ignore */ }
}

function getState() {
    const c = ctx();
    let st = null;
    if (c.chatMetadata && typeof c.chatMetadata === 'object') {
        st = c.chatMetadata[META_KEY];
        if (!st || typeof st !== 'object') {
            st = newState();
            c.chatMetadata[META_KEY] = st;
        }
    } else {
        st = memoryState;
    }
    st.accounts = st.accounts && typeof st.accounts === 'object' && !Array.isArray(st.accounts) ? st.accounts : {};
    st.posts = Array.isArray(st.posts) ? st.posts : [];
    st.lastMesId = typeof st.lastMesId === 'number' ? st.lastMesId : -1;
    st.unread = typeof st.unread === 'number' ? st.unread : 0;
    st.dms = st.dms && typeof st.dms === 'object' && !Array.isArray(st.dms) ? st.dms : {};
    st.trends = Array.isArray(st.trends) ? st.trends : [];
    st.trendLocation = typeof st.trendLocation === 'string' ? st.trendLocation : '';
    st.version = 2;
    state = st;
    memoryState = st;
    ensureCoreAccounts(st);
    return st;
}

/* ------------------------------------------------------------------ */
/* Accounts                                                           */
/* ------------------------------------------------------------------ */

function coreCharacters() {
    const c = ctx();
    if (c.groupId) {
        const group = (c.groups || []).find(g => String(g.id) === String(c.groupId));
        if (Array.isArray(group?.members) && group.members.length) {
            return group.members
                .map(avatar => (c.characters || []).find(ch => ch.avatar === avatar))
                .filter(Boolean);
        }
    }
    const ch = (c.characters || [])[Number(c.characterId)];
    return ch ? [ch] : [];
}

function randomJoined() {
    const year = rand(2018, 2024);
    const month = rand(1, 12);
    return `${year}年${month}月`;
}

function uniqueHandle(base, exceptKey) {
    const clean = cleanHandle(base) || 'user';
    const taken = new Set(Object.values(state?.accounts || {})
        .filter(acc => acc.key !== exceptKey)
        .map(acc => String(acc.handle || '').toLowerCase()));
    let candidate = clean;
    let suffix = 1;
    while (taken.has(candidate.toLowerCase())) {
        candidate = `${clean.slice(0, 12)}${++suffix}`;
    }
    return candidate;
}

function makeAccount(key, name, kind, bio = '', preferredHandle = '') {
    const hue = hashHue(`${key}:${name}`);
    const baseHandle = cleanHandle(preferredHandle) || cleanHandle(name) || cleanHandle(key) || 'user';
    return {
        key,
        name: String(name || '无名').slice(0, 40),
        handle: uniqueHandle(baseHandle, key),
        kind,
        bio: String(bio || '').slice(0, 160),
        hue,
        verified: kind === 'char',
        followers: kind === 'user' ? rand(120, 980) : rand(900, 48000),
        followingCount: rand(70, 980),
        joined: randomJoined(),
        following: true,
        avatarType: kind === 'user' ? 'persona' : (kind === 'char' ? 'char' : ''),
        avatarFile: '',
        charAvatar: '',
        customAvatar: '',
        location: '',
    };
}

function ensureCoreAccounts(st) {
    const c = ctx();
    const personaName = c.name1 || '你';
    const personaFile = c.powerUserSettings?.personas?.[personaName] || '';
    let user = Object.values(st.accounts).find(acc => acc.kind === 'user');
    if (!user) {
        user = makeAccount('user', personaName, 'user', '', handleFromFile(personaFile));
        st.accounts.user = user;
    }
    user.kind = 'user';
    if (!user.nameCustomized) user.name = personaName;
    user.customAvatar = user.customAvatar || '';
    user.location = user.location || st.trendLocation || '';
    user.avatarType = 'persona';
    user.avatarFile = personaFile || user.avatarFile || '';
    if (!cleanHandle(user.handle)) {
        user.handle = uniqueHandle(handleFromFile(user.avatarFile) || 'you', user.key);
    }
    if (!user.bio) user.bio = '活在这个故事里的人。';

    const chars = coreCharacters();
    chars.forEach((ch, index) => {
        let acc = Object.values(st.accounts).find(a => a.kind === 'char' && a.charAvatar === ch.avatar);
        if (!acc) {
            let key = index === 0 ? 'char' : `char_${index + 1}`;
            if (st.accounts[key]) key = `char_${uid().slice(0, 5)}`;
            acc = makeAccount(key, ch.name, 'char', '', handleFromFile(ch.avatar));
            acc.charAvatar = ch.avatar;
            st.accounts[key] = acc;
        }
        if (!acc.nameCustomized) acc.name = ch.name || acc.name;
        acc.kind = 'char';
        acc.customAvatar = acc.customAvatar || '';
        acc.location = acc.location || '';
        acc.charAvatar = ch.avatar;
        acc.avatarType = 'char';
        acc.avatarFile = ch.avatar;
        if (!cleanHandle(acc.handle)) {
            acc.handle = uniqueHandle(handleFromFile(ch.avatar) || acc.key, acc.key);
        }
        if (acc.verified === undefined) acc.verified = true;
        if (!acc.bio) acc.bio = stripHtml(ch.description || '').slice(0, 140) || '故事里的人。';
    });
}

function avatarUrl(acc) {
    try {
        if (acc?.customAvatar) return acc.customAvatar;
        const c = ctx();
        if (acc.kind === 'user' || acc.avatarType === 'persona') {
            const file = c.powerUserSettings?.personas?.[c.name1] || acc.avatarFile;
            return file ? c.getThumbnailUrl('persona', file) : '';
        }
        const file = acc.charAvatar || acc.avatarFile;
        return file ? c.getThumbnailUrl('avatar', file) : '';
    } catch {
        return '';
    }
}

function avatarHtml(acc, size = 'md') {
    if (!acc) return '';
    const url = avatarUrl(acc);
    return `<span class="xt-avatar xt-avatar-${size}" style="--xt-hue:${Number(acc.hue) || 210}">${
        url ? `<img src="${escAttr(url)}" alt="" loading="lazy" onerror="this.remove()">` : ''
    }<span class="xt-avatar-ph">${esc(firstChar(acc.name))}</span></span>`;
}

function postAccount(post) {
    return state.accounts[post?.accountKey] || {
        key: post?.accountKey || 'unknown',
        name: '未知账号',
        handle: 'unknown',
        hue: 210,
        verified: false,
        bio: '',
    };
}

function normalizeKey(value) {
    return String(value || '').trim().replace(/\s+/g, '_').slice(0, 24);
}

function defaultAuthorKey() {
    const accounts = Object.values(state.accounts);
    return (accounts.find(acc => acc.kind === 'char')
        || accounts.find(acc => acc.kind === 'npc')
        || accounts[0])?.key || '';
}

function resolveAuthorKey(ref) {
    const raw = String(ref || '').trim();
    if (!raw) return defaultAuthorKey();
    const lower = raw.toLowerCase().replace(/^@/, '');
    for (const acc of Object.values(state.accounts)) {
        if (String(acc.key).toLowerCase() === raw.toLowerCase()) return acc.key;
        if (String(acc.handle).toLowerCase() === lower) return acc.key;
        if (String(acc.name).toLowerCase() === raw.toLowerCase()) return acc.key;
    }
    return defaultAuthorKey();
}

/* ------------------------------------------------------------------ */
/* Posts                                                              */
/* ------------------------------------------------------------------ */

function createPost(accountKey, text, extra = {}) {
    return {
        id: uid(),
        accountKey,
        text,
        createdAt: extra.createdAt || Date.now(),
        likes: extra.likes ?? 0,
        reposts: extra.reposts ?? 0,
        views: extra.views ?? 0,
        replyTo: extra.replyTo || null,
        sourceMesId: extra.sourceMesId ?? null,
        imagePrompt: extra.imagePrompt || '',
        imageUrl: '',
        imageStatus: 'idle',
        imageError: '',
        liked: false,
        reposted: false,
        bookmarked: false,
    };
}

function replyCount(postId) {
    return state.posts.filter(p => p.replyTo === postId).length;
}

/* ------------------------------------------------------------------ */
/* Init                                                               */
/* ------------------------------------------------------------------ */

function init() {
    if (ui.bootstrapped) return;
    const c = ctx();
    if (!c?.eventSource) return;
    ui.bootstrapped = true;
    settings = loadSettings();
    getState();
    injectPanel();
    injectMenu();
    registerSlashCommands();
    bindEvents();
    bindBaiBaiEvents();
    startAutoRefresh();
    updateBadge();
    if (new URLSearchParams(location.search).has('xt-open')) openPanel();
}

function injectPanel() {
    if (document.getElementById(ROOT_ID)) {
        el.root = document.getElementById(ROOT_ID);
        return;
    }
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
        <div class="xt-panel" role="dialog" aria-label="X 时间线">
            <header class="xt-topbar" id="xt-topbar"></header>
            <div class="xt-tabs" id="xt-tabs"></div>
            <main class="xt-scroll" id="xt-scroll" tabindex="-1"></main>
            <nav class="xt-bottomnav" id="xt-bottomnav"></nav>
            <button class="xt-fab" id="xt-fab" data-action="compose" aria-label="发帖">${icon('compose')}</button>
            <div class="xt-layer" id="xt-composer-layer" hidden>
                <div class="xt-composer">
                    <div class="xt-composer-top">
                        <button class="xt-text-btn" data-action="composer-close">取消</button>
                        <span class="xt-composer-title">发帖</span>
                        <span class="xt-top-actions"><button class="xt-icon-btn" data-action="composer-close" aria-label="关闭">${icon('close')}</button></span>
                    </div>
                    <div class="xt-composer-account">
                        <select id="xt-compose-account" aria-label="发布账号"></select>
                        <span class="xt-composer-reply" id="xt-compose-reply"></span>
                    </div>
                    <textarea id="xt-compose-text" placeholder="有什么新鲜事？" maxlength="280" rows="5"></textarea>
                    <label class="xt-check"><input type="checkbox" id="xt-compose-img"> <span>生成配图</span></label>
                    <input id="xt-compose-imgprompt" class="xt-input" placeholder="画面描述，留空则使用推文内容" hidden>
                    <div class="xt-composer-foot">
                        <button class="xt-ai-btn" id="xt-ai-draft">${icon('sparkle')} AI 代写</button>
                        <span class="xt-count" id="xt-count">0/280</span>
                        <button class="xt-publish" id="xt-publish" data-action="publish" disabled>发布</button>
                    </div>
                </div>
            </div>
            <div class="xt-layer" id="xt-sheet-layer" hidden></div>
            <div class="xt-layer" id="xt-edit-layer" hidden></div>
        </div>
        <div class="xt-lightbox" id="xt-lightbox" hidden></div>
        <div class="xt-toast" id="xt-toast" role="status"></div>`;
    document.body.appendChild(root);

    el.root = root;
    el.panel = root.querySelector('.xt-panel');
    el.topbar = root.querySelector('#xt-topbar');
    el.tabs = root.querySelector('#xt-tabs');
    el.scroll = root.querySelector('#xt-scroll');
    el.nav = root.querySelector('#xt-bottomnav');
    el.fab = root.querySelector('#xt-fab');
    el.composerLayer = root.querySelector('#xt-composer-layer');
    el.sheetLayer = root.querySelector('#xt-sheet-layer');
    el.editLayer = root.querySelector('#xt-edit-layer');
    el.lightbox = root.querySelector('#xt-lightbox');
    el.toast = root.querySelector('#xt-toast');
    el.composeText = root.querySelector('#xt-compose-text');
    el.composeAccount = root.querySelector('#xt-compose-account');
    el.composeReply = root.querySelector('#xt-compose-reply');
    el.composeImg = root.querySelector('#xt-compose-img');
    el.composeImgPrompt = root.querySelector('#xt-compose-imgprompt');
    el.composeCount = root.querySelector('#xt-count');
    el.publish = root.querySelector('#xt-publish');
    el.aiDraft = root.querySelector('#xt-ai-draft');

    root.addEventListener('click', onRootClick);
    root.addEventListener('input', onRootInput);
    root.addEventListener('change', onRootChange);
    root.addEventListener('keydown', onRootKeydown);
    document.addEventListener('keydown', onDocumentKeydown, true);
}

function injectMenu() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) {
        setTimeout(injectMenu, 1200);
        return;
    }
    if (document.getElementById('xt-menu-item')) return;
    const item = document.createElement('div');
    item.id = 'xt-menu-item';
    item.className = 'extension_container';
    item.innerHTML = `<div class="list-group-item flex-container flexGap5 interactable" tabindex="0" role="button" aria-label="打开 X 时间线">
        <span class="xt-wand-logo">${X_LOGO}</span>
        <span>X 时间线</span>
        <span class="xt-wand-badge" hidden></span>
    </div>`;
    menu.appendChild(item);
    item.addEventListener('click', event => {
        event.preventDefault();
        menu.style.display = 'none';
        openPanel();
    });
    updateBadge();
}

function registerSlashCommands() {
    const c = ctx();
    if (!c.SlashCommandParser || !c.SlashCommand) return;
    const exists = c.SlashCommandParser.commands?.xfeed;
    if (exists) return;
    try {
        c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
            name: 'xfeed',
            helpString: '打开 X 时间线面板（联动正文与生图）。',
            callback: async () => {
                openPanel();
                return '';
            },
        }));
        c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
            name: 'xsync',
            helpString: '打开 X 时间线并立即从最近正文同步。',
            callback: async () => {
                openPanel();
                await syncNow({ manual: true });
                return '';
            },
        }));
    } catch (error) {
        console.warn('[X Timeline] 注册斜杠命令失败', error);
    }
}

function bindBaiBaiEvents() {
    let timer = 0;
    const refresh = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { if (ui.open) render(); }, 80);
    };
    for (const target of [window, document]) {
        target.addEventListener('st-baibai-image:ready', refresh);
        target.addEventListener('st-baibai-image:changed', refresh);
    }
}

function bindEvents() {
    const c = ctx();
    const types = c.eventTypes || {};
    if (types.MESSAGE_RECEIVED) {
        c.eventSource.on(types.MESSAGE_RECEIVED, message => {
            if (message?.is_user) return;
            scheduleAutoSync();
        });
    }
    if (types.CHAT_CHANGED) {
        c.eventSource.on(types.CHAT_CHANGED, onChatChanged);
    }
}

function onChatChanged() {
    state = getState();
    lastRefreshAt = 0;
    ui.threadId = null;
    ui.profileKey = null;
    ui.view = 'home';
    ui.search = '';
    ui.syncing = false;
    ui.syncError = '';
    ui.genReplies = false;
    ui.returnTo = null;
    imageQueue.length = 0;
    updateBadge();
    if (ui.open) render({ resetScroll: true });
    if (settings.autoSync && !state.posts.length && (ctx().chat || []).length) {
        setTimeout(() => { if (!state.posts.length) syncNow({ manual: false }); }, 1600);
    }
}

let syncTimer = 0;
let refreshTimer = 0;
let lastRefreshAt = 0;

function startAutoRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
        if (!settings.autoRefresh || !ui.open || ui.syncing) return;
        const chat = ctx().chat || [];
        if (chat.length - 1 <= state.lastMesId) return;
        const fresh = chat.slice(state.lastMesId + 1).filter(m => !m.is_user).length;
        if (fresh < Math.max(1, Number(settings.syncEvery) || 2)) return;
        const interval = Math.max(20, Number(settings.refreshInterval) || 60) * 1000;
        if (Date.now() - lastRefreshAt < interval) return;
        lastRefreshAt = Date.now();
        void syncNow({ manual: false });
    }, 5000);
}

function scheduleAutoSync() {
    if (!settings.autoSync) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => maybeAutoSync(), 1200);
}

function maybeAutoSync() {
    if (!settings.autoSync || ui.syncing) return;
    const chat = ctx().chat || [];
    const last = chat.length - 1;
    if (last <= state.lastMesId) return;
    const fresh = chat.slice(state.lastMesId + 1).filter(m => !m.is_user).length;
    if (fresh < Math.max(1, Number(settings.syncEvery) || 2)) return;
    void syncNow({ manual: false });
}

/* ------------------------------------------------------------------ */
/* Panel open/close & render                                          */
/* ------------------------------------------------------------------ */

function openPanel() {
    if (!ui.bootstrapped) return;
    state = getState();
    ui.open = true;
    el.root.classList.add('xt-open');
    el.root.setAttribute('aria-hidden', 'false');
    state.unread = 0;
    persist();
    updateBadge();
    render({ resetScroll: true });
}

function closePanel() {
    if (!el.root) return;
    ui.open = false;
    el.root.classList.remove('xt-open');
    el.root.setAttribute('aria-hidden', 'true');
    closeComposer();
    closeSheet();
    closeEdit();
    closeLightbox();
}

function updateBadge() {
    const count = (Number(state?.unread) || 0) + totalDmUnread();
    const badge = document.querySelector('#xt-menu-item .xt-wand-badge');
    if (!badge) return;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count <= 0;
}

function render({ resetScroll = false } = {}) {
    if (!ui.open || !el.root) return;
    const scrollTop = el.scroll.scrollTop;
    renderTopbar();
    renderTabs();
    el.scroll.innerHTML = renderView();
    renderNav();
    el.fab.hidden = ui.view !== 'home';
    if (resetScroll) el.scroll.scrollTop = 0;
    else el.scroll.scrollTop = scrollTop;
}

function renderTopbar() {
    if (ui.view === 'home') {
        el.topbar.innerHTML = `
            <button class="xt-logo" data-action="home" aria-label="首页">${X_LOGO}</button>
            <div class="xt-top-actions">
                <button class="xt-icon-btn ${ui.syncing ? 'is-spinning' : ''}" data-action="sync-now" title="同步正文" aria-label="同步正文">${icon('sync')}</button>
                <button class="xt-icon-btn" data-action="close" title="关闭" aria-label="关闭">${icon('close')}</button>
            </div>`;
        return;
    }
    const titles = { thread: '帖子', profile: '资料', community: '社区', search: '搜索', settings: '设置', messages: '私信', dm: state.accounts[ui.dmKey]?.name || '私信' };
    el.topbar.innerHTML = `
        <button class="xt-icon-btn" data-action="back" aria-label="返回">${icon('back')}</button>
        <div class="xt-top-title">${titles[ui.view] || 'X 时间线'}</div>
        <button class="xt-icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button>`;
}

function renderTabs() {
    el.tabs.hidden = ui.view !== 'home';
    if (ui.view !== 'home') return;
    el.tabs.innerHTML = `
        <button class="xt-tab ${ui.tab === 'for-you' ? 'is-active' : ''}" data-action="tab" data-tab="for-you">为你推荐</button>
        <button class="xt-tab ${ui.tab === 'following' ? 'is-active' : ''}" data-action="tab" data-tab="following">正在关注</button>`;
}

function renderNav() {
    const items = [
        ['home', 'home', '首页'],
        ['search', 'search', '搜索'],
        ['messages', 'mail', '私信'],
        ['community', 'users', '社区'],
        ['settings', 'settings', '设置'],
    ];
    el.nav.innerHTML = items.map(([view, iconName, label]) => {
        const active = ui.view === view || (view === 'home' && (ui.view === 'thread' || ui.view === 'profile')) || (view === 'messages' && ui.view === 'dm');
        return `<button class="xt-nav-btn ${active ? 'is-active' : ''}" data-action="nav" data-view="${view}">${icon(iconName)}<span>${label}</span></button>`;
    }).join('');
}

function renderView() {
    switch (ui.view) {
        case 'thread': return renderThread();
        case 'profile': return renderProfile();
        case 'community': return renderCommunity();
        case 'search': return renderSearch();
        case 'messages': return renderMessages();
        case 'dm': return renderDM();
        case 'settings': return renderSettings();
        default: return renderHome();
    }
}

/* ------------------------------------------------------------------ */
/* Home & post rendering                                              */
/* ------------------------------------------------------------------ */

function renderHome() {
    const posts = currentFeedPosts();
    const strip = ui.syncing
        ? `<div class="xt-sync-strip"><span class="xt-spinner"></span>正在从正文同步…</div>`
        : ui.syncError
            ? `<div class="xt-sync-strip is-error">${icon('alert')}<span>同步失败：${esc(ui.syncError)}</span><button data-action="sync-now">重试</button></div>`
            : '';
    const user = state.accounts.user;
    return `<div class="xt-view xt-view-home">
        ${strip}
        <div class="xt-inline-compose">
            ${avatarHtml(user, 'md')}
            <button class="xt-inline-input" data-action="compose">有什么新鲜事？</button>
            <button class="xt-inline-post" data-action="compose">发帖</button>
        </div>
        <div class="xt-feed">${posts.length ? posts.map(renderPost).join('') : renderEmptyHome()}</div>
    </div>`;
}

function renderEmptyHome() {
    return `<div class="xt-empty">
        ${X_LOGO}
        <h3>这里还没有推文</h3>
        <p>让时间线从最近的正文里长出来。角色会用自己的口吻发帖，<br>配图则通过 SillyTavern 的 Image Generation 生成。</p>
        <button class="xt-primary" data-action="sync-now">${icon('sparkle')} 从最近剧情生成</button>
        <p class="xt-note">自动同步已${settings.autoSync ? `开启：每 ${settings.syncEvery} 条正文更新一次` : '关闭，可在设置里打开'}</p>
    </div>`;
}

function currentFeedPosts() {
    return state.posts
        .filter(post => !post.replyTo)
        .filter(post => ui.tab !== 'following' || postAccount(post).following !== false)
        .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
}

function renderPost(post, options = {}) {
    const acc = postAccount(post);
    const isMain = Boolean(options.main);
    const replies = replyCount(post.id);
    const parent = post.replyTo ? state.posts.find(p => p.id === post.replyTo) : null;
    const parentAcc = parent ? postAccount(parent) : null;
    const media = renderPostMedia(post);
    return `<article class="xt-post ${isMain ? 'is-main' : ''}" data-action="open-thread" data-id="${escAttr(post.id)}">
        <div class="xt-post-av"><button class="xt-avatar-btn" data-action="open-profile" data-key="${escAttr(acc.key)}" aria-label="查看 ${escAttr(acc.name)} 的资料">${avatarHtml(acc, 'md')}</button></div>
        <div class="xt-post-main">
            <div class="xt-head">
                <div class="xt-head-left">
                    <button class="xt-name" data-action="open-profile" data-key="${escAttr(acc.key)}">${esc(acc.name)}</button>
                    ${acc.verified ? VERIFIED : ''}
                    <span class="xt-handle">@${esc(acc.handle)}</span>
                    <span class="xt-sep">·</span>
                    <span class="xt-time">${timeAgo(post.createdAt)}</span>
                </div>
                <button class="xt-more" data-action="sheet" data-id="${escAttr(post.id)}" aria-label="更多">${icon('more')}</button>
            </div>
            ${parent ? `<div class="xt-reply-hint">回复 <button class="xt-inline-link" data-action="open-profile" data-key="${escAttr(parent.accountKey)}">@${esc(parentAcc?.handle || '')}</button></div>` : ''}
            <div class="xt-text">${linkify(post.text)}</div>
            ${media}
            <div class="xt-actions">
                <button class="xt-act" data-action="open-thread" data-id="${escAttr(post.id)}" data-focus="replies" title="查看评论">${icon('reply')}<span>${replies || ''}</span></button>
                <button class="xt-act xt-act-repost ${post.reposted ? 'is-reposted' : ''}" data-action="repost" data-id="${escAttr(post.id)}" title="转发">${icon('repost')}<span>${post.reposts || ''}</span></button>
                <button class="xt-act xt-act-like ${post.liked ? 'is-liked' : ''}" data-action="like" data-id="${escAttr(post.id)}" title="喜欢">${icon('heart')}<span>${post.likes || ''}</span></button>
                <button class="xt-act ${post.bookmarked ? 'is-bookmarked' : ''}" data-action="bookmark" data-id="${escAttr(post.id)}" title="收藏">${icon('bookmark')}</button>
                <button class="xt-act" data-action="share" data-id="${escAttr(post.id)}" title="复制">${icon('share')}</button>
                <span class="xt-views">${icon('views')}${post.views ? fmtCount(post.views) : ''}</span>
            </div>
            ${isMain ? `<div class="xt-stats">${fmtCount(post.views)} 次查看 · ${fmtCount(post.likes)} 次喜欢 · ${fullDate(post.createdAt)}</div>` : ''}
        </div>
    </article>`;
}

function renderPostMedia(post) {
    if (post.imageUrl) {
        return `<div class="xt-media" data-action="open-image" data-id="${escAttr(post.id)}">
            <img src="${escAttr(post.imageUrl)}" alt="" loading="lazy">
        </div>`;
    }
    if (post.imageStatus === 'loading' || post.imageStatus === 'queued') {
        return `<div class="xt-media is-loading" data-action="regen-image" data-id="${escAttr(post.id)}">
            <div class="xt-shimmer"></div>
            <span class="xt-media-note">${esc(imageProgressText(post.imageProgress || (post.imageStatus === 'queued' ? 'queued' : 'generating')))}</span>
        </div>`;
    }
    if (post.imageStatus === 'error') {
        return `<div class="xt-media is-error" data-action="regen-image" data-id="${escAttr(post.id)}">
            <span class="xt-media-note">配图失败 · 点击重试</span>
            ${post.imageError ? `<small class="xt-media-sub">${esc(post.imageError)}</small>` : ''}
        </div>`;
    }
    if (post.imagePrompt) {
        return `<button class="xt-media-add" data-action="regen-image" data-id="${escAttr(post.id)}">${icon('image')} 生成配图</button>`;
    }
    return '';
}

function linkify(text) {
    const safe = esc(text);
    return safe
        .replace(/(#[\p{L}\p{N}_]{1,30})/gu, (match) => `<button class="xt-tag" data-action="search-tag" data-tag="${escAttr(match.slice(1))}">${match}</button>`)
        .replace(/(@[A-Za-z0-9_]{2,15})/g, (match) => `<button class="xt-tag" data-action="open-mention" data-handle="${escAttr(match.slice(1))}">${match}</button>`);
}

/* ------------------------------------------------------------------ */
/* Thread                                                             */
/* ------------------------------------------------------------------ */

function renderThread() {
    const post = state.posts.find(p => p.id === ui.threadId);
    if (!post) {
        return `<div class="xt-empty"><h3>帖子不存在</h3><p>它可能已经被删除。</p><button class="xt-primary" data-action="home">返回首页</button></div>`;
    }
    const parent = post.replyTo ? state.posts.find(p => p.id === post.replyTo) : null;
    const replies = state.posts.filter(p => p.replyTo === post.id).sort((a, b) => a.createdAt - b.createdAt);
    return `<div class="xt-view xt-view-thread">
        ${parent ? `<div class="xt-parent">${renderPost(parent, { compact: true })}</div><div class="xt-thread-line"></div>` : ''}
        ${renderPost(post, { main: true })}
        <div class="xt-thread-bar">
            <button class="xt-primary" data-action="reply" data-id="${escAttr(post.id)}">${icon('reply')} 回复</button>
            <button class="xt-ghost" data-action="ai-replies" data-id="${escAttr(post.id)}" ${ui.genReplies ? 'disabled' : ''}>${icon('sparkle')} ${ui.genReplies ? '正在生成…' : '让时间线回应'}</button>
        </div>
        <div class="xt-replies-head">回复${replies.length ? ` ${replies.length}` : ''}</div>
        ${replies.length ? replies.map(reply => renderPost(reply)).join('') : '<div class="xt-none">还没有回复</div>'}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Profile                                                            */
/* ------------------------------------------------------------------ */

function renderProfile() {
    const acc = state.accounts[ui.profileKey];
    if (!acc) {
        return `<div class="xt-empty"><h3>找不到这个账号</h3><button class="xt-primary" data-action="home">返回首页</button></div>`;
    }
    const isSelf = acc.kind === 'user';
    const posts = state.posts
        .filter(post => post.accountKey === acc.key && !post.replyTo)
        .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
    return `<div class="xt-view xt-view-profile">
        <div class="xt-banner" style="--xt-hue:${Number(acc.hue) || 210}"></div>
        <div class="xt-profile-row">
            ${avatarHtml(acc, 'xl')}
            <div class="xt-profile-btns">
                ${isSelf ? '' : `<button class="xt-follow-btn ${acc.following !== false ? 'is-following' : ''}" data-action="follow" data-key="${escAttr(acc.key)}">${acc.following !== false ? '正在关注' : '关注'}</button>`}
                ${isSelf
                    ? `<button class="xt-ghost" data-action="edit-profile" data-key="${escAttr(acc.key)}">编辑资料</button>`
                    : `<button class="xt-ghost" data-action="dm-open" data-key="${escAttr(acc.key)}">${icon('mail')} 私信</button>`}
            </div>
        </div>
        <div class="xt-profile-info">
            <div class="xt-profile-name">${esc(acc.name)} ${acc.verified ? VERIFIED : ''}</div>
            <div class="xt-profile-handle">@${esc(acc.handle)}</div>
            <div class="xt-profile-bio">${esc(acc.bio || '这个人很神秘，什么都没有写。')}</div>
            ${acc.location ? `<div class="xt-profile-meta">${icon('pin')} ${esc(acc.location)}</div>` : ''}
            <div class="xt-profile-meta">${icon('calendar')} 加入于 ${esc(acc.joined || '很久以前')}</div>
            <div class="xt-profile-counts"><b>${fmtCount(acc.followingCount)}</b> 正在关注 <b>${fmtCount(acc.followers)}</b> 关注者</div>
        </div>
        <div class="xt-profile-tabs"><span>帖子</span></div>
        ${posts.length ? posts.map(post => renderPost(post)).join('') : '<div class="xt-none">还没有发过帖子</div>'}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Direct messages                                                    */
/* ------------------------------------------------------------------ */

function dmThread(key) {
    if (!state.dms) state.dms = {};
    if (!state.dms[key] || typeof state.dms[key] !== 'object') {
        state.dms[key] = { messages: [], unread: 0, updatedAt: 0 };
    }
    if (!Array.isArray(state.dms[key].messages)) state.dms[key].messages = [];
    if (typeof state.dms[key].unread !== 'number') state.dms[key].unread = 0;
    if (typeof state.dms[key].updatedAt !== 'number') state.dms[key].updatedAt = 0;
    return state.dms[key];
}

function friendAccounts() {
    return Object.values(state.accounts)
        .filter(acc => acc.kind !== 'user')
        .filter(acc => acc.kind === 'char' || dmThread(acc.key).messages.length || acc.following !== false)
        .sort((a, b) => {
            const ua = dmThread(a.key).updatedAt || 0;
            const ub = dmThread(b.key).updatedAt || 0;
            if (ua !== ub) return ub - ua;
            return (a.kind === 'char' ? 0 : 1) - (b.kind === 'char' ? 0 : 1);
        });
}

function totalDmUnread() {
    return Object.values(state.dms || {}).reduce((sum, thread) => sum + (Number(thread?.unread) || 0), 0);
}

function dmPreview(acc) {
    const thread = dmThread(acc.key);
    const last = thread.messages[thread.messages.length - 1];
    if (!last) return acc.kind === 'char' ? '角色卡好友 · 打个招呼' : '发一条私信';
    return `${last.from === 'me' ? '你：' : ''}${last.text}`;
}

function renderMessages() {
    const friends = friendAccounts();
    return `<div class="xt-view xt-view-messages">
        <div class="xt-section-title">私信</div>
        <p class="xt-hint">好友来自当前角色卡与群聊成员；名字、头像和简介会跟随角色卡更新。</p>
        ${friends.length ? friends.map(acc => {
            const thread = dmThread(acc.key);
            return `<div class="xt-dm-row" data-action="dm-open" data-key="${escAttr(acc.key)}">
                ${avatarHtml(acc, 'md')}
                <div class="xt-dm-main">
                    <div class="xt-dm-name">${esc(acc.name)} ${acc.verified ? VERIFIED : ''}<span class="xt-dm-time">${thread.updatedAt ? timeAgo(thread.updatedAt) : ''}</span></div>
                    <div class="xt-dm-preview ${thread.unread ? 'is-unread' : ''}">${esc(dmPreview(acc))}</div>
                </div>
                ${thread.unread ? `<span class="xt-dm-badge">${thread.unread > 9 ? '9+' : thread.unread}</span>` : ''}
            </div>`;
        }).join('') : '<div class="xt-empty"><h3>还没有好友</h3><p>打开一个角色卡或群聊，时间线会自动把他们加进好友列表。</p></div>'}
    </div>`;
}

function renderDM() {
    const acc = state.accounts[ui.dmKey];
    if (!acc) return `<div class="xt-empty"><h3>找不到这个好友</h3><button class="xt-primary" data-action="nav" data-view="messages">返回私信</button></div>`;
    const thread = dmThread(acc.key);
    const messages = thread.messages.map(msg => {
        const mine = msg.from === 'me';
        return `<div class="xt-dm-msg ${mine ? 'is-me' : ''}">
            ${mine ? '' : avatarHtml(acc, 'sm')}
            <div class="xt-dm-bubble">${esc(msg.text).replace(/\n/g, '<br>')}</div>
        </div>`;
    }).join('');
    return `<div class="xt-view xt-view-dm">
        <div class="xt-dm-head">
            ${avatarHtml(acc, 'md')}
            <div><div class="xt-dm-head-name">${esc(acc.name)} ${acc.verified ? VERIFIED : ''}</div><div class="xt-dm-head-handle">@${esc(acc.handle)}${acc.charAvatar ? ' · 角色卡好友' : ''}</div></div>
        </div>
        <div class="xt-dm-thread" id="xt-dm-thread">
            ${messages || `<div class="xt-none">和 ${esc(acc.name)} 说点什么吧</div>`}
            ${ui.dmTyping ? `<div class="xt-dm-msg"><span class="xt-dm-bubble is-typing">正在输入…</span></div>` : ''}
        </div>
        <div class="xt-dm-compose">
            <textarea id="xt-dm-input" rows="1" maxlength="500" placeholder="发一条私信…"></textarea>
            <button class="xt-primary" data-action="dm-send" aria-label="发送">${icon('send')}</button>
        </div>
    </div>`;
}

function openDM(key) {
    const acc = state.accounts[key];
    if (!acc) return;
    ui.dmKey = key;
    ui.view = 'dm';
    ui.returnTo = { view: 'messages' };
    const thread = dmThread(key);
    thread.unread = 0;
    persist();
    updateBadge();
    render({ resetScroll: true });
    scrollDmToBottom();
}

function scrollDmToBottom() {
    setTimeout(() => {
        const box = document.getElementById('xt-dm-thread');
        if (box) box.scrollTop = box.scrollHeight;
        if (el.scroll) el.scroll.scrollTop = 0;
    }, 30);
}

async function sendDM() {
    const input = document.getElementById('xt-dm-input');
    const text = String(input?.value || '').trim();
    const acc = state.accounts[ui.dmKey];
    if (!text || !acc) return;
    const thread = dmThread(acc.key);
    thread.messages.push({ id: uid(), from: 'me', text: text.slice(0, 500), at: Date.now() });
    thread.updatedAt = Date.now();
    if (input) input.value = '';
    persist();
    render();
    scrollDmToBottom();
    if (settings.dmAutoReply !== false) void requestDMReply(acc);
}

async function requestDMReply(acc) {
    if (ui.dmTyping) return;
    ui.dmTyping = true;
    if (ui.view === 'dm') render();
    scrollDmToBottom();
    try {
        const thread = dmThread(acc.key);
        const recent = thread.messages.slice(-10).map(msg => `${msg.from === 'me' ? '我' : acc.name}：${msg.text}`).join('\n');
        const chat = (ctx().chat || []).slice(-2).map(m => `${m.is_user ? (ctx().name1 || '我') : (m.name || '旁白')}：${stripHtml(m.mes).slice(0, 240)}`).join('\n');
        const prompt = `你正在扮演角色「${acc.name}」（@${acc.handle}），和用户私聊。角色简介：${acc.bio || '故事里的角色'}。
${chat ? `最近的剧情片段：\n${chat}\n` : ''}
最近私信：
${recent}

请以「${acc.name}」的口吻回复最后一条私信。要求：只输出 1-2 句自然口语，不要引号、不要旁白、不要动作描写，不要提 AI/模型/提示词；保持角色性格与当前剧情一致。`;
        const raw = await callModel(prompt, { responseLength: 240 });
        const text = cleanModelText(raw).replace(/^["“”'']|["“”'']$/g, '').trim();
        if (!text) throw new Error('没有生成有效回复');
        const now = Date.now();
        thread.messages.push({ id: uid(), from: 'them', text: text.slice(0, 500), at: now });
        thread.updatedAt = now;
        if (!(ui.open && ui.view === 'dm' && ui.dmKey === acc.key)) {
            thread.unread = (thread.unread || 0) + 1;
            if (!ui.open) state.unread = (Number(state.unread) || 0) + 1;
        }
        persist();
        updateBadge();
    } catch (error) {
        console.warn('[X Timeline] 私信回复失败', error);
        toast('私信回复失败', true);
    } finally {
        ui.dmTyping = false;
        if (ui.open) render();
        scrollDmToBottom();
    }
}

/* ------------------------------------------------------------------ */
/* Community & search                                                 */
/* ------------------------------------------------------------------ */

function renderCommunity() {
    const rank = acc => (acc.kind === 'user' ? 0 : acc.kind === 'char' ? 1 : 2);
    const accounts = Object.values(state.accounts)
        .sort((a, b) => rank(a) - rank(b) || Number(b.followers) - Number(a.followers));
    return `<div class="xt-view xt-view-community">
        <div class="xt-section-title">时间线里的账号</div>
        <p class="xt-hint">这些账号来自当前角色、群聊成员，以及剧情里出现的配角。</p>
        ${accounts.map(renderUserRow).join('')}
    </div>`;
}

function renderUserRow(acc) {
    const isSelf = acc.kind === 'user';
    return `<div class="xt-user-row" data-action="open-profile" data-key="${escAttr(acc.key)}">
        ${avatarHtml(acc, 'md')}
        <div class="xt-user-main">
            <div class="xt-user-name">${esc(acc.name)} ${acc.verified ? VERIFIED : ''}</div>
            <div class="xt-handle">@${esc(acc.handle)}</div>
            <div class="xt-user-bio">${esc(acc.bio || '')}</div>
        </div>
        ${isSelf ? '' : `<button class="xt-follow-btn ${acc.following !== false ? 'is-following' : ''}" data-action="follow" data-key="${escAttr(acc.key)}">${acc.following !== false ? '正在关注' : '关注'}</button>`}
    </div>`;
}

function renderSearch() {
    return `<div class="xt-view xt-view-search">
        <div class="xt-search-box">${icon('search')}<input id="xt-search" placeholder="搜索推文、账号或话题" value="${escAttr(ui.search)}" autocomplete="off" aria-label="搜索"></div>
        <div id="xt-search-results">${renderSearchResults()}</div>
    </div>`;
}

function localTrends() {
    const counts = collectTags();
    const seen = new Set(counts.map(([tag]) => tag));
    const extra = (Array.isArray(state.trends) ? state.trends : [])
        .map(item => typeof item === 'string' ? item.replace(/^#/, '') : String(item?.tag || '').replace(/^#/, ''))
        .filter(tag => tag && !seen.has(tag));
    for (const tag of extra.slice(0, 3)) counts.push([tag, 1]);
    const location = state.accounts?.user?.location || state.trendLocation || '当前故事';
    return { location, items: counts.slice(0, 6) };
}

function renderSearchResults() {
    const query = String(ui.search || '').trim();
    if (!query) {
        const { location, items } = localTrends();
        return `<div class="xt-section-title">正在流行</div>
            <div class="xt-trend-card">
                <div class="xt-trend-loc">${icon('pin')} ${esc(location)} · 当地趋势</div>
                ${items.length
                    ? items.map(([tag, count], index) => `<div class="xt-trend" data-action="search-tag" data-tag="${escAttr(tag)}"><small>${index + 1} · 趋势 · ${count} 条帖子</small><b>#${esc(tag)}</b></div>`).join('')
                    : '<div class="xt-trend-empty">剧情里还没有形成话题。同步几条正文，或自己发一条带 # 的帖子。</div>'}
            </div>
            <div class="xt-section-title">推荐关注</div>
            ${Object.values(state.accounts).slice(0, 5).map(renderUserRow).join('')}`;
    }
    const lower = query.toLowerCase();
    const hits = state.posts
        .filter(post => {
            const acc = postAccount(post);
            return String(post.text).toLowerCase().includes(lower)
                || String(acc.name).toLowerCase().includes(lower)
                || String(acc.handle).toLowerCase().includes(lower);
        })
        .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
        .slice(0, 40);
    return `<div class="xt-section-title">搜索结果</div>
        ${hits.length ? hits.map(post => renderPost(post)).join('') : `<div class="xt-empty"><h3>没有找到“${esc(query)}”</h3><p>换个关键词，或者先让时间线从正文里长出来。</p></div>`}`;
}

function collectTags() {
    const counts = new Map();
    for (const post of state.posts) {
        const matches = String(post.text).match(/#[\p{L}\p{N}_]{1,30}/gu) || [];
        for (const tag of matches) {
            const key = tag.slice(1);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
}

/* ------------------------------------------------------------------ */
/* Settings view                                                      */
/* ------------------------------------------------------------------ */

function renderSettings() {
    const chat = ctx().chat || [];
    const last = state.lastMesId >= 0 ? `第 ${Math.min(state.lastMesId + 1, chat.length)} 楼` : '尚未同步';
    return `<div class="xt-view xt-view-settings">
        <div class="xt-section-title">时间线</div>
        ${toggleRow('autoSync', '随正文自动更新', '每收到若干条角色消息后，让模型把剧情转成推文。')}
        ${toggleRow('autoRefresh', '定时自动刷新', '打开面板时按间隔检查新正文；关闭后只保留手动刷新。')}
        ${selectRow('refreshInterval', '自动刷新间隔', '定时检查新正文的间隔。', [[30, '30 秒'], [60, '1 分钟'], [120, '2 分钟'], [300, '5 分钟']])}
        ${selectRow('syncEvery', '同步频率', '积累多少条角色消息后同步一次。', [[1, '每 1 条'], [2, '每 2 条'], [3, '每 3 条'], [5, '每 5 条']])}
        ${selectRow('maxPosts', '每次生成数量', '单次同步最多写入几条推文。', [[1, '1 条'], [2, '2 条'], [3, '3 条']])}
        <div class="xt-field">
            <label>额外的写作要求</label>
            <div class="xt-note">会附加在同步提示词末尾，例如语气、世界观限制、不要剧透等。</div>
            <textarea data-setting="customPrompt" placeholder="可选">${esc(settings.customPrompt)}</textarea>
        </div>

        <div class="xt-section-title">配图</div>
        ${toggleRow('autoImage', '自动生成配图', '模型为推文提供画面描述时，调用生图后端。')}
        ${selectRow('imageProvider', '生图通道', '优先用柏宝绘；不可用时自动回退到 SillyTavern 的 /imagine。', [['auto', '自动'], ['baibai', '柏宝绘'], ['st', 'SillyTavern']])}
        ${toggleRow('saveToBaiBaiGallery', '保存到柏宝绘图库', '关闭时只把图片放在时间线里，不写入柏宝绘图库，避免图库膨胀。')}
        <div class="xt-setting">
            <div class="xt-setting-text">
                <div class="xt-setting-title">配图概率</div>
                <div class="xt-setting-desc">即使开启自动配图，也按这个概率决定是否真的生成。</div>
            </div>
            <div class="xt-range-wrap"><input type="range" min="0" max="100" step="5" data-setting="imageChance" value="${Number(settings.imageChance) || 0}" aria-label="配图概率"><span class="xt-range-value" id="xt-chance-value">${Number(settings.imageChance) || 0}%</span></div>
        </div>
        <div class="xt-field">
            <label>画风后缀</label>
            <div class="xt-note">追加到每条画面描述后面，用来固定画风。</div>
            <textarea data-setting="imageStyle" placeholder="anime illustration, cinematic lighting">${esc(settings.imageStyle)}</textarea>
        </div>
        <div class="xt-setting">
            <div class="xt-setting-text">
                <div class="xt-setting-title">图片尺寸</div>
                <div class="xt-setting-desc">竖图更适合手机上的时间线。</div>
            </div>
            <div class="xt-dim"><input class="xt-input" type="number" min="256" max="2048" step="64" data-setting="imageWidth" value="${Number(settings.imageWidth) || 832}" aria-label="宽"> × <input class="xt-input" type="number" min="256" max="2048" step="64" data-setting="imageHeight" value="${Number(settings.imageHeight) || 1216}" aria-label="高"></div>
        </div>
        <div class="xt-info-card">
            <div><span>柏宝绘</span><b>${esc(baiBaiLabel())}</b></div>
            <div><span>ST 生图</span><b>${esc(imageSourceLabel())}</b></div>
            <div><span>同步进度</span><b>${esc(last)}</b></div>
            <div><span>推文数量</span><b>${state.posts.length}</b></div>
        </div>
        <p class="xt-hint xt-hint-pad">配图默认先调用柏宝绘公开 API（NovelAI / ComfyUI，自动复用它的角色 tag 与并发队列）；柏宝绘未安装或失败时回退到 SillyTavern 的 <code>/imagine</code>。图像只出现在时间线里，不进入聊天楼层。</p>

        <div class="xt-section-title">独立 API</div>
        ${toggleRow('useCustomApi', '使用独立 API 生成时间线', '开启后，同步、AI 回复和私信都走下面这个 OpenAI 兼容接口，不再消耗酒馆主 API。')}
        <div class="xt-field"><label>接口地址</label><input class="xt-input" type="text" data-setting="apiBaseUrl" placeholder="https://api.openai.com/v1" value="${escAttr(settings.apiBaseUrl)}"></div>
        <div class="xt-field"><label>API Key</label><input class="xt-input" type="password" data-setting="apiKey" placeholder="sk-…（只存本地）" value="${escAttr(settings.apiKey)}"></div>
        <div class="xt-field"><label>模型名</label><input class="xt-input" type="text" data-setting="apiModel" placeholder="gpt-4o-mini / claude-sonnet-4-5 / …" value="${escAttr(settings.apiModel)}"></div>
        <div class="xt-setting">
            <div class="xt-setting-text"><div class="xt-setting-title">温度</div><div class="xt-setting-desc">越高越自由；角色口吻建议 0.8–1.0。</div></div>
            <div class="xt-range-wrap"><input type="range" min="0" max="1.5" step="0.05" data-setting="apiTemperature" value="${Number(settings.apiTemperature) || 0.9}"><span class="xt-range-value">${Number(settings.apiTemperature) || 0.9}</span></div>
        </div>
        <div class="xt-setting">
            <div class="xt-setting-text"><div class="xt-setting-title">最大输出</div><div class="xt-setting-desc">单次生成的 token 上限。</div></div>
            <div class="xt-dim"><input class="xt-input" type="number" min="64" max="4000" step="64" data-setting="apiMaxTokens" value="${Number(settings.apiMaxTokens) || 900}"></div>
        </div>
        <div class="xt-setting-actions"><button class="xt-ghost" data-action="test-api">${icon('sparkle')} 测试 API</button></div>
        <p class="xt-hint xt-hint-pad">填写到 <code>/v1</code> 即可，插件会自动拼 <code>/chat/completions</code>；也支持完整 endpoint。Key 存在扩展设置里，不会发到除该接口外的地址。</p>

        <div class="xt-section-title">高级</div>
        ${toggleRow('dmAutoReply', '私信自动回复', '给角色发私信后，让当前模型以角色口吻自动回一条。')}
        ${selectRow('contextMessages', '参考正文条数', '每次同步时，把最近多少条消息交给模型。', [[2, '2 条'], [4, '4 条'], [6, '6 条'], [8, '8 条']])}
        ${toggleRow('fakeMetrics', '模拟互动数据', '为模型生成的推文添加随机的点赞、转发与查看数。')}

        <div class="xt-setting-actions">
            <button class="xt-ghost" data-action="sync-now">${icon('sync')} 立即同步</button>
            <button class="xt-ghost" data-action="export">${icon('copy')} 导出时间线</button>
            <button class="xt-ghost xt-danger" data-action="clear">${icon('trash')} 清空时间线</button>
        </div>
        <div class="xt-footnote">X 时间线 v${VERSION} · 数据保存在当前聊天的 metadata 里 · 不修改角色卡</div>
    </div>`;
}

function toggleRow(key, title, desc) {
    return `<div class="xt-setting">
        <div class="xt-setting-text"><div class="xt-setting-title">${title}</div><div class="xt-setting-desc">${desc}</div></div>
        <label class="xt-switch"><input type="checkbox" data-setting="${key}" ${settings[key] ? 'checked' : ''}><span class="xt-slider"></span></label>
    </div>`;
}

function selectRow(key, title, desc, options) {
    return `<div class="xt-setting">
        <div class="xt-setting-text"><div class="xt-setting-title">${title}</div><div class="xt-setting-desc">${desc}</div></div>
        <select class="xt-select" data-setting="${key}">${options.map(([value, label]) => `<option value="${value}" ${String(settings[key]) === String(value) ? 'selected' : ''}>${label}</option>`).join('')}</select>
    </div>`;
}

function imageSourceLabel() {
    const source = ctx().extensionSettings?.sd?.source;
    const map = {
        novel: 'NovelAI', comfy: 'ComfyUI', auto: '自动选择', sdcpp: 'SD.cpp', vlad: 'Vlad', extras: 'Extras',
        horde: 'AI Horde', openai: 'OpenAI', aimlapi: 'AIML API', togetherai: 'Together', drawthings: 'Draw Things',
        pollinations: 'Pollinations', stability: 'Stability', huggingface: 'Hugging Face', chutes: 'Chutes',
        electronhub: 'Electron Hub', nanogpt: 'NanoGPT', bfl: 'BFL', falai: 'Fal.ai', xai: 'xAI', google: 'Google',
        zai: 'Z.AI', openrouter: 'OpenRouter', workersai: 'Workers AI',
    };
    return map[source] || (source ? String(source) : '尚未配置');
}

/* ------------------------------------------------------------------ */
/* Composer                                                           */
/* ------------------------------------------------------------------ */

function openComposer({ replyTo = null, accountKey = null } = {}) {
    if (!state) return;
    const accounts = Object.values(state.accounts);
    if (!accounts.length) return;
    ui.composer.open = true;
    ui.composer.replyTo = replyTo || null;
    ui.composer.accountKey = accountKey || state.accounts.user?.key || accounts[0].key;
    const target = replyTo ? state.posts.find(p => p.id === replyTo) : null;
    const targetAcc = target ? postAccount(target) : null;

    el.composeAccount.innerHTML = accounts.map(acc => `<option value="${escAttr(acc.key)}">${esc(acc.name)} (@${esc(acc.handle)})</option>`).join('');
    el.composeAccount.value = ui.composer.accountKey;
    el.composeReply.textContent = target ? `回复 @${targetAcc?.handle || ''}` : '';
    el.composeText.value = target ? `@${targetAcc?.handle || ''} ` : '';
    el.composeImg.checked = false;
    el.composeImgPrompt.hidden = true;
    el.composeImgPrompt.value = '';
    updateComposeCount();
    el.composerLayer.hidden = false;
    setTimeout(() => el.composeText.focus(), 40);
}

function closeComposer() {
    if (!el.composerLayer) return;
    el.composerLayer.hidden = true;
    ui.composer.open = false;
    ui.composer.replyTo = null;
}

function updateComposeCount() {
    const length = Array.from(el.composeText.value).length;
    el.composeCount.textContent = `${length}/${MAX_POST_LEN}`;
    el.composeCount.classList.toggle('is-over', length > MAX_POST_LEN);
    el.publish.disabled = length === 0 || length > MAX_POST_LEN;
}

async function publishComposer() {
    const text = cleanPostText(el.composeText.value);
    if (!text) return;
    const account = state.accounts[ui.composer.accountKey] || state.accounts.user;
    if (!account) return;
    const post = createPost(account.key, text, { replyTo: ui.composer.replyTo });
    post.imagePrompt = el.composeImg.checked
        ? sanitizeImagePrompt(el.composeImgPrompt.value || text)
        : '';
    state.posts.push(post);
    persist();
    const replyTo = ui.composer.replyTo;
    closeComposer();
    if (replyTo) {
        ui.threadId = replyTo;
        ui.view = 'thread';
    } else {
        ui.view = 'home';
    }
    render({ resetScroll: true });
    if (post.imagePrompt) enqueueImage(post);
    toast('已发布');
}

async function aiDraft() {
    const account = state.accounts[ui.composer.accountKey] || state.accounts.user;
    if (!account) return;
    const old = el.aiDraft.innerHTML;
    el.aiDraft.disabled = true;
    el.aiDraft.innerHTML = '<span class="xt-spinner"></span> 正在写…';
    try {
        const prompt = `你是「${account.name}」（@${account.handle}，${account.bio || '故事里的角色'}）。结合最近的剧情，以这个账号的口吻写一条社交媒体推文。要求：1-2 句，口语化，可以带 emoji 和 #话题；不要旁白，不要动作描写，不要引号，不超过 120 字。只输出推文正文。`;
        const raw = await callModel(prompt, { responseLength: 220 });
        const text = cleanPostText(cleanModelText(raw));
        if (text) {
            el.composeText.value = text;
            updateComposeCount();
        } else {
            toast('模型没有写出内容');
        }
    } catch (error) {
        console.warn('[X Timeline] AI 代写失败', error);
        toast('AI 代写失败', true);
    } finally {
        el.aiDraft.disabled = false;
        el.aiDraft.innerHTML = old;
    }
}

/* ------------------------------------------------------------------ */
/* Sheet, edit, lightbox                                              */
/* ------------------------------------------------------------------ */

function openSheet(postId) {
    const post = state.posts.find(p => p.id === postId);
    if (!post) return;
    ui.sheetPostId = postId;
    el.sheetLayer.innerHTML = `<div class="xt-sheet xt-modal">
        <button data-action="sheet-copy">${icon('copy')}复制推文</button>
        <button data-action="sheet-image">${icon('image')}${post.imageUrl ? '重新生成配图' : '生成配图'}</button>
        <button data-action="sheet-source" ${post.sourceMesId === null || post.sourceMesId === undefined ? 'disabled' : ''}>${icon('pin')}在正文中定位</button>
        <button data-action="sheet-delete" class="is-danger">${icon('trash')}删除这条推文</button>
        <button data-action="sheet-close" class="is-cancel">取消</button>
    </div>`;
    el.sheetLayer.hidden = false;
}

function closeSheet() {
    if (!el.sheetLayer) return;
    el.sheetLayer.hidden = true;
    el.sheetLayer.innerHTML = '';
    ui.sheetPostId = null;
}

function openEdit(key) {
    const acc = state.accounts[key];
    if (!acc) return;
    ui.editKey = key;
    ui.editAvatar = acc.customAvatar || '';
    el.editLayer.innerHTML = `<div class="xt-modal">
        <div class="xt-modal-head"><b>编辑资料</b><button class="xt-icon-btn" data-action="edit-close" aria-label="关闭">${icon('close')}</button></div>
        <div class="xt-modal-body">
            <div class="xt-edit-avatar-row">
                <div id="xt-edit-avatar-preview">${avatarHtml(acc, 'lg')}</div>
                <div class="xt-edit-avatar-actions">
                    <label class="xt-ghost xt-file-label">更换头像<input id="xt-edit-avatar-file" type="file" accept="image/*" hidden></label>
                    <button class="xt-text-btn" data-action="edit-avatar-clear">移除自定义头像</button>
                    <div class="xt-note">支持本地图片，会压缩成 256px 存在当前聊天里。</div>
                </div>
            </div>
            <label>头像链接（可选）<input id="xt-edit-avatar-url" type="url" placeholder="https://…" value="${escAttr(acc.customAvatar?.startsWith('data:') ? '' : (acc.customAvatar || ''))}"></label>
            <label>显示名称<input id="xt-edit-name" type="text" maxlength="40" value="${escAttr(acc.name)}"></label>
            <label>用户名<input id="xt-edit-handle" type="text" maxlength="15" value="${escAttr(acc.handle)}"></label>
            <label>简介<textarea id="xt-edit-bio" maxlength="160" rows="3">${esc(acc.bio || '')}</textarea></label>
            <label>所在地<input id="xt-edit-location" type="text" maxlength="40" placeholder="例如：星港 / 雾林" value="${escAttr(acc.location || '')}"></label>
            <label class="xt-check"><input type="checkbox" id="xt-edit-verified" ${acc.verified ? 'checked' : ''}> <span>显示认证标记</span></label>
            <p class="xt-note">只修改时间线里的账号，不会改动角色卡或用户设定。自定义的名称、头像和简介会保留；没有自定义的部分继续跟随角色卡与 persona。</p>
        </div>
        <div class="xt-modal-foot"><button class="xt-ghost" data-action="edit-close">取消</button><button class="xt-publish" data-action="edit-save">保存</button></div>
    </div>`;
    el.editLayer.hidden = false;
    setTimeout(() => document.getElementById('xt-edit-name')?.focus(), 40);
}

function refreshEditAvatar() {
    const acc = state.accounts[ui.editKey];
    if (!acc) return;
    const preview = document.getElementById('xt-edit-avatar-preview');
    if (!preview) return;
    const temp = { ...acc, customAvatar: ui.editAvatar };
    preview.innerHTML = avatarHtml(temp, 'lg');
}

function readAvatarFile(file) {
    return new Promise((resolve, reject) => {
        if (!file || !/^image\//.test(file.type)) return reject(new Error('请选择图片文件'));
        if (file.size > 8 * 1024 * 1024) return reject(new Error('图片不能超过 8MB'));
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('无法解析图片'));
            img.onload = () => {
                const size = 256;
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const context2d = canvas.getContext('2d');
                const scale = Math.max(size / img.width, size / img.height);
                const w = img.width * scale;
                const h = img.height * scale;
                context2d.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.88));
            };
            img.src = String(reader.result || '');
        };
        reader.readAsDataURL(file);
    });
}

function closeEdit() {
    if (!el.editLayer) return;
    el.editLayer.hidden = true;
    el.editLayer.innerHTML = '';
    ui.editKey = null;
}

function saveEdit() {
    const acc = state.accounts[ui.editKey];
    if (!acc) return closeEdit();
    const name = String(document.getElementById('xt-edit-name')?.value || '').trim();
    if (!name) {
        toast('名称不能为空', true);
        return;
    }
    const handle = cleanHandle(document.getElementById('xt-edit-handle')?.value);
    if (acc.name !== name.slice(0, 40)) acc.nameCustomized = true;
    acc.name = name.slice(0, 40);
    if (handle) acc.handle = uniqueHandle(handle, acc.key);
    acc.bio = String(document.getElementById('xt-edit-bio')?.value || '').trim().slice(0, 160);
    acc.location = String(document.getElementById('xt-edit-location')?.value || '').trim().slice(0, 40);
    const avatarUrlValue = String(document.getElementById('xt-edit-avatar-url')?.value || '').trim();
    acc.customAvatar = avatarUrlValue || ui.editAvatar || '';
    if (acc.kind === 'user' && acc.location) state.trendLocation = acc.location;
    acc.verified = Boolean(document.getElementById('xt-edit-verified')?.checked);
    persist();
    closeEdit();
    render();
    toast('资料已更新');
}

function openLightbox(postId) {
    const post = state.posts.find(p => p.id === postId);
    if (!post?.imageUrl) return;
    el.lightbox.innerHTML = `<button class="xt-lightbox-close" data-action="close-lightbox" aria-label="关闭">${icon('close')}</button><img src="${escAttr(post.imageUrl)}" alt="">`;
    el.lightbox.hidden = false;
}

function closeLightbox() {
    if (!el.lightbox) return;
    el.lightbox.hidden = true;
    el.lightbox.innerHTML = '';
}

/* ------------------------------------------------------------------ */
/* Actions                                                            */
/* ------------------------------------------------------------------ */

function onRootClick(event) {
    if (event.target === el.composerLayer) return closeComposer();
    if (event.target === el.editLayer) return closeEdit();
    if (event.target === el.sheetLayer) return closeSheet();
    if (event.target === el.lightbox) return closeLightbox();

    const actionEl = event.target.closest('[data-action]');
    if (!actionEl || !el.root.contains(actionEl)) return;
    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;
    const post = id ? state.posts.find(p => p.id === id) : null;

    switch (action) {
        case 'close': return closePanel();
        case 'back': return goBack();
        case 'home': ui.view = 'home'; ui.threadId = null; return render({ resetScroll: true });
        case 'nav': {
            const view = actionEl.dataset.view;
            if (view === 'home') { ui.threadId = null; ui.profileKey = null; }
            ui.view = view;
            ui.returnTo = null;
            return render({ resetScroll: true });
        }
        case 'tab': ui.tab = actionEl.dataset.tab; return render();
        case 'sync-now': return void syncNow({ manual: true });
        case 'test-api': return void testModelApi();
        case 'seed': return void syncNow({ manual: true });
        case 'clear': return clearTimeline();
        case 'export': return exportTimeline();
        case 'compose': return openComposer();
        case 'composer-close': return closeComposer();
        case 'publish': return void publishComposer();
        case 'ai-draft': return void aiDraft();
        case 'open-thread': {
            const target = post || state.posts.find(p => p.id === id);
            if (!target) return;
            ui.returnTo = { view: ui.view, profileKey: ui.profileKey };
            ui.threadId = target.id;
            ui.view = 'thread';
            render({ resetScroll: true });
            if (actionEl.dataset.focus === 'replies') {
                setTimeout(() => document.querySelector('#xt-root .xt-replies-head')?.scrollIntoView({ block: 'start' }), 60);
            }
            return;
        }
        case 'open-profile': {
            const key = actionEl.dataset.key;
            if (!state.accounts[key]) return;
            ui.returnTo = { view: ui.view, profileKey: ui.profileKey };
            ui.profileKey = key;
            ui.view = 'profile';
            return render({ resetScroll: true });
        }
        case 'open-mention': {
            const handle = String(actionEl.dataset.handle || '').toLowerCase();
            const acc = Object.values(state.accounts).find(a => String(a.handle).toLowerCase() === handle);
            if (!acc) return toast('时间线里还没有这个账号');
            ui.returnTo = { view: ui.view, profileKey: ui.profileKey };
            ui.profileKey = acc.key;
            ui.view = 'profile';
            return render({ resetScroll: true });
        }
        case 'search-tag': {
            ui.search = actionEl.dataset.tag || '';
            ui.view = 'search';
            ui.returnTo = null;
            render({ resetScroll: true });
            setTimeout(() => document.getElementById('xt-search')?.focus(), 30);
            return;
        }
        case 'like': {
            if (!post) return;
            post.liked = !post.liked;
            post.likes = Math.max(0, Number(post.likes || 0) + (post.liked ? 1 : -1));
            persist();
            return render();
        }
        case 'repost': {
            if (!post) return;
            post.reposted = !post.reposted;
            post.reposts = Math.max(0, Number(post.reposts || 0) + (post.reposted ? 1 : -1));
            persist();
            return render();
        }
        case 'bookmark': {
            if (!post) return;
            post.bookmarked = !post.bookmarked;
            persist();
            return render();
        }
        case 'share': {
            if (!post) return;
            const acc = postAccount(post);
            const text = `${acc.name} (@${acc.handle})\n${post.text}\n\n—— 来自 X 时间线`;
            void copyText(text);
            return;
        }
        case 'reply': {
            if (!post) return;
            openComposer({ replyTo: post.id });
            return;
        }
        case 'sheet': return openSheet(id);
        case 'sheet-close': return closeSheet();
        case 'sheet-copy': {
            const target = state.posts.find(p => p.id === ui.sheetPostId);
            if (target) void copyText(target.text);
            closeSheet();
            return;
        }
        case 'sheet-image': {
            const target = state.posts.find(p => p.id === ui.sheetPostId);
            if (!target) return;
            target.imagePrompt = sanitizeImagePrompt(target.imagePrompt || target.text);
            enqueueImage(target, { force: true });
            closeSheet();
            toast('已加入配图队列');
            return;
        }
        case 'sheet-source': {
            const target = state.posts.find(p => p.id === ui.sheetPostId);
            closeSheet();
            if (target) jumpToSource(target);
            return;
        }
        case 'sheet-delete': {
            deletePost(ui.sheetPostId);
            return;
        }
        case 'follow': {
            const acc = state.accounts[actionEl.dataset.key];
            if (!acc) return;
            acc.following = acc.following === false;
            persist();
            return render();
        }
        case 'edit-profile': return openEdit(actionEl.dataset.key);
        case 'edit-close': return closeEdit();
        case 'edit-save': return saveEdit();
        case 'edit-avatar-clear': {
            ui.editAvatar = '';
            const input = document.getElementById('xt-edit-avatar-url');
            if (input) input.value = '';
            refreshEditAvatar();
            return;
        }
        case 'dm-open': return openDM(actionEl.dataset.key);
        case 'dm-send': return void sendDM();
        case 'regen-image': {
            if (!post) return;
            post.imagePrompt = sanitizeImagePrompt(post.imagePrompt || post.text);
            enqueueImage(post, { force: true });
            return;
        }
        case 'open-image': return openLightbox(id);
        case 'close-lightbox': return closeLightbox();
        case 'ai-replies': {
            if (!post) return;
            void generateReplies(post);
            return;
        }
        default: return;
    }
}

function goBack() {
    if (ui.returnTo?.view) {
        const { view, profileKey } = ui.returnTo;
        ui.returnTo = null;
        ui.view = view;
        if (view === 'profile') ui.profileKey = profileKey;
        return render({ resetScroll: true });
    }
    ui.view = 'home';
    ui.threadId = null;
    ui.profileKey = null;
    render({ resetScroll: true });
}

function onRootInput(event) {
    const target = event.target;
    if (target.id === 'xt-edit-avatar-url') {
        ui.editAvatar = target.value.trim();
        refreshEditAvatar();
        return;
    }
    if (target.id === 'xt-search') {
        ui.search = target.value;
        const results = document.getElementById('xt-search-results');
        if (results) results.innerHTML = renderSearchResults();
        return;
    }
    if (target.id === 'xt-compose-text') {
        updateComposeCount();
        return;
    }
    if (target.matches('input[type="range"][data-setting]')) {
        const key = target.dataset.setting;
        settings[key] = Number(target.value);
        if (key === 'imageChance') {
            const label = document.getElementById('xt-chance-value');
            if (label) label.textContent = `${Number(target.value)}%`;
        }
        saveSettings();
        return;
    }
    if (target.matches('textarea[data-setting]')) {
        settings[target.dataset.setting] = target.value;
        saveSettings();
        return;
    }
    if (target.matches('input[data-setting]') && !['checkbox', 'range', 'number'].includes(target.type)) {
        settings[target.dataset.setting] = target.value;
        saveSettings();
    }
}

function onRootChange(event) {
    const target = event.target;
    if (target.id === 'xt-edit-avatar-file') {
        const file = target.files?.[0];
        if (!file) return;
        readAvatarFile(file).then(dataUrl => {
            ui.editAvatar = dataUrl;
            const urlInput = document.getElementById('xt-edit-avatar-url');
            if (urlInput) urlInput.value = '';
            refreshEditAvatar();
        }).catch(error => toast(error.message || '头像读取失败', true));
        target.value = '';
        return;
    }
    if (target.id === 'xt-compose-account') {
        ui.composer.accountKey = target.value;
        return;
    }
    if (target.id === 'xt-compose-img') {
        el.composeImgPrompt.hidden = !target.checked;
        if (target.checked) setTimeout(() => el.composeImgPrompt.focus(), 30);
        return;
    }
    if (target.matches('[data-setting]')) {
        const key = target.dataset.setting;
        let value;
        if (target.type === 'checkbox') value = target.checked;
        else if (target.type === 'number' || target.type === 'range') value = Number(target.value);
        else value = target.value;
        if (key === 'syncEvery' || key === 'maxPosts' || key === 'contextMessages') value = Number(value) || 1;
        if (key === 'imageWidth' || key === 'imageHeight') value = Math.min(2048, Math.max(256, Number(value) || 832));
        settings[key] = value;
        saveSettings();
    }
}

function onRootKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && event.target === el.composeText) {
        event.preventDefault();
        void publishComposer();
    }
    if (event.target?.id === 'xt-dm-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void sendDM();
    }
}

function onDocumentKeydown(event) {
    if (event.key !== 'Escape' || !ui.open) return;
    if (!el.lightbox.hidden) { event.preventDefault(); event.stopPropagation(); return closeLightbox(); }
    if (!el.sheetLayer.hidden) { event.preventDefault(); event.stopPropagation(); return closeSheet(); }
    if (!el.composerLayer.hidden) { event.preventDefault(); event.stopPropagation(); return closeComposer(); }
    if (!el.editLayer.hidden) { event.preventDefault(); event.stopPropagation(); return closeEdit(); }
    event.preventDefault();
    event.stopPropagation();
    closePanel();
}

/* ------------------------------------------------------------------ */
/* Timeline actions                                                   */
/* ------------------------------------------------------------------ */

function clearTimeline() {
    if (!window.confirm('清空当前聊天的时间线？这会删除所有推文，但不会影响正文。')) return;
    state.posts = [];
    state.lastMesId = -1;
    state.unread = 0;
    ui.threadId = null;
    ui.view = 'home';
    persist();
    updateBadge();
    render({ resetScroll: true });
    toast('已清空时间线');
}

function exportTimeline() {
    const payload = {
        version: VERSION,
        exportedAt: new Date().toISOString(),
        accounts: state.accounts,
        posts: state.posts,
        dms: state.dms,
        trends: state.trends,
        trendLocation: state.trendLocation,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `x-timeline-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出 JSON');
}

function jumpToSource(post) {
    if (post.sourceMesId === null || post.sourceMesId === undefined) {
        toast('这条推文不是从正文同步来的');
        return;
    }
    const index = Number(post.sourceMesId);
    if (!Number.isInteger(index) || index < 0) return;
    const message = document.querySelector(`#chat .mes[mesid="${index}"]`);
    if (!message) {
        toast('找不到对应的正文楼层');
        return;
    }
    message.scrollIntoView({ behavior: 'smooth', block: 'center' });
    message.classList.add('xt-flash');
    setTimeout(() => message.classList.remove('xt-flash'), 1800);
    if (window.innerWidth < 720) closePanel();
}

function deletePost(postId) {
    if (!postId) return;
    if (!window.confirm('删除这条推文？')) return;
    state.posts = state.posts.filter(post => post.id !== postId && post.replyTo !== postId);
    if (ui.threadId === postId) {
        ui.threadId = null;
        ui.view = 'home';
    }
    closeSheet();
    persist();
    render({ resetScroll: true });
    toast('已删除');
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        toast('已复制');
        return;
    } catch { /* fall through */ }
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); toast('已复制'); } catch { toast('复制失败', true); }
    area.remove();
}

/* ------------------------------------------------------------------ */
/* AI sync                                                            */
/* ------------------------------------------------------------------ */

async function syncNow({ manual = false } = {}) {
    if (ui.syncing) return;
    const chat = ctx().chat || [];
    if (!chat.length) {
        if (manual) toast('当前聊天还没有消息');
        return;
    }
    if (!state.accounts || !Object.keys(state.accounts).length) {
        if (manual) toast('还没有可用的账号');
        return;
    }
    ui.syncing = true;
    ui.syncError = '';
    if (ui.open) render();
    try {
        const data = await requestTimeline(chat);
        const added = applyTimelineData(data, chat.length - 1);
        state.lastMesId = chat.length - 1;
        persist();
        if (added > 0) {
            if (!ui.open) state.unread = (Number(state.unread) || 0) + added;
            toast(`时间线更新了 ${added} 条`);
        } else {
            toast('这次没有新的推文');
        }
    } catch (error) {
        console.warn('[X Timeline] 同步失败', error);
        ui.syncError = String(error?.message || error).slice(0, 120);
        toast(`同步失败：${ui.syncError}`, true);
    } finally {
        ui.syncing = false;
        updateBadge();
        persist();
        if (ui.open) render();
    }
}

async function requestTimeline(chat) {
    const c = ctx();
    const contextCount = Math.max(1, Number(settings.contextMessages) || 4);
    const recent = chat.slice(-contextCount);
    const contextText = recent.map(message => {
        const name = message.is_user ? (c.name1 || '我') : (message.name || '旁白');
        return `${name}：${stripHtml(message.mes).slice(0, 500)}`;
    }).join('\n');
    const accountLines = Object.values(state.accounts).slice(0, 16).map(acc => {
        return `- ${acc.key} | ${acc.name} | @${acc.handle} | ${acc.kind === 'user' ? '用户' : acc.kind === 'char' ? '角色' : '配角'}${acc.verified ? ' | 认证' : ''}`;
    }).join('\n');
    const custom = settings.customPrompt ? `\n额外要求：${settings.customPrompt}` : '';
    const location = String(state.accounts.user?.location || state.trendLocation || '').trim();
    const prompt = `你是一个角色扮演剧情专用的社交媒体时间线引擎。请把最近的剧情转译成角色们在 X（Twitter）上发布的推文。

【可用账号】
${accountLines}

【当前地点】
${location || '未指定，请从剧情推断'}

【最近剧情】
${contextText}

【要求】
1. 只输出一个 JSON 对象，不要解释，不要 Markdown 代码块。
2. 输出 1-${Math.max(1, Number(settings.maxPosts) || 3)} 条推文：{"posts":[{"author":"账号 key","text":"推文正文","imagePrompt":"可选，英文画面描述"}]}
3. author 必须使用上面列出的账号 key；text 用该账号的第一人称口吻，1-2 句，可以带 emoji 和 #话题，不超过 180 字。
4. 不要写旁白、动作描写或引号；角色不知道自己是虚构人物，不要提 AI、模型、提示词。
5. 优先写与最近剧情直接相关的反应、心情、侧写或日常碎片，不要复述剧情。
6. imagePrompt 只在画面感很强时填写，描述一个具体的瞬间或场景，不要出现文字、Logo、对话框。
7. 如果剧情不适合发推，输出 {"posts":[]}。
8. 如果需要新增一个剧情里刚出现的配角账号，可加 "accounts":[{"key":"npc_xxx","name":"名字","handle":"handle","bio":"一句话简介"}]，最多 1 个。
9. 可选 "trends":["#话题1","#话题2"]，给出 2-4 个与当前地点/剧情有关的当地趋势话题，不要带 # 以外的符号。${custom}`;
    const raw = await callModel(prompt, { responseLength: 600 });
    return extractJson(raw);
}

function applyTimelineData(data, sourceMesId = state.lastMesId) {
    if (!data || typeof data !== 'object') throw new Error('模型返回格式不正确');
    let added = 0;
    for (const raw of (Array.isArray(data.accounts) ? data.accounts : []).slice(0, 2)) {
        const name = String(raw?.name || '').trim().slice(0, 40);
        if (!name) continue;
        if (Object.values(state.accounts).some(acc => acc.name === name)) continue;
        let key = normalizeKey(raw?.key) || `npc_${uid().slice(0, 6)}`;
        if (state.accounts[key]) key = `npc_${uid().slice(0, 6)}`;
        const acc = makeAccount(key, name, 'npc', String(raw?.bio || '').slice(0, 120));
        const handle = cleanHandle(raw?.handle);
        if (handle) acc.handle = uniqueHandle(handle, key);
        acc.followers = rand(80, 9000);
        state.accounts[key] = acc;
    }
    const rawPosts = Array.isArray(data.posts) ? data.posts : [];
    const count = Math.min(rawPosts.length, Math.max(1, Number(settings.maxPosts) || 3), 3);
    rawPosts.slice(0, count).forEach((raw, index) => {
        const text = cleanPostText(raw?.text);
        if (!text) return;
        const key = resolveAuthorKey(raw?.author);
        if (!key) return;
        if (state.posts.some(post => post.accountKey === key && post.text === text)) return;
        const post = createPost(key, text, {
            createdAt: Date.now() - (count - 1 - index) * 45000,
            sourceMesId,
        });
        post.imagePrompt = String(raw?.imagePrompt || '').trim().slice(0, 500);
        if (settings.fakeMetrics) {
            post.likes = rand(2, 320);
            post.reposts = Math.floor(post.likes * randf(0.04, 0.25));
            post.views = post.likes * rand(7, 30) + rand(40, 600);
        }
        state.posts.push(post);
        added++;
        if (settings.autoImage && Math.random() * 100 < Number(settings.imageChance || 0)) {
            enqueueImage(post);
        }
    });
    if (Array.isArray(data.trends)) {
        state.trends = data.trends
            .map(item => String(item || '').replace(/^#/, '').trim().slice(0, 30))
            .filter(Boolean)
            .slice(0, 6);
    }
    if (state.posts.length > MAX_POSTS) {
        state.posts = state.posts.slice(-MAX_POSTS);
    }
    return added;
}

async function generateReplies(post) {
    if (ui.genReplies) return;
    const acc = postAccount(post);
    ui.genReplies = true;
    render();
    try {
        const accountLines = Object.values(state.accounts).slice(0, 12).map(a => `- ${a.key} | ${a.name} | @${a.handle}`).join('\n');
        const prompt = `这是一个角色扮演故事的社交媒体时间线。请为下面这条推文生成 1-2 条来自其他账号的回复。

【原帖】${acc.name}（@${acc.handle}）：${post.text}

【可用账号】
${accountLines}

【要求】
只输出 JSON：{"posts":[{"author":"账号 key","text":"回复内容"}]}。回复要短、口语化、像真实的 X 评论区，可以赞同、吐槽、追问或补充细节；必须使用不同账号；不要旁白，不要引号。`;
        const raw = await callModel(prompt, { responseLength: 400 });
        const data = extractJson(raw);
        const items = Array.isArray(data.posts) ? data.posts.slice(0, 2) : [];
        let added = 0;
        for (const item of items) {
            const text = cleanPostText(item?.text);
            if (!text) continue;
            const key = resolveAuthorKey(item?.author);
            if (!key || key === post.accountKey) continue;
            const reply = createPost(key, text, {
                replyTo: post.id,
                createdAt: Date.now() + (added + 1) * 20000,
                likes: rand(0, 18),
                views: rand(20, 400),
            });
            state.posts.push(reply);
            added++;
        }
        if (!added) throw new Error('没有生成有效回复');
        persist();
        toast(`新增 ${added} 条回复`);
    } catch (error) {
        console.warn('[X Timeline] 生成回复失败', error);
        toast('生成回复失败', true);
    } finally {
        ui.genReplies = false;
        if (ui.open) render();
    }
}

/* ------------------------------------------------------------------ */
/* Image queue                                                        */
/* ------------------------------------------------------------------ */

function enqueueImage(post, { force = false } = {}) {
    if (!post) return;
    if (!force && (post.imageUrl || post.imageStatus === 'loading' || post.imageStatus === 'queued')) return;
    if (imageQueue.includes(post.id)) return;
    post.imageStatus = 'queued';
    post.imageError = '';
    imageQueue.push(post.id);
    if (ui.open) render();
    void runImageQueue();
}

async function runImageQueue() {
    if (imageRunning) return;
    imageRunning = true;
    try {
        while (imageQueue.length) {
            const id = imageQueue.shift();
            const post = state.posts.find(p => p.id === id);
            if (!post) continue;
            await generatePostImage(post);
        }
    } finally {
        imageRunning = false;
    }
}

function imageProgressText(progress) {
    if (progress === 'queued') return '柏宝绘排队中…';
    if (progress === 'queued-remote') return 'ComfyUI 排队中…';
    if (progress === 'retrying') return '柏宝绘限流，正在重试…';
    if (progress === 'saving') return '正在保存图片…';
    return '正在生成配图…';
}

async function generateWithBaiBai(post) {
    const api = baiBaiApi();
    if (!api) throw Object.assign(new Error('未检测到柏宝绘'), { code: 'not_configured' });
    const status = api.getBackendStatus();
    if (!status?.configured) throw Object.assign(new Error(status?.reason || '柏宝绘尚未配置'), { code: 'not_configured' });
    const acc = postAccount(post);
    const source = sanitizeImagePrompt(post.imagePrompt || post.text);
    const prompt = sanitizeImagePrompt([source, settings.imageStyle].filter(Boolean).join(', '));
    let characters = [];
    if (status.supportsCharacters) {
        try {
            const floor = Number(post.sourceMesId);
            const library = api.getCharacters(Number.isFinite(floor) && floor >= 0 ? { floor } : {});
            const match = (library?.characters || []).find(item => String(item.name || '').toLowerCase() === String(acc?.name || '').toLowerCase());
            if (match) characters = [{ name: match.name, tag: match.tag, nl: match.nl || '' }];
        } catch (error) {
            console.warn('[X Timeline] 读取柏宝绘角色库失败', error);
        }
    }
    post.imageProgress = 'queued';
    const result = await api.generate({
        prompt,
        nl: String(post.text || '').slice(0, 600),
        characters,
        size: Number(settings.imageHeight) >= Number(settings.imageWidth) ? 'portrait' : 'landscape',
        save: Boolean(settings.saveToBaiBaiGallery),
        character: acc?.name || undefined,
    }, {
        onProgress: progress => {
            const phase = String(progress?.phase || '');
            if (phase && phase !== post.imageProgress) {
                post.imageProgress = phase;
                if (ui.open) render();
            }
        },
    });
    if (!result?.dataUrl) throw new Error('柏宝绘没有返回图片');
    return result.dataUrl;
}

async function generateWithST(post) {
    const prompt = sanitizeImagePrompt([post.imagePrompt || post.text, settings.imageStyle].filter(Boolean).join(', '));
    const width = Math.max(256, Number(settings.imageWidth) || 832);
    const height = Math.max(256, Number(settings.imageHeight) || 1216);
    const command = `/imagine quiet=true gallery=false processing=minimal width=${width} height=${height} ${prompt}`;
    const result = await ctx().executeSlashCommandsWithOptions(command, {
        handleParserErrors: true,
        handleExecutionErrors: true,
    });
    if (result?.isError) throw new Error(result.errorMessage || '生图命令执行失败');
    const url = String(result?.pipe || '').trim().replace(/^["']|["']$/g, '');
    if (!url || !/^(https?:\/\/|data:image\/|\/)/.test(url)) {
        throw new Error('生图后端没有返回图片地址');
    }
    return url;
}

async function generatePostImage(post) {
    post.imageStatus = 'loading';
    post.imageProgress = 'queued';
    post.imageError = '';
    if (ui.open) render();
    const prompt = sanitizeImagePrompt([post.imagePrompt || post.text, settings.imageStyle].filter(Boolean).join(', '));
    if (!prompt) {
        post.imageStatus = 'error';
        post.imageError = '画面描述为空';
        return;
    }
    const provider = settings.imageProvider || 'auto';
    let baiBaiError = null;
    try {
        if (provider !== 'st' && (baiBaiApi() || provider === 'baibai')) {
            try {
                post.imageUrl = await generateWithBaiBai(post);
                post.imageStatus = 'ready';
                post.imageProgress = '';
                persist();
                return;
            } catch (error) {
                if (error?.code === 'aborted') throw error;
                baiBaiError = error;
                if (provider === 'baibai') throw error;
                console.warn('[X Timeline] 柏宝绘失败，回退 ST 生图', error);
            }
        }
        post.imageProgress = 'generating';
        post.imageUrl = await generateWithST(post);
        post.imageStatus = 'ready';
        post.imageProgress = '';
        persist();
    } catch (error) {
        console.warn('[X Timeline] 生成配图失败', error);
        post.imageStatus = 'error';
        post.imageError = (baiBaiError && provider === 'baibai') ? baiBaiErrorText(baiBaiError) : String(error?.message || error).slice(0, 140);
        persist();
    } finally {
        if (ui.open) render();
    }
}

/* ------------------------------------------------------------------ */
/* Toast                                                              */
/* ------------------------------------------------------------------ */

function toast(message, isError = false) {
    if (!el.toast) return;
    el.toast.textContent = String(message || '');
    el.toast.classList.toggle('is-error', Boolean(isError));
    el.toast.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast?.classList.remove('is-show'), 2400);
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

(function boot() {
    const start = () => {
        try {
            init();
        } catch (error) {
            console.error('[X Timeline] 初始化失败', error);
        }
    };
    if (window.SillyTavern?.getContext) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
        else start();
    } else {
        console.warn('[X Timeline] 未找到 SillyTavern 上下文，插件没有启动');
    }
})();
