import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Op } from 'sequelize';
import Employee from '../models/Employee.js';
import DesignationPermission from '../models/DesignationPermission.js';
import multer from 'multer';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { verify } from 'otplib';
import { loginLimiter, otpLimiter, forgotPassLimiter } from '../middleware/rateLimiter.js';

const upload = multer();


const router = express.Router();


// Register Route
router.post('/register', upload.none(),async (req, res) => {
  try {
    const { fullName, email, phone, department, designation, password } = req.body;

  console.log(req.body);
  

    // Validate backend side
    if (!fullName || !email || !phone || !department || !designation || !password) {
      return res.status(400).json({ message: 'All fields are mandatory' });
    }

    // Duplicate email check
    const existingEmployee = await Employee.findOne({ where: { email } });
    if (existingEmployee) {
      return res.status(400).json({ message: 'Email is already registered' });
    }

    // Password hashing
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insert employee
    const newEmployee = await Employee.create({
      fullName,
      email,
      phone,
      department,
      designation,
      password: hashedPassword,
    });

    res.status(201).json({ message: 'Registration successful', employeeId: newEmployee.id });
  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ message: 'Server error during registration', error: String(error), stack: error.stack });
  }
});

// Login Route
// Rate limited: 5 attempts per 15 minutes per IP
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Check email exists
    const employee = await Employee.findOne({ where: { email } });
    if (!employee) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, employee.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const { useEmailFallback, requestedMfaType } = req.body;

    // Determine verification method: use requested type if specified, fallback to saved preference
    const verifyType = useEmailFallback ? 'email' : (requestedMfaType || employee.mfaType || 'email');

    if (verifyType === 'totp') {
      if (!employee.mfaSecret) {
        return res.status(400).json({ 
          message: 'Authenticator App is not configured for this account. Please select Email OTP.' 
        });
      }
      return res.json({ 
        message: 'Authenticator app code required.', 
        requiresOtp: true, 
        mfaType: 'totp', 
        email: employee.email 
      });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    employee.otp = otp;
    employee.otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    await employee.save();

    // Send OTP email
    const mailOptions = {
      from: process.env.FROM_ADDRESS || `"TaskFlow Support" <${process.env.EMAIL_USER}>`,
      to: employee.email,
      subject: 'Your Login OTP - TaskFlow',
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; padding: 40px 20px; text-align: center;">
          <div style="max-width: 500px; margin: 0 auto; background: #ffffff; padding: 40px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0; text-align: left;">
            <div style="text-align: center; margin-bottom: 30px;">
              <span style="font-size: 24px; font-weight: bold; color: #4f46e5;">TaskFlow</span>
            </div>
            <h2 style="color: #1e293b; font-size: 22px; font-weight: 700; margin-bottom: 20px;">Login Verification</h2>
            <p style="color: #64748b; font-size: 15px; line-height: 1.6; margin-bottom: 30px;">
              Hello ${employee.fullName},<br/><br/>
              Your One-Time Password (OTP) for logging in is:
            </p>
            <div style="text-align: center; margin-bottom: 30px;">
              <div style="background-color: #f1f5f9; color: #4f46e5; padding: 14px 28px; font-size: 32px; font-weight: bold; letter-spacing: 8px; border-radius: 8px; display: inline-block; border: 1px dashed #cbd5e1;">
                ${otp}
              </div>
            </div>
            <p style="color: #94a3b8; font-size: 13px; line-height: 1.5; margin-bottom: 20px; border-top: 1px solid #e2e8f0; padding-top: 20px;">
              This code will expire in 5 minutes. If you did not request this, please ignore this email.
            </p>
          </div>
        </div>
      `
    };

    try {
      await getTransporter().sendMail(mailOptions);
    } catch (mailError) {
      console.warn('--- EMAIL DELIVERY FAILED (Local Fallback) ---');
      console.warn('OTP is:', otp);
    }

    res.json({ message: 'OTP sent to your email. Please verify to login.', requiresOtp: true, mfaType: 'email', email: employee.email });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'Server error during login', error: String(error), stack: error.stack });
  }
});

// Verify OTP Route
// Rate limited: 5 attempts per 10 minutes per IP
router.post('/verify-otp', otpLimiter, async (req, res) => {
  try {
    const { email, otp, mfaType } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP/Code are required' });
    }

    const employee = await Employee.findOne({ where: { email } });
    if (!employee) {
      return res.status(400).json({ message: 'Invalid email' });
    }

    // Determine verification method: use passed mfaType or fallback to stored user preference
    const verifyType = mfaType || employee.mfaType || 'email';

    if (verifyType === 'totp' && employee.mfaSecret) {
      const result = await verify({
        token: otp,
        secret: employee.mfaSecret
      });
      if (!result.valid) {
        return res.status(400).json({ message: 'Invalid or expired Authenticator code' });
      }
    } else {
      if (employee.otp !== otp || new Date(employee.otpExpires) < new Date()) {
        return res.status(400).json({ message: 'Invalid or expired OTP' });
      }
      // Clear OTP
      employee.otp = null;
      employee.otpExpires = null;
      await employee.save();
    }

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

    // JWT token generation
    const payload = {
      user: {
        id: employee.id,
        email: employee.email,
        fullName: employee.fullName,
        role: employee.role || 'user',
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
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '8h' },
      (err, token) => {
        if (err) throw err;
        res.json({ token, user: payload.user, message: 'Login Successful' });
      }
    );
  } catch (error) {
    console.error('Verify OTP Error:', error);
    res.status(500).json({ message: 'Server error during OTP verification', error: String(error) });
  }
});

// Setup mail transporter helper
let transporter;
const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT) || 465,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }
  return transporter;
};

// Forgot Password Route
// Rate limited: 3 attempts per 60 minutes per IP
router.post('/forgot-password', forgotPassLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const employee = await Employee.findOne({ where: { email } });
    if (!employee) {
      return res.status(400).json({ message: 'No employee registered with this email address' });
    }

    // Generate reset token
    const token = crypto.randomBytes(32).toString('hex');
    employee.resetPasswordToken = token;
    employee.resetPasswordExpires = new Date(Date.now() + 3600000); // 1 hour
    await employee.save();

    // Reset Link
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

    // Mail options
    const mailOptions = {
      from: process.env.FROM_ADDRESS || `"TaskFlow Support" <${process.env.EMAIL_USER}>`,
      to: employee.email,
      subject: 'Password Reset Request - TaskFlow',
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; padding: 40px 20px; text-align: center;">
          <div style="max-width: 500px; margin: 0 auto; background: #ffffff; padding: 40px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0; text-align: left;">
            <div style="text-align: center; margin-bottom: 30px;">
              <span style="font-size: 24px; font-weight: bold; color: #4f46e5;">TaskFlow</span>
            </div>
            <h2 style="color: #1e293b; font-size: 22px; font-weight: 700; margin-bottom: 20px;">Reset Your Password</h2>
            <p style="color: #64748b; font-size: 15px; line-height: 1.6; margin-bottom: 30px;">
              Hello ${employee.fullName},<br/><br/>
              We received a request to reset the password for your TaskFlow account. Click the button below to authorize and set a new password:
            </p>
            <div style="text-align: center; margin-bottom: 30px;">
              <a href="${resetUrl}" style="background-color: #4f46e5; color: #ffffff; padding: 14px 28px; text-decoration: none; font-size: 15px; font-weight: 600; border-radius: 8px; display: inline-block; box-shadow: 0 4px 6px rgba(79, 70, 229, 0.15);">
                Reset Password
              </a>
            </div>
            <p style="color: #94a3b8; font-size: 13px; line-height: 1.5; margin-bottom: 20px; border-top: 1px solid #e2e8f0; padding-top: 20px;">
              If you didn't request this reset, you can safely ignore this email. The link will expire in 1 hour.
            </p>
            <p style="color: #94a3b8; font-size: 11px;">
              If you're having trouble clicking the button, copy and paste this URL into your browser:<br/>
              <a href="${resetUrl}" style="color: #4f46e5; word-break: break-all;">${resetUrl}</a>
            </p>
          </div>
        </div>
      `
    };

    try {
      await getTransporter().sendMail(mailOptions);
      res.json({ message: 'Password reset link sent to your email successfully.' });
    } catch (mailError) {
      console.warn('--- EMAIL DELIVERY FAILED (Local Fallback) ---');
      console.warn('Nodemailer error:', mailError.message);
      console.warn('This is expected if there is no internet or SMTP port 465 is blocked.');
      console.warn('Copy and use the following link to reset your password:');
      console.warn(resetUrl);
      console.warn('----------------------------------------------');
      
      res.json({
        message: 'Password reset link generated. (Email sending failed, but you can copy the link below in dev mode)',
        devResetUrl: resetUrl
      });
    }
  } catch (error) {
    console.error('Forgot Password Error:', error);
    res.status(500).json({ message: 'Server error while processing forgot password request', error: String(error) });
  }
});

// Verify Reset Token Route
router.post('/verify-reset-token', async (req, res) => {
  try {
    const { email, token } = req.body;

    if (!email || !token) {
      return res.status(400).json({ message: 'Email and token are required' });
    }

    const employee = await Employee.findOne({
      where: {
        email,
        resetPasswordToken: token,
        resetPasswordExpires: { [Op.gt]: new Date() }
      }
    });

    if (!employee) {
      return res.status(400).json({ message: 'Invalid or expired password reset token' });
    }

    res.json({ valid: true, message: 'Token is valid' });
  } catch (error) {
    console.error('Verify Token Error:', error);
    res.status(500).json({ message: 'Server error while verifying token', error: String(error) });
  }
});

// Reset Password Route
router.post('/reset-password', async (req, res) => {
  try {
    const { email, token, password } = req.body;

    if (!email || !token || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const employee = await Employee.findOne({
      where: {
        email,
        resetPasswordToken: token,
        resetPasswordExpires: { [Op.gt]: new Date() }
      }
    });

    if (!employee) {
      return res.status(400).json({ message: 'Invalid or expired password reset token' });
    }

    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    employee.password = await bcrypt.hash(password, salt);

    // Clear reset token and expiration
    employee.resetPasswordToken = null;
    employee.resetPasswordExpires = null;
    await employee.save();

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

    // Generate JWT token for immediate authorization
    const payload = {
      user: {
        id: employee.id,
        email: employee.email,
        fullName: employee.fullName,
        role: employee.role || 'user',
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
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '8h' },
      (err, jwtToken) => {
        if (err) throw err;
        res.json({
          token: jwtToken,
          user: payload.user,
          message: 'Password has been reset successfully. You are now logged in.'
        });
      }
    );
  } catch (error) {
    console.error('Reset Password Error:', error);
    res.status(500).json({ message: 'Server error while resetting password', error: String(error) });
  }
});

// GET /api/designations
// public route to fetch all designations for register page dropdown
router.get('/designations', async (req, res) => {
  try {
    const permissions = await DesignationPermission.findAll({ attributes: ['designation'] });
    const designations = permissions.map(p => p.designation);
    res.json(designations);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching designations', error: String(error) });
  }
});

export default router;
