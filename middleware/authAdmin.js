import jwt from 'jsonwebtoken';

export default function authAdmin(req, res, next) {
  const token = req.header('Authorization');

  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token.replace('Bearer ', ''), process.env.JWT_SECRET);
    req.user = decoded.user;
    
    // Check if the user has any admin privileges (explicit admin, manager, or delegated permissions)
    const user = req.user;
    const hasAdminAccess = 
      user.role === 'admin' || 
      user.designation === 'Manager' || 
      user.canAccessUserDirectory || 
      user.canAccessApprovals || 
      user.canAccessAnalytics;

    if (!hasAdminAccess) {
      return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }

    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
}
