import express from 'express';
import Task from '../models/Task.js';
import Employee from '../models/Employee.js';
import DesignationPermission from '../models/DesignationPermission.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// @route   GET /api/tasks
// @desc    Get all tasks for the logged-in user
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const tasks = await Task.findAll({
      where: { employeeId: req.user.id },
      order: [['createdAt', 'DESC']]
    });
    res.json(tasks);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   POST /api/tasks
// @desc    Create a new task
// @access  Private
router.post('/', auth, async (req, res) => {
  try {
    const { title, description, priority, dueDate, status } = req.body;

    const employee = await Employee.findByPk(req.user.id);
    if (!employee) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check designation-level permission
    const designationPerm = await DesignationPermission.findOne({ where: { designation: employee.designation } });
    const canCreateTasks = designationPerm ? designationPerm.canCreateTasks : true;
    if (!canCreateTasks) {
      return res.status(403).json({ message: 'Permission denied. Task creation is disabled for this designation.' });
    }

    const task = await Task.create({
      title,
      description,
      priority,
      dueDate,
      status: status || 'Pending',
      employeeId: req.user.id
    });

    res.status(201).json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error', error: err.message, stack: err.stack });
  }
});

// @route   PUT /api/tasks/:id
// @desc    Update a task (e.g., status)
// @access  Private
router.put('/:id', auth, async (req, res) => {
  try {
    const employee = await Employee.findByPk(req.user.id);
    if (!employee) {
      return res.status(404).json({ message: 'User not found' });
    }

    const designationPerm = await DesignationPermission.findOne({ where: { designation: employee.designation } });
    const canEditTasks = designationPerm && designationPerm.canEditTasks !== undefined ? designationPerm.canEditTasks : true;
    if (!canEditTasks) {
      return res.status(403).json({ message: 'Permission denied. Task editing is disabled for this designation.' });
    }

    const { title, description, priority, dueDate, status } = req.body;

    // Build task fields object
    const taskFields = {};
    // Prevent regular users from marking tasks as Completed directly
    if (status === 'Completed') {
      return res.status(403).json({ message: 'Only admins can mark tasks as Completed. Please submit for review.' });
    }

    if (title) taskFields.title = title;
    if (description) taskFields.description = description;
    if (priority) taskFields.priority = priority;
    if (dueDate) taskFields.dueDate = dueDate;
    if (status) taskFields.status = status;

    // If actual task content is updated, reset status to Pending and clear adminRemark
    if (title || description || priority || dueDate) {
      taskFields.status = 'Pending';
      taskFields.adminRemark = '';
    }

    const task = await Task.findByPk(req.params.id);

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Make sure user owns task
    if (task.employeeId !== req.user.id) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    await task.update(taskFields);

    res.json(task);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   DELETE /api/tasks/:id
// @desc    Delete a task
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const employee = await Employee.findByPk(req.user.id);
    if (!employee) {
      return res.status(404).json({ message: 'User not found' });
    }

    const designationPerm = await DesignationPermission.findOne({ where: { designation: employee.designation } });
    const canDeleteTasks = designationPerm && designationPerm.canDeleteTasks !== undefined ? designationPerm.canDeleteTasks : true;
    if (!canDeleteTasks) {
      return res.status(403).json({ message: 'Permission denied. Task deletion is disabled for this designation.' });
    }

    const task = await Task.findByPk(req.params.id);

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Make sure user owns task
    if (task.employeeId !== req.user.id) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    await task.destroy();

    res.json({ message: 'Task removed' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

export default router;
