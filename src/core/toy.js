'use strict';

/* B站 Toy JS SDK 封装: 非 Toy 环境自动降级(返回 null / 走 localStorage)
 * 能力取舍:
 *   - 云存储 getCloudStorage/setCloudStorage: 端内外均支持, 跨设备同步, 不弹数据确认 → 用于存档
 *   - 排行榜 submitScore/getRankList/getMyRank: 端内外均支持 → 金币榜/评分榜/口碑榜
 *   - 互动 getVideoUserActions/getAuthorRelation: 端内外均支持, 不弹数据确认 → 解锁限定内容
 *   - 容器 onContainerChange/setContainerMode: 仅 App 内 → 请求横屏+沉浸(手机不支持"横屏且非沉浸")
 *   - 不使用 getUserProfile(会弹数据确认弹窗), 昵称头像改用排行榜返回的 avatar/nickname
 */

/* global TOY_BVID, TOY_AUTHOR_UID, TOY_AUTHOR_NAME, TOY_VIDEO_TITLE, TOY_AUTHOR_FACE, TOY_VIDEO_COVER, interact, refreshUnlocks */

const Toy = (() => {
  /* ---- 本地模拟(?mock=1): 注入假的 window.toy, 便于在普通浏览器测试 ---- */
  const MOCK_KEY = 'toyMockState';
  let mockState = null;

  function isMock() {
    return mockState !== null;
  }

  function installMock() {
    const raw = JSON.parse(localStorage.getItem(MOCK_KEY) || '{}');
    mockState = {
      liked: !!raw.liked,
      coin: !!raw.coin,
      fav: !!raw.fav,
      following: !!raw.following,
    };
    const save = () => localStorage.setItem(MOCK_KEY, JSON.stringify(mockState));
    window.toy = {
      isSupport: () => Promise.resolve(true),
      getVideoUserActions: () =>
        Promise.resolve({
          items: [
            {
              status: 'ok',
              liked: mockState.liked,
              coinCount: mockState.coin ? 2 : 0,
              favorited: mockState.fav,
            },
          ],
        }),
      getAuthorRelation: () =>
        Promise.resolve({ status: 'ok', data: { isFollowing: mockState.following } }),
      submitScore: (req) => {
        const k = 'toyMockScore' + (req.board || 1);
        const my = Number(localStorage.getItem(k) || 0);
        if (req.score > my) localStorage.setItem(k, String(req.score));
        return Promise.resolve({ score: Math.max(my, req.score) });
      },
      getRankList: () =>
        Promise.resolve([
          { rank: 1, score: 9999, nickname: '月饼大师', avatar: '' },
          { rank: 2, score: 8200, nickname: '莲蓉控', avatar: '' },
          { rank: 3, score: 6600, nickname: '五仁滚出去', avatar: '' },
        ]),
      getMyRank: () => Promise.resolve({ ranked: false, rank: 0, score: 0 }),
      getContainerState: () =>
        Promise.resolve({
          deviceType: 'desktop',
          viewport: { width: 1280, height: 720 },
          safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
          orientation: 'landscape',
          immersive: false,
          changedFields: [],
        }),
      onContainerChange: () => () => {},
      setContainerMode: () => Promise.resolve(),
      navigate: (req) => {
        console.log('[mock toy.navigate]', req);
        return Promise.resolve();
      },
    };
    window.__toyMock = {
      state: mockState,
      toggle(k) {
        mockState[k] = !mockState[k];
        save();
        if (typeof refreshUnlocks === 'function') refreshUnlocks();
      },
    };
  }

  const mockMode = typeof location !== 'undefined' && location.search.indexOf('mock') >= 0;
  if (typeof window !== 'undefined' && !window.toy && mockMode) {
    installMock();
  }

  /* 异步动态加载真 SDK: 不阻塞页面; 模拟模式跳过; 加载完刷新一次解锁状态 */
  function loadSdk() {
    if (mockMode || typeof document === 'undefined') return;
    const s = document.createElement('script');
    s.src = '//s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js';
    s.async = true;
    s.onerror = () => {};
    s.onload = () => {
      if (typeof refreshUnlocks === 'function') refreshUnlocks();
      loadMedia(); // SDK 就位了, 顺便把封面/标题/头像拉下来
    };
    document.head.appendChild(s);
  }
  loadSdk();

  function sdk() {
    return typeof window !== 'undefined' && window.toy ? window.toy : null;
  }
  function available() {
    return !!sdk();
  }

  /* ---- 互动状态: 点赞/投币/收藏/关注 ---- */
  async function getVideoActions() {
    const t = sdk();
    if (!t || typeof t.getVideoUserActions !== 'function') return null;
    try {
      const res = await t.getVideoUserActions({ videos: [{ bvid: TOY_BVID }] });
      const item = res && res.items && res.items[0];
      if (!item || item.status !== 'ok') return null;
      return { liked: !!item.liked, coin: (item.coinCount || 0) > 0, fav: !!item.favorited };
    } catch (_) {
      return null;
    }
  }

  async function getAuthorRelation() {
    const t = sdk();
    if (!t || typeof t.getAuthorRelation !== 'function') return null;
    try {
      const res = await t.getAuthorRelation();
      if (!res || res.status !== 'ok' || !res.data) return null;
      return { following: !!res.data.isFollowing };
    } catch (_) {
      return null;
    }
  }

  /* ---- 排行榜 ---- */
  async function submitScore(board, score) {
    const t = sdk();
    if (!t || typeof t.submitScore !== 'function') return null;
    try {
      return await t.submitScore({ board: board, score: Math.round(score) });
    } catch (_) {
      return null;
    }
  }

  async function getRankList(board, limit) {
    const t = sdk();
    if (!t || typeof t.getRankList !== 'function') return null;
    try {
      return await t.getRankList({ board: board, period: 'all', limit: limit || 50 });
    } catch (_) {
      return null;
    }
  }

  async function getMyRank(board) {
    const t = sdk();
    if (!t || typeof t.getMyRank !== 'function') return null;
    try {
      return await t.getMyRank({ board: board, period: 'all' });
    } catch (_) {
      return null;
    }
  }

  /* ---- 云存储: 单 key value <= 1024 字节, 需自行 JSON ---- */
  async function getCloudStorage(keys) {
    const t = sdk();
    if (!t || typeof t.getCloudStorage !== 'function') return null;
    try {
      return await t.getCloudStorage(keys);
    } catch (_) {
      return null;
    }
  }

  async function setCloudStorage(items) {
    const t = sdk();
    if (!t || typeof t.setCloudStorage !== 'function') return false;
    try {
      await t.setCloudStorage(items);
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ---- 容器: 请求横屏 + 沉浸 ----
   * 文档: 手机不支持"横屏且非沉浸"组合; Promise 不是成功回执, 需 onContainerChange 确认 */
  /* ---- UP 主头像 / 视频封面标题(互动界面用) ----
   * 端内可从 SDK 拉; 拿不到就用 config 里的名字/标题, 不画占位图 */
  const media = { avatar: null, cover: null, name: '', title: '', mid: '' };
  let mediaDone = false; // 真的问过一遍(SDK 在)才锁, 否则允许以后重试
  let mediaTrying = false;

  function loadImg(url) {
    if (!url) return null;
    try {
      const im = new Image();
      /* B站图床有防盗链: 带 Referer 会 403, 不带 Referer 才放行 */
      im.referrerPolicy = 'no-referrer';
      /* 接口返回可能是 http:// -> 升到 https, 免得被混合内容拦掉 */
      im.src = String(url).replace(/^http:/, 'https:');
      return im;
    } catch (_) {
      return null;
    }
  }

  /* 取封面/标题/头像: 先官方 SDK, 再直连 B站 web 接口, 最后 config 兜底 */
  async function loadMedia() {
    if (mediaDone || mediaTrying) return media;
    mediaTrying = true;
    media.name = TOY_AUTHOR_NAME || '作者';
    media.title = TOY_VIDEO_TITLE || '';
    let avatarUrl = '';
    let coverUrl = '';
    /* 1) 官方 SDK */
    try {
      const t = sdk();
      if (t) {
        if (typeof t.getAuthorProfile === 'function') {
          const p = await t.getAuthorProfile();
          const d = p && (p.data || p);
          if (d) {
            avatarUrl = d.face || d.avatar || d.face_url || '';
            if (d.nickname || d.name) media.name = d.nickname || d.name;
          }
        }
        if (typeof t.getAuthorVideos === 'function' && TOY_BVID) {
          const v = await t.getAuthorVideos({ videos: [{ bvid: TOY_BVID }] });
          const arr = v && (v.items || (v.data && (v.data.items || v.data)));
          const it = Array.isArray(arr) ? arr[0] : null;
          const d = it && (it.data || it);
          if (d) {
            coverUrl = d.pic || d.cover || d.cover_url || '';
            if (d.title) media.title = d.title;
          }
        }
      }
    } catch (_) {}
    /* 2) 直连 B站 web 接口(只在 bilibili 域内放行, 也就是 Toy 内 -> 必须有 SDK 才试) */
    if (sdk() && (!avatarUrl || !coverUrl || !media.title) && TOY_BVID) {
      try {
        const r = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + TOY_BVID);
        const j = await r.json();
        const d = j && j.data;
        if (d) {
          if (!coverUrl && d.pic) coverUrl = d.pic;
          if (!avatarUrl && d.owner && d.owner.face) avatarUrl = d.owner.face;
          if (!media.title && d.title) media.title = d.title;
          if (d.owner && d.owner.mid) media.mid = String(d.owner.mid); // 跳主页优先用它
          if (d.owner && d.owner.name && media.name === (TOY_AUTHOR_NAME || '作者')) media.name = d.owner.name;
        }
      } catch (_) {}
    }
    /* 3) config 兜底(留空就用作者名 + 不画图) */
    if (!avatarUrl && typeof TOY_AUTHOR_FACE !== 'undefined') avatarUrl = TOY_AUTHOR_FACE;
    if (!coverUrl && typeof TOY_VIDEO_COVER !== 'undefined') coverUrl = TOY_VIDEO_COVER;
    /* B站图床防盗链: 不带 Referer 才放行 */
    media.avatar = loadImg(avatarUrl);
    media.cover = loadImg(coverUrl);
    /* SDK 已经在了 -> 这次是靠谱的结果, 锁掉; 否则留着下次再拉 */
    mediaDone = !!sdk();
    mediaTrying = false;
    return media;
  }

  function avatar() {
    return media.avatar;
  }
  function cover() {
    return media.cover;
  }
  function authorName() {
    return media.name || TOY_AUTHOR_NAME || '作者';
  }
  function videoTitle() {
    return media.title || TOY_VIDEO_TITLE || '';
  }

  function requestLandscape() {
    const t = sdk();
    if (!t || typeof t.setContainerMode !== 'function') return;
    try {
      const p = t.setContainerMode({ orientation: 'landscape', immersive: true });
      if (p && p.catch) p.catch(() => {});
    } catch (_) {}
  }

  /* 监听容器状态: 尺寸/安全区变化时回调(用于自适应) */
  function onContainerChange(listener) {
    const t = sdk();
    if (!t || typeof t.onContainerChange !== 'function') return () => {};
    try {
      return t.onContainerChange(listener) || (() => {});
    } catch (_) {
      return () => {};
    }
  }

  /* ---- 跳转(必须在用户手势中调用) ---- */
  function navigate(type, id) {
    const t = sdk();
    if (!t || typeof t.navigate !== 'function') return;
    try {
      const p = t.navigate({ type: type, id: id });
      if (p && p.catch) p.catch(() => {});
    } catch (_) {}
  }
  function openVideo() {
    navigate('video', TOY_BVID);
  }
  function openAuthor() {
    /* 优先用视频接口带回来的作者 mid(换了 BV 也不会跳错); 拿不到再退回 config */
    navigate('space', media.mid || TOY_AUTHOR_UID);
  }

  return {
    available,
    isMock,
    getVideoActions,
    getAuthorRelation,
    submitScore,
    getRankList,
    getMyRank,
    getCloudStorage,
    setCloudStorage,
    requestLandscape,
    onContainerChange,
    navigate,
    openVideo,
    openAuthor,
    loadMedia,
    avatar,
    cover,
    authorName,
    videoTitle,
  };
})();
