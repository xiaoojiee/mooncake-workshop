'use strict';

/* B站 Toy JS SDK 封装: 非 Toy 环境自动降级(返回 null / 走 localStorage)
 * 能力取舍:
 *   - 云存储 getCloudStorage/setCloudStorage: 端内外均支持, 跨设备同步, 不弹数据确认 → 用于存档
 *   - 排行榜 submitScore/getRankList/getMyRank: 端内外均支持 → 金币榜/评分榜/口碑榜
 *   - 互动 getVideoUserActions/getAuthorRelation: 端内外均支持, 不弹数据确认 → 解锁限定内容
 *   - 容器 onContainerChange/setContainerMode: 仅 App 内 → 请求横屏+沉浸(手机不支持"横屏且非沉浸")
 *   - 不使用 getUserProfile(会弹数据确认弹窗), 昵称头像改用排行榜返回的 avatar/nickname
 */

/* global TOY_BVID, TOY_AUTHOR_UID, TOY_AUTHOR_NAME, TOY_VIDEO_TITLE, interact, refreshUnlocks */

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
    navigate('space', TOY_AUTHOR_UID);
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
  };
})();
