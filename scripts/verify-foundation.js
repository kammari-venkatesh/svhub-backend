const BASE_URL = 'http://localhost:5000/api'

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const data = await response.json().catch(() => ({}))
  return { status: response.status, ok: response.ok, data }
}

async function runTests() {
  console.log('====================================================')
  console.log('SV HUB — PHASE 1.1 AUTHORIZATION & SECURITY TESTS')
  console.log('====================================================\n')

  const randomSuffix = Math.floor(100000 + Math.random() * 900000)
  const testCustomerEmail = `test.cust.${randomSuffix}@example.com`
  const testCustomerPass = 'TestPass@123'
  const testAdminEmail = `test.admin.${randomSuffix}@example.com`
  const testAdminPass = 'AdminPass@123'

  let customerToken = ''
  let customerId = ''
  let adminToken = ''
  let adminId = ''

  let passed = 0
  let failed = 0

  function assert(title, condition, extra = '') {
    if (condition) {
      console.log(`[PASS] ${title}`)
      passed++
    } else {
      console.error(`[FAIL] ${title} ${extra ? `(${extra})` : ''}`)
      failed++
    }
  }

  try {
    // 0. Health check
    const health = await request('/health')
    assert('Health endpoint returns 200 & connected DB', health.status === 200 && health.data?.database === 'connected')

    // Case 1: No token → protected endpoint rejected (401)
    const case1 = await request('/test/protected')
    assert('Case 1: No token -> 401 unauthenticated', case1.status === 401 && case1.data?.code === 'unauthenticated')

    // Case 2: Invalid token → rejected (401)
    const case2 = await request('/test/protected', {
      headers: { Authorization: 'Bearer invalid.token.xyz123' },
    })
    assert('Case 2: Invalid token -> 401 unauthenticated', case2.status === 401 && case2.data?.code === 'unauthenticated')

    // Case 6: Registration attempts to assign ADMIN role → rejected/ignored (assigned CUSTOMER)
    const regRes = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Malicious Attacker',
        email: testCustomerEmail,
        phone: '9876543210',
        password: testCustomerPass,
        role: 'ADMIN', // Attempting privilege escalation
      }),
    })
    customerId = regRes.data?.user?.id
    customerToken = regRes.data?.token

    assert(
      'Case 6: Registration privilege escalation blocked (role assigned as CUSTOMER)',
      regRes.status === 201 && regRes.data?.user?.role === 'CUSTOMER',
      `Assigned role: ${regRes.data?.user?.role}`,
    )

    // Case 3: Valid CUSTOMER token → customer endpoint allowed (200)
    const case3 = await request('/test/protected', {
      headers: { Authorization: `Bearer ${customerToken}` },
    })
    assert(
      'Case 3: Valid CUSTOMER token -> customer endpoint allowed (200)',
      case3.status === 200 && case3.data?.success === true,
    )

    // Session Restore: GET /api/auth/me
    const meRes = await request('/auth/me', {
      headers: { Authorization: `Bearer ${customerToken}` },
    })
    assert(
      'Session restore: GET /api/auth/me returns safe customer identity without passwordHash',
      meRes.status === 200 &&
        meRes.data?.user?.id === customerId &&
        meRes.data?.user?.email === testCustomerEmail &&
        meRes.data?.user?.role === 'CUSTOMER' &&
        meRes.data?.user?.hasPassword === true &&
        meRes.data?.user?.passwordHash === undefined,
    )

    // Case 4: Valid CUSTOMER token → admin endpoint rejected (403)
    const case4 = await request('/test/admin-only', {
      headers: { Authorization: `Bearer ${customerToken}` },
    })
    assert(
      'Case 4: Valid CUSTOMER token -> admin endpoint rejected (403 forbidden_admin_access)',
      case4.status === 403 && case4.data?.code === 'forbidden_admin_access',
      `Status: ${case4.status}, Code: ${case4.data?.code}`,
    )

    // Provision test Admin via test endpoint
    const createAdminRes = await request('/test/create-admin', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Staff Operations Lead',
        email: testAdminEmail,
        password: testAdminPass,
      }),
    })
    adminId = createAdminRes.data?.user?.id

    // Admin login via canonical POST /api/auth/login
    const adminLoginRes = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: testAdminEmail,
        password: testAdminPass,
      }),
    })
    adminToken = adminLoginRes.data?.token
    assert(
      'Staff admin login succeeds via canonical POST /api/auth/login with role: ADMIN',
      adminLoginRes.status === 200 && adminLoginRes.data?.user?.role === 'ADMIN',
    )

    // Case 5: Valid ADMIN token → admin endpoint allowed (200)
    const case5 = await request('/test/admin-only', {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert(
      'Case 5: Valid ADMIN token -> admin endpoint allowed (200 success)',
      case5.status === 200 && case5.data?.success === true && case5.data?.user?.role === 'ADMIN',
    )

    // Case 7: User A attempts to access User B's resource → rejected (403)
    const case7Denied = await request(`/test/users/${adminId}/resource`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    })
    assert(
      'Case 7: Customer User A accessing User B resource -> 403 forbidden_resource',
      case7Denied.status === 403 && case7Denied.data?.code === 'forbidden_resource',
    )

    const case7Allowed = await request(`/test/users/${customerId}/resource`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    })
    assert(
      'Case 7: Customer User A accessing own resource -> 200 success',
      case7Allowed.status === 200 && case7Allowed.data?.ownerId === customerId,
    )

    // Profile update: Customer attempts to update profile without altering role
    const profileRes = await request('/auth/profile', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({
        name: 'Priya Venkatesh Updated',
        email: testCustomerEmail,
        phone: '9876543299',
        role: 'ADMIN', // Privilege escalation attempt
      }),
    })
    assert(
      'Profile update preserves role: CUSTOMER (cannot self-assign ADMIN via profile)',
      profileRes.status === 200 &&
        profileRes.data?.user?.role === 'CUSTOMER' &&
        profileRes.data?.user?.name === 'Priya Venkatesh Updated',
    )

    // Logout endpoint test
    const logoutRes = await request('/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerToken}` },
    })
    assert('Logout endpoint: POST /api/auth/logout succeeds (200)', logoutRes.status === 200 && logoutRes.data?.success === true)

  } finally {
    // Cleanup test users
    await request('/test/cleanup-user', {
      method: 'DELETE',
      body: JSON.stringify({ email: testCustomerEmail }),
    })
    await request('/test/cleanup-user', {
      method: 'DELETE',
      body: JSON.stringify({ email: testAdminEmail }),
    })
  }

  console.log('\n====================================================')
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`)
  console.log('====================================================')

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err)
  process.exit(1)
})
