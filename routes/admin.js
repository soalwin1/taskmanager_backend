import express from 'express';
import { Op } from 'sequelize';
import Employee from '../models/Employee.js';
import Task from '../models/Task.js';
import DesignationPermission from '../models/DesignationPermission.js';
import authAdmin from '../middleware/authAdmin.js';
import Notification from '../models/Notification.js';

const router = express.Router();

// @route   GET /api/admin/users
// @desc    Get all users
// @access  Private (Admin or Manager/Delegated)
router.get('/users', authAdmin, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && !req.user.canAccessUserDirectory) {
      return res.status(403).json({ message: 'Access denied. User Directory privileges required.' });
    }

    let whereClause = {};
    if (req.user.role !== 'admin') {
      let dept = req.user.department;
      if (!dept) {
        const mgr = await Employee.findByPk(req.user.id);
        dept = mgr ? mgr.department : null;
      }
      whereClause = { department: dept, role: { [Op.ne]: 'admin' } };
    }

    // Return filtered users except passwords
    const users = await Employee.findAll({
      where: whereClause,
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']]
    });

    // Evaluate dynamic permissions for each user based on designation permission
    const permissions = await DesignationPermission.findAll();
    const formattedUsers = users.map(user => {
      const perm = permissions.find(p => p.designation === user.designation);
      const userObj = user.toJSON();
      userObj.canCreateTasks = perm ? perm.canCreateTasks : true;
      userObj.canEditTasks = perm && perm.canEditTasks !== undefined ? perm.canEditTasks : true;
      userObj.canDeleteTasks = perm && perm.canDeleteTasks !== undefined ? perm.canDeleteTasks : true;

      const isManager = user.designation === 'Manager';
      userObj.canAccessUserDirectory = perm && perm.canAccessUserDirectory !== undefined 
        ? perm.canAccessUserDirectory 
        : isManager;
      userObj.canAccessApprovals = perm && perm.canAccessApprovals !== undefined 
        ? perm.canAccessApprovals 
        : isManager;
      userObj.canAccessAnalytics = perm && perm.canAccessAnalytics !== undefined 
        ? perm.canAccessAnalytics 
        : isManager;
      return userObj;
    });

    res.json(formattedUsers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// @route   GET /api/admin/tasks
// @desc    Get all tasks (for approval)
// @access  Private (Admin or Manager/Delegated)
router.get('/tasks', authAdmin, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && !req.user.canAccessApprovals) {
      return res.status(403).json({ message: 'Access denied. Approvals privileges required.' });
    }

    let whereClause = { status: 'In Review' };
    if (req.user.role !== 'admin') {
      let dept = req.user.department;
      if (!dept) {
        const mgr = await Employee.findByPk(req.user.id);
        dept = mgr ? mgr.department : null;
      }
      const employees = await Employee.findAll({
        where: { department: dept, role: { [Op.ne]: 'admin' } },
        attributes: ['id']
      });
      const employeeIds = employees.map(e => e.id);
      whereClause.employeeId = { [Op.in]: employeeIds };
    }

    // Include employee data (replaces .populate())
    const tasks = await Task.findAll({
      where: whereClause,
      include: [{
        model: Employee,
        as: 'employee',
        attributes: ['fullName', 'email', 'department', 'designation']
      }],
      order: [['createdAt', 'DESC']]
    });
    res.json(tasks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// @route   GET /api/admin/tasks/all
// @desc    Get all tasks across the company (Analytics)
// @access  Private (Admin or Manager/Delegated)
router.get('/tasks/all', authAdmin, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && !req.user.canAccessAnalytics) {
      return res.status(403).json({ message: 'Access denied. Analytics privileges required.' });
    }

    let whereClause = {};
    if (req.user.role !== 'admin') {
      let dept = req.user.department;
      if (!dept) {
        const mgr = await Employee.findByPk(req.user.id);
        dept = mgr ? mgr.department : null;
      }
      const employees = await Employee.findAll({
        where: { department: dept, role: { [Op.ne]: 'admin' } },
        attributes: ['id']
      });
      const employeeIds = employees.map(e => e.id);
      whereClause.employeeId = { [Op.in]: employeeIds };
    }

    const tasks = await Task.findAll({
      where: whereClause,
      include: [{
        model: Employee,
        as: 'employee',
        attributes: ['fullName', 'email', 'department', 'designation']
      }],
      order: [['createdAt', 'DESC']]
    });
    res.json(tasks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// @route   PUT /api/admin/tasks/:id/approve
// @desc    Approve a task (mark as Completed)
// @access  Private (Admin or Manager/Delegated)
router.put('/tasks/:id/approve', authAdmin, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && !req.user.canAccessApprovals) {
      return res.status(403).json({ message: 'Access denied. Approvals privileges required.' });
    }

    const task = await Task.findByPk(req.params.id, {
      include: [{ model: Employee, as: 'employee' }]
    });
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    if (req.user.role !== 'admin') {
      let dept = req.user.department;
      if (!dept) {
        const mgr = await Employee.findByPk(req.user.id);
        dept = mgr ? mgr.department : null;
      }
      if (!task.employee || task.employee.role === 'admin' || task.employee.department !== dept) {
        return res.status(403).json({ message: 'Access denied. You can only approve tasks for employees in your department.' });
      }
    }

    await task.update({ status: 'Completed' });

    // Create and save notification
    const notification = await Notification.create({
      employeeId: task.employee.id,
      taskId: task.id,
      message: `Your task "${task.title}" has been approved.`,
      type: 'approval'
    });

    // Emit real-time notification
    if (req.io) {
      req.io.to(`user_${task.employee.id}`).emit('new_notification', notification);
    }

    // Reload task with employee fields expected by frontend
    const updatedTask = await Task.findByPk(task.id, {
      include: [{ model: Employee, as: 'employee', attributes: ['fullName', 'email', 'department', 'designation'] }]
    });

    res.json(updatedTask);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// @route   PUT /api/admin/tasks/:id/reject
// @desc    Reject a task (mark as Rejected) and add a remark
// @access  Private (Admin or Manager/Delegated)
router.put('/tasks/:id/reject', authAdmin, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && !req.user.canAccessApprovals) {
      return res.status(403).json({ message: 'Access denied. Approvals privileges required.' });
    }

    const { adminRemark } = req.body;
    const task = await Task.findByPk(req.params.id, {
      include: [{ model: Employee, as: 'employee' }]
    });

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    if (req.user.role !== 'admin') {
      let dept = req.user.department;
      if (!dept) {
        const mgr = await Employee.findByPk(req.user.id);
        dept = mgr ? mgr.department : null;
      }
      if (!task.employee || task.employee.role === 'admin' || task.employee.department !== dept) {
        return res.status(403).json({ message: 'Access denied. You can only reject tasks for employees in your department.' });
      }
    }

    await task.update({ status: 'Rejected', adminRemark: adminRemark || '' });

    // Create and save notification
    const notification = await Notification.create({
      employeeId: task.employee.id,
      taskId: task.id,
      message: `Your task "${task.title}" has been rejected. Remark: ${adminRemark || 'No remark provided.'}`,
      type: 'rejection'
    });

    // Emit real-time notification
    if (req.io) {
      req.io.to(`user_${task.employee.id}`).emit('new_notification', notification);
    }

    // Reload task with employee fields expected by frontend
    const updatedTask = await Task.findByPk(task.id, {
      include: [{ model: Employee, as: 'employee', attributes: ['fullName', 'email', 'department', 'designation'] }]
    });

    res.json(updatedTask);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// @route   GET /api/admin/designations/permissions
// @desc    Get all designation permissions
// @access  Private (Admin only)
router.get('/designations/permissions', authAdmin, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }

    let permissions = await DesignationPermission.findAll();
    
    // Seed defaults if not present
    const expected = ['Manager', 'CTO', 'Employee'];
    for (const desig of expected) {
      let perm = permissions.find(p => p.designation === desig);
      if (!perm) {
        perm = await DesignationPermission.create({ designation: desig, canCreateTasks: true });
        permissions.push(perm);
      }
    }
    
    res.json(permissions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// @route   POST /api/admin/designations/permissions
// @desc    Create a new designation permission (role)
// @access  Private (Admin only)
router.post('/designations/permissions', authAdmin, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }

    const { designation } = req.body;
    if (!designation || !designation.trim()) {
      return res.status(400).json({ message: 'Designation name is required' });
    }

    const cleanName = designation.trim();

    const existing = await DesignationPermission.findOne({ where: { designation: cleanName } });
    if (existing) {
      return res.status(400).json({ message: 'Designation already exists' });
    }

    const permission = await DesignationPermission.create({ designation: cleanName, canCreateTasks: true });

    res.status(201).json(permission);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// @route   PUT /api/admin/designations/permissions/rename
// @desc    Rename a designation and update all associated employees
// @access  Private (Admin only)
router.put('/designations/permissions/rename', authAdmin, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }

    const { oldName, newName } = req.body;
    if (!oldName || !newName || !newName.trim()) {
      return res.status(400).json({ message: 'Both old and new designation names are required' });
    }

    const oldNameClean = oldName.trim();
    const newNameClean = newName.trim();

    if (oldNameClean === newNameClean) {
      return res.status(400).json({ message: 'New designation name must be different' });
    }

    // Check if new designation name already exists
    const existing = await DesignationPermission.findOne({ where: { designation: newNameClean } });
    if (existing) {
      return res.status(400).json({ message: 'New designation name already exists' });
    }

    // Find old designation permission
    const permission = await DesignationPermission.findOne({ where: { designation: oldNameClean } });
    if (!permission) {
      return res.status(404).json({ message: 'Designation not found' });
    }

    // Update designation permission record
    await permission.update({ designation: newNameClean });

    // Update all employees having old designation
    await Employee.update({ designation: newNameClean }, { where: { designation: oldNameClean } });

    res.json(permission);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// @route   PUT /api/admin/designations/permissions
// @desc    Update permissions (create, edit, delete, directory, approvals, analytics) for a designation
// @access  Private (Admin only)
router.put('/designations/permissions', authAdmin, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }

    const { 
      designation, 
      canCreateTasks, 
      canEditTasks, 
      canDeleteTasks,
      canAccessUserDirectory,
      canAccessApprovals,
      canAccessAnalytics
    } = req.body;
    if (!designation) {
      return res.status(400).json({ message: 'Designation name is required.' });
    }

    let [permission] = await DesignationPermission.findOrCreate({
      where: { designation },
      defaults: { designation }
    });

    if (canCreateTasks !== undefined) {
      if (typeof canCreateTasks !== 'boolean') {
        return res.status(400).json({ message: 'canCreateTasks must be a boolean value' });
      }
      permission.canCreateTasks = canCreateTasks;
    }

    if (canEditTasks !== undefined) {
      if (typeof canEditTasks !== 'boolean') {
        return res.status(400).json({ message: 'canEditTasks must be a boolean value' });
      }
      permission.canEditTasks = canEditTasks;
    }

    if (canDeleteTasks !== undefined) {
      if (typeof canDeleteTasks !== 'boolean') {
        return res.status(400).json({ message: 'canDeleteTasks must be a boolean value' });
      }
      permission.canDeleteTasks = canDeleteTasks;
    }

    if (canAccessUserDirectory !== undefined) {
      if (typeof canAccessUserDirectory !== 'boolean') {
        return res.status(400).json({ message: 'canAccessUserDirectory must be a boolean value' });
      }
      permission.canAccessUserDirectory = canAccessUserDirectory;
    }

    if (canAccessApprovals !== undefined) {
      if (typeof canAccessApprovals !== 'boolean') {
        return res.status(400).json({ message: 'canAccessApprovals must be a boolean value' });
      }
      permission.canAccessApprovals = canAccessApprovals;
    }

    if (canAccessAnalytics !== undefined) {
      if (typeof canAccessAnalytics !== 'boolean') {
        return res.status(400).json({ message: 'canAccessAnalytics must be a boolean value' });
      }
      permission.canAccessAnalytics = canAccessAnalytics;
    }

    await permission.save();
    res.json(permission);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// @route   DELETE /api/admin/designations/permissions/:designation
// @desc    Delete a custom designation and reset users holding it to 'Employee'
// @access  Private (Admin only)
router.delete('/designations/permissions/:designation', authAdmin, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }

    const designation = decodeURIComponent(req.params.designation).trim();

    const protectedRoles = ['Manager', 'CTO', 'Employee'];
    if (protectedRoles.some(role => role.toLowerCase() === designation.toLowerCase())) {
      return res.status(400).json({ message: 'Default system designations cannot be deleted.' });
    }

    const deletedCount = await DesignationPermission.destroy({ where: { designation } });
    if (deletedCount === 0) {
      return res.status(404).json({ message: 'Designation not found.' });
    }

    // Update all employees having deleted designation to 'Employee'
    await Employee.update({ designation: 'Employee' }, { where: { designation } });

    res.json({ message: 'Designation deleted successfully', designation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});


// @route   PUT /api/admin/users/:id/permission
// @desc    Toggle task creation permission for a user (DEPRECATED)
// @access  Private (Admin or Manager)
router.put('/users/:id/permission', authAdmin, async (req, res) => {
  return res.status(400).json({ message: 'Individual user permissions are deprecated. Use designation-level permissions instead.' });
});

// @route   POST /api/admin/notifications/send
// @desc    Send custom notifications to a user, specific roles, or all users
// @access  Private (Admin only)
router.post('/notifications/send', authAdmin, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }

    const { title, message, targetType, targetUserId, targetRoles } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Notification title is required.' });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ message: 'Notification message is required.' });
    }
    if (!['user', 'role', 'all'].includes(targetType)) {
      return res.status(400).json({ message: 'Invalid target type.' });
    }

    let targetEmployees = [];

    if (targetType === 'user') {
      if (!targetUserId) {
        return res.status(400).json({ message: 'User selection is required.' });
      }
      const employee = await Employee.findByPk(targetUserId);
      if (!employee) {
        return res.status(404).json({ message: 'Target user not found.' });
      }
      targetEmployees = [employee];
    } else if (targetType === 'role') {
      if (!targetRoles || !Array.isArray(targetRoles) || targetRoles.length === 0) {
        return res.status(400).json({ message: 'At least one role must be selected.' });
      }
      targetEmployees = await Employee.findAll({ where: { designation: { [Op.in]: targetRoles } } });
    } else if (targetType === 'all') {
      targetEmployees = await Employee.findAll();
    }

    if (targetEmployees.length === 0) {
      return res.status(400).json({ message: 'No employees found matching the target selection.' });
    }

    // Prepare notifications
    const notificationsToSave = targetEmployees.map(emp => ({
      employeeId: emp.id,
      title: title.trim(),
      message: message.trim(),
      type: 'admin_message',
      read: false
    }));

    // Save notifications to DB (bulkCreate replaces insertMany)
    const savedNotifications = await Notification.bulkCreate(notificationsToSave);

    // Emit real-time updates via Socket.io
    if (req.io) {
      savedNotifications.forEach(notif => {
        req.io.to(`user_${notif.employeeId}`).emit('new_notification', notif);
      });
    }

    res.status(201).json({
      message: `Notification successfully sent to ${targetEmployees.length} employee(s).`,
      count: targetEmployees.length
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

export default router;
