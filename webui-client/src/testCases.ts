import type { TestCase } from './types'

// 预设测试用例库：覆盖 FunGame.Server-v3 现有 REST + WS 功能
export const TEST_CASES: TestCase[] = [
  // ===== 认证（REST）=====
  { id: 'auth-register', group: '认证', kind: 'rest', name: '注册', description: 'POST /api/auth/register 创建新账号', method: 'POST', path: '/api/auth/register', bodyText: '{"username":"tester01","password":"test123456","nickname":"测试员01","device":"webui-client"}' },
  { id: 'auth-login', group: '认证', kind: 'rest', name: '登录', description: 'POST /api/auth/login 获取 JWT', method: 'POST', path: '/api/auth/login', bodyText: '{"username":"admin","password":"admin123456","device":"webui-client"}' },
  { id: 'auth-me', group: '认证', kind: 'rest', name: '我的信息', description: 'GET /api/auth/me 当前用户角色与权限', method: 'GET', path: '/api/auth/me' },
  { id: 'auth-logout', group: '认证', kind: 'rest', name: '登出', description: 'POST /api/auth/logout 撤销刷新令牌', method: 'POST', path: '/api/auth/logout', bodyText: '{}' },

  // ===== 用户中心（REST）=====
  { id: 'users-list', group: '用户中心', kind: 'rest', name: '用户列表', description: 'GET /api/users?page=1&pageSize=10', method: 'GET', path: '/api/users?page=1&pageSize=10' },
  { id: 'roles-list', group: '用户中心', kind: 'rest', name: '角色列表', description: 'GET /api/roles 全部角色', method: 'GET', path: '/api/roles' },
  { id: 'permissions-list', group: '用户中心', kind: 'rest', name: '权限点列表', description: 'GET /api/permissions 全部权限点', method: 'GET', path: '/api/permissions' },
  { id: 'profiles-list', group: '用户中心', kind: 'rest', name: '用户资料列表', description: 'GET /api/userprofiles', method: 'GET', path: '/api/userprofiles?page=1&pageSize=10' },
  { id: 'sessions-list', group: '用户中心', kind: 'rest', name: '用户会话列表', description: 'GET /api/usersessions', method: 'GET', path: '/api/usersessions?page=1&pageSize=10' },
  { id: 'loginlogs-list', group: '用户中心', kind: 'rest', name: '登录日志', description: 'GET /api/loginlogs', method: 'GET', path: '/api/loginlogs?page=1&pageSize=10' },

  // ===== 对局与回放（REST）=====
  { id: 'games-list', group: '对局回放', kind: 'rest', name: '对局记录列表', description: 'GET /api/gamerecords?page=1&pageSize=10', method: 'GET', path: '/api/gamerecords?page=1&pageSize=10' },
  { id: 'roundrecords-list', group: '对局回放', kind: 'rest', name: '回合记录列表', description: 'GET /api/roundrecords?page=1&pageSize=10', method: 'GET', path: '/api/roundrecords?page=1&pageSize=10' },
  { id: 'rooms-list', group: '对局回放', kind: 'rest', name: '房间列表', description: 'GET /api/rooms?page=1&pageSize=10', method: 'GET', path: '/api/rooms?page=1&pageSize=10' },

  // ===== 经济（REST）=====
  { id: 'stores-list', group: '经济', kind: 'rest', name: '商店列表', description: 'GET /api/stores', method: 'GET', path: '/api/stores' },
  { id: 'goods-list', group: '经济', kind: 'rest', name: '商品列表', description: 'GET /api/goods', method: 'GET', path: '/api/goods' },
  { id: 'marketitems-list', group: '经济', kind: 'rest', name: '市场物品', description: 'GET /api/marketitems', method: 'GET', path: '/api/marketitems' },
  { id: 'offers-list', group: '经济', kind: 'rest', name: '报价列表', description: 'GET /api/offers', method: 'GET', path: '/api/offers' },

  // ===== 系统（REST）=====
  { id: 'serverlogs-list', group: '系统', kind: 'rest', name: '服务器日志', description: 'GET /api/serverlogs?page=1&pageSize=10', method: 'GET', path: '/api/serverlogs?page=1&pageSize=10' },
  { id: 'configs-list', group: '系统', kind: 'rest', name: '系统配置', description: 'GET /api/systemconfigs', method: 'GET', path: '/api/systemconfigs' },
  { id: 'apitokens-list', group: '系统', kind: 'rest', name: 'API 令牌', description: 'GET /api/apitokens', method: 'GET', path: '/api/apitokens' },

  // ===== 管理（REST）=====
  { id: 'admin-plugins', group: '管理', kind: 'rest', name: '插件清单', description: 'GET /api/admin/plugins', method: 'GET', path: '/api/admin/plugins' },
  { id: 'admin-overview', group: '管理', kind: 'rest', name: '服务器概览', description: 'GET /api/admin/server/overview', method: 'GET', path: '/api/admin/server/overview' },
  { id: 'admin-sessions', group: '管理', kind: 'rest', name: '在线会话', description: 'GET /api/admin/server/sessions', method: 'GET', path: '/api/admin/server/sessions' },
  { id: 'admin-games', group: '管理', kind: 'rest', name: '运行中对局', description: 'GET /api/admin/server/games', method: 'GET', path: '/api/admin/server/games' },

  // ===== WebSocket 基础 =====
  { id: 'ws-ping', group: 'WebSocket', kind: 'ws', name: '心跳', description: 'system.ping → system.pong', wsType: 'system.ping', wsData: { ts: 0 } },
  { id: 'ws-info', group: 'WebSocket', kind: 'ws', name: '服务器信息', description: 'system.info 获取服务器信息', wsType: 'system.info' },

  // ===== 房间 / 匹配（WS）=====
  { id: 'ws-room-list', group: '房间匹配', kind: 'ws', name: '房间列表', description: 'room.list 获取房间列表', wsType: 'room.list' },
  { id: 'ws-room-create', group: '房间匹配', kind: 'ws', name: '创建房间', description: 'room.create 创建示例模组房间', wsType: 'room.create', wsData: { module: 'example', map: '', maxUsers: 2, isRank: false } },
  { id: 'ws-match-start', group: '房间匹配', kind: 'ws', name: '快速匹配', description: 'match.start 立即创建 AI 对战（5 人混战）', wsType: 'match.start', wsData: { mode: 'example', count: 5 } },
]

// 用例分组顺序
export const TEST_GROUPS = ['认证', '用户中心', '对局回放', '经济', '系统', '管理', 'WebSocket', '房间匹配']
