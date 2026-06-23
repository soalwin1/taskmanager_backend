import express from 'express';
import multer from 'multer';
import path from 'path';
import { Op } from 'sequelize';
import Employee from '../models/Employee.js';
import DesignationPermission from '../models/DesignationPermission.js';
import auth from '../middleware/auth.js';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';

// Helper to construct public user profile response
async function formatUserResponse(employee) {
  const designationPerm = await DesignationPermission.findOne({ where: { designation: employee.designation } });
  const canCreateTasks = designationPerm ? designationPerm.canCreateTasks : true;
  const canEditTasks = designationPerm && designationPerm.canEditTasks !== undefined ? designationPerm.canEditTasks : true;
  const canDeleteTasks = designationPerm && designationPerm.canDeleteTasks !== undefined ? designationPerm.canDeleteTasks : true;
  
  const isManager = employee.designation === 'Manager';
  const canAccessUserDirectory = designationPerm && designationPerm.canAccessUserDirectory !== undefined 
    ? designationPerm.canAccessUserDirectory 
    : isManager;
  const canAccessApprovals = designationPerm && designationPerm.canAccessApprovals !== undefined 
    ? designationPerm.canAccessApprovals 
    : isManager;
  const canAccessAnalytics = designationPerm && designationPerm.canAccessAnalytics !== undefined 
    ? designationPerm.canAccessAnalytics 
    : isManager;

  return {
    id: employee.id,
    email: employee.email,
    fullName: employee.fullName,
    role: employee.role,
    designation: employee.designation,
    department: employee.department,
    phone: employee.phone,
    profilePicture: employee.profilePicture,
    canCreateTasks,
    canEditTasks,
    canDeleteTasks,
    canAccessUserDirectory,
    canAccessApprovals,
    canAccessAnalytics,
    mfaType: employee.mfaType || 'email',
    mfaEnabled: !!employee.mfaSecret
  };
}

const router = express.Router();

// Configure multer for local storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed!'));
  }
});

// Route to upload profile picture
router.post('/profile-picture', auth, upload.single('profilePicture'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const employeeId = req.user.id;
    const profilePictureUrl = `/api/uploads/${req.file.filename}`;

    // Update employee record
    const employee = await Employee.findByPk(employeeId);
    if (!employee) {
      return res.status(404).json({ message: 'User not found' });
    }

    await employee.update({ profilePicture: profilePictureUrl });

    res.json({
      message: 'Profile picture updated successfully',
      user: await formatUserResponse(employee)
    });
  } catch (error) {
    console.error('Error uploading profile picture:', error);
    res.status(500).json({ message: 'Server error during upload', error: String(error) });
  }
});

// Route to update user details
router.put('/profile', auth, async (req, res) => {
  try {
    const { fullName, email, phone } = req.body;
    const employeeId = req.user.id;

    if (!fullName || !email || !phone) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Check if email is already taken by another user
    const existingUser = await Employee.findOne({
      where: { email, id: { [Op.ne]: employeeId } }
    });
    if (existingUser) {
      return res.status(400).json({ message: 'Email is already in use by another account' });
    }

    const employee = await Employee.findByPk(employeeId);
    if (!employee) {
      return res.status(404).json({ message: 'User not found' });
    }

    await employee.update({ fullName, email, phone });

    res.json({
      message: 'Profile updated successfully',
      user: await formatUserResponse(employee)
    });

  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ message: 'Server error while updating profile', error: String(error) });
  }
});

// Route to get logged-in user details
router.get('/me', auth, async (req, res) => {
  try {
    const employee = await Employee.findByPk(req.user.id, {
      attributes: { exclude: ['password'] }
    });
    if (!employee) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(await formatUserResponse(employee));
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Route to setup TOTP (generate secret and QR code)
router.get('/mfa/setup', auth, async (req, res) => {
  try {
    const employee = await Employee.findByPk(req.user.id);
    if (!employee) {
      return res.status(404).json({ message: 'User not found' });
    }

    const secret = generateSecret();
    const otpauthUrl = generateURI({
      strategy: 'totp',
      issuer: 'TaskFlow',
      label: employee.email,
      secret: secret
    });
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    employee.mfaSecretTemp = secret;
    await employee.save();

    res.json({
      secret,
      qrCodeUrl
    });
  } catch (error) {
    console.error('Error during MFA setup:', error);
    res.status(500).json({ message: 'Server error during MFA setup', error: String(error) });
  }
});

// Route to verify TOTP setup and enable TOTP
router.post('/mfa/verify-setup', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ message: 'Verification code is required' });
    }

    const employee = await Employee.findByPk(req.user.id);
    if (!employee) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!employee.mfaSecretTemp) {
      return res.status(400).json({ message: 'MFA setup has not been initiated' });
    }

    const result = await verify({
      token: code,
      secret: employee.mfaSecretTemp
    });

    if (!result.valid) {
      return res.status(400).json({ message: 'Invalid verification code. Please try again.' });
    }

    employee.mfaSecret = employee.mfaSecretTemp;
    employee.mfaSecretTemp = null;
    employee.mfaType = 'totp';
    await employee.save();

    res.json({
      message: 'MFA setup successful. Authenticator App is now enabled.',
      user: await formatUserResponse(employee)
    });
  } catch (error) {
    console.error('Error during MFA verification:', error);
    res.status(500).json({ message: 'Server error during MFA verification', error: String(error) });
  }
});

// Route to toggle MFA type preference
router.put('/mfa/preference', auth, async (req, res) => {
  try {
    const { mfaType } = req.body;
    if (!mfaType || !['email', 'totp'].includes(mfaType)) {
      return res.status(400).json({ message: 'Invalid MFA type' });
    }

    const employee = await Employee.findByPk(req.user.id);
    if (!employee) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (mfaType === 'totp' && !employee.mfaSecret) {
      return res.status(400).json({ message: 'Please set up your Authenticator App first' });
    }

    employee.mfaType = mfaType;
    await employee.save();

    res.json({
      message: `MFA preference updated to ${mfaType === 'totp' ? 'Authenticator App' : 'Email OTP'}`,
      user: await formatUserResponse(employee)
    });
  } catch (error) {
    console.error('Error updating MFA preference:', error);
    res.status(500).json({ message: 'Server error updating MFA preference', error: String(error) });
  }
});

// Route to disable TOTP / set default back to email
router.post('/mfa/disable', auth, async (req, res) => {
  try {
    const employee = await Employee.findByPk(req.user.id);
    if (!employee) {
      return res.status(404).json({ message: 'User not found' });
    }

    employee.mfaSecret = null;
    employee.mfaSecretTemp = null;
    employee.mfaType = 'email';
    await employee.save();

    res.json({
      message: 'Authenticator App disabled. Defaulting back to Email OTP.',
      user: await formatUserResponse(employee)
    });
  } catch (error) {
    console.error('Error disabling MFA:', error);
    res.status(500).json({ message: 'Server error disabling MFA', error: String(error) });
  }
});

export default router;
