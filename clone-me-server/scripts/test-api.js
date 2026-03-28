/**
 * API 自动化测试脚本
 * 运行: node scripts/test-api.js
 */

const BASE = 'http://localhost:3001';
let passed = 0;
let failed = 0;
let tokenA = '';
let tokenB = '';
let avatarId = '';

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function test(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? '✅' : '❌'} ${name} (got: ${actual}, expected: ${expected})`);
  ok ? passed++ : failed++;
}

function testIncludes(name, actual, keyword) {
  const ok = String(actual).includes(keyword);
  console.log(`${ok ? '✅' : '❌'} ${name} (includes "${keyword}": ${ok})`);
  ok ? passed++ : failed++;
}

async function run() {
  console.log('🧪 CloneMe API 测试\n');

  // ========== 认证 ==========
  console.log('--- 认证模块 ---');

  // TC-AUTH-001 注册正常
  const r1 = await req('POST', '/api/auth/register', { email: 'testA@api.com', password: '123456', name: '用户A' });
  test('TC-AUTH-001 注册正常', r1.status, 200);
  tokenA = r1.data.token || '';
  test('TC-AUTH-001 返回token', !!tokenA, true);

  // TC-AUTH-002 邮箱已存在
  const r2 = await req('POST', '/api/auth/register', { email: 'testA@api.com', password: '123456', name: '重复' });
  test('TC-AUTH-002 邮箱已存在', r2.status, 409);

  // TC-AUTH-003 参数校验
  const r3 = await req('POST', '/api/auth/register', { email: '', password: '', name: '' });
  test('TC-AUTH-003 参数校验', r3.status, 400);

  // TC-AUTH-004 登录正常
  const r4 = await req('POST', '/api/auth/login', { email: 'testA@api.com', password: '123456' });
  test('TC-AUTH-004 登录正常', r4.status, 200);

  // TC-AUTH-005 密码错误
  const r5 = await req('POST', '/api/auth/login', { email: 'testA@api.com', password: 'wrong' });
  test('TC-AUTH-005 密码错误', r5.status, 401);

  // TC-AUTH-006 邮箱不存在
  const r6 = await req('POST', '/api/auth/login', { email: 'nobody@api.com', password: '123456' });
  test('TC-AUTH-006 邮箱不存在', r6.status, 401);

  // TC-AUTH-007 获取用户信息
  const r7 = await req('GET', '/api/auth/me', null, tokenA);
  test('TC-AUTH-007 获取用户', r7.status, 200);
  testIncludes('TC-AUTH-007 用户名', r7.data.user?.name, '用户A');

  // TC-AUTH-008 无效Token
  const r8 = await req('GET', '/api/auth/me', null, 'invalid');
  test('TC-AUTH-008 无效Token', r8.status, 401);

  // ========== 数字人 CRUD ==========
  console.log('\n--- 数字人管理 ---');

  // TC-AVATAR-001 创建
  const a1 = await req('POST', '/api/avatars', { name: '小美客服', description: '测试', persona_prompt: '你是客服' }, tokenA);
  test('TC-AVATAR-001 创建', a1.status, 200);
  avatarId = a1.data.id || '';
  test('TC-AVATAR-001 返回ID', !!avatarId, true);

  // TC-AVATAR-002 名称为空
  const a2 = await req('POST', '/api/avatars', { name: '' }, tokenA);
  test('TC-AVATAR-002 名称为空', a2.status, 400);

  // TC-AVATAR-004 编辑
  const a4 = await req('PUT', `/api/avatars/${avatarId}`, { name: '小美客服V2' }, tokenA);
  test('TC-AVATAR-004 编辑', a4.status, 200);

  // TC-AVATAR-007 详情
  const a7 = await req('GET', `/api/avatars/${avatarId}`, null, tokenA);
  test('TC-AVATAR-007 详情', a7.status, 200);
  testIncludes('TC-AVATAR-007 名称已更新', a7.data.avatar?.name, 'V2');

  // 列表
  const aList = await req('GET', '/api/avatars', null, tokenA);
  test('TC-AVATAR 列表', aList.status, 200);
  test('TC-AVATAR 列表数量', aList.data.avatars?.length >= 1, true);

  // ========== 多租户隔离 ==========
  console.log('\n--- 多租户隔离 ---');

  // 注册第二个用户
  const rb = await req('POST', '/api/auth/register', { email: 'testB@api.com', password: '123456', name: '用户B' });
  tokenB = rb.data.token || '';

  // TC-TENANT-001 B看不到A的数字人
  const bList = await req('GET', '/api/avatars', null, tokenB);
  test('TC-TENANT-001 B看不到A的数字人', bList.data.avatars?.length, 0);

  // TC-TENANT-003 B访问A的数字人
  const bAccess = await req('GET', `/api/avatars/${avatarId}`, null, tokenB);
  test('TC-TENANT-003 越权访问', bAccess.status, 404);

  // ========== 模型管理 ==========
  console.log('\n--- 模型管理 ---');

  // 普通用户浏览模型（目前没有模型）
  const m1 = await req('GET', '/api/models', null, tokenA);
  test('TC-MODEL-001 浏览模型', m1.status, 200);

  // 可用模型
  const m2 = await req('GET', '/api/models/available', null, tokenA);
  test('TC-MODEL-002 可用模型', m2.status, 200);

  // 普通用户不能上传模型
  const m3 = await req('POST', '/api/models/admin', { name: '测试模型', model_url: '/models/test.json' }, tokenA);
  test('TC-MODEL-004 普通用户不能上传', m3.status, 403);

  // ========== 删除 ==========
  console.log('\n--- 清理 ---');

  const aDel = await req('DELETE', `/api/avatars/${avatarId}`, null, tokenA);
  test('TC-AVATAR-005 删除', aDel.status, 200);

  // 删除后列表为空
  const aList2 = await req('GET', '/api/avatars', null, tokenA);
  test('TC-AVATAR-005 删除后列表', aList2.data.avatars?.length, 0);

  // ========== 数量限制 ==========
  console.log('\n--- 数量限制 ---');
  for (let i = 0; i < 3; i++) {
    await req('POST', '/api/avatars', { name: `数字人${i}` }, tokenA);
  }
  const aOver = await req('POST', '/api/avatars', { name: '超限' }, tokenA);
  test('TC-AVATAR-003 数量上限', aOver.status, 403);

  // ========== 汇总 ==========
  console.log(`\n📊 测试结果: ${passed} 通过, ${failed} 失败, 共 ${passed + failed} 个`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('测试异常:', err); process.exit(1); });
