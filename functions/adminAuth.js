function authError(message, status) {
  return Object.assign(new Error(message), { status })
}

export async function verifyAdminUser(req, adminAuth, adminUid) {
  const idToken = req.get('x-firebase-id-token')
  if (!idToken) throw authError('Firebase administrator sign-in required.', 401)

  let decoded
  try {
    decoded = await adminAuth.verifyIdToken(idToken, true)
  } catch {
    throw authError('Firebase administrator sign-in is invalid or expired.', 401)
  }

  if (decoded.uid !== adminUid) throw authError('This Firebase account is not authorized for the CMS.', 403)
  return {
    sub: decoded.uid,
    email: typeof decoded.email === 'string' ? decoded.email : decoded.uid,
  }
}
